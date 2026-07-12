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
import { isFoodItem, normalizeName, storedGroceryKey } from "./grocery.js";
import {
  ingredientContext,
  emptyIngredientContext,
  captureSubstitution,
  readIngredientCategoryMemo,
} from "./corpus-db.js";
import { validateCanonicalId } from "./ingredient-normalize.js";
import { stampDepartment, PANTRY_CATEGORIES, LEGACY_CATEGORY_TO_LOCATION } from "./department.js";
import { recordPurchaseAssertion, voidSpendEvents, deleteSendStatements } from "./spend.js";
import {
  applyPantryOperations,
  markVerified,
  pantryOperationShapeError,
  type PantryItem,
  type PantryOperation,
  type PantryApplyResult,
  type WasteEventDraft,
} from "./pantry-write.js";
import {
  applyMealPlanOps,
  orderPlanned,
  type PlannedRow,
  type MealPlanOp,
  type AppliedPlanOp,
  type PlanOpConflict,
} from "./meal-plan.js";
import { ulid } from "./ids.js";
import {
  addToGroceryList,
  updateGroceryItem,
  removeGroceryItem,
  findGroceryItem,
  illegalStatusTransition,
  type GroceryItem,
  type GroceryAddInput,
  type GroceryUpdateInput,
  type AddResult,
  type UpdateResult,
} from "./grocery.js";

/** The ISO date (YYYY-MM-DD) of an epoch-ms `now` — the `added_at`/`ordered_at` stamp the grocery
 *  advance helpers (below) take. Shared so the order-fill intake (ingest.ts) and endpoints
 *  (satellite.ts) stamp identically. */
export function isoDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

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
  display_name: string | null;
  quantity: string | null;
  category: string | null;
  location: string | null;
  prepared_from: string | null;
  added_at: string | null;
  last_verified_at: string | null;
  notes: string | null;
}

/** Assemble a pantry item (the agent-facing shape) from a row. Carries the STORED `normalized_name`
 *  (so the pure ops key on the stored id, never a re-derivation) and the curated `display_name`. */
function pantryItemOf(r: PantryRow): PantryItem {
  const item: PantryItem = { name: r.name, normalized_name: r.normalized_name };
  if (r.display_name != null) item.display_name = r.display_name;
  if (r.quantity != null) item.quantity = r.quantity;
  if (r.category != null) item.category = r.category;
  if (r.location != null) item.location = r.location;
  item.prepared_from = r.prepared_from; // null is meaningful (the default)
  if (r.added_at != null) item.added_at = r.added_at;
  if (r.last_verified_at != null) item.last_verified_at = r.last_verified_at;
  if (r.notes != null) item.notes = r.notes;
  return item;
}

export interface PantryFilter {
  category?: string;
  location?: string;
  preparedOnly?: boolean;
}

/** Read the caller's pantry rows, with optional category / location / prepared filters (WHERE).
 *  A LEGACY location-flavored `category` value (pantry|fridge|freezer|spices) is mapped onto the
 *  `location` filter for one deprecation window (design D7/D21), so cached-skill reads keep
 *  working across the vocabulary split; an explicit `location` filter wins over the mapping. */
export async function readPantry(env: Env, tenant: string, filter: PantryFilter = {}): Promise<PantryItem[]> {
  let category = filter.category;
  let location = filter.location;
  if (category !== undefined) {
    const legacy = LEGACY_CATEGORY_TO_LOCATION[category.trim().toLowerCase()];
    if (legacy !== undefined) {
      if (location === undefined) location = legacy;
      category = undefined;
    }
  }
  let sql =
    "SELECT name, normalized_name, display_name, quantity, category, location, prepared_from, added_at, last_verified_at, notes " +
    "FROM pantry WHERE tenant = ?1";
  const binds: unknown[] = [tenant];
  if (category !== undefined) {
    sql += ` AND category = ?${binds.length + 1}`;
    binds.push(category);
  }
  if (location !== undefined) {
    sql += ` AND location = ?${binds.length + 1}`;
    binds.push(location);
  }
  if (filter.preparedOnly) {
    sql += " AND prepared_from IS NOT NULL";
  }
  const rows = await db(env).all<PantryRow>(sql, ...binds);
  return rows.map(pantryItemOf);
}

/** An UPSERT statement for one pantry item (merge rule: keep added_at, overlay rest). Pantry
 *  is food by construction, so `normalized_name` is `resolve(name)` (the canonical id). */
export function pantryUpsertStmt(
  env: Env,
  tenant: string,
  item: PantryItem,
  resolve: (n: string) => string,
): D1PreparedStatement {
  const name = String(item.name);
  return db(env).prepare(
    "INSERT INTO pantry (tenant, name, normalized_name, quantity, category, location, prepared_from, " +
      "added_at, last_verified_at, notes, display_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) " +
      "ON CONFLICT(tenant, normalized_name) DO UPDATE SET " +
      "name = excluded.name, quantity = excluded.quantity, category = excluded.category, " +
      "location = excluded.location, " +
      "prepared_from = excluded.prepared_from, last_verified_at = excluded.last_verified_at, " +
      "notes = excluded.notes, display_name = excluded.display_name",
    tenant,
    name,
    resolve(name),
    item.quantity ?? null,
    item.category ?? null,
    item.location ?? null,
    item.prepared_from ?? null,
    item.added_at ?? null,
    item.last_verified_at ?? null,
    item.notes ?? null,
    item.display_name ?? null,
  );
}

