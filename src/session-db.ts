// D1 session-state data layer (d1-session-state). The per-tenant working state —
// pantry, meal plan, grocery list — lives in normalized D1 row tables
// (migrations/d1/0005_session_state.sql), one row per item keyed by normalized name
// (pantry, grocery) or recipe slug (meal plan). This module is the SINGLE place those
// rows are read into the agent-facing shapes and mutated — every tool's session
// read/write goes through here, over src/db.ts (so a D1 failure surfaces as a
// structured `storage_error`). It replaces the `state:*` KV blobs (user-kv.ts, retired
// in this slice).
//
// Reads return the same item shapes the agent saw from the old KV arrays. Writes are
// row-level: an add is `INSERT … ON CONFLICT DO UPDATE` (no whole-array rewrite), a
// remove/verify is a targeted row statement. The pure transform logic (merge rules,
// dedup, conflict reporting) stays in pantry-write.ts / meal-plan.ts / grocery.ts; this
// module reads current rows, runs that logic, and emits the matching row statements.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError } from "./errors.js";
import { normalizeName } from "./grocery.js";
import {
  applyPantryOperations,
  markVerified,
  type PantryItem,
  type PantryOperation,
  type PantryApplyResult,
} from "./pantry-write.js";
import { applyMealPlanOps, type PlannedItem, type MealPlanOp } from "./meal-plan.js";
import {
  addToGroceryList,
  updateGroceryItem,
  removeGroceryItem,
  type GroceryItem,
  type GroceryAddInput,
  type GroceryUpdateInput,
  type AddResult,
  type UpdateResult,
} from "./grocery.js";

