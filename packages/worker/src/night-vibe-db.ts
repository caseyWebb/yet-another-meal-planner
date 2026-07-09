// D1 access for the per-tenant NIGHT-VIBE PALETTE (night-vibe-palette capability). Reads and
// writes the `night_vibes` rows (the palette) and reads the sibling `night_vibe_derived`
// vectors (produced by the embedding reconcile in src/night-vibe-vector.ts). Like every tool
// data-path, all D1 goes through `src/db.ts` so failures map to a structured `storage_error`.

import { db } from "./db.js";
import type { Env } from "./env.js";

/** A night vibe as the palette + scheduler see it (the row, decoded). */
export interface NightVibe {
  id: string;
  vibe: string;
  /** Optional hard-gate facets for the slot's retrieval (the same `search_recipes` facets). */
  facets?: Record<string, unknown>;
  /** Target cadence period in days; null/absent = no cadence pressure (occasional). */
  cadence_days?: number | null;
  /** Sticky weekly intent — placed when due, exempt from the weather reserve. */
  pinned?: boolean;
  /** Base sampling weight before debt/weather (null → 1). */
  base_weight?: number | null;
  /** Weather meal_vibes that favor this vibe. */
  weather_affinity?: string[];
  /** Weather meal_vibes that suppress it. */
  weather_antipathy?: string[];
  /** Seasonal lean (spring|summer|fall|winter). */
  season?: string[];
  /** ISO timestamp the vibe was created (read-only; drives the reconcile's "stale, ignored" signal). */
  created_at?: string | null;
}

interface NightVibeRow {
  id: string;
  vibe: string;
  facets: string | null;
  cadence_days: number | null;
  pinned: number;
  base_weight: number | null;
  weather_affinity: string | null;
  weather_antipathy: string | null;
  season: string | null;
  created_at: string | null;
}

function parseJsonArray(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  } catch {
    // a malformed cell self-heals on the next write; never abort a read over one row
  }
  return undefined;
}

function decodeVibe(row: NightVibeRow): NightVibe {
  const out: NightVibe = { id: row.id, vibe: row.vibe };
  if (row.facets) {
    try {
      const f = JSON.parse(row.facets);
      if (f && typeof f === "object") out.facets = f as Record<string, unknown>;
    } catch {
      /* ignore a bad facets cell */
    }
  }
  if (row.cadence_days != null) out.cadence_days = row.cadence_days;
  if (row.pinned) out.pinned = true;
  if (row.base_weight != null) out.base_weight = row.base_weight;
  const wa = parseJsonArray(row.weather_affinity);
  if (wa) out.weather_affinity = wa;
  const wan = parseJsonArray(row.weather_antipathy);
  if (wan) out.weather_antipathy = wan;
  const se = parseJsonArray(row.season);
  if (se) out.season = se;
  if (row.created_at) out.created_at = row.created_at;
  return out;
}

/** Every night vibe in the caller's palette, id-ordered. */
export async function readNightVibes(env: Env, tenant: string): Promise<NightVibe[]> {
  const rows = await db(env).all<NightVibeRow>(
    "SELECT id, vibe, facets, cadence_days, pinned, base_weight, weather_affinity, weather_antipathy, season, created_at " +
      "FROM night_vibes WHERE tenant = ?1 ORDER BY id",
    tenant,
  );
  return rows.map(decodeVibe);
}

const UPSERT_SQL =
  "INSERT INTO night_vibes (tenant, id, vibe, facets, cadence_days, pinned, base_weight, weather_affinity, weather_antipathy, season, created_at, updated_at) " +
  "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11) " +
  "ON CONFLICT(tenant, id) DO UPDATE SET vibe = excluded.vibe, facets = excluded.facets, cadence_days = excluded.cadence_days, " +
  "pinned = excluded.pinned, base_weight = excluded.base_weight, weather_affinity = excluded.weather_affinity, " +
  "weather_antipathy = excluded.weather_antipathy, season = excluded.season, updated_at = excluded.updated_at";

const jsonOrNull = (v: unknown): string | null =>
  v == null || (Array.isArray(v) && v.length === 0) ? null : JSON.stringify(v);

/** Insert or update one night vibe (keyed by `(tenant, id)`). Returns nothing; the embedding
 *  reconciles on the next cron tick from the new `vibe` text (hash-gated). */
export async function upsertNightVibe(env: Env, tenant: string, vibe: NightVibe, nowIso: string): Promise<void> {
  await db(env).run(
    UPSERT_SQL,
    tenant,
    vibe.id,
    vibe.vibe,
    jsonOrNull(vibe.facets),
    vibe.cadence_days ?? null,
    vibe.pinned ? 1 : 0,
    vibe.base_weight ?? null,
    jsonOrNull(vibe.weather_affinity),
    jsonOrNull(vibe.weather_antipathy),
    jsonOrNull(vibe.season),
    nowIso,
  );
}

/** Delete one night vibe. Returns true when a row was removed. The sibling derived row is
 *  pruned by the reconcile (its (tenant,id) no longer has a vibe). */
export async function deleteNightVibe(env: Env, tenant: string, id: string): Promise<boolean> {
  const r = await db(env).run("DELETE FROM night_vibes WHERE tenant = ?1 AND id = ?2", tenant, id);
  return r.changes > 0;
}

/** The caller's derived `last_satisfied(vibe)` — `MAX(date)` over cooking-log rows attributed
 *  to each vibe by slot provenance (`satisfied_vibe`). Vibe id → YYYY-MM-DD. Off-plan cooks
 *  (null `satisfied_vibe`) never appear, so an unsatisfied vibe is simply absent (max debt). */