/** Crockford base32 (the ULID alphabet). */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Mint a ULID-shaped event id (48-bit time + 80-bit crypto randomness, 26 chars) — the
 *  server-side mint for a `dispose` that arrived without a client `event_id` (the agent/MCP
 *  path is online by construction, so no replay key is needed; design D3). */
export function mintEventId(now: number = Date.now()): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rand = crypto.getRandomValues(new Uint8Array(16));
  let out = time;
  for (let i = 0; i < 16; i++) out += ULID_ALPHABET[rand[i] & 31];
  return out;
}

/** An INSERT for one waste event — idempotent under the client-minted id (design D3/D4):
 *  `ON CONFLICT(tenant, id) DO NOTHING`, so a replayed dispose can never duplicate. */
export function wasteEventInsertStmt(
  env: Env,
  tenant: string,
  event: {
    id: string;
    name: string;
    item_id: string;
    prepared_from: string | null;
    quantity: string | null;
    department: string | null;
    reason: string;
    occurred_at: string;
    created_at: string;
  },
): D1PreparedStatement {
  return db(env).prepare(
    "INSERT INTO waste_events (tenant, id, name, item_id, prepared_from, quantity, department, reason, occurred_at, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT(tenant, id) DO NOTHING",
    tenant,
    event.id,
    event.name,
    event.item_id,
    event.prepared_from,
    event.quantity,
    event.department,
    event.reason,
    event.occurred_at,
    event.created_at,
  );
}

/** The already-recorded subset of the given waste-event ids (the D3 replay probe). */
async function existingWasteEventIds(env: Env, tenant: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const id of ids) {
    const row = await db(env).first<{ ok: number }>(
      "SELECT 1 AS ok FROM waste_events WHERE tenant = ?1 AND id = ?2",
      tenant,
      id,
    );
    if (row) found.add(id);
  }
  return found;
}

/**
 * Apply pantry add/remove/verify/dispose operations as row statements. Shape-validates
 * every op first (a violation is a whole-call `validation_failed` ToolError — the shared
 * posture for the MCP tool and `/api`), short-circuits a replayed `dispose` whose
 * `event_id` is already recorded to applied-with-no-writes (design D3 replay convergence),
 * reads the current rows, runs the pure `applyPantryOperations` (merge/conflict/vocab
 * logic), then emits an UPSERT per applied add/verify, a DELETE per applied remove/dispose,
 * and a waste-event INSERT per waste dispose — one D1 batch, so the row delete and the
 * event insert land atomically. Waste events stamp their analytics `department` at capture
 * (`stampDepartment`: leftovers → in-vocab row category → identity memo → NULL pending).
 */
export async function applyPantryRowOps(
  env: Env,
  tenant: string,
  operations: PantryOperation[],
  today: string,
): Promise<Pick<PantryApplyResult, "applied" | "conflicts" | "warnings">> {
  for (let i = 0; i < operations.length; i++) {
    const err = pantryOperationShapeError(operations[i], i);
    if (err) throw new ToolError("validation_failed", err, { index: i });
  }

  // Replay convergence (D3): a dispose whose client event_id is already recorded reports
  // applied and writes NOTHING — the row is already gone and the event already stands, and
  // a row re-added since the original toss must not be deleted by the replay.
  const replayIds = operations
    .filter((op) => op.op === "dispose" && op.disposition === "waste" && op.event_id !== undefined)
    .map((op) => op.event_id as string);
  const recorded = replayIds.length > 0 ? await existingWasteEventIds(env, tenant, replayIds) : new Set<string>();
  const replayApplied: PantryApplyResult["applied"] = [];
  const effective = operations.filter((op) => {
    if (op.op === "dispose" && op.event_id !== undefined && recorded.has(op.event_id)) {
      replayApplied.push({
        op: "dispose",
        name: typeof op.name === "string" ? op.name : String(op.item?.name ?? ""),
        disposition: op.disposition,
      });
      return false;
    }
    return true;
  });

  // Pantry is food by construction — funnel every row through the canonical-id resolver
  // (normalize + best-effort capture). A resolver read failure degrades to lowercase/strip
  // with capture disabled, never failing the write.
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readPantry(env, tenant);
  const result = applyPantryOperations(current, effective, today, ctx.resolve);
  const byName = new Map(result.items.map((it) => [ctx.resolve(String(it.name)), it]));

  const stmts: D1PreparedStatement[] = [];
  for (const a of result.applied) {
    const key = ctx.resolve(a.name);
    if (a.op === "remove" || a.op === "dispose") {
      stmts.push(
        db(env).prepare("DELETE FROM pantry WHERE tenant = ?1 AND normalized_name = ?2", tenant, key),
      );
    } else {
      // add (upsert) or verify (last_verified_at refresh) — UPSERT the resulting row.
      const item = byName.get(key);
      if (item) stmts.push(pantryUpsertStmt(env, tenant, item, ctx.resolve));
    }
  }

  if (result.wasteEvents.length > 0) {
    // The identity memo backs the department stamp's step 3 — read once, only for drafts a
    // leftover/row-category stamp doesn't already decide. A memo read failure degrades to
    // NULL-pending (the cron fills it), never failing the dispose.
    const needMemo = result.wasteEvents
      .filter(
        (d: WasteEventDraft) =>
          d.prepared_from == null && !(d.category !== null && (PANTRY_CATEGORIES as readonly string[]).includes(d.category)),
      )
      .map((d) => d.item_id);
    const memo =
      needMemo.length > 0
        ? await readIngredientCategoryMemo(env, needMemo).catch(() => new Map<string, string>())
        : new Map<string, string>();
    const createdAt = new Date().toISOString();
    for (const draft of result.wasteEvents) {
      stmts.push(
        wasteEventInsertStmt(env, tenant, {
          id: draft.id ?? mintEventId(),
          name: draft.name,
          item_id: draft.item_id,
          prepared_from: draft.prepared_from,
          quantity: draft.quantity,
          department: stampDepartment({
            preparedFrom: draft.prepared_from,
            rowCategory: draft.category,
            memoCategory: memo.get(draft.item_id) ?? null,
          }),
          reason: draft.reason,
          occurred_at: draft.occurred_at ?? today,
          created_at: createdAt,
        }),
      );
    }
  }

  if (stmts.length > 0) await db(env).batch(stmts);
  return {
    applied: [...result.applied, ...replayApplied],
    conflicts: result.conflicts,
    warnings: result.warnings,
  };
}