/** Parse a JSON column, tolerating null/empty/garbage as `[]`. */
function parseJsonArray(value: string | null): string[] {
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// === Pantry ==================================================================

interface PantryRow {
  name: string;
  normalized_name: string;
  quantity: string | null;
  category: string | null;
  prepared_from: string | null;
  added_at: string | null;
  last_verified_at: string | null;
  notes: string | null;
}

/** Assemble a pantry item (the agent-facing shape) from a row. */
function pantryItemOf(r: PantryRow): PantryItem {
  const item: PantryItem = { name: r.name };
  if (r.quantity != null) item.quantity = r.quantity;
  if (r.category != null) item.category = r.category;
  item.prepared_from = r.prepared_from; // null is meaningful (the default)
  if (r.added_at != null) item.added_at = r.added_at;
  if (r.last_verified_at != null) item.last_verified_at = r.last_verified_at;
  if (r.notes != null) item.notes = r.notes;
  return item;
}

export interface PantryFilter {
  category?: string;
  preparedOnly?: boolean;
}

/** Read the caller's pantry rows, with optional category / prepared filters (WHERE). */
export async function readPantry(env: Env, tenant: string, filter: PantryFilter = {}): Promise<PantryItem[]> {
  let sql =
    "SELECT name, normalized_name, quantity, category, prepared_from, added_at, last_verified_at, notes " +
    "FROM pantry WHERE tenant = ?1";
  const binds: unknown[] = [tenant];
  if (filter.category !== undefined) {
    sql += ` AND category = ?${binds.length + 1}`;
    binds.push(filter.category);
  }
  if (filter.preparedOnly) {
    sql += " AND prepared_from IS NOT NULL";
  }
  const rows = await db(env).all<PantryRow>(sql, ...binds);
  return rows.map(pantryItemOf);
}

/** An UPSERT statement for one pantry item (merge rule: keep added_at, overlay rest). */
function pantryUpsertStmt(env: Env, tenant: string, item: PantryItem): D1PreparedStatement {
  const name = String(item.name);
  return db(env).prepare(
    "INSERT INTO pantry (tenant, name, normalized_name, quantity, category, prepared_from, " +
      "added_at, last_verified_at, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) " +
      "ON CONFLICT(tenant, normalized_name) DO UPDATE SET " +
      "name = excluded.name, quantity = excluded.quantity, category = excluded.category, " +
      "prepared_from = excluded.prepared_from, last_verified_at = excluded.last_verified_at, " +
      "notes = excluded.notes",
    tenant,
    name,
    normalizeName(name),
    item.quantity ?? null,
    item.category ?? null,
    item.prepared_from ?? null,
    item.added_at ?? null,
    item.last_verified_at ?? null,
    item.notes ?? null,
  );
}

/**
 * Apply pantry add/remove/verify operations as row statements. Reads the current rows,
 * runs the pure `applyPantryOperations` (the merge/conflict logic), then emits an
 * UPSERT per applied add/verify and a DELETE per applied remove — one batch.
 */
export async function applyPantryRowOps(
  env: Env,
  tenant: string,
  operations: PantryOperation[],
  today: string,
): Promise<Pick<PantryApplyResult, "applied" | "conflicts">> {
  const current = await readPantry(env, tenant);
  const result = applyPantryOperations(current, operations, today);
  const byName = new Map(result.items.map((it) => [normalizeName(String(it.name)), it]));

  const stmts: D1PreparedStatement[] = [];
  for (const a of result.applied) {
    const key = normalizeName(a.name);
    if (a.op === "remove") {
      stmts.push(
        db(env).prepare("DELETE FROM pantry WHERE tenant = ?1 AND normalized_name = ?2", tenant, key),
      );
    } else {
      // add (upsert) or verify (last_verified_at refresh) — UPSERT the resulting row.
      const item = byName.get(key);
      if (item) stmts.push(pantryUpsertStmt(env, tenant, item));
    }
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return { applied: result.applied, conflicts: result.conflicts };
}

/** Reset last_verified_at to `today` on the named pantry rows. Returns verified + missing. */
export async function markPantryVerifiedRows(
  env: Env,
  tenant: string,
  names: string[],
  today: string,
): Promise<{ verified: string[]; missing: string[] }> {
  const current = await readPantry(env, tenant);
  const { items, verified, missing } = markVerified(current, names, today);
  const byName = new Map(items.map((it) => [normalizeName(String(it.name)), it]));
  const stmts: D1PreparedStatement[] = [];
  for (const name of verified) {
    const item = byName.get(normalizeName(name));
    if (item) stmts.push(pantryUpsertStmt(env, tenant, item));
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return { verified, missing };
}

/** The caller's pantry item names, normalized — for the order-time set algebra. */
export async function readPantryNames(env: Env, tenant: string): Promise<Set<string>> {
  const rows = await db(env).all<{ normalized_name: string }>(
    "SELECT normalized_name FROM pantry WHERE tenant = ?1",
    tenant,
  );
  return new Set(rows.map((r) => r.normalized_name));
}

// === Meal plan ===============================================================

interface MealPlanRow {
  recipe: string;
  planned_for: string | null;
  sides: string | null;
}

function plannedItemOf(r: MealPlanRow): PlannedItem {
  const item: PlannedItem = { recipe: r.recipe, planned_for: r.planned_for ?? null };
  const sides = parseJsonArray(r.sides);
  if (sides.length) item.sides = sides;
  return item;
}

/** Read the caller's meal-plan rows. */
export async function readMealPlan(env: Env, tenant: string): Promise<PlannedItem[]> {
  const rows = await db(env).all<MealPlanRow>(
    "SELECT recipe, planned_for, sides FROM meal_plan WHERE tenant = ?1",
    tenant,
  );
  return rows.map(plannedItemOf);
}

/** An UPSERT statement for one meal-plan row (upsert by recipe slug, with sides JSON). */
function mealPlanUpsertStmt(env: Env, tenant: string, item: PlannedItem): D1PreparedStatement {
  const sides = item.sides && item.sides.length ? JSON.stringify(item.sides) : null;
  return db(env).prepare(
    "INSERT INTO meal_plan (tenant, recipe, planned_for, sides) VALUES (?1, ?2, ?3, ?4) " +
      "ON CONFLICT(tenant, recipe) DO UPDATE SET planned_for = excluded.planned_for, sides = excluded.sides",
    tenant,
    item.recipe,
    item.planned_for ?? null,
    sides,
  );
}

/** A DELETE statement for one meal-plan recipe (exposed for log_cooked's transaction). */
export function mealPlanDeleteStmt(env: Env, tenant: string, recipe: string): D1PreparedStatement {
  return db(env).prepare("DELETE FROM meal_plan WHERE tenant = ?1 AND recipe = ?2", tenant, recipe);
}

/**
 * Apply meal-plan add/remove ops as row statements (add = upsert by recipe; remove =
 * DELETE). Reads current rows, runs the pure `applyMealPlanOps`, emits per-op rows.
 */
export async function applyMealPlanRowOps(
  env: Env,
  tenant: string,
  ops: MealPlanOp[],
): Promise<{ applied: { op: MealPlanOp["op"]; recipe: string }[]; conflicts: { op: MealPlanOp["op"]; recipe: string; reason: string }[] }> {
  const current = await readMealPlan(env, tenant);
  const result = applyMealPlanOps(current, ops);
  const byRecipe = new Map(result.items.map((it) => [it.recipe.toLowerCase(), it]));

  const stmts: D1PreparedStatement[] = [];
  for (const a of result.applied) {
    if (a.op === "remove") {
      // applyMealPlanOps drops every row whose slug matches case-insensitively; the
      // recipe stored may differ in case, so delete by the op's recipe value.
      stmts.push(mealPlanDeleteStmt(env, tenant, a.recipe));
    } else {
      const item = byRecipe.get(a.recipe.toLowerCase());
      if (item) stmts.push(mealPlanUpsertStmt(env, tenant, item));
    }
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return { applied: result.applied, conflicts: result.conflicts };
}

// === Grocery list ============================================================

interface GroceryRow {
  name: string;
  normalized_name: string;
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

function groceryItemOf(r: GroceryRow): GroceryItem {
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

const GROCERY_SELECT =
  "SELECT name, normalized_name, quantity, kind, domain, status, source, for_recipes, note, " +
  "added_at, ordered_at FROM grocery_list WHERE tenant = ?1";

/** Read the caller's grocery-list rows, with an optional status filter (WHERE). */
export async function readGroceryList(env: Env, tenant: string, status?: string): Promise<GroceryItem[]> {
  let sql = GROCERY_SELECT;
  const binds: unknown[] = [tenant];
  if (status !== undefined) {
    sql += " AND status = ?2";
    binds.push(status);
  }
  const rows = await db(env).all<GroceryRow>(sql, ...binds);
  return rows.map(groceryItemOf);
}

/** An UPSERT statement for one grocery-list item. */
function groceryUpsertStmt(env: Env, tenant: string, item: GroceryItem): D1PreparedStatement {
  return db(env).prepare(
    "INSERT INTO grocery_list (tenant, name, normalized_name, quantity, kind, domain, status, " +
      "source, for_recipes, note, added_at, ordered_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) " +
      "ON CONFLICT(tenant, normalized_name) DO UPDATE SET " +
      "name = excluded.name, quantity = excluded.quantity, kind = excluded.kind, " +
      "domain = excluded.domain, status = excluded.status, source = excluded.source, " +
      "for_recipes = excluded.for_recipes, note = excluded.note, ordered_at = excluded.ordered_at",
    tenant,
    item.name,
    normalizeName(item.name),
    item.quantity,
    item.kind,
    item.domain,
    item.status,
    item.source,
    JSON.stringify(item.for_recipes),
    item.note,
    item.added_at,
    item.ordered_at,
  );
}

/** Add (or merge into) one grocery-list item; returns the resulting item + merged flag. */
export async function addGroceryRow(
  env: Env,
  tenant: string,
  input: GroceryAddInput,
  today: string,
): Promise<{ item: GroceryItem; merged: boolean }> {
  const current = await readGroceryList(env, tenant);
  const result: AddResult = addToGroceryList(current, input, today);
  await db(env).batch([groceryUpsertStmt(env, tenant, result.item)]);
  return { item: result.item, merged: result.merged };
}

/** Patch one grocery-list item by name. Throws a `not_found` ToolError when absent. */
export async function updateGroceryRow(
  env: Env,
  tenant: string,
  name: string,
  patch: GroceryUpdateInput,
): Promise<GroceryItem> {
  const current = await readGroceryList(env, tenant);
  let result: UpdateResult;
  try {
    result = updateGroceryItem(current, name, patch);
  } catch {
    throw new ToolError("not_found", `No grocery-list item named: ${name}`, { name });
  }
  await db(env).batch([groceryUpsertStmt(env, tenant, result.item)]);
  return result.item;
}

/** Remove one grocery-list item by name. `found` is false when no such row existed. */
export async function removeGroceryRow(
  env: Env,
  tenant: string,
  name: string,
): Promise<{ found: boolean }> {
  const current = await readGroceryList(env, tenant);
  const { found } = removeGroceryItem(current, name);
  if (!found) return { found: false };
  await db(env).run(
    "DELETE FROM grocery_list WHERE tenant = ?1 AND normalized_name = ?2",
    tenant,
    normalizeName(name),
  );
  return { found: true };
}

/**
 * Advance the given resolved lines to status:in_cart, inserting any line not yet on
 * the list. Mirrors the old KV advance — row-level upserts in one batch.
 */
export async function advanceInCartRows(
  env: Env,
  tenant: string,
  lines: { name: string }[],
  today: string,
): Promise<void> {
  const current = await readGroceryList(env, tenant);
  const byKey = new Map(current.map((it) => [normalizeName(it.name), it]));
  const stmts: D1PreparedStatement[] = [];
  for (const line of lines) {
    const key = normalizeName(line.name);
    const existing = byKey.get(key);
    const next: GroceryItem = existing
      ? { ...existing, status: "in_cart" }
      : {
          name: line.name,
          quantity: "1",
          kind: "grocery",
          domain: "grocery",
          status: "in_cart",
          source: "menu",
          for_recipes: [],
          note: null,
          added_at: today,
          ordered_at: null,
        };
    stmts.push(groceryUpsertStmt(env, tenant, next));
  }
  if (stmts.length > 0) await db(env).batch(stmts);
}
