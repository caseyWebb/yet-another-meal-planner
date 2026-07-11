// Pure meal-plan logic (meal-planning capability). The D1 `meal_plan` table is the
// transient, SLOT-grain record of committed cook intent: PRIMARY KEY (tenant, id),
// where `id` is an opaque client- or server-mintable row id (ULID; the one-time
// migration minted 32-hex ids — src/ids.ts). Each row carries a `meal`
// (breakfast | lunch | dinner | project) beside the recipe slug. A recipe MAY occupy
// multiple rows, but ONLY by explicit user action — the planner-no-duplicates
// invariant (D26-final): the `add` op coalesces slug-globally (across ALL meals)
// unless the caller passes `duplicate: true`, the ONE wire spelling of duplication.
// No I/O here; session-db.ts reads current rows, runs these ops, and emits the
// matching row statements.

import { isRowId } from "./ids.js";

/** The closed meal set on plan rows. Vibes never carry `project` (projects are not
 *  vibe-driven); the op layer enforces project rows carry no date and no sides. */
export type PlanMeal = "breakfast" | "lunch" | "dinner" | "project";

export const PLAN_MEALS: readonly PlanMeal[] = ["breakfast", "lunch", "dinner", "project"];

export interface PlannedRow {
  /** Opaque row id — THE address for row-level edits and the class (b) replay key.
   *  Never parsed or meaningfully sorted; `id ASC` is only an arbitrary-but-
   *  deterministic tiebreak. */
  id: string;
  recipe: string;
  meal: PlanMeal;
  /** ISO date the cook is slated for; null/absent = undated. Always null on projects. */
  planned_for?: string | null;
  /** Free-text open-world side names riding on this main's row; never slug-resolved.
   *  Always empty on projects. */
  sides?: string[];
  /** The meal-vibe slot id this row was proposed to fill (advisory provenance; never
   *  slug-resolved). Read from the CLEARED row at cook time for vibe attribution. */
  from_vibe?: string | null;
}

export interface MealPlanOp {
  op: "add" | "remove" | "set";
  /** Regex-validated opaque row id. add: a client-minted idempotency key (an existing
   *  id replays as an update). set/remove: the exact row address. */
  id?: string;
  /** Required on `add`; the slug address on `set`/`remove` when `id` is absent. */
  recipe?: string;
  meal?: PlanMeal;
  /** add only; default false — THE one wire spelling of explicit duplication. */
  duplicate?: boolean;
  /** On `add`: set when supplied non-null (null/absent preserves). On `set`: a string
   *  sets the date, an EXPLICIT null clears it, absent preserves. */
  planned_for?: string | null;
  /** On `add`: open-world sides UNIONED onto the row. On `set`: supplied ⇒ replaced
   *  WHOLESALE (an empty array removes them all); absent ⇒ preserved. */
  sides?: string[];
  /** Vibe-slot provenance. On `add`: set when supplied non-null. On `set`:
   *  supplied ⇒ set (null clears); absent ⇒ preserved. */
  from_vibe?: string | null;
}

/** One applied op's report. `id` is the row acted on — on a coalescing add, the
 *  SURVIVING row's id (`coalesced: true`); the caller adopts it. `removed` reports a
 *  remove's fan-out count (0 for an idempotent id-replay), with the ids listed. */
export interface AppliedPlanOp {
  op: MealPlanOp["op"];
  id?: string;
  recipe?: string;
  meal?: PlanMeal;
  coalesced?: true;
  removed?: number;
  removed_ids?: string[];
}

/** A candidate row surfaced by a >1-match conflict (add coalesce / set-by-slug):
 *  genuine member-created ambiguity, resolved by re-issuing with a row `id`. */
export interface PlanRowCandidate {
  id: string;
  meal: PlanMeal;
  planned_for: string | null;
  sides?: string[];
}

export interface PlanOpConflict {
  op: MealPlanOp["op"];
  recipe?: string;
  id?: string;
  reason: string;
  candidates?: PlanRowCandidate[];
}

