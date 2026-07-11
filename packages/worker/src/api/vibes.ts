// The `vibes` area (member-app-core): the meal-vibe palette (production vocabulary,
// D11 — reads merge the log-derived last_satisfied; the row itself stores none), vibe
// CRUD through the shared add/patch ops (edit is class (a) under If-Match; create and
// delete are class (b) keyed on the slugified id), the reconciliation queue
// (pending proposals + the shared confirm op, D12), and the RETIRED suggest trigger:
// for one deprecation window POST /vibes/suggest is a pinned 410 stub (D8/D20 — the
// cron carries generation; the shipped SPA's button fails explicably, never the
// SPA-shell/404 trap, and no derivation or model runs). Session-gated per route.
// Static /vibes/proposals + /vibes/suggest are registered before /vibes/:id so the
// param route never swallows them.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag, requireIfMatch } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readNightVibes, readVibeLastSatisfied, deleteNightVibe, type NightVibe, type VibeMeal } from "../night-vibe-db.js";
import { addNightVibe, patchNightVibe, type NightVibeMeta } from "../night-vibe-tools.js";
import { readProposals } from "../reconcile-db.js";
import { resolveProposal } from "../reconcile-tools.js";

const WEATHER_VIBES = new Set(["grill", "cold-comfort", "wet", "soup", "comfort", "grill-friendly", "light", "no-grill"]);
const SEASONS = new Set(["spring", "summer", "fall", "winter"]);
const MEALS = new Set(["breakfast", "lunch", "dinner"]);

/** Boundary-validate the vibe metadata fields shared by create + edit (D11 vocabulary). */
function coerceMeta(o: Record<string, unknown>): NightVibeMeta {
  const meta: NightVibeMeta = {};
  if (o.facets !== undefined) {
    if (o.facets === null) {
      meta.facets = null; // explicit-null clearing
    } else if (typeof o.facets !== "object" || Array.isArray(o.facets)) {
      throw new ToolError("validation_failed", "facets must be an object (or null to clear)");
    } else {
      meta.facets = o.facets as Record<string, unknown>;
    }
  }
  if (o.cadence_days !== undefined) {
    if (o.cadence_days !== null && (typeof o.cadence_days !== "number" || !Number.isInteger(o.cadence_days) || o.cadence_days <= 0)) {
      throw new ToolError("validation_failed", "cadence_days must be a positive integer (or null to clear)");
    }
    meta.cadence_days = o.cadence_days as number | null;
  }
  if (o.pinned !== undefined) {
    if (typeof o.pinned !== "boolean") throw new ToolError("validation_failed", "pinned must be a boolean");
    meta.pinned = o.pinned;
  }
  if (o.base_weight !== undefined) {
    if (o.base_weight !== null && (typeof o.base_weight !== "number" || !(o.base_weight > 0))) {
      throw new ToolError("validation_failed", "base_weight must be a positive number (or null to clear)");
    }
    meta.base_weight = o.base_weight as number | null;
  }
  for (const key of ["weather_affinity", "weather_antipathy"] as const) {
    const v = o[key];
    if (v === undefined) continue;
    if (v !== null && (!Array.isArray(v) || v.some((t) => typeof t !== "string" || !WEATHER_VIBES.has(t)))) {
      throw new ToolError("validation_failed", `${key} must be an array of grill | cold-comfort | wet (or legacy) tags (or null to clear)`);
    }
    meta[key] = v as string[] | null;
  }
  if (o.season !== undefined) {
    if (!Array.isArray(o.season) || o.season.some((t) => typeof t !== "string" || !SEASONS.has(t))) {
      throw new ToolError("validation_failed", "season must be an array of spring | summer | fall | winter");
    }
    meta.season = o.season as string[];
  }
  if (o.members !== undefined) {
    if (o.members !== null && (!Array.isArray(o.members) || o.members.some((m) => typeof m !== "string" || !m))) {
      throw new ToolError("validation_failed", "members must be an array of non-empty member handles (or null to clear)");
    }
    meta.members = o.members as string[] | null;
  }
  return meta;
}

/** Boundary-validate the optional `meal` (settable, never null — the closed vibe set). */
function coerceMeal(o: Record<string, unknown>): VibeMeal | undefined {
  if (o.meal === undefined) return undefined;
  if (typeof o.meal !== "string" || !MEALS.has(o.meal)) {
    throw new ToolError("validation_failed", "meal must be breakfast | lunch | dinner");
  }
  return o.meal as VibeMeal;
}