/** Reset last_verified_at to `today` on the named pantry rows. Returns verified + missing. */
export async function markPantryVerifiedRows(
  env: Env,
  tenant: string,
  names: string[],
  today: string,
): Promise<{ verified: string[]; missing: string[] }> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readPantry(env, tenant);
  const { items, verified, missing } = markVerified(current, names, today, ctx.resolve);
  const byName = new Map(items.map((it) => [ctx.resolve(String(it.name)), it]));
  const stmts: D1PreparedStatement[] = [];
  for (const name of verified) {
    const item = byName.get(ctx.resolve(name));
    if (item) stmts.push(pantryUpsertStmt(env, tenant, item, ctx.resolve));
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return { verified, missing };
}

/** One pantry row's verify metadata, keyed for the to-buy view's coverage join. */
export interface PantryMeta {
  name: string;
  display_name: string | null;
  quantity: string | null;
  category: string | null;
  last_verified_at: string | null;
}

/**
 * The caller's pantry rows keyed by their stored `normalized_name` (the canonical id) —
 * the to-buy view's `pantry_covered` join (member-app-grocery D3): a covered line carries
 * the pantry row's quantity/category/last-verified so verification nudges are renderable.
 * Read directly by the stored key (no re-resolution), like `readGroceryKeyIndex`.
 */
export async function readPantryByKey(env: Env, tenant: string): Promise<Map<string, PantryMeta>> {
  const rows = await db(env).all<{ name: string; normalized_name: string } & Omit<PantryMeta, "name">>(
    "SELECT name, normalized_name, display_name, quantity, category, last_verified_at FROM pantry WHERE tenant = ?1",
    tenant,
  );
  return new Map(
    rows.map((r) => [
      r.normalized_name,
      { name: r.name, display_name: r.display_name, quantity: r.quantity, category: r.category, last_verified_at: r.last_verified_at },
    ]),
  );
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
  id: string;
  recipe: string;
  meal: string;
  planned_for: string | null;
  sides: string | null;
  from_vibe: string | null;
}

function plannedRowOf(r: MealPlanRow): PlannedRow {
  const item: PlannedRow = {
    id: r.id,
    recipe: r.recipe,
    meal: (r.meal as PlannedRow["meal"]) ?? "dinner",
    planned_for: r.planned_for ?? null,
  };
  const sides = parseJsonArray(r.sides);
  if (sides.length) item.sides = sides;
  if (r.from_vibe) item.from_vibe = r.from_vibe;
  return item;
}

/** Read the caller's meal-plan rows, in the read_meal_plan ORDERING GUARANTEE: dated
 *  rows by `(planned_for, breakfast < lunch < dinner)`, then undated rows grouped by
 *  meal, then projects last; ties by `id ASC` (arbitrary-but-deterministic). */
export async function readMealPlan(env: Env, tenant: string): Promise<PlannedRow[]> {
  const rows = await db(env).all<MealPlanRow>(
    "SELECT id, recipe, meal, planned_for, sides, from_vibe FROM meal_plan WHERE tenant = ?1",
    tenant,
  );
  return orderPlanned(rows.map(plannedRowOf));
}

