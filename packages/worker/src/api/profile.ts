// The `profile` area (member-app-core): the assembled profile (+ Kroger link state),
// the class (a) whole-document writes — preferences merge-patch and the taste /
// diet-principles markdown fields, each requiring `If-Match` against the companion
// GET's representation (D8; a lost race is a structured 412, never a clobber) — the
// derived retrospective read, and the Kroger consent-URL mint. Session-gated per route.

import { Hono } from "hono";
import type { Context } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag, requireIfMatch } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { assembleUserProfile } from "../tools.js";
import { applyPreferencesPatch } from "../write-tools.js";
import { readPreferences, readProfile, setProfileFields } from "../profile-db.js";
import { loadRetrospective } from "../cooking-tools.js";
import { buildKrogerConsentUrl } from "../oauth.js";
import { refreshKeyFor, type KvStore } from "../kroger-user.js";

/** The markdown field's conditional-write representation (what its GET serves). */
async function markdownDoc(
  c: Context<ApiEnv>,
  field: "taste" | "diet_principles",
): Promise<{ field: string; content: string | null }> {
  const tenant = c.get("tenant");
  const profile = await readProfile(c.env, tenant.id);
  return { field, content: profile[field] };
}

/** Boundary-validate + conditionally apply one markdown-field PUT (shared body). */
async function putMarkdown(c: Context<ApiEnv>, field: "taste" | "diet_principles") {
  const tenant = c.get("tenant");
  const body = await jsonBody<{ content?: unknown }>(c);
  if (typeof body.content !== "string") {
    throw new ToolError("validation_failed", "content must be the full markdown string");
  }
  await requireIfMatch(c, await markdownDoc(c, field));
  await setProfileFields(c.env, tenant.id, { [field]: body.content });
  return jsonWithEtag(c, { field: field as string, content: body.content as string | null });
}

export const profileArea = new Hono<ApiEnv>()
  // The assembled profile + the member's Kroger link state (refresh-token presence).
  .get("/profile", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const [profile, refresh] = await Promise.all([
      assembleUserProfile(c.env, tenant.id),
      (c.env.KROGER_KV as unknown as KvStore).get(refreshKeyFor(tenant.id)),
    ]);
    return jsonWithEtag(c, { ...profile, kroger: { linked: refresh !== null } });
  })
  // The preferences document — the class (a) representation the PATCH preconditions on.
  .get("/profile/preferences", requireSession, async (c) => {
    const tenant = c.get("tenant");
    return jsonWithEtag(c, { preferences: await readPreferences(c.env, tenant.id) });
  })
  // Merge-patch (RFC 7396) over preferences, conditional on If-Match; answers the
  // fresh document + ETag so the SPA rebases without a second round-trip.
  .patch("/profile/preferences", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<{ patch?: unknown }>(c);
    if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
      throw new ToolError("validation_failed", "patch must be a merge-patch object");
    }
    await requireIfMatch(c, { preferences: await readPreferences(c.env, tenant.id) });
    await applyPreferencesPatch(c.env, tenant.id, body.patch as Record<string, unknown>);
    return jsonWithEtag(c, { preferences: await readPreferences(c.env, tenant.id) });
  })
  // The two member-editable markdown fields: GET serves the conditional representation,
  // PUT replaces the whole field under If-Match.
  .get("/profile/taste", requireSession, async (c) => jsonWithEtag(c, await markdownDoc(c, "taste")))
  .put("/profile/taste", requireSession, (c) => putMarkdown(c, "taste"))
  .get("/profile/diet-principles", requireSession, async (c) => jsonWithEtag(c, await markdownDoc(c, "diet_principles")))
  .put("/profile/diet-principles", requireSession, (c) => putMarkdown(c, "diet_principles"))
  // The derived taste read: the SAME retrospective aggregation the MCP tool serves.
  .get("/profile/retrospective", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const period = c.req.query("period") ?? "month";
    return jsonWithEtag(c, await loadRetrospective(c.env, tenant.id, period));
  })
  // Mint the member's one-time Kroger consent link (bound to the session tenant).
  .get("/profile/kroger-login-url", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const origin = new URL(c.req.url).origin;
    const url = await buildKrogerConsentUrl(c.env.KROGER_KV as unknown as KvStore, origin, tenant.id);
    return c.json({ url });
  });
