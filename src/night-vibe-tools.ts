// CRUD tools for the per-tenant NIGHT-VIBE PALETTE (night-vibe-palette capability). A night
// vibe is a saved `search_recipes` spec (a `vibe` phrase + optional `facets`) plus lifecycle
// metadata: a `cadence_days` target period, `weather_affinity`/`weather_antipathy` tags (from
// the weather `meal_vibes` vocabulary), an optional `season` lean, `pinned` (sticky weekly
// intent), and a `base_weight`. `propose_meal_plan` samples this palette to shape a week; the
// vibe text is embedded on the next cron tick (hash-gated) so a fresh vibe is retrievable a
// tick later. All writes are per-tenant private profile data — never shared.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { runTool, ToolError } from "./errors.js";
import { slugify } from "./discovery.js";
import { readNightVibes, upsertNightVibe, deleteNightVibe, type NightVibe } from "./night-vibe-db.js";

// The controlled weather-vibe vocabulary the affinity tags join against (src/weather.ts
// `deriveVibes`). Kept permissive (a tag off this set simply never matches a forecast), but
// the enum documents the useful values and catches typos at the tool boundary.
const WEATHER_VIBE = z.enum(["soup", "comfort", "grill-friendly", "light", "no-grill"]);

const facetsSchema = z
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
        "Add a night vibe to the caller's palette. `vibe` is the craving/query phrase (e.g. 'a simple, comforting weeknight Italian pasta'). Optional: an `id` (else derived from the vibe), hard-gate `facets`, a `cadence_days` target period (7 ≈ weekly, 30 ≈ monthly — drives the debt scheduler), `pinned` (sticky weekly intent), `weather_affinity`/`weather_antipathy` tags (soup|comfort|grill-friendly|light|no-grill), a `season` lean, and a `base_weight`. Rejects a duplicate id with `conflict` (use update_night_vibe). Returns { id }.",
      inputSchema: {
        vibe: z.string().min(1),
        id: z.string().optional(),
        ...metaSchema,
      },
    },
    ({ vibe, id, ...meta }) =>
      runTool(async () => {
        const vibeId = (id && slugify(id)) || slugify(vibe);
        if (!vibeId) throw new ToolError("validation_failed", "could not derive a vibe id from the input");
        const existing = await readNightVibes(env, tenant);
        if (existing.some((v) => v.id === vibeId)) {
          throw new ToolError("conflict", `night vibe '${vibeId}' already exists; use update_night_vibe`, { id: vibeId });
        }
        const row: NightVibe = { id: vibeId, vibe, ...meta };
        await upsertNightVibe(env, tenant, row, new Date().toISOString());
        return { id: vibeId };
      }),
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
    ({ id, ...patch }) =>
      runTool(async () => {
        const existing = (await readNightVibes(env, tenant)).find((v) => v.id === id);
        if (!existing) throw new ToolError("not_found", `no night vibe '${id}'`, { id });
        const merged: NightVibe = { ...existing, ...patch, id, vibe: patch.vibe ?? existing.vibe };
        await upsertNightVibe(env, tenant, merged, new Date().toISOString());
        return { id, updated_fields: Object.keys(patch) };
      }),
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