/** An UPSERT statement for one meal-plan row (keyed on `(tenant, id)` — D26-final). */
function mealPlanUpsertStmt(env: Env, tenant: string, item: PlannedRow): D1PreparedStatement {
  const sides = item.sides && item.sides.length ? JSON.stringify(item.sides) : null;
  return db(env).prepare(
    "INSERT INTO meal_plan (tenant, id, recipe, meal, planned_for, sides, from_vibe) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
      "ON CONFLICT(tenant, id) DO UPDATE SET recipe = excluded.recipe, meal = excluded.meal, " +
      "planned_for = excluded.planned_for, sides = excluded.sides, from_vibe = excluded.from_vibe",
    tenant,
    item.id,
    item.recipe,
    item.meal,
    item.planned_for ?? null,
    sides,
    item.from_vibe ?? null,
  );
}

/** A DELETE for one meal-plan row by its id — log_cooked's transactional clear deletes
 *  exactly the row the deterministic clear order selected (a concurrent delete makes it
 *  a no-op — safe). */
export function mealPlanDeleteByIdStmt(env: Env, tenant: string, id: string): D1PreparedStatement {
  return db(env).prepare("DELETE FROM meal_plan WHERE tenant = ?1 AND id = ?2", tenant, id);
}

/**
 * Apply meal-plan add/remove/set ops as row statements over per-slot identity: reads
 * current rows, runs the pure `applyMealPlanOps` (the D26-final resolution order —
 * id replay → `duplicate: true` → slug-global coalesce; remove split idempotency;
 * set unique-or-candidates; project constraints), and emits one UPSERT per touched
 * row + one DELETE per removed id in a single batch. New ids are server-minted ULIDs
 * when the caller supplied none.
 */
export async function applyMealPlanRowOps(
  env: Env,
  tenant: string,
  ops: MealPlanOp[],
): Promise<{ applied: AppliedPlanOp[]; conflicts: PlanOpConflict[] }> {
  const current = await readMealPlan(env, tenant);
  const result = applyMealPlanOps(current, ops, ulid);
  const stmts: D1PreparedStatement[] = [
    ...result.deletes.map((id) => mealPlanDeleteByIdStmt(env, tenant, id)),
    ...result.upserts.map((row) => mealPlanUpsertStmt(env, tenant, row)),
  ];
  if (stmts.length > 0) await db(env).batch(stmts);
  return { applied: result.applied, conflicts: result.conflicts };
}

// === Grocery list ============================================================

interface GroceryRow {
  name: string;
  normalized_name: string;
  display_name: string | null;
  quantity: string | null;
  kind: string | null;
  domain: string | null;
  status: string | null;
  source: string | null;
  for_recipes: string | null;
  note: string | null;
  added_at: string | null;
  ordered_at: string | null;
  sent_in: string | null;
  checked_at: string | null;
  row_version: number | null;
  updated_at: string | null;
}

function groceryItemOf(r: GroceryRow): GroceryItem {
  return {
    name: r.name,
    normalized_name: r.normalized_name,
    display_name: r.display_name ?? null,
    quantity: r.quantity ?? "1",
    kind: (r.kind ?? "grocery") as GroceryItem["kind"],
    domain: r.domain ?? "grocery",
    status: (r.status ?? "active") as GroceryItem["status"],
    source: (r.source ?? "ad_hoc") as GroceryItem["source"],
    for_recipes: parseJsonArray(r.for_recipes),
    note: r.note ?? null,
    added_at: r.added_at ?? "",
    ordered_at: r.ordered_at ?? null,
    sent_in: r.sent_in ?? null,
    checked_at: r.checked_at ?? null,
    row_version: r.row_version ?? 1,
    updated_at: r.updated_at ?? null,
  };
}

const GROCERY_SELECT =
  "SELECT name, normalized_name, display_name, quantity, kind, domain, status, source, for_recipes, note, " +
  "added_at, ordered_at, sent_in, checked_at, row_version, updated_at FROM grocery_list WHERE tenant = ?1";

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

/**
 * Read the grocery list with LEGACY id-named rows reified for display (reify-ingredient-display-names
 * Move D): the shared read behind `read_grocery_list` (MCP) and `GET /api/grocery`. A legacy row
 * stored before the display/key split has `name === normalized_name` (the raw canonical id) and no
 * display; for such a row (and only such a row) the curated node label is resolved at READ into
 * `display_name` (`ctx.idLabel`, never a raw `::` id), converging as the node's `display_name`
 * backfills — no per-row edit. A NEW add-by-id row already stores a clean display `name`, and a typed
 * row's `name` is the member's phrasing, so both are no-ops here; a row with an explicit
 * `display_name` override is left untouched. Only **food** rows are reified — a non-food row never
 * touches the identity graph, so its `name === normalized_name` (both `normalizeName`) is left as the
 * member's phrasing even when it collides with a food id. The resolver read is capture-off (a read
 * never enqueues) and degrades to the empty context on a blip, so it never fails the list read.
 */
