// The `vibes` area (member-app-core): the night-vibe palette (production vocabulary,
// D11 — reads merge the log-derived last_satisfied; the row itself stores none), vibe
// CRUD through the shared add/patch ops (edit is class (a) under If-Match; create and
// delete are class (b) keyed on the slugified id), the reconciliation queue
// (pending proposals + the shared confirm op, D12), and the job-health-gated suggest
// trigger (D7 — fresh-and-healthy answers throttled WITHOUT touching env.AI).
// Session-gated per route. Static /vibes/proposals + /vibes/suggest are registered
// before /vibes/:id so the param route never swallows them.

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag, requireIfMatch } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { readNightVibes, readVibeLastSatisfied, deleteNightVibe, type NightVibe } from "../night-vibe-db.js";
import { addNightVibe, patchNightVibe, type NightVibeMeta } from "../night-vibe-tools.js";
import { readProposals } from "../reconcile-db.js";
import { resolveProposal } from "../reconcile-tools.js";
import { readJobHealth } from "../health.js";
import { runDerivation, DERIVE_INTERVAL_MS, DEFAULT_MAX_SUGGESTIONS } from "../night-vibe-suggest.js";

const WEATHER_VIBES = new Set(["grill", "cold-comfort", "wet", "soup", "comfort", "grill-friendly", "light", "no-grill"]);
const SEASONS = new Set(["spring", "summer", "fall", "winter"]);

/** Boundary-validate the vibe metadata fields shared by create + edit (D11 vocabulary). */
function coerceMeta(o: Record<string, unknown>): NightVibeMeta {
  const meta: NightVibeMeta = {};
  if (o.facets !== undefined) {
    if (o.facets === null || typeof o.facets !== "object" || Array.isArray(o.facets)) {
      throw new ToolError("validation_failed", "facets must be an object");
    }
    meta.facets = o.facets as Record<string, unknown>;
  }
  if (o.cadence_days !== undefined && o.cadence_days !== null) {
    if (typeof o.cadence_days !== "number" || !Number.isInteger(o.cadence_days) || o.cadence_days <= 0) {
      throw new ToolError("validation_failed", "cadence_days must be a positive integer");
    }
    meta.cadence_days = o.cadence_days;
  }
  if (o.pinned !== undefined) {
    if (typeof o.pinned !== "boolean") throw new ToolError("validation_failed", "pinned must be a boolean");
    meta.pinned = o.pinned;
  }
  if (o.base_weight !== undefined && o.base_weight !== null) {
    if (typeof o.base_weight !== "number" || !(o.base_weight > 0)) {
      throw new ToolError("validation_failed", "base_weight must be a positive number");
    }
    meta.base_weight = o.base_weight;
  }
  for (const key of ["weather_affinity", "weather_antipathy"] as const) {
    const v = o[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((t) => typeof t !== "string" || !WEATHER_VIBES.has(t))) {
      throw new ToolError("validation_failed", `${key} must be an array of grill | cold-comfort | wet (or legacy) tags`);
    }
    meta[key] = v as string[];
  }
  if (o.season !== undefined) {
    if (!Array.isArray(o.season) || o.season.some((t) => typeof t !== "string" || !SEASONS.has(t))) {
      throw new ToolError("validation_failed", "season must be an array of spring | summer | fall | winter");
    }
    meta.season = o.season as string[];
  }
  return meta;
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
  // The gated suggest trigger (D7): a healthy archetype-derive run within the cron's
  // own interval answers throttled WITHOUT running derivation (no env.AI spend);
  // stale/unhealthy runs the bounded on-demand derivation (proposals land in the queue).
  .post("/vibes/suggest", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const now = Date.now();
    const last = await readJobHealth(c.env, "archetype-derive").catch(() => null);
    if (last && last.ok && now - last.last_run_at < DERIVE_INTERVAL_MS) {
      return c.json({
        throttled: true as const,
        retry_after_ms: Math.max(0, DERIVE_INTERVAL_MS - (now - last.last_run_at)),
      });
    }
    const seed = Number(new Date(now).toISOString().slice(0, 10).replace(/-/g, ""));
    const { candidates, enqueued, superseded, source } = await runDerivation(c.env, tenant.id, seed, DEFAULT_MAX_SUGGESTIONS, "request");
    return c.json({ throttled: false as const, candidates, enqueued, superseded, source });
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
    const result = await addNightVibe(c.env, tenant.id, { vibe: body.vibe, id, ...coerceMeta(body) });
    return c.json(result);
  })
  // Edit — class (a): requires If-Match against the raw-row representation (plan §6).
  .patch("/vibes/:id", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const id = c.req.param("id");
    const body = await jsonBody<Record<string, unknown>>(c);
    const patch: { vibe?: string } & NightVibeMeta = coerceMeta(body);
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