export async function readVibeLastSatisfied(env: Env, tenant: string): Promise<Map<string, string>> {
  const rows = await db(env).all<{ satisfied_vibe: string; d: string }>(
    "SELECT satisfied_vibe, MAX(date) AS d FROM cooking_log " +
      "WHERE tenant = ?1 AND satisfied_vibe IS NOT NULL GROUP BY satisfied_vibe",
    tenant,
  );
  const map = new Map<string, string>();
  for (const r of rows) if (r.satisfied_vibe && r.d) map.set(r.satisfied_vibe, r.d);
  return map;
}

/** A palette vibe's cadence status — the same `overdue | due | soon | ok` bucketing the member
 *  app computes client-side (`statusOf` in `packages/app/src/routes/_app.profile.tsx`). */
export type VibeCadenceStatus = "overdue" | "due" | "soon" | "ok";

/**
 * Bucket one vibe's cadence status, mirroring the member app's `statusOf`/`daysSince` exactly:
 * a debt ratio `days_since(anchor) / cadence_days` (floor of whole days, `now`-relative) is
 * bucketed overdue (≥ 1.5) / due (≥ 1) / soon (≥ 0.6) / ok. The anchor is `last_satisfied`, else
 * the vibe's created date, else none. A vibe with no cadence (unset/≤ 0) or no anchor is `ok`.
 */
export function vibeCadenceStatus(vibe: NightVibe, lastSatisfied: string | null, now: Date): VibeCadenceStatus {
  const cadence = vibe.cadence_days ?? null;
  let ratio = 0;
  if (cadence && cadence > 0) {
    const anchor = lastSatisfied ?? (vibe.created_at ? vibe.created_at.slice(0, 10) : null);
    if (anchor) ratio = Math.floor((now.getTime() - Date.parse(`${anchor}T00:00:00`)) / 86_400_000) / cadence;
  }
  if (ratio >= 1.5) return "overdue";
  if (ratio >= 1) return "due";
  if (ratio >= 0.6) return "soon";
  return "ok";
}

/** A palette vibe as the profile read surfaces it: the stored vibe, its log-derived
 *  last-satisfied date, and its derived cadence status. */
export type ProfilePaletteVibe = NightVibe & { last_satisfied: string | null; status: VibeCadenceStatus };

/** The caller's night-vibe palette for the profile read (data-read-tools D5): each saved vibe
 *  merged with its derived `last_satisfied` and cadence status, reusing `readNightVibes` +
 *  `readVibeLastSatisfied` rather than re-querying. Id-ordered, as `readNightVibes` returns. */
export async function readNightVibePalette(env: Env, tenant: string, now: Date): Promise<ProfilePaletteVibe[]> {
  const [vibes, last] = await Promise.all([readNightVibes(env, tenant), readVibeLastSatisfied(env, tenant)]);
  return vibes.map((v) => {
    const last_satisfied = last.get(v.id) ?? null;
    return { ...v, last_satisfied, status: vibeCadenceStatus(v, last_satisfied, now) };
  });
}

/** The caller's FULL satisfaction history per vibe (dates DESC, most recent first) over
 *  provenance-stamped cooking-log rows (`satisfied_vibe`). The reconcile signal pass reads
 *  this ONE query for both cadence signals: last-satisfied is index 0, and the tighten
 *  rule's recent intervals fall out of the adjacent pairs. A never-satisfied vibe is
 *  simply absent. */
export async function readVibeSatisfactionDates(env: Env, tenant: string): Promise<Map<string, string[]>> {
  const rows = await db(env).all<{ satisfied_vibe: string; date: string }>(
    "SELECT satisfied_vibe, date FROM cooking_log " +
      "WHERE tenant = ?1 AND satisfied_vibe IS NOT NULL ORDER BY date DESC",
    tenant,
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.satisfied_vibe || !r.date) continue;
    const dates = map.get(r.satisfied_vibe) ?? [];
    dates.push(r.date);
    map.set(r.satisfied_vibe, dates);
  }
  return map;
}

/** The caller's cook dates grouped by recipe slug (`type = recipe` cooking-log rows) — the
 *  taste-space's cadence-inference input for archetype derivation. */
export async function readCookedDatesByRecipe(env: Env, tenant: string): Promise<Map<string, string[]>> {
  const rows = await db(env).all<{ recipe: string; date: string }>(
    "SELECT recipe, date FROM cooking_log WHERE tenant = ?1 AND type = 'recipe' AND recipe IS NOT NULL",
    tenant,
  );
  const map = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.recipe || !r.date) continue;
    const a = map.get(r.recipe) ?? [];
    a.push(r.date);
    map.set(r.recipe, a);
  }
  return map;
}

/** The caller's night-vibe vectors (vibe id → embedding), skipping NULL/garbage rows —
 *  the Level-2 fill's query vectors. An unembedded vibe is simply absent (not-yet-indexed). */
export async function readNightVibeVectors(env: Env, tenant: string): Promise<Map<string, number[]>> {
  const rows = await db(env).all<{ id: string; embedding: string | null }>(
    "SELECT id, embedding FROM night_vibe_derived WHERE tenant = ?1 AND embedding IS NOT NULL",
    tenant,
  );
  const map = new Map<string, number[]>();
  for (const { id, embedding } of rows) {
    if (!embedding) continue;
    try {
      const v = JSON.parse(embedding);
      if (Array.isArray(v) && v.every((n) => typeof n === "number")) map.set(id, v as number[]);
    } catch {
      // a bad row self-heals on the next reconcile
    }
  }
  return map;
}
