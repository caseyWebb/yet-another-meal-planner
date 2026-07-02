// Operator-wide runtime configuration (operator-runtime-config capability).
// A D1 singleton (id = 1) holds sparse overrides for ranking weights and flyer
// behavior. Absent/null columns fall back to the compiled defaults — the table
// only records intentional operator deltas. Pattern mirrors discovery_config.

import { db } from "./db.js";
import { ToolError } from "./errors.js";
import type { Env } from "./env.js";

// --- Types ------------------------------------------------------------------

export interface OperatorConfig {
  // Ranking weights (group defaults; per-tenant profile.rotation overrides on top)
  favoriteWeight: number;
  noveltyBoost: number;
  pantryWeight: number;
  perishWeight: number;
  keyWeight: number;
  overlapCap: number;
  // Flyer / Kroger behavior
  minFlyerDiscount: number;
  flyerRefreshHours: number;
  flyerBatchUnits: number;
  // Satellite sale-scan behavior. `scanStalenessDays` is the read-time staleness ceiling
  // `store_flyer` applies to a SATELLITE-scanned store's rollup only (a dead satellite must
  // degrade to empty, not steer menu-gen on stale sales); Kroger keeps its cron-refresh
  // freshness (no ceiling). It rides the config module as a compiled default — no D1 column is
  // added in this change (that would require a migration; the rollup + queue changes carry
  // none), so it is not yet DB-tunable; a later change wires the column + save/validate path.
  scanStalenessDays: number;
}

export const DEFAULT_OPERATOR_CONFIG: OperatorConfig = {
  favoriteWeight: 0.15,
  noveltyBoost: 0.1,
  pantryWeight: 0.12,
  perishWeight: 1.0,
  keyWeight: 0.4,
  overlapCap: 2,
  minFlyerDiscount: 0.05,
  flyerRefreshHours: 24,
  flyerBatchUnits: 12,
  scanStalenessDays: 7,
};

// --- D1 row -----------------------------------------------------------------

interface OperatorConfigRow {
  favorite_weight: number | null;
  novelty_boost: number | null;
  pantry_weight: number | null;
  perish_weight: number | null;
  key_weight: number | null;
  overlap_cap: number | null;
  min_flyer_discount: number | null;
  flyer_refresh_hours: number | null;
  flyer_batch_units: number | null;
}

const SELECT_SQL =
  "SELECT favorite_weight, novelty_boost, pantry_weight, perish_weight, key_weight, overlap_cap, " +
  "min_flyer_discount, flyer_refresh_hours, flyer_batch_units FROM operator_config WHERE id = 1";

function validNum(value: number | null | undefined, check: (n: number) => boolean): number | null {
  if (value == null || typeof value !== "number" || !isFinite(value) || !check(value)) return null;
  return value;
}

function rowToConfig(row: OperatorConfigRow | null): OperatorConfig {
  if (!row) return { ...DEFAULT_OPERATOR_CONFIG };
  return {
    favoriteWeight: validNum(row.favorite_weight, (n) => n >= 0 && n <= 2) ?? DEFAULT_OPERATOR_CONFIG.favoriteWeight,
    noveltyBoost: validNum(row.novelty_boost, (n) => n >= 0 && n <= 2) ?? DEFAULT_OPERATOR_CONFIG.noveltyBoost,
    pantryWeight: validNum(row.pantry_weight, (n) => n >= 0 && n <= 2) ?? DEFAULT_OPERATOR_CONFIG.pantryWeight,
    perishWeight: validNum(row.perish_weight, (n) => n >= 0 && n <= 10) ?? DEFAULT_OPERATOR_CONFIG.perishWeight,
    keyWeight: validNum(row.key_weight, (n) => n >= 0 && n <= 10) ?? DEFAULT_OPERATOR_CONFIG.keyWeight,
    overlapCap: validNum(row.overlap_cap, (n) => n > 0 && Number.isInteger(n)) ?? DEFAULT_OPERATOR_CONFIG.overlapCap,
    minFlyerDiscount: validNum(row.min_flyer_discount, (n) => n >= 0 && n <= 1) ?? DEFAULT_OPERATOR_CONFIG.minFlyerDiscount,
    flyerRefreshHours: validNum(row.flyer_refresh_hours, (n) => n > 0 && Number.isInteger(n)) ?? DEFAULT_OPERATOR_CONFIG.flyerRefreshHours,
    flyerBatchUnits: validNum(row.flyer_batch_units, (n) => n > 0 && Number.isInteger(n)) ?? DEFAULT_OPERATOR_CONFIG.flyerBatchUnits,
    // No D1 column yet (see the field doc) — always the compiled default this change.
    scanStalenessDays: DEFAULT_OPERATOR_CONFIG.scanStalenessDays,
  };
}

