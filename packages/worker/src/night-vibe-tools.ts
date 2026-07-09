// CRUD tools for the per-tenant NIGHT-VIBE PALETTE (night-vibe-palette capability). A night
// vibe is a saved `search_recipes` spec (a `vibe` phrase + optional `facets`) plus lifecycle
// metadata: a `cadence_days` target period, `weather_affinity` weather-bucket membership
// (`grill`/`cold-comfort`/`wet`; legacy `meal_vibes` tags still accepted), an optional `season` lean, `pinned` (sticky weekly
// intent), and a `base_weight`. `propose_meal_plan` samples this palette to shape a week; the
// vibe text is embedded on the next cron tick (hash-gated) so a fresh vibe is retrievable a
// tick later. All writes are per-tenant private profile data — never shared.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { runTool, ToolError } from "./errors.js";
import { slugify } from "./discovery.js";
import { readNightVibes, upsertNightVibe, deleteNightVibe, type NightVibe } from "./night-vibe-db.js";

// The weather vocabulary the affinity tags declare. The PREFERRED values are the discrete
// weather-bucket categories `propose_meal_plan` allocates over (`grill`/`cold-comfort`/`wet`);
// the legacy `deriveVibes` tags (`soup`/`comfort`/`grill-friendly`/`light`/`no-grill`) are still
// accepted and resolved to a bucket through the same map (`resolveBucketMembership`), so an
// existing palette keeps working. The enum documents the useful values and catches typos.
const WEATHER_VIBE = z.enum(["grill", "cold-comfort", "wet", "soup", "comfort", "grill-friendly", "light", "no-grill"]);

/** The vibe hard-gate facets (the same `search_recipes` facets). Exported so the shared
 *  `propose_meal_plan` input can reuse it for the Claude-authored EPHEMERAL vibe set (converge
 *  D2 — an ephemeral vibe is the same primitive as a saved night vibe: a phrase + these facets). */
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

/** Shared shape for the metadata a vibe carries (used by add + update). */
const metaSchema = {
  facets: facetsSchema,
  cadence_days: z.number().int().positive().optional(),
  pinned: z.boolean().optional(),
  base_weight: z.number().positive().optional(),
  weather_affinity: z.array(WEATHER_VIBE).optional(),
  weather_antipathy: z.array(WEATHER_VIBE).optional(),
  season: z.array(z.enum(["spring", "summer", "fall", "winter"])).optional(),
};

/** The metadata fields a vibe carries beside its phrase (add + update + the member API). */
export interface NightVibeMeta {
  facets?: Record<string, unknown>;
  cadence_days?: number;
  pinned?: boolean;
  base_weight?: number;
  weather_affinity?: string[];
  weather_antipathy?: string[];
  season?: string[];
}

/**
 * The `add_night_vibe` core as a shared operation (member-app-core D2): derive/slugify
 * the id, reject a duplicate with structured `conflict` (replay-converged: a re-added
 * vibe answers conflict, never duplicates), upsert the row. Called by the MCP tool and
 * the member API's `POST /api/vibes`.
 */
export async function addNightVibe(
  env: Env,
  tenant: string,
  spec: { vibe: string; id?: string } & NightVibeMeta,
): Promise<{ id: string }> {
  const { vibe, id, ...meta } = spec;
  const vibeId = (id && slugify(id)) || slugify(vibe);
  if (!vibeId) throw new ToolError("validation_failed", "could not derive a vibe id from the input");
  const existing = await readNightVibes(env, tenant);
  if (existing.some((v) => v.id === vibeId)) {
    throw new ToolError("conflict", `night vibe '${vibeId}' already exists; use update_night_vibe`, { id: vibeId });
  }
  const row: NightVibe = { id: vibeId, vibe, ...meta };
  await upsertNightVibe(env, tenant, row, new Date().toISOString());
  return { id: vibeId };
}

/**
 * The `update_night_vibe` core as a shared operation (member-app-core D2): read-merge-
 * upsert preserving un-passed fields; unknown id → structured `not_found`. Called by
 * the MCP tool and the member API's `PATCH /api/vibes/:id`.
 */
export async function patchNightVibe(
  env: Env,
  tenant: string,
  id: string,
  patch: { vibe?: string } & NightVibeMeta,
): Promise<{ id: string; updated_fields: string[] }> {
  const existing = (await readNightVibes(env, tenant)).find((v) => v.id === id);
  if (!existing) throw new ToolError("not_found", `no night vibe '${id}'`, { id });
  const merged: NightVibe = { ...existing, ...patch, id, vibe: patch.vibe ?? existing.vibe };
  await upsertNightVibe(env, tenant, merged, new Date().toISOString());
  return { id, updated_fields: Object.keys(patch) };
}

export function registerNightVibeTools(server: McpServer, env: Env, tenant: string): void {
  server.registerTool(
    "list_night_vibes",
    {
      description:
        "List the caller's night-vibe palette — the durable, editable 'shape of a week' propose_meal_plan samples from. Each vibe is a saved search-spec (vibe phrase + optional facets) plus cadence/weather/season metadata. Per-tenant and private. Returns { vibes: [...] } (empty when the palette is unset).",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const vibes = await readNightVibes(env, tenant);
        return { vibes };
      }),
  );

  server.registerTool(
    "add_night_vibe",
    {
      description:
        "Add a night vibe to the caller's palette. `vibe` is the craving/query phrase (e.g. 'a simple, comforting weeknight Italian pasta'). Optional: an `id` (else derived from the vibe), hard-gate `facets`, a `cadence_days` target period (7 ≈ weekly, 30 ≈ monthly — drives the debt scheduler), `pinned` (sticky weekly intent), `weather_affinity` weather-bucket membership (grill|cold-comfort|wet — a legacy soup|comfort|grill-friendly|light|no-grill tag is also accepted), a `season` lean, and a `base_weight`. Rejects a duplicate id with `conflict` (use update_night_vibe). Returns { id }.",
      inputSchema: {
        vibe: z.string().min(1),
        id: z.string().optional(),
        ...metaSchema,
      },
    },
    ({ vibe, id, ...meta }) => runTool(() => addNightVibe(env, tenant, { vibe, id, ...meta })),
  );

  server.registerTool(
    "update_night_vibe",
    {
      description:
        "Patch an existing night vibe by `id` — pass only the fields to change (`vibe`, `facets`, `cadence_days`, `pinned`, `base_weight`, `weather_affinity`, `weather_antipathy`, `season`). Editing `vibe` re-embeds it on the next cron tick. An un-passed field is PRESERVED (there is no clear-a-field path); to drop an optional field, remove and re-add the vibe. Unknown id returns `not_found`. Returns { id, updated_fields }.",
      inputSchema: {
        id: z.string().min(1),
        vibe: z.string().min(1).optional(),
        ...metaSchema,
      },
    },
    ({ id, ...patch }) => runTool(() => patchNightVibe(env, tenant, id, patch)),
  );

  server.registerTool(
    "remove_night_vibe",
    {
      description:
        "Remove a night vibe from the caller's palette by `id`. Unknown id returns `not_found`. Its derived embedding is pruned on the next cron tick. Returns { id, removed: true }.",
      inputSchema: { id: z.string().min(1) },
    },
    ({ id }) =>
      runTool(async () => {
        const removed = await deleteNightVibe(env, tenant, id);
        if (!removed) throw new ToolError("not_found", `no night vibe '${id}'`, { id });
        return { id, removed: true };
      }),
  );
}