export interface MealPlanOpsResult {
  rows: PlannedRow[];
  applied: AppliedPlanOp[];
  conflicts: PlanOpConflict[];
  /** Final states of the rows this call inserted/updated (deduped by id, last wins). */
  upserts: PlannedRow[];
  /** Row ids this call deleted. */
  deletes: string[];
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sameRecipe(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function candidateOf(r: PlannedRow): PlanRowCandidate {
  const c: PlanRowCandidate = { id: r.id, meal: r.meal, planned_for: r.planned_for ?? null };
  if (r.sides?.length) c.sides = [...r.sides];
  return c;
}

/** Union `add` into `existing`, preserving order and dropping exact duplicates. */
function unionSides(existing: string[] | undefined, add: string[]): string[] {
  const out = [...(existing ?? [])];
  for (const s of add) if (!out.includes(s)) out.push(s);
  return out;
}

/** The op-layer project constraint: a project row carries no date and no sides. */
function projectViolation(row: PlannedRow): boolean {
  return row.meal === "project" && (row.planned_for != null || (row.sides?.length ?? 0) > 0);
}

const PROJECT_REASON = "project rows carry no date or sides";

/** The MEAL-ORDER used everywhere a plan is presented (projects last). */
const MEAL_ORDER: Record<PlanMeal, number> = { breakfast: 0, lunch: 1, dinner: 2, project: 3 };

/**
 * The one shared EARLIEST-DUE selector (log_cooked's fallback clear and any tie among
 * explicit duplicates): `planned_for ASC NULLS LAST, id ASC` — the id leg is an
 * arbitrary-but-deterministic tiebreak, never a semantic ordering.
 */
export function earliestDue<T extends { planned_for?: string | null; id: string }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (best === null) {
      best = r;
      continue;
    }
    const a = r.planned_for ?? null;
    const b = best.planned_for ?? null;
    if (a === b ? r.id < best.id : a !== null && (b === null || a < b)) best = r;
  }
  return best;
}

/**
 * The `read_meal_plan` ordering guarantee — a FLAT array, "grouped by meal" as
 * ordering, not nesting: dated rows first by `(planned_for, breakfast < lunch <
 * dinner)`, then undated rows grouped by meal, then `project` rows last; every tie by
 * `id ASC` (arbitrary-but-deterministic).
 */
