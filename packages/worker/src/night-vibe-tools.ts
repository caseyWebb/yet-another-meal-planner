// CRUD tools for the per-tenant MEAL-VIBE PALETTE (meal-vibe-palette capability). A meal
// vibe is a saved `search_recipes` spec (a `vibe` phrase + optional `facets`) plus a
// `meal` dimension (breakfast | lunch | dinner — which meal's palette it samples into),
// an optional `members` assignment (D29-final; NULL = everyone), and lifecycle
// metadata: a `cadence_days` target period, `weather_affinity` weather-bucket membership
// (`grill`/`cold-comfort`/`wet`; legacy `meal_vibes` tags still accepted — dinner-scoped in
// allocation), an optional `season` lean, `pinned` (sticky weekly intent), and a
// `base_weight`. `propose_meal_plan` samples this palette per meal to shape a week; the
// vibe text is embedded on the next cron tick (hash-gated) so a fresh vibe is retrievable a
// tick later. All writes are per-tenant private profile data — never shared.
//
// D21 rename: the canonical tool names are `list/add/update/remove_meal_vibes`; the old
// `*_night_vibe` names stay registered for ONE deprecation window as DISPATCH ALIASES
// onto the identical shared ops — identical requests, identical responses, no warnings
// injection — removed by the window-close cleanup change. The D1 tables keep their
// `night_vibes`/`night_vibe_derived` names deliberately (a tool-contract decision, not a
// schema one).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { runTool, ToolError } from "./errors.js";
import { slugify } from "./discovery.js";
import { readNightVibes, upsertNightVibe, deleteNightVibe, VIBE_MEALS, type NightVibe, type VibeMeal } from "./night-vibe-db.js";

// The weather vocabulary the affinity tags declare. The PREFERRED values are the discrete
// weather-bucket categories `propose_meal_plan` allocates over (`grill`/`cold-comfort`/`wet`);
// the legacy `deriveVibes` tags (`soup`/`comfort`/`grill-friendly`/`light`/`no-grill`) are still
// accepted and resolved to a bucket through the same map (`resolveBucketMembership`), so an
// existing palette keeps working. The enum documents the useful values and catches typos.
const WEATHER_VIBE = z.enum(["grill", "cold-comfort", "wet", "soup", "comfort", "grill-friendly", "light", "no-grill"]);

/** The vibe hard-gate facets (the same `search_recipes` facets). Exported so the shared
 *  `propose_meal_plan` input can reuse it for the Claude-authored EPHEMERAL vibe set (converge
 *  D2 — an ephemeral vibe is the same primitive as a saved meal vibe: a phrase + these facets). */
export const facetsSchema = z
  .object({
    protein: z.string().optional(),
    cuisine: z.string().optional(),
    course: z.string().optional(),
    query: z.string().optional(),
    season: z.string().optional(),
    dietary: z.array(z.string()).optional(),
    max_time_total: z.number().optional(),
  })
  .passthrough()
  .optional();

/** Shared shape for the metadata a vibe carries (add + update). On `update_meal_vibe`
 *  the clearable fields accept an EXPLICIT null (clears the field; absent preserves). */
const metaSchema = {
  facets: facetsSchema.nullable(),
  cadence_days: z.number().int().positive().nullable().optional(),
  pinned: z.boolean().optional(),
  base_weight: z.number().positive().nullable().optional(),
  weather_affinity: z.array(WEATHER_VIBE).nullable().optional(),
  weather_antipathy: z.array(WEATHER_VIBE).nullable().optional(),
  season: z.array(z.enum(["spring", "summer", "fall", "winter"])).nullable().optional(),
  members: z.array(z.string().min(1)).nullable().optional(),
};

/** The metadata fields a vibe carries beside its phrase and meal (add + update + the
 *  member API). A `null` on the update path CLEARS that field (explicit-null clearing);
 *  absent preserves. */
export interface NightVibeMeta {
  facets?: Record<string, unknown> | null;
  cadence_days?: number | null;
  pinned?: boolean;
  base_weight?: number | null;
  weather_affinity?: string[] | null;
  weather_antipathy?: string[] | null;
  season?: string[] | null;
  members?: string[] | null;
}

/** Fields an explicit `null` clears on update (design: explicit-null field clearing). */
const CLEARABLE = ["facets", "cadence_days", "base_weight", "weather_affinity", "weather_antipathy", "season", "members"] as const;

/** Validate + normalize a `members` assignment: non-empty strings, deduped, verbatim. */
function normalizeMembers(members: string[] | null | undefined): string[] | null | undefined {
  if (members == null) return members;
  const out: string[] = [];
  for (const m of members) {
    const s = String(m);
    if (!s) throw new ToolError("validation_failed", "members entries must be non-empty strings");
    if (!out.includes(s)) out.push(s);
  }
  return out.length ? out : null;
}

