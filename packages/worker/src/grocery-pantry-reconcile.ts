// Grocery + pantry key-reconcile (normalize-grocery-pantry-identity, decision D2).
//
// When the ingredient funnel started keying FOOD grocery/pantry rows on the canonical id
// (`resolve`) instead of `normalizeName`, existing rows kept their old `normalizeName`-shaped
// `normalized_name` PK. The pure dual-key lookups find those old rows by name, but a merge-add
// of an aliased synonym would UPSERT under the NEW canonical key and orphan the old row as a
// duplicate. This one-time, idempotent reconcile re-keys stale food rows onto the canonical id,
// merging any that collapse together — the reconcile-backfill the design chose over lazy-re-key.
//
// It rides the scheduled() handler: each tick it re-keys up to a bounded number of stale rows
// across all tenants. Once every row is canonical the pass finds nothing and is a cheap no-op,
// so it self-terminates. Names are never touched — only `normalized_name` (the key) moves.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { ingredientContext, emptyIngredientContext } from "./corpus-db.js";
import { groceryKey, type GroceryItem } from "./grocery.js";
import { pantryUpsertStmt, groceryUpsertStmt } from "./session-db.js";
import type { PantryItem } from "./pantry-write.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name the reconcile records its health + per-run history under (its
 *  observability surface reads this back). Distinct from `reconcile-signals` (a different job). */
export const RECONCILE_JOB = "grocery-reconcile";

/** Max rows re-keyed per tick (writes, not reads). Tiny per-tenant stores converge in one
 *  tick; the bound guards a pathological store and lets convergence span ticks idempotently. */
export const RECONCILE_MAX_PER_TICK = 500;

interface GroceryRekeyRow {
  tenant: string;
  normalized_name: string;
  name: string;
  quantity: string | null;
  kind: string | null;
  domain: string | null;
  status: string | null;
  source: string | null;
  for_recipes: string | null;
  note: string | null;
  added_at: string | null;
  ordered_at: string | null;
}

interface PantryRekeyRow {
  tenant: string;
  normalized_name: string;
  name: string;
  quantity: string | null;
  category: string | null;
  prepared_from: string | null;
  added_at: string | null;
  last_verified_at: string | null;
  notes: string | null;
}

/** One (tenant, target-key) group that needs re-keying: the stale PKs to DELETE and the single
 *  merged row to UPSERT under the canonical key. Kept together so a per-tick bound never splits
 *  a re-key into a DELETE without its UPSERT (which would orphan data). */
export interface RekeyGroup<T> {
  deletes: { tenant: string; normalized_name: string }[];
  upsert: T;
}

/**
 * Pure planner: group rows by (tenant, target-key); a group needs re-keying when it holds more
 * than one row (a collision) or its single row's stored key differs from the target. Each such
 * group yields a `RekeyGroup` — a DELETE for every member PK that isn't already the target, plus
 * one merged UPSERT under the target. A fully-canonical singleton group is skipped. Deterministic:
 * groups and rows keep input order, so the plan is stable (idempotent — a second pass over
 * canonical rows yields nothing).
 */
export function planReconcile<T extends { tenant: string; normalized_name: string; name: string }>(
  rows: T[],
  targetKeyOf: (row: T) => string,
  merge: (rows: T[]) => T,
): RekeyGroup<T>[] {
  const order: string[] = [];
  const groups = new Map<string, { target: string; rows: T[] }>();
  for (const r of rows) {
    const target = targetKeyOf(r);
    const gk = `${r.tenant} ${target}`;
    let g = groups.get(gk);
    if (!g) {
      g = { target, rows: [] };
      groups.set(gk, g);
      order.push(gk);
    }
    g.rows.push(r);
  }

  const plans: RekeyGroup<T>[] = [];
  for (const gk of order) {
    const { target, rows: group } = groups.get(gk)!;
    if (group.length === 1 && group[0].normalized_name === target) continue; // already canonical
    const deletes = group
      .filter((r) => r.normalized_name !== target)
      .map((r) => ({ tenant: r.tenant, normalized_name: r.normalized_name }));
    plans.push({ deletes, upsert: merge(group) });
  }
  return plans;
}

const STATUS_RANK: Record<string, number> = { active: 0, in_cart: 1, ordered: 2 };