export async function readGroceryListReified(env: Env, tenant: string, status?: string): Promise<GroceryItem[]> {
  const items = await readGroceryList(env, tenant, status);
  // A legacy row to reify: a FOOD row stored under its own canonical id as `name`, no display.
  const isLegacyIdNamed = (it: GroceryItem): boolean =>
    it.display_name == null && it.name === it.normalized_name && isFoodItem(it.kind, it.domain);
  if (!items.some(isLegacyIdNamed)) return items;
  const ctx = await ingredientContext(env, { capture: false }).catch(() => emptyIngredientContext(env));
  return items.map((it) =>
    isLegacyIdNamed(it) ? { ...it, display_name: ctx.idLabel(it.normalized_name as string) } : it,
  );
}

/** An UPSERT statement for one grocery-list item. `normalized_name` keys on the canonical id
 *  (`resolve`) for a FOOD row and `normalizeName` for a non-food row (`groceryKey`'s guard) —
 *  the SAME function `computeToBuy` / the pure ops use, so the store never corrupts. */
export function groceryUpsertStmt(
  env: Env,
  tenant: string,
  item: GroceryItem,
  resolve: (n: string) => string,
): D1PreparedStatement {
  return db(env).prepare(
    "INSERT INTO grocery_list (tenant, name, normalized_name, quantity, kind, domain, status, " +
      "source, for_recipes, note, added_at, ordered_at, display_name, sent_in, checked_at, row_version, updated_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17) " +
      "ON CONFLICT(tenant, normalized_name) DO UPDATE SET " +
      "name = excluded.name, quantity = excluded.quantity, kind = excluded.kind, " +
      "domain = excluded.domain, status = excluded.status, source = excluded.source, " +
      "for_recipes = excluded.for_recipes, note = excluded.note, ordered_at = excluded.ordered_at, " +
      "display_name = excluded.display_name, sent_in = excluded.sent_in, " +
      "decision_owner_token = NULL, row_version = grocery_list.row_version + 1, updated_at = ?18",
    tenant,
    item.name,
    // Persist the STORED key the item carries (add-by-id rows key on the given id, which is NOT
    // `resolve(name)`); fall back to the derived key for a fixture / not-yet-persisted item.
    storedGroceryKey(item, resolve),
    item.quantity,
    item.kind,
    item.domain,
    item.status,
    item.source,
    JSON.stringify(item.for_recipes),
    item.note,
    item.added_at,
    item.ordered_at,
    item.display_name ?? null,
    // The internal send linkage rides the in-memory item (stamped/cleared only by the
    // order-flush and status-transition ops — no tool/route input reaches it).
    item.sent_in ?? null,
    item.checked_at ?? null,
    item.row_version ?? 1,
    item.updated_at ?? new Date().toISOString(),
    new Date().toISOString(),
  );
}

/**
 * Add (or merge into) one grocery-list item; returns the resulting item + merged flag.
 *
 * Add-by-id: when `input.id` is supplied it is treated as an ALREADY-CANONICAL key. It is accepted
 * only when it is well-formed (`validateCanonicalId`) AND a LIVE survivor in the current resolver
 * (`ctx.resolver.ids` — a well-formed but never-minted / merged-away-loser id must NOT be stored as
 * a key). When accepted, the row keys on the id directly (NOT re-resolved through the funnel) as its
 * `normalized_name`, and stores a clean human DISPLAY as its `name` — the member's posted phrasing
 * when present, else the node's `idLabel` (a curated label or its deterministic synthesis, NEVER the
 * raw id) — with `display_name` null. Key and display are stored separately, so the row keys on the
 * id while every surface renders `name` natively. A rejected id (malformed or non-survivor) falls
 * back to the `name` path when a name is present, else it is a structured `validation_failed` — an
 * unresolvable key is NEVER stored. Add-by-name is today's behavior unchanged
 * (key = `groceryKey(name,…)`, `display_name` null).
 */
export async function addGroceryRow(
  env: Env,
  tenant: string,
  input: GroceryAddInput,
  today: string,
): Promise<{ item: GroceryItem; merged: boolean }> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  let effective = input;
  if (input.id !== undefined) {
    const validId = validateCanonicalId(input.id);
    if (validId && ctx.resolver.ids.has(validId)) {
      // A live survivor: key on the id, name = the display (posted phrasing, else the node's clean
      // idLabel — never the raw id); display_name null. The key and the display are stored separately.
      const display = input.name?.trim() || ctx.idLabel(validId);
      effective = { ...input, id: validId, name: display, display_name: null };
    } else if (input.name?.trim()) {
      // Malformed / non-survivor id but a member name is present — fall back to the name path (drop the id).
      effective = { ...input, id: undefined };
    } else {
      throw new ToolError("validation_failed", `not a live canonical ingredient id: ${input.id}`, { id: input.id });
    }
  }
  if (!effective.id && !effective.name?.trim()) {
    throw new ToolError("validation_failed", "an add requires a name or a canonical id");
  }
  const current = await readGroceryList(env, tenant);
  const result: AddResult = addToGroceryList(current, effective, today, ctx.resolve);
  await db(env).batch([groceryUpsertStmt(env, tenant, result.item, ctx.resolve)]);
  // Best-effort taste-substitution capture (D6/D7): a FOOD add annotated with the recipe ingredient
  // it stands in for records/strengthens a candidate `substitution` edge in the identity graph.
  // Runs AFTER the add write and is throw-free by construction (`captureSubstitution` swallows every
  // failure), so it can never fail the grocery add. A non-food add never enters the identity graph.
  // The added item Y is the RESOLVED display term (`effective.name`: the member's phrasing when
  // present, else an add-by-id row's clean `idLabel`), so an accepted add-by-id swap still captures.
  if (input.substitutes_for && effective.name && isFoodItem(input.kind, input.domain)) {
    await captureSubstitution(env, ctx, input.substitutes_for, effective.name);
  }
  return { item: result.item, merged: result.merged };
}