/**
 * The `add_meal_vibe` core as a shared operation (member-app-core D2): derive/slugify
 * the id, reject a duplicate with structured `conflict` (replay-converged: a re-added
 * vibe answers conflict, never duplicates), upsert the row. `meal` defaults `'dinner'`.
 * Called by the MCP tool (and its `add_night_vibe` alias) and the member API's
 * `POST /api/vibes`.
 */
export async function addNightVibe(
  env: Env,
  tenant: string,
  spec: { vibe: string; id?: string; meal?: VibeMeal } & NightVibeMeta,
): Promise<{ id: string }> {
  const { vibe, id, meal, members, ...meta } = spec;
  const vibeId = (id && slugify(id)) || slugify(vibe);
  if (!vibeId) throw new ToolError("validation_failed", "could not derive a vibe id from the input");
  const existing = await readNightVibes(env, tenant);
  if (existing.some((v) => v.id === vibeId)) {
    throw new ToolError("conflict", `meal vibe '${vibeId}' already exists; use update_meal_vibe`, { id: vibeId });
  }
  const row: NightVibe = { id: vibeId, vibe, meal: meal ?? "dinner" };
  const normalizedMembers = normalizeMembers(members);
  if (normalizedMembers) row.members = normalizedMembers;
  for (const [k, v] of Object.entries(meta)) {
    if (v != null) (row as unknown as Record<string, unknown>)[k] = v;
  }
  await upsertNightVibe(env, tenant, row, new Date().toISOString());
  return { id: vibeId };
}

/**
 * The `update_meal_vibe` core as a shared operation (member-app-core D2): read-merge-
 * upsert with EXPLICIT-NULL FIELD CLEARING — a supplied `null` clears `cadence_days`,
 * `base_weight`, `weather_affinity`, `weather_antipathy`, `season`, `facets`, or
 * `members`; an absent field is preserved. `meal` is settable (moves the vibe between
 * meal palettes — no re-embed, the embedding hash covers the phrase) but never null;
 * `vibe` is never null. Unknown id → structured `not_found`. Called by the MCP tool
 * (and its `update_night_vibe` alias) and the member API's `PATCH /api/vibes/:id`.
 */
export async function patchNightVibe(
  env: Env,
  tenant: string,
  id: string,
  patch: { vibe?: string; meal?: VibeMeal } & NightVibeMeta,
): Promise<{ id: string; updated_fields: string[] }> {
  const existing = (await readNightVibes(env, tenant)).find((v) => v.id === id);
  if (!existing) throw new ToolError("not_found", `no meal vibe '${id}'`, { id });
  const merged: NightVibe = { ...existing, id };
  if (patch.vibe !== undefined) {
    if (patch.vibe === null || !patch.vibe) throw new ToolError("validation_failed", "vibe is not clearable — supply a phrase");
    merged.vibe = patch.vibe;
  }
  if (patch.meal !== undefined) {
    if (patch.meal === null || !(VIBE_MEALS as readonly string[]).includes(patch.meal)) {
      throw new ToolError("validation_failed", "meal is not clearable — it must be breakfast | lunch | dinner");
    }
    merged.meal = patch.meal;
  }
  if (patch.pinned !== undefined) merged.pinned = patch.pinned;
  for (const key of CLEARABLE) {
    if (!(key in patch)) continue;
    const v = key === "members" ? normalizeMembers(patch.members) : (patch as unknown as Record<string, unknown>)[key];
    if (v == null) delete (merged as unknown as Record<string, unknown>)[key];
    else (merged as unknown as Record<string, unknown>)[key] = v;
  }
  await upsertNightVibe(env, tenant, merged, new Date().toISOString());
  return { id, updated_fields: Object.keys(patch) };
}

/** One line replaces a deprecated alias's whole description (D21's dispatch framing). */
export const aliasDescription = (canonical: string): string =>
  `Deprecated alias of \`${canonical}\` — identical behavior; use the new name.`;

const MEAL_ENUM = z.enum(["breakfast", "lunch", "dinner"]);