// --- Load / Save ------------------------------------------------------------

export async function loadOperatorConfig(env: Env): Promise<OperatorConfig> {
  const row = await db(env).first<OperatorConfigRow>(SELECT_SQL);
  return rowToConfig(row);
}

export async function saveOperatorConfig(env: Env, patch: Partial<OperatorConfig>): Promise<void> {
  const existing = await db(env).first<OperatorConfigRow>(SELECT_SQL);
  const merged = {
    favorite_weight: patch.favoriteWeight ?? existing?.favorite_weight ?? null,
    novelty_boost: patch.noveltyBoost ?? existing?.novelty_boost ?? null,
    pantry_weight: patch.pantryWeight ?? existing?.pantry_weight ?? null,
    perish_weight: patch.perishWeight ?? existing?.perish_weight ?? null,
    key_weight: patch.keyWeight ?? existing?.key_weight ?? null,
    overlap_cap: patch.overlapCap ?? existing?.overlap_cap ?? null,
    min_flyer_discount: patch.minFlyerDiscount ?? existing?.min_flyer_discount ?? null,
    flyer_refresh_hours: patch.flyerRefreshHours ?? existing?.flyer_refresh_hours ?? null,
    flyer_batch_units: patch.flyerBatchUnits ?? existing?.flyer_batch_units ?? null,
  };
  await db(env).run(
    "INSERT INTO operator_config (id, favorite_weight, novelty_boost, pantry_weight, perish_weight, " +
      "key_weight, overlap_cap, min_flyer_discount, flyer_refresh_hours, flyer_batch_units) " +
      "VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "favorite_weight = excluded.favorite_weight, novelty_boost = excluded.novelty_boost, " +
      "pantry_weight = excluded.pantry_weight, perish_weight = excluded.perish_weight, " +
      "key_weight = excluded.key_weight, overlap_cap = excluded.overlap_cap, " +
      "min_flyer_discount = excluded.min_flyer_discount, flyer_refresh_hours = excluded.flyer_refresh_hours, " +
      "flyer_batch_units = excluded.flyer_batch_units",
    merged.favorite_weight,
    merged.novelty_boost,
    merged.pantry_weight,
    merged.perish_weight,
    merged.key_weight,
    merged.overlap_cap,
    merged.min_flyer_discount,
    merged.flyer_refresh_hours,
    merged.flyer_batch_units,
  );
}

// --- Validation -------------------------------------------------------------

/** Hard floors: values AT OR BELOW these thresholds need an explicit confirm (mirrors
 *  discovery-calibration.ts's FLOOR_TASTE/FLOOR_DEDUP/CEILING_RATE_CAP pattern). The five
 *  ranking weight knobs intentionally carry NO floor — 0 is a legitimate "no effect" value
 *  for a weight, not a footgun, so only the two flyer-cadence knobs below get a confirm gate. */
export const FLOOR_FLYER_REFRESH_HOURS = 6;
export const FLOOR_FLYER_BATCH_UNITS = 4;

export interface ValidateOperatorConfigOpts {
  /** When true, allow values that breach a hard floor (the operator explicitly confirmed). */
  confirm?: boolean;
}

/**
 * Server-side guard for an operator-config write. Enforces:
 *   - range checks (always enforced, even with confirm=true)
 *   - hard floors on flyerRefreshHours/flyerBatchUnits → rejected unless confirm=true
 * Returns a structured error (never throws) — same `ToolError | null` shape as before,
 * so `putOperatorConfig` doesn't need to change its `if (err) throw err` call site.
 */