/**
 * Patch one grocery-list item by name. Throws a `not_found` ToolError when absent.
 * Enforces the W3 status-transition guard (grocery.ts `illegalStatusTransition`) for
 * EVERY caller — the MCP tool and the member API get the identical guarantee: an
 * illegal write of `status: "ordered"` is a structured `validation_failed` carrying
 * `{ name, from, to }`, row unchanged; the legal `in_cart → ordered` (user-asserted
 * order placed) advance stamps `ordered_at` = `today` (parity with
 * `advanceOrderedRows`, which is a separate code path and unaffected).
 *
 * Spend hooks (spend-telemetry, D16) — homed HERE in the shared op so every surface
 * (the MCP tool AND the member PATCH route) gets the identical guarantees:
 *   - the legal `in_cart → ordered` advance is the PURCHASE ASSERTION: it keeps the
 *     row's send linkage and materializes the linked send-snapshot lines as spend
 *     events via the one shared writer (verbatim copy, idempotent) — a row with no
 *     linkage (a manual `active → in_cart` move) advances without writing spend;
 *   - `in_cart → active` clears the linkage and writes nothing (the snapshot lines
 *     simply never materialize);
 *   - leaving `ordered` (re-listed in either direction) VOIDS the row's materialized
 *     events (`voided_at`, never a delete) and clears the linkage — the same branch
 *     that already clears `ordered_at`.
 */
export async function updateGroceryRow(
  env: Env,
  tenant: string,
  name: string,
  patch: GroceryUpdateInput,
  today: string = isoDay(Date.now()),
): Promise<GroceryItem> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readGroceryList(env, tenant);
  const existing = findGroceryItem(current, name, ctx.resolve);
  if (!existing) {
    throw new ToolError("not_found", `No grocery-list item named: ${name}`, { name });
  }
  if (patch.status !== undefined) {
    const illegal = illegalStatusTransition(existing.status, patch.status);
    if (illegal) {
      throw new ToolError("validation_failed", illegal, {
        name: existing.name,
        from: existing.status,
        to: patch.status,
      });
    }
  }
  let result: UpdateResult;
  try {
    result = updateGroceryItem(current, name, patch, ctx.resolve);
  } catch {
    throw new ToolError("not_found", `No grocery-list item named: ${name}`, { name });
  }
  let item = result.item;
  // The legal user-asserted advance stamps ordered_at (the patch path used to leave it null);
  // any status write that leaves "ordered" (e.g. re-listing to "active"/"in_cart") clears the
  // stamp so a later re-advance stamps fresh rather than carrying a stale timestamp.
  const asserted = patch.status === "ordered" && existing.status === "in_cart";
  const leavingOrdered = patch.status !== undefined && patch.status !== "ordered" && existing.status === "ordered";
  const leavingInCart = patch.status === "active" && existing.status === "in_cart";
  if (asserted) {
    item = { ...item, ordered_at: today };
  } else if (patch.status !== undefined && patch.status !== "ordered") {
    item = { ...item, ordered_at: null };
  }
  // Send-linkage transitions (D16): leaving the in-flight send without an assertion
  // (in_cart → active) or leaving `ordered` (either direction) drops the linkage; the
  // assertion keeps it (the writer below materializes from it).
  if (leavingOrdered || leavingInCart) {
    item = { ...item, sent_in: null };
  }
  await db(env).batch([groceryUpsertStmt(env, tenant, item, ctx.resolve)]);
  const lineKey = storedGroceryKey(existing, ctx.resolve);
  if (asserted && existing.sent_in) {
    // The purchase assertion: materialize the linked snapshot verbatim (idempotent —
    // a replayed assertion is rejected by the W3 guard before it ever reaches here,
    // and the writer's (send_id, line_key) PK absorbs any race the guard misses).
    // Runs after the row write: if this throws on a storage blip the row is already
    // ordered+linked and a retry of status:"ordered" dead-ends on the transition guard,
    // so the event is only recoverable by re-listing first — an accepted telemetry-only
    // loss (no phantom spend), visible as an ordered row with no event.
    await recordPurchaseAssertion(env, tenant, [{ sendId: existing.sent_in, lineKey }], today);
  } else if (leavingOrdered && existing.sent_in) {
    // Re-listing an ordered row voids its events — never deletes them.
    await voidSpendEvents(env, tenant, [{ sendId: existing.sent_in, lineKey }]);
  }
  return item;
}