export function registerNightVibeTools(server: McpServer, env: Env, tenant: string): void {
  // Each tool registers TWICE — the canonical `*_meal_vibe` name with the full
  // description, and the deprecated `*_night_vibe` name as a dispatch alias onto the
  // SAME handler (one op layer, identical requests and responses, no warnings
  // injection — D21's dispatch framing). The aliases go at window close.

  const listSchema = {};
  const listHandler = () =>
    runTool(async () => {
      const vibes = await readNightVibes(env, tenant);
      return { vibes };
    });
  const LIST_DESC =
    "List the caller's meal-vibe palette — the durable, editable 'shape of a week' propose_meal_plan samples from, per meal. Each vibe is a saved search-spec (vibe phrase + optional facets) plus its `meal` (breakfast | lunch | dinner — which meal's slots it can fill), optional `members` (who it applies to; absent = everyone), and cadence/weather/season metadata. Per-tenant and private. Returns { vibes: [...] } (empty when the palette is unset).";
  server.registerTool("list_meal_vibes", { description: LIST_DESC, inputSchema: listSchema }, listHandler);
  server.registerTool("list_night_vibes", { description: aliasDescription("list_meal_vibes"), inputSchema: listSchema }, listHandler);

  const addSchema = {
    vibe: z.string().min(1),
    id: z.string().optional(),
    meal: MEAL_ENUM.optional(),
    ...metaSchema,
  };
  const addHandler = ({ vibe, id, meal, ...meta }: { vibe: string; id?: string; meal?: VibeMeal } & NightVibeMeta) =>
    runTool(() => addNightVibe(env, tenant, { vibe, id, meal, ...meta }));
  const ADD_DESC =
    "Add a meal vibe to the caller's palette. `vibe` is the craving/query phrase (e.g. 'a simple, comforting weeknight Italian pasta'). `meal` (breakfast | lunch | dinner, default dinner) picks which meal's palette it samples into — a lunch vibe only ever fills lunch slots. Optional: an `id` (else derived from the vibe), hard-gate `facets`, a `cadence_days` target period (7 ≈ weekly, 30 ≈ monthly — drives the debt scheduler), `pinned` (sticky weekly intent), `weather_affinity` weather-bucket membership (grill|cold-comfort|wet — a legacy soup|comfort|grill-friendly|light|no-grill tag is also accepted; weather shapes DINNER slots only, so it is stored but inert on a non-dinner vibe), a `season` lean, a `base_weight`, and `members` (opaque member handles this vibe applies to — omitted means everyone; an assigned vibe contributes slots only when one of its members is eating that week, and a members list naming nobody the household recognizes contributes as everyone rather than silently vanishing). Rejects a duplicate id with `conflict` (use update_meal_vibe). Returns { id }.";
  server.registerTool("add_meal_vibe", { description: ADD_DESC, inputSchema: addSchema }, addHandler);
  server.registerTool("add_night_vibe", { description: aliasDescription("add_meal_vibe"), inputSchema: addSchema }, addHandler);

  const updateSchema = {
    id: z.string().min(1),
    vibe: z.string().min(1).optional(),
    meal: MEAL_ENUM.optional(),
    ...metaSchema,
  };
  const updateHandler = ({ id, ...patch }: { id: string; vibe?: string; meal?: VibeMeal } & NightVibeMeta) =>
    runTool(() => patchNightVibe(env, tenant, id, patch));
  const UPDATE_DESC =
    "Patch an existing meal vibe by `id` — pass only the fields to change (`vibe`, `meal`, `facets`, `cadence_days`, `pinned`, `base_weight`, `weather_affinity`, `weather_antipathy`, `season`, `members`). An un-passed field is PRESERVED; passing an EXPLICIT null CLEARS `cadence_days`, `base_weight`, `weather_affinity`, `weather_antipathy`, `season`, `facets`, or `members` (members: null returns the vibe to everyone). `meal` is settable (moves the vibe to another meal's palette — no re-embed; the embedding covers the phrase) but never null; `vibe` is never null (editing it re-embeds on the next cron tick). Unknown id returns `not_found`. Returns { id, updated_fields }.";
  server.registerTool("update_meal_vibe", { description: UPDATE_DESC, inputSchema: updateSchema }, updateHandler);
  server.registerTool("update_night_vibe", { description: aliasDescription("update_meal_vibe"), inputSchema: updateSchema }, updateHandler);

  const removeSchema = { id: z.string().min(1) };
  const removeHandler = ({ id }: { id: string }) =>
    runTool(async () => {
      const removed = await deleteNightVibe(env, tenant, id);
      if (!removed) throw new ToolError("not_found", `no meal vibe '${id}'`, { id });
      return { id, removed: true };
    });
  const REMOVE_DESC =
    "Remove a meal vibe from the caller's palette by `id`. Unknown id returns `not_found`. Its derived embedding is pruned on the next cron tick. Returns { id, removed: true }.";
  server.registerTool("remove_meal_vibe", { description: REMOVE_DESC, inputSchema: removeSchema }, removeHandler);
  server.registerTool("remove_night_vibe", { description: aliasDescription("remove_meal_vibe"), inputSchema: removeSchema }, removeHandler);
}
