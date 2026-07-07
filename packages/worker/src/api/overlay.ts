// The `overlay` area (member-app-core): the caller's per-tenant subjective layer —
// the favorites read and the EXPLICIT favorite set (never a toggle: the client sends
// the target boolean, so a replayed mutation converges, D8). Session-gated per route.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readOverlay } from "../profile-db.js";
import { setOverlay } from "../profile-db.js";
import { applyOverlayEdit } from "../overlay.js";
import { recipeMeta } from "../recipe-index.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const overlayArea = new Hono<ApiEnv>()
  // The caller's whole overlay (slug → { favorite?, reject? }); the favorites page
  // joins it to the client-cached index.
  .get("/overlay", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const overlay = await readOverlay(c.env, tenant.id);
    return jsonWithEtag(c, { overlay });
  })
  // Favorite as an EXPLICIT set — { slug, favorite: boolean }, keyed by slug (class (b)).
  .put("/overlay/favorite", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<{ slug?: unknown; favorite?: unknown }>(c);
    const slug = typeof body.slug === "string" ? body.slug : "";
    if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    if (typeof body.favorite !== "boolean") {
      throw new ToolError("validation_failed", "favorite must be an explicit boolean", { slug });
    }
    // Same existence rule as toggle_favorite: the slug must resolve against the index.
    const meta = await recipeMeta(c.env, [slug]);
    if (!meta.has(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    const current = await readOverlay(c.env, tenant.id);
    const next = applyOverlayEdit(current[slug], { favorite: body.favorite });
    await setOverlay(c.env, tenant.id, slug, next);
    return c.json({ slug, overlay: next ?? {} });
  });