/**
 * Remove one grocery-list item by name. `found` is false when no such row existed.
 *
 * NEGATIVE GUARANTEE (spend-telemetry): a removal NEVER writes spend — a remove is
 * ambiguous (a collapsed receive expressed as removes, or "changed my mind"), so it is
 * not a purchase assertion; any send linkage dies with the row. The guarantee is this
 * operation's, independent of any skill. Any future operation that completes a receive
 * for rows still `in_cart` must perform the purchase assertion FIRST (advance through
 * the guarded transition, materializing via the shared writer), then remove.
 */
export async function removeGroceryRow(
  env: Env,
  tenant: string,
  name: string,
): Promise<{ found: boolean }> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readGroceryList(env, tenant);
  const { found } = removeGroceryItem(current, name, ctx.resolve);
  if (!found) return { found: false };
  // Lookup-by-bare-name carries no kind/domain, so the target may be keyed under EITHER
  // candidate: the resolved canonical id (food) or normalizeName (non-food). Delete both
  // (deduped when they coincide) so a case/quantity/alias-varying removal hits its row.
  const resolved = ctx.resolve(name);
  const plain = normalizeName(name);
  if (resolved === plain) {
    await db(env).run(
      "DELETE FROM grocery_list WHERE tenant = ?1 AND normalized_name = ?2",
      tenant,
      resolved,
    );
  } else {
    await db(env).run(
      "DELETE FROM grocery_list WHERE tenant = ?1 AND normalized_name IN (?2, ?3)",
      tenant,
      resolved,
      plain,
    );
  }
  return { found: true };
}

/**
 * Read the caller's grocery-list rows keyed by their canonical id (`normalized_name`), each
 * mapped to its display `name` + current `status`. The order-fill receipt reconciliation
 * (satellite-order-cart-fill) uses this to advance ONLY issued ids that are STILL on the list:
 * an `item_id` (=== `normalized_name`) not present, or not `active`, is skipped rather than
 * resurrected/regressed — the receipt's issued-set guard against a stale pull-list. Read directly
 * (the id IS the key) so no ingredient-context resolution is needed here.
 */
export async function readGroceryKeyIndex(
  env: Env,
  tenant: string,
): Promise<Map<string, { name: string; status: string; kind: string; domain: string }>> {
  const rows = await db(env).all<{
    name: string;
    normalized_name: string;
    status: string | null;
    kind: string | null;
    domain: string | null;
  }>("SELECT name, normalized_name, status, kind, domain FROM grocery_list WHERE tenant = ?1", tenant);
  return new Map(
    rows.map((r) => [
      r.normalized_name,
      // kind/domain ride along for the send snapshot's department override (a household
      // row stamps `household` at capture, never pending).
      { name: r.name, status: r.status ?? "active", kind: r.kind ?? "grocery", domain: r.domain ?? "grocery" },
    ]),
  );
}

/**
 * Advance the given lines to status:ordered (+ `ordered_at`), keyed by canonical id — the
 * mark-placed advance the satellite cart-fill flush uses after the human checks out. UPDATE-ONLY:
 * a line with no existing row is skipped (never inserted), unlike `advanceInCartRows` — an order
 * can only be placed for a line already on the list. Mirrors `advanceInCartRows`' keying.
 *
 * This is the satellite path's PURCHASE ASSERTION (spend-telemetry, D16): after the
 * advance, rows carrying a send linkage materialize their send-snapshot lines as spend
 * events via the one shared writer — verbatim copy, idempotent on `(send_id, line_key)`,
 * so a replayed mark-placed converges. A row with no linkage advances without writing
 * spend (nothing was snapshotted for it).
 *
 * Status-agnostic by design: callers MUST filter to `in_cart` rows — re-advancing an
 * already-`ordered` row restamps its `ordered_at` (the event materialize itself stays
 * idempotent either way).
 */
export async function advanceOrderedRows(
  env: Env,
  tenant: string,
  lines: { name: string; key?: string }[],
  today: string,
): Promise<void> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readGroceryList(env, tenant);
  // Key existing rows by their STORED `normalized_name` (never a re-derivation of the display),
  // look up by the caller's explicit stored key (add-by-id rows, satellite receipt) or, absent one,
  // the resolved line name — closes coupling #2 for the ordered advance.
  const byKey = new Map(current.map((it) => [storedGroceryKey(it, ctx.resolve), it]));
  const stmts: D1PreparedStatement[] = [];
  const asserted: { sendId: string; lineKey: string }[] = [];
  for (const line of lines) {
    const key = line.key ?? ctx.resolve(line.name);
    const existing = byKey.get(key);
    if (!existing) continue; // update-only — never mint a row on the ordered advance
    // The linkage rides the row (`...existing`) into `ordered`; the writer keys on it.
    stmts.push(groceryUpsertStmt(env, tenant, { ...existing, status: "ordered", ordered_at: today }, ctx.resolve));
    if (existing.sent_in) asserted.push({ sendId: existing.sent_in, lineKey: storedGroceryKey(existing, ctx.resolve) });
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  if (asserted.length > 0) await recordPurchaseAssertion(env, tenant, asserted, today);
}