/** Earliest non-empty date wins (lexicographic on YYYY-MM-DD); a null loses to a real date. */
function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}
function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Collision-merge for grocery rows: the representative (name/kind/domain/source) is the
 *  most-advanced-status row, then earliest-added; union for_recipes; keep a real quantity over
 *  "1"; earliest added_at; most-advanced status; first non-null note. */
function mergeGrocery(rows: GroceryRekeyRow[]): GroceryRekeyRow {
  const rep = [...rows].sort(
    (a, b) =>
      (STATUS_RANK[b.status ?? "active"] ?? 0) - (STATUS_RANK[a.status ?? "active"] ?? 0) ||
      (earliest(a.added_at, b.added_at) === a.added_at ? -1 : 1),
  )[0];
  const forRecipes = new Set<string>();
  let quantity = rep.quantity;
  let status = rep.status ?? "active";
  let addedAt = rep.added_at;
  let note = rep.note;
  let orderedAt = rep.ordered_at;
  for (const r of rows) {
    for (const fr of parseJsonArray(r.for_recipes)) forRecipes.add(fr);
    if ((quantity == null || quantity === "1") && r.quantity != null && r.quantity !== "1") quantity = r.quantity;
    if ((STATUS_RANK[r.status ?? "active"] ?? 0) > (STATUS_RANK[status] ?? 0)) status = r.status ?? status;
    addedAt = earliest(addedAt, r.added_at);
    if (note == null && r.note != null) note = r.note;
    orderedAt = orderedAt ?? r.ordered_at;
  }
  return { ...rep, quantity, status, added_at: addedAt, note, ordered_at: orderedAt, for_recipes: JSON.stringify([...forRecipes]) };
}

/** Collision-merge for pantry rows: earliest added_at, freshest last_verified_at, latest
 *  quantity, first non-null category/prepared_from/notes; name from the earliest-added row. */