export function validateOperatorConfig(patch: Record<string, unknown>, opts: ValidateOperatorConfigOpts = {}): ToolError | null {
  const { confirm = false } = opts;
  const checks: Array<[string, unknown, (n: number) => boolean, string]> = [
    ["favoriteWeight", patch.favoriteWeight, (n) => n >= 0 && n <= 2, "must be in [0, 2]"],
    ["noveltyBoost", patch.noveltyBoost, (n) => n >= 0 && n <= 2, "must be in [0, 2]"],
    ["pantryWeight", patch.pantryWeight, (n) => n >= 0 && n <= 2, "must be in [0, 2]"],
    ["perishWeight", patch.perishWeight, (n) => n >= 0 && n <= 10, "must be in [0, 10]"],
    ["keyWeight", patch.keyWeight, (n) => n >= 0 && n <= 10, "must be in [0, 10]"],
    ["overlapCap", patch.overlapCap, (n) => Number.isInteger(n) && n > 0 && n <= 20, "must be a positive integer ≤ 20"],
    ["minFlyerDiscount", patch.minFlyerDiscount, (n) => n >= 0 && n <= 1, "must be in [0, 1]"],
    ["flyerRefreshHours", patch.flyerRefreshHours, (n) => Number.isInteger(n) && n >= 1 && n <= 720, "must be an integer in [1, 720]"],
    ["flyerBatchUnits", patch.flyerBatchUnits, (n) => Number.isInteger(n) && n >= 1 && n <= 200, "must be an integer in [1, 200]"],
  ];
  for (const [field, val, check, msg] of checks) {
    if (val === undefined || val === null) continue;
    if (typeof val !== "number" || !isFinite(val) || !check(val)) {
      return new ToolError("validation_failed", `${field}: ${msg}`);
    }
  }

  // Floor checks (require explicit confirm to override) — evaluated only after range checks
  // pass, so a below-floor value is also known in-range before it can trigger a confirm gate.
  if (!confirm) {
    if (typeof patch.flyerRefreshHours === "number" && patch.flyerRefreshHours <= FLOOR_FLYER_REFRESH_HOURS) {
      return new ToolError(
        "validation_failed",
        `flyerRefreshHours ≤ ${FLOOR_FLYER_REFRESH_HOURS} risks hammering the Kroger flyer endpoint every tick — pass confirm:true to override`,
        { field: "flyerRefreshHours", floor: FLOOR_FLYER_REFRESH_HOURS, needsConfirm: true },
      );
    }
    if (typeof patch.flyerBatchUnits === "number" && patch.flyerBatchUnits <= FLOOR_FLYER_BATCH_UNITS) {
      return new ToolError(
        "validation_failed",
        `flyerBatchUnits ≤ ${FLOOR_FLYER_BATCH_UNITS} under-batches, inflating per-tick embedding call overhead — pass confirm:true to override`,
        { field: "flyerBatchUnits", floor: FLOOR_FLYER_BATCH_UNITS, needsConfirm: true },
      );
    }
  }
  return null;
}

export function parseOperatorConfigPatch(body: Record<string, unknown>): Partial<OperatorConfig> {
  const patch: Partial<OperatorConfig> = {};
  if (typeof body.favoriteWeight === "number") patch.favoriteWeight = body.favoriteWeight;
  if (typeof body.noveltyBoost === "number") patch.noveltyBoost = body.noveltyBoost;
  if (typeof body.pantryWeight === "number") patch.pantryWeight = body.pantryWeight;
  if (typeof body.perishWeight === "number") patch.perishWeight = body.perishWeight;
  if (typeof body.keyWeight === "number") patch.keyWeight = body.keyWeight;
  if (typeof body.overlapCap === "number") patch.overlapCap = body.overlapCap;
  if (typeof body.minFlyerDiscount === "number") patch.minFlyerDiscount = body.minFlyerDiscount;
  if (typeof body.flyerRefreshHours === "number") patch.flyerRefreshHours = body.flyerRefreshHours;
  if (typeof body.flyerBatchUnits === "number") patch.flyerBatchUnits = body.flyerBatchUnits;
  return patch;
}