/** The send-record rider an order-flush advance composes into its batch (spend-telemetry):
 *  the send id stamps each advanced row's `sent_in`, and the snapshot statements
 *  (`snapshotStatements(...)`) land in the SAME batch — the send exists iff the advance
 *  succeeded. Absent (a bare advance), rows advance with no linkage and no snapshot. */
export interface SendBatch {
  id: string;
  statements: D1PreparedStatement[];
}

/**
 * Advance the given resolved lines to status:in_cart, inserting any line not yet on
 * the list (a menu-plan-derived need has no stored row). Mirrors the old KV advance —
 * row-level upserts in one batch. Returns the canonical keys of the rows it INSERTED
 * (vs merely updated), so `rollbackInCartRows` can compensate an insert by deleting
 * the row instead of stranding a never-listed `active` item.
 *
 * With a `send` rider the advance is a SNAPSHOT-WRITING advance (spend-telemetry): the
 * send-record statements join this same atomic batch and every advanced row is stamped
 * `sent_in = send.id`. Without one, `sent_in` is left as-is (a bare advance stamps
 * nothing — a manual or degraded advance never manufactures a linkage).
 */
export async function advanceInCartRows(
  env: Env,
  tenant: string,
  lines: { name: string; key?: string }[],
  today: string,
  send?: SendBatch,
): Promise<{ inserted: string[] }> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readGroceryList(env, tenant);
  // Advanced lines are resolved grocery purchases (food) — key existing rows by their STORED
  // `normalized_name` (never a re-derivation of the display) and each line by its explicit stored key
  // (place_order's `ResolvedLine.key`, the satellite receipt's issued id) or, absent one, resolve(name)
  // so a food purchase still matches its row across surface forms; a never-listed line mints a fresh
  // row under that same key.
  const byKey = new Map(current.map((it) => [storedGroceryKey(it, ctx.resolve), it]));
  const stmts: D1PreparedStatement[] = send ? [...send.statements] : [];
  const inserted: string[] = [];
  for (const line of lines) {
    const key = line.key ?? ctx.resolve(line.name);
    const existing = byKey.get(key);
    if (!existing) inserted.push(key);
    const next: GroceryItem = existing
      ? { ...existing, status: "in_cart", sent_in: send ? send.id : (existing.sent_in ?? null) }
      : {
          name: line.name,
          normalized_name: key,
          display_name: null,
          quantity: "1",
          kind: "grocery",
          domain: "grocery",
          status: "in_cart",
          source: "menu",
          for_recipes: [],
          note: null,
          added_at: today,
          ordered_at: null,
          sent_in: send?.id ?? null,
        };
    stmts.push(groceryUpsertStmt(env, tenant, next, ctx.resolve));
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return { inserted };
}

/**
 * Undo an `advanceInCartRows` — the compensation `place_order` runs when the cart
 * write fails after the pre-write advance. A row the advance INSERTED (its canonical
 * key is in `inserted`) is DELETED — the member never listed it, so flipping it to
 * `active` would strand an orphaned grocery item; a pre-existing row flips from
 * in_cart back to `active`. Both legs are in_cart-guarded and never insert: a line
 * with no row is skipped, and a row in any other status (`active`, `ordered`) is left
 * alone — only the advance this call compensates is undone. Mirrors the advance's keying.
 *
 * With a `sendId` (the advance wrote a send record) the compensation also deletes the
 * send record + its lines in the same batch (a failed cart write means nothing was
 * sent — no phantom order survives) and clears each flipped row's `sent_in` (rows
 * leaving the flight without an assertion drop their linkage).
 */
export async function rollbackInCartRows(
  env: Env,
  tenant: string,
  lines: { name: string; key?: string }[],
  inserted: string[] = [],
  sendId?: string,
): Promise<void> {
  const ctx = await ingredientContext(env).catch(() => emptyIngredientContext(env));
  const current = await readGroceryList(env, tenant);
  // Key existing rows by their STORED `normalized_name`, mirroring the advance this compensates —
  // look up by the line's explicit stored key (place_order's `ResolvedLine.key`) or resolve(name).
  const byKey = new Map(current.map((it) => [storedGroceryKey(it, ctx.resolve), it]));
  const insertedKeys = new Set(inserted);
  const stmts: D1PreparedStatement[] = sendId ? deleteSendStatements(env, sendId) : [];
  for (const line of lines) {
    const key = line.key ?? ctx.resolve(line.name);
    const existing = byKey.get(key);
    if (!existing || existing.status !== "in_cart") continue;
    stmts.push(
      insertedKeys.has(key)
        ? db(env).prepare("DELETE FROM grocery_list WHERE tenant = ?1 AND normalized_name = ?2", tenant, key)
        : groceryUpsertStmt(env, tenant, { ...existing, status: "active", sent_in: null }, ctx.resolve),
    );
  }
  if (stmts.length > 0) await db(env).batch(stmts);
}