function mergePantry(rows: PantryRekeyRow[]): PantryRekeyRow {
  const rep = [...rows].sort((a, b) => (earliest(a.added_at, b.added_at) === a.added_at ? -1 : 1))[0];
  let quantity = rep.quantity;
  let category = rep.category;
  let preparedFrom = rep.prepared_from;
  let notes = rep.notes;
  let addedAt = rep.added_at;
  let lastVerified = rep.last_verified_at;
  for (const r of rows) {
    if (r.quantity != null) quantity = r.quantity; // latest supplied wins (input order)
    if (category == null && r.category != null) category = r.category;
    if (preparedFrom == null && r.prepared_from != null) preparedFrom = r.prepared_from;
    if (notes == null && r.notes != null) notes = r.notes;
    addedAt = earliest(addedAt, r.added_at);
    lastVerified = latest(lastVerified, r.last_verified_at);
  }
  return { ...rep, quantity, category, prepared_from: preparedFrom, notes, added_at: addedAt, last_verified_at: lastVerified };
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function groceryItemOf(r: GroceryRekeyRow): GroceryItem {
  return {
    name: r.name,
    quantity: r.quantity ?? "1",
    kind: (r.kind ?? "grocery") as GroceryItem["kind"],
    domain: r.domain ?? "grocery",
    status: (r.status ?? "active") as GroceryItem["status"],
    source: (r.source ?? "ad_hoc") as GroceryItem["source"],
    for_recipes: parseJsonArray(r.for_recipes),
    note: r.note ?? null,
    added_at: r.added_at ?? "",
    ordered_at: r.ordered_at ?? null,
  };
}

function pantryItemOf(r: PantryRekeyRow): PantryItem {
  const item: PantryItem = { name: r.name };
  if (r.quantity != null) item.quantity = r.quantity;
  if (r.category != null) item.category = r.category;
  item.prepared_from = r.prepared_from;
  if (r.added_at != null) item.added_at = r.added_at;
  if (r.last_verified_at != null) item.last_verified_at = r.last_verified_at;
  if (r.notes != null) item.notes = r.notes;
  return item;
}

export interface ReconcileResult {
  grocery_rekeyed: number;
  pantry_rekeyed: number;
  truncated: boolean;
}

/** Flush a bounded slice of re-key groups into `stmts` (deletes then the upsert, together per
 *  group so the bound never splits a re-key). Returns how many groups were flushed. */
function flush<T extends { tenant: string }>(
  plans: RekeyGroup<T>[],
  budget: number,
  stmts: D1PreparedStatement[],
  del: (g: { tenant: string; normalized_name: string }) => D1PreparedStatement,
  up: (row: T) => D1PreparedStatement,
): number {
  let n = 0;
  for (const p of plans) {
    if (n >= budget) break;
    for (const g of p.deletes) stmts.push(del(g));
    stmts.push(up(p.upsert));
    n++;
  }
  return n;
}

/**
 * One idempotent reconcile pass over ALL tenants' grocery + pantry rows: re-key stale FOOD rows
 * onto the canonical id, merging collisions. Bounded to RECONCILE_MAX_PER_TICK re-keyed groups
 * per tick (logs when it truncates so a large backlog is visible, not silently capped). Reads the
 * shared resolver once; a resolver-read failure degrades to `emptyIngredientContext` (lowercase/
 * strip, no capture) so a transient blip never mis-keys — it simply finds fewer stale rows.
 */
export async function reconcileGroceryPantryKeys(env: Env): Promise<ReconcileResult> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const d = db(env);

  const groceryRows = await d.all<GroceryRekeyRow>(
    "SELECT tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes, note, added_at, ordered_at FROM grocery_list",
  );
  const pantryRows = await d.all<PantryRekeyRow>(
    "SELECT tenant, name, normalized_name, quantity, category, prepared_from, added_at, last_verified_at, notes FROM pantry",
  );

  const groceryPlan = planReconcile(
    groceryRows,
    (r) => groceryKey(r.name, r.kind ?? undefined, r.domain ?? undefined, ctx.resolve),
    mergeGrocery,
  );
  const pantryPlan = planReconcile(pantryRows, (r) => ctx.resolve(r.name), mergePantry);

  const stmts: D1PreparedStatement[] = [];
  const groceryRekeyed = flush(
    groceryPlan,
    RECONCILE_MAX_PER_TICK,
    stmts,
    (g) => d.prepare("DELETE FROM grocery_list WHERE tenant = ?1 AND normalized_name = ?2", g.tenant, g.normalized_name),
    (row) => groceryUpsertStmt(env, row.tenant, groceryItemOf(row), ctx.resolve),
  );
  const pantryRekeyed = flush(
    pantryPlan,
    RECONCILE_MAX_PER_TICK - groceryRekeyed,
    stmts,
    (g) => d.prepare("DELETE FROM pantry WHERE tenant = ?1 AND normalized_name = ?2", g.tenant, g.normalized_name),
    (row) => pantryUpsertStmt(env, row.tenant, pantryItemOf(row), ctx.resolve),
  );

  if (stmts.length > 0) await d.batch(stmts);
  const truncated = groceryPlan.length > groceryRekeyed || pantryPlan.length > pantryRekeyed;
  if (truncated) {
    console.warn(`[grocery-pantry-reconcile] truncated at ${RECONCILE_MAX_PER_TICK} re-keys/tick; backlog re-keys next tick`);
  }
  return { grocery_rekeyed: groceryRekeyed, pantry_rekeyed: pantryRekeyed, truncated };
}

/**
 * One scheduled run: do the reconcile pass, record the `grocery-reconcile` job_health + job_run
 * rows (a `{ grocery_rekeyed, pantry_rekeyed, truncated }` summary — tenant-clean counts only), and
 * rethrow so the platform's cron status reflects a hard failure (mirrors runReconfirmJob). The
 * per-run history is what the observability card reads back (`readReconcileObservability`) to tell
 * "converging" from "converged". A converged tick is a healthy `ok: true` run that happened to
 * re-key nothing — not a failure.
 */
export async function runReconcileJob(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const s = await reconcileGroceryPantryKeys(env);
    const summary = { grocery_rekeyed: s.grocery_rekeyed, pantry_rekeyed: s.pantry_rekeyed, truncated: s.truncated };
    await writeJobHealth(env, RECONCILE_JOB, { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, RECONCILE_JOB, { ok: true, ran_at: startedAt, duration_ms: Date.now() - startedAt, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[grocery-pantry-reconcile] pass failed:", msg);
    await writeJobHealth(env, RECONCILE_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, RECONCILE_JOB, {
      ok: false,
      ran_at: startedAt,
      duration_ms: Date.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