/** One palette-page row: the stored vibe + its log-derived last-satisfied date. */
export type PaletteVibe = NightVibe & { last_satisfied: string | null };

export const vibesArea = new Hono<ApiEnv>()
  // Palette read: rows merged with derived last_satisfied (MAX(date) over
  // cooking_log.satisfied_vibe) — the cadence-debt meter is client-derived from it.
  .get("/vibes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const [vibes, last] = await Promise.all([
      readNightVibes(c.env, tenant.id),
      readVibeLastSatisfied(c.env, tenant.id),
    ]);
    const merged: PaletteVibe[] = vibes.map((v) => ({ ...v, last_satisfied: last.get(v.id) ?? null }));
    return jsonWithEtag(c, { vibes: merged });
  })
  // The reconciliation queue: the member's PENDING proposals (production shows dozens).
  .get("/vibes/proposals", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const proposals = await readProposals(c.env, tenant.id, "pending");
    return jsonWithEtag(c, { proposals });
  })
  // Confirm — the shared resolveProposal op: accept applies the diff, dismiss records
  // rejected (never re-surfaced); an already-resolved id answers structured conflict (D12).
  .post("/vibes/proposals/:id/confirm", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<{ accept?: unknown }>(c);
    if (typeof body.accept !== "boolean") {
      throw new ToolError("validation_failed", "accept must be an explicit boolean");
    }
    const result = await resolveProposal(c.env, tenant.id, c.req.param("id"), body.accept);
    return c.json(result);
  })
  // RETIRED (D8/D20 — the cron carries generation): the member-tappable suggest trigger
  // is cut. For one deprecation window the route stays registered as a pinned 410 stub —
  // the member-API route-level error convention (`c.json({ error: <literal>, message },
  // status)`, the csrf_rejected/rate_limited family; NOT a src/errors.ts ToolError code) —
  // so the deployed SPA's shipped button fails EXPLICABLY, never the SPA-shell/404 trap,
  // and no derivation and no model runs. Band 2's profile/vibes UI removes the button;
  // the window-close cleanup change removes this stub (the path then falls to the normal
  // unknown-API 404).
  .post("/vibes/suggest", requireSession, (c) => {
    return c.json({ error: "gone" as const,
      message: "Vibe suggestions now arrive automatically; this trigger was retired." }, 410);
  })
  // One raw vibe row — the class (a) representation the PATCH preconditions on
  // (derived fields excluded: a cook would spuriously fail an unrelated edit).
  .get("/vibes/:id", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const vibe = (await readNightVibes(c.env, tenant.id)).find((v) => v.id === id);
    if (!vibe) throw new ToolError("not_found", `no night vibe '${id}'`, { id });
    return jsonWithEtag(c, { vibe });
  })
  // Create — class (b)-shaped: slugified id; a duplicate answers structured conflict
  // (replay-converged, never a second row).
  .post("/vibes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const body = await jsonBody<Record<string, unknown>>(c);
    if (typeof body.vibe !== "string" || !body.vibe.trim()) {
      throw new ToolError("validation_failed", "vibe must be a non-empty phrase");
    }
    const id = body.id !== undefined ? String(body.id) : undefined;
    const result = await addNightVibe(c.env, tenant.id, { vibe: body.vibe, id, meal: coerceMeal(body), ...coerceMeta(body) });
    return c.json(result);
  })
  // Edit — class (a): requires If-Match against the raw-row representation (plan §6).
  .patch("/vibes/:id", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const body = await jsonBody<Record<string, unknown>>(c);
    const patch: { vibe?: string; meal?: VibeMeal } & NightVibeMeta = coerceMeta(body);
    const meal = coerceMeal(body);
    if (meal !== undefined) patch.meal = meal;
    if (body.vibe !== undefined) {
      if (typeof body.vibe !== "string" || !body.vibe.trim()) {
        throw new ToolError("validation_failed", "vibe must be a non-empty phrase");
      }
      patch.vibe = body.vibe;
    }
    const current = (await readNightVibes(c.env, tenant.id)).find((v) => v.id === id);
    if (!current) throw new ToolError("not_found", `no night vibe '${id}'`, { id });
    await requireIfMatch(c, { vibe: current });
    const result = await patchNightVibe(c.env, tenant.id, id, patch);
    return c.json(result);
  })
  // Delete — class (b): a second delivery finds nothing and reports converged.
  .delete("/vibes/:id", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const removed = await deleteNightVibe(c.env, tenant.id, c.req.param("id"));
    return c.json({ removed });
  });