export function orderPlanned(rows: PlannedRow[]): PlannedRow[] {
  return [...rows].sort((a, b) => {
    const ap = a.meal === "project";
    const bp = b.meal === "project";
    if (ap !== bp) return ap ? 1 : -1;
    const ad = a.planned_for ?? null;
    const bd = b.planned_for ?? null;
    if ((ad !== null) !== (bd !== null)) return ad !== null ? -1 : 1; // dated before undated
    if (ad !== null && bd !== null && ad !== bd) return ad < bd ? -1 : 1;
    if (a.meal !== b.meal) return MEAL_ORDER[a.meal] - MEAL_ORDER[b.meal];
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Apply add/remove/set ops in order over id-keyed rows (the D26-final contract).
 * Pure; `mint` supplies fresh row ids (a ULID in production, injectable for tests).
 *
 * `add` — deterministic resolution order (the commit-side no-duplicates enforcement):
 *   1. supplied `id` exists → replay/update that row (recipe mismatch → conflict);
 *   2. else `duplicate: true` → insert (supplied id or minted);
 *   3. else slug-global coalesce (case-insensitive, across ALL meals): 0 → insert,
 *      1 → update it (a supplied `meal` MOVES the row; `coalesced: true` reports the
 *      surviving id), >1 → conflict with `candidates` (never an auto-pick).
 * `remove` — by `id`: idempotent (`removed: 0|1`, never a conflict); by slug
 *   (optionally narrowed by `meal`): deletes ALL matches (`removed: N` + ids), zero
 *   matches is a conflict.
 * `set` — by `id`: must exist; may change ANY field including `recipe` and `meal`.
 *   By slug (optionally narrowed by `meal`): unique match required (0 → conflict,
 *   >1 → conflict with `candidates`); may NOT change `recipe`.
 * Project rows (insert, move-to, or edit) reject a non-null date / non-empty sides
 * with a per-op structured conflict — op-layer enforcement, not a SQL CHECK.
 */
export function applyMealPlanOps(
  rows: PlannedRow[],
  ops: MealPlanOp[],
  mint: () => string,
): MealPlanOpsResult {
  let next: PlannedRow[] = rows.map((r) => {
    const copy: PlannedRow = { ...r };
    if (r.sides) copy.sides = [...r.sides];
    return copy;
  });
  const applied: AppliedPlanOp[] = [];
  const conflicts: PlanOpConflict[] = [];
  const touched = new Map<string, PlannedRow>(); // upserted rows by id (last state wins)
  const deleted = new Set<string>();

  const conflict = (c: PlanOpConflict): void => {
    conflicts.push(c);
  };
  const trackUpsert = (row: PlannedRow): void => {
    deleted.delete(row.id);
    touched.set(row.id, row);
  };
  const trackDelete = (id: string): void => {
    touched.delete(id);
    deleted.add(id);
  };

  for (const op of ops) {
    if (op.id !== undefined && !isRowId(op.id)) {
      conflict({ op: op.op, id: op.id, recipe: op.recipe, reason: `invalid row id: ${op.id}` });
      continue;
    }
    if (op.planned_for != null && !ISO_DATE_RE.test(op.planned_for)) {
      conflict({ op: op.op, id: op.id, recipe: op.recipe, reason: `invalid planned_for: ${op.planned_for}` });
      continue;
    }

    if (op.op === "add") {
      if (!op.recipe) {
        conflict({ op: "add", id: op.id, reason: "add requires a recipe slug" });
        continue;
      }
      // 1. Id replay/update — the class (b) idempotency property, in every branch.
      const byId = op.id !== undefined ? next.find((r) => r.id === op.id) : undefined;
      if (byId) {
        if (!sameRecipe(byId.recipe, op.recipe)) {
          conflict({ op: "add", id: op.id, recipe: op.recipe, reason: "id addresses a different recipe" });
          continue;
        }
        const updated: PlannedRow = { ...byId };
        if (op.planned_for != null) updated.planned_for = op.planned_for;
        if (op.sides?.length) updated.sides = unionSides(updated.sides, op.sides);
        if (op.meal !== undefined) updated.meal = op.meal;
        if (op.from_vibe != null) updated.from_vibe = op.from_vibe;
        if (projectViolation(updated)) {
          conflict({ op: "add", id: op.id, recipe: op.recipe, reason: PROJECT_REASON });
          continue;
        }
        Object.assign(byId, updated);
        trackUpsert({ ...byId });
        applied.push({ op: "add", id: byId.id, recipe: byId.recipe, meal: byId.meal });
        continue;
      }

      // 2. Explicit duplication — insert; on redelivery the id exists → branch 1 update.
      // 3. Else slug-global coalesce across ALL meals (no cross-meal duplication hole).
      const matches = op.duplicate === true ? [] : next.filter((r) => sameRecipe(r.recipe, op.recipe as string));
      if (op.duplicate === true || matches.length === 0) {
        const row: PlannedRow = {
          id: op.id ?? mint(),
          recipe: op.recipe,
          meal: op.meal ?? "dinner",
          planned_for: op.planned_for ?? null,
        };
        if (op.sides?.length) row.sides = [...op.sides];
        if (op.from_vibe != null) row.from_vibe = op.from_vibe;
        if (projectViolation(row)) {
          conflict({ op: "add", id: op.id, recipe: op.recipe, reason: PROJECT_REASON });
          continue;
        }
        next.push(row);
        trackUpsert({ ...row });
        applied.push({ op: "add", id: row.id, recipe: row.recipe, meal: row.meal });
        continue;
      }
      if (matches.length > 1) {
        // Explicit duplicates exist — surface the ambiguity, never an earliest-due pick.
        conflict({
          op: "add",
          recipe: op.recipe,
          reason: "multiple planned rows for that recipe — re-issue by id, or pass duplicate: true",
          candidates: matches.map(candidateOf),
        });
        continue;
      }
      // Exactly one — coalesce onto it. A supplied `meal` MOVES the row between meals;
      // the client-supplied id is discarded and the caller adopts the survivor's.
      const survivor = matches[0];
      const updated: PlannedRow = { ...survivor };
      if (op.planned_for != null) updated.planned_for = op.planned_for;
      if (op.sides?.length) updated.sides = unionSides(updated.sides, op.sides);
      if (op.meal !== undefined) updated.meal = op.meal;
      if (op.from_vibe != null) updated.from_vibe = op.from_vibe;
      if (projectViolation(updated)) {
        conflict({ op: "add", id: op.id, recipe: op.recipe, reason: PROJECT_REASON });
        continue;
      }
      Object.assign(survivor, updated);
      trackUpsert({ ...survivor });
      applied.push({ op: "add", id: survivor.id, recipe: survivor.recipe, meal: survivor.meal, coalesced: true });
      continue;
    }

    if (op.op === "remove") {
      // Exactly one addressing field: id (idempotent replay) XOR slug (defined fan-out).
      if ((op.id !== undefined) === (op.recipe !== undefined && op.recipe !== "")) {
        conflict({ op: "remove", id: op.id, recipe: op.recipe, reason: "remove requires exactly one of id or recipe" });
        continue;
      }
      if (op.id !== undefined) {
        const existed = next.some((r) => r.id === op.id);
        if (existed) {
          next = next.filter((r) => r.id !== op.id);
          trackDelete(op.id);
        }
        // A missing id is NEVER a conflict — id-addressed removes are the offline-replay
        // surface and must replay silently.
        applied.push({ op: "remove", id: op.id, removed: existed ? 1 : 0, removed_ids: existed ? [op.id] : [] });
        continue;
      }
      const matches = next.filter(
        (r) => sameRecipe(r.recipe, op.recipe as string) && (op.meal === undefined || r.meal === op.meal),
      );
      if (matches.length === 0) {
        conflict({ op: "remove", recipe: op.recipe, reason: "no planned row for that recipe" });
        continue;
      }
      const ids = matches.map((r) => r.id);
      next = next.filter((r) => !ids.includes(r.id));
      for (const id of ids) trackDelete(id);
      applied.push({ op: "remove", recipe: op.recipe, removed: ids.length, removed_ids: ids });
      continue;
    }

    // set
    let target: PlannedRow | undefined;
    if (op.id !== undefined) {
      target = next.find((r) => r.id === op.id);
      if (!target) {
        conflict({ op: "set", id: op.id, reason: "no planned row with that id" });
        continue;
      }
    } else {
      if (!op.recipe) {
        conflict({ op: "set", reason: "set requires an id or a recipe slug" });
        continue;
      }
      const matches = next.filter(
        (r) => sameRecipe(r.recipe, op.recipe as string) && (op.meal === undefined || r.meal === op.meal),
      );
      if (matches.length === 0) {
        conflict({ op: "set", recipe: op.recipe, reason: "no planned row for that recipe" });
        continue;
      }
      if (matches.length > 1) {
        conflict({
          op: "set",
          recipe: op.recipe,
          reason: "multiple planned rows for that recipe — re-issue by id",
          candidates: matches.map(candidateOf),
        });
        continue;
      }
      target = matches[0];
    }

    const updated: PlannedRow = { ...target };
    if (target.sides) updated.sides = [...target.sides];
    // Id-addressed sets may swap the recipe (swap-in-slot) and the meal; slug-addressed
    // sets use `recipe`/`meal` as the ADDRESS, so those changes are structurally
    // inexpressible there (recipe-swap requires id addressing).
    if (op.id !== undefined && op.recipe !== undefined && op.recipe !== "") updated.recipe = op.recipe;
    if (op.id !== undefined && op.meal !== undefined) updated.meal = op.meal;
    // planned_for: a string sets, an EXPLICIT null clears, absent preserves.
    if ("planned_for" in op) updated.planned_for = op.planned_for ?? null;
    // sides: supplied ⇒ replaced wholesale; [] removes them all; absent ⇒ preserved.
    if (op.sides !== undefined) {
      if (op.sides.length) updated.sides = [...op.sides];
      else delete updated.sides;
    }
    // from_vibe: supplied ⇒ set (null clears); absent ⇒ preserved.
    if ("from_vibe" in op) {
      if (op.from_vibe != null) updated.from_vibe = op.from_vibe;
      else delete updated.from_vibe;
    }
    if (projectViolation(updated)) {
      conflict({ op: "set", id: op.id, recipe: op.recipe, reason: PROJECT_REASON });
      continue;
    }
    if (updated.sides === undefined) delete updated.sides;
    const idx = next.findIndex((r) => r.id === (target as PlannedRow).id);
    next[idx] = updated;
    trackUpsert({ ...updated });
    applied.push({ op: "set", id: updated.id, recipe: updated.recipe, meal: updated.meal });
  }

  return {
    rows: next,
    applied,
    conflicts,
    upserts: [...touched.values()],
    deletes: [...deleted],
  };
}

/**
 * Partition planned rows into those that are DUE (planned_for on/before `today`,
 * or unset) and those scheduled for the future. The session-start reconcile only
 * surfaces the due ones. Projects are undated by construction, so they read as due.
 */
export function dueAndFuture(
  rows: PlannedRow[],
  today: string,
): { due: PlannedRow[]; future: PlannedRow[] } {
  const due: PlannedRow[] = [];
  const future: PlannedRow[] = [];
  for (const it of rows) {
    if (it.planned_for && it.planned_for > today) future.push(it);
    else due.push(it);
  }
  return { due, future };
}
