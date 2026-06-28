// D1 profile data layer (d1-profile). The per-tenant grocery profile lives in
// normalized D1 tables (migrations/d1/0004_profile.sql): a singleton `profile` row
// of scalars + freeform JSON + the two markdown fields, plus child tables for the
// list/map fields (brand_prefs, kitchen_equipment, staples, overlay, ready_to_eat,
// stockup). This module is the SINGLE place those rows are assembled into the
// agent-facing shapes and mutated — every tool's profile read/write goes through
// here, over `src/db.ts` (so a D1 failure surfaces as a structured `storage_error`).
//
// Reads assemble objects identical to what the agent saw from the old KV bundle;
// writes mutate rows (UPSERT/DELETE), using `batch` for multi-row atomicity. The
// preferences merge-patch (RFC 7396) lands here: scalar/JSON columns on `profile`,
// brands tri-state on `brand_prefs` (value → UPSERT, `null` → DELETE).

import type { Env } from "./env.js";
import { db } from "./db.js";
import { normalizeName } from "./grocery.js";
import type { OverlayRow } from "./overlay.js";
import type { StaplesItem } from "./staples.js";
import type { StockupItem } from "./stockup.js";
import type { KitchenInventory } from "./kitchen.js";

// --- row shapes (as the D1 driver returns them) ------------------------------

interface ProfileRow {
  tenant: string;
  taste: string | null;
  diet_principles: string | null;
  default_cooking_nights: number | null;
  lunch_strategy: string | null;
  ready_to_eat_default_action: string | null;
  stores: string | null;
  dietary: string | null;
  rotation: string | null;
  custom: string | null;
  kitchen_notes: string | null;
  freezer_capacity_estimate: string | null;
  retrospective_prefs: string | null;
}

/** Parse a JSON column, tolerating null/empty/garbage as `null`. */
function parseJson(value: string | null): unknown {
  if (value == null || value === "") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// --- the assembled profile shape ---------------------------------------------

/** The agent-facing preferences object (defined top-level keys + open `custom`). */
export type Preferences = Record<string, unknown>;

/** The full assembled profile (the `read_user_profile` payload, minus initialized/missing). */
export interface AssembledProfile {
  preferences: Preferences | null;
  taste: string | null;
  diet_principles: string | null;
  kitchen: KitchenInventory;
  staples: StaplesItem[];
  ready_to_eat: Record<string, unknown>[];
  stockup: Record<string, unknown> | null;
}

// --- preferences assembly ----------------------------------------------------

/**
 * Reconstruct the preferences object from the `profile` row + `brand_prefs` rows.
 * Returns null when there is no profile row (no preferences set up). Defined scalar
 * keys are included only when non-null; `stores`/`dietary`/`custom` come from their
 * JSON columns; `brands` is rebuilt as term→ranks from the child table.
 */
function assemblePreferences(
  row: ProfileRow | null,
  brands: { term: string; ranks: string }[],
): Preferences | null {
  // No preferences exist when there is no profile row at all, OR the row carries
  // none of the preference-bearing fields (a bare taste/diet/kitchen-only profile).
  if (row === null) return null;
  const prefs: Preferences = {};
  if (row.default_cooking_nights != null) prefs.default_cooking_nights = row.default_cooking_nights;
  if (row.lunch_strategy != null) prefs.lunch_strategy = row.lunch_strategy;
  if (row.ready_to_eat_default_action != null)
    prefs.ready_to_eat_default_action = row.ready_to_eat_default_action;
  const stores = asObject(parseJson(row.stores));
  if (stores) prefs.stores = stores;
  const dietary = asObject(parseJson(row.dietary));
  if (dietary) prefs.dietary = dietary;
  const rotation = asObject(parseJson(row.rotation));
  if (rotation) prefs.rotation = rotation;
  const retrospective = asObject(parseJson(row.retrospective_prefs));
  if (retrospective) prefs.retrospective = retrospective;
  const custom = asObject(parseJson(row.custom));
  if (custom) prefs.custom = custom;
  if (brands.length > 0) {
    const map: Record<string, unknown> = {};
    for (const { term, ranks } of brands) {
      const parsed = parseJson(ranks);
      map[term] = Array.isArray(parsed) ? parsed : [];
    }
    prefs.brands = map;
  }
  // A profile row with literally nothing preference-bearing reads as "no preferences".
  return Object.keys(prefs).length > 0 ? prefs : null;
}

// --- reads -------------------------------------------------------------------

const PROFILE_SELECT =
  "SELECT tenant, taste, diet_principles, default_cooking_nights, lunch_strategy, " +
  "ready_to_eat_default_action, stores, dietary, rotation, custom, kitchen_notes, " +
  "freezer_capacity_estimate, retrospective_prefs FROM profile WHERE tenant = ?1";

/** The caller's preferences object (or null when none are set up). */
export async function readPreferences(env: Env, tenant: string): Promise<Preferences | null> {
  const [row, brands] = await Promise.all([
    db(env).first<ProfileRow>(PROFILE_SELECT, tenant),
    db(env).all<{ term: string; ranks: string }>(
      "SELECT term, ranks FROM brand_prefs WHERE tenant = ?1",
      tenant,
    ),
  ]);
  return assemblePreferences(row, brands);
}

/** The caller's brand preferences (term → rank list), for the matcher. */
export async function readBrandPrefs(env: Env, tenant: string): Promise<Record<string, string[]>> {
  const rows = await db(env).all<{ term: string; ranks: string }>(
    "SELECT term, ranks FROM brand_prefs WHERE tenant = ?1",
    tenant,
  );
  const out: Record<string, string[]> = {};
  for (const { term, ranks } of rows) {
    const parsed = parseJson(ranks);
    out[term] = Array.isArray(parsed) ? (parsed as string[]) : [];
  }
  return out;
}

/** The caller's owned equipment slugs (the makeability gate's left operand). */
export async function readOwnedEquipment(env: Env, tenant: string): Promise<string[]> {
  const rows = await db(env).all<{ slug: string }>(
    "SELECT slug FROM kitchen_equipment WHERE tenant = ?1 ORDER BY slug",
    tenant,
  );
  return rows.map((r) => r.slug);
}

/** The caller's overlay (slug → {favorite?, reject?}), assembled from the `overlay` table. */
export async function readOverlay(env: Env, tenant: string): Promise<Record<string, OverlayRow>> {
  const rows = await db(env).all<{ recipe: string; favorite: number | null; reject: number | null }>(
    "SELECT recipe, favorite, reject FROM overlay WHERE tenant = ?1",
    tenant,
  );
  const out: Record<string, OverlayRow> = {};
  for (const { recipe, favorite, reject } of rows) {
    const entry: OverlayRow = {};
    if (favorite) entry.favorite = true;
    if (reject) entry.reject = true;
    out[recipe] = entry;
  }
  return out;
}

/** The caller's staples list. */
export async function readStaples(env: Env, tenant: string): Promise<StaplesItem[]> {
  const rows = await db(env).all<{ name: string; perishable: number | null }>(
    "SELECT name, perishable FROM staples WHERE tenant = ?1",
    tenant,
  );
  return rows.map((r) => (r.perishable ? { name: r.name, perishable: true } : { name: r.name }));
}

/** The caller's ready-to-eat catalog items (the same item shape the agent reads). */
export async function readReadyToEat(env: Env, tenant: string): Promise<Record<string, unknown>[]> {
  const rows = await db(env).all<{
    slug: string;
    meal: string | null;
    name: string | null;
    favorite: number | null;
    reject: number | null;
    category: string | null;
    source: string | null;
    brand: string | null;
    notes: string | null;
  }>(
    "SELECT slug, meal, name, favorite, reject, category, source, brand, notes FROM ready_to_eat WHERE tenant = ?1",
    tenant,
  );
  return rows.map((r) => ({
    name: r.name,
    slug: r.slug,
    meal: r.meal,
    favorite: Boolean(r.favorite),
    reject: Boolean(r.reject),
    category: r.category ?? null,
    discovery_source: r.source ?? null,
    brand: r.brand ?? null,
    notes: r.notes ?? null,
  }));
}

/** Raw stockup items (typed shape) for the update path's dedup logic. */
export async function readStockupItems(env: Env, tenant: string): Promise<StockupItem[]> {
  const rows = await db(env).all<{
    name: string;
    unit: string | null;
    typical_purchase: string | null;
    notes: string | null;
    baseline_price: number | null;
    buy_at_or_below: number | null;
  }>(
    "SELECT name, unit, typical_purchase, notes, baseline_price, buy_at_or_below FROM stockup WHERE tenant = ?1",
    tenant,
  );
  return rows.map((r) => {
    const item: StockupItem = { name: r.name };
    if (r.unit != null) item.unit = r.unit;
    if (r.typical_purchase != null) item.typical_purchase = r.typical_purchase;
    if (r.notes != null) item.notes = r.notes;
    if (r.baseline_price != null) item.baseline_price = r.baseline_price;
    if (r.buy_at_or_below != null) item.buy_at_or_below = r.buy_at_or_below;
    return item;
  });
}

/** The caller's freezer estimate (on the `profile` row). */
export async function readFreezerEstimate(env: Env, tenant: string): Promise<string | null> {
  const row = await db(env).first<{ freezer_capacity_estimate: string | null }>(
    "SELECT freezer_capacity_estimate FROM profile WHERE tenant = ?1",
    tenant,
  );
  return row?.freezer_capacity_estimate ?? null;
}

/**
 * Assemble the full profile in one batched-ish set of reads (the per-table SELECTs
 * run concurrently). Returns the structured fields plus the markdown fields; the
 * caller adds `initialized`/`missing`. Shape parity with the old KV-bundle assembly.
 */
export async function readProfile(env: Env, tenant: string): Promise<AssembledProfile> {
  const [profileRow, brands, owned, staples, ready, stockupItems] = await Promise.all([
    db(env).first<ProfileRow>(PROFILE_SELECT, tenant),
    db(env).all<{ term: string; ranks: string }>(
      "SELECT term, ranks FROM brand_prefs WHERE tenant = ?1",
      tenant,
    ),
    readOwnedEquipment(env, tenant),
    readStaples(env, tenant),
    readReadyToEat(env, tenant),
    readStockupItems(env, tenant),
  ]);

  const preferences = assemblePreferences(profileRow, brands);
  const notes = asObject(parseJson(profileRow?.kitchen_notes ?? null)) ?? {};
  const freezer = profileRow?.freezer_capacity_estimate ?? null;
  let stockup: Record<string, unknown> | null = null;
  if (stockupItems.length > 0 || freezer !== null) {
    stockup = {};
    if (freezer !== null) stockup.freezer_capacity_estimate = freezer;
    stockup.items = stockupItems;
  }

  return {
    preferences,
    taste: profileRow?.taste ?? null,
    diet_principles: profileRow?.diet_principles ?? null,
    kitchen: { owned, notes },
    staples,
    ready_to_eat: ready,
    stockup,
  };
}

// --- writes ------------------------------------------------------------------

const SCALAR_PROFILE_COLUMNS = [
  "taste",
  "diet_principles",
  "default_cooking_nights",
  "lunch_strategy",
  "ready_to_eat_default_action",
  "stores",
  "dietary",
  "rotation",
  "custom",
  "kitchen_notes",
  "freezer_capacity_estimate",
] as const;

type ProfileColumn = (typeof SCALAR_PROFILE_COLUMNS)[number];

/**
 * Build an UPSERT statement that sets the given `profile` columns for a tenant,
 * inserting the singleton row if absent. Values may be null (SET NULL). Returns a
 * prepared statement for inclusion in a `batch`, or null when no columns are given.
 */
export function profileUpsertStmt(
  env: Env,
  tenant: string,
  fields: Partial<Record<ProfileColumn, unknown>>,
): D1PreparedStatement | null {
  const cols = Object.keys(fields) as ProfileColumn[];
  if (cols.length === 0) return null;
  const insertCols = ["tenant", ...cols];
  const placeholders = insertCols.map((_, i) => `?${i + 1}`).join(", ");
  const setClause = cols.map((c) => `${c} = excluded.${c}`).join(", ");
  const binds = [tenant, ...cols.map((c) => fields[c] ?? null)];
  return db(env).prepare(
    `INSERT INTO profile (${insertCols.join(", ")}) VALUES (${placeholders}) ` +
      `ON CONFLICT(tenant) DO UPDATE SET ${setClause}`,
    ...binds,
  );
}

/** Set `profile` columns (one UPSERT). A convenience for single-field writers. */
export async function setProfileFields(
  env: Env,
  tenant: string,
  fields: Partial<Record<ProfileColumn, unknown>>,
): Promise<void> {
  const stmt = profileUpsertStmt(env, tenant, fields);
  if (stmt) await db(env).batch([stmt]);
}

/** UPSERT/DELETE a brand_prefs row. ranks=null DELETEs (back to ambiguous). */
export function brandStmt(
  env: Env,
  tenant: string,
  term: string,
  ranks: unknown[] | null,
): D1PreparedStatement {
  if (ranks === null) {
    return db(env).prepare(
      "DELETE FROM brand_prefs WHERE tenant = ?1 AND term = ?2",
      tenant,
      term,
    );
  }
  return db(env).prepare(
    "INSERT INTO brand_prefs (tenant, term, ranks) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(tenant, term) DO UPDATE SET ranks = excluded.ranks",
    tenant,
    term,
    JSON.stringify(ranks),
  );
}

/** Set the caller's overlay row for a slug, or DELETE it when the row is empty. */
export async function setOverlay(
  env: Env,
  tenant: string,
  slug: string,
  row: OverlayRow | null,
): Promise<void> {
  if (row === null) {
    await db(env).run("DELETE FROM overlay WHERE tenant = ?1 AND recipe = ?2", tenant, slug);
    return;
  }
  // Write the two disposition flags; `favorite` and `reject` are mutually exclusive
  // (the row builder in overlay.ts enforces that), so at most one is set.
  const favorite = row.favorite ? 1 : null;
  const reject = row.reject ? 1 : null;
  await db(env).run(
    "INSERT INTO overlay (tenant, recipe, favorite, reject) VALUES (?1, ?2, ?3, ?4) " +
      "ON CONFLICT(tenant, recipe) DO UPDATE SET favorite = excluded.favorite, reject = excluded.reject",
    tenant,
    slug,
    favorite,
    reject,
  );
}

/** Replace the caller's staples rows with the given list (delete-then-insert, one batch). */
export async function setStaples(env: Env, tenant: string, items: StaplesItem[]): Promise<void> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [
    d.prepare("DELETE FROM staples WHERE tenant = ?1", tenant),
  ];
  for (const it of items) {
    stmts.push(
      d.prepare(
        "INSERT INTO staples (tenant, name, normalized_name, perishable) VALUES (?1, ?2, ?3, ?4)",
        tenant,
        it.name,
        normalizeName(it.name),
        it.perishable === true ? 1 : 0,
      ),
    );
  }
  await d.batch(stmts);
}

/** Replace the caller's stockup rows with the given list (delete-then-insert, one batch). */
export async function setStockup(env: Env, tenant: string, items: StockupItem[]): Promise<void> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [
    d.prepare("DELETE FROM stockup WHERE tenant = ?1", tenant),
  ];
  for (const it of items) {
    stmts.push(
      d.prepare(
        "INSERT INTO stockup (tenant, name, normalized_name, unit, typical_purchase, notes, " +
          "baseline_price, buy_at_or_below) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        tenant,
        it.name,
        normalizeName(it.name),
        it.unit ?? null,
        it.typical_purchase ?? null,
        it.notes ?? null,
        it.baseline_price ?? null,
        it.buy_at_or_below ?? null,
      ),
    );
  }
  await d.batch(stmts);
}

/**
 * Persist the caller's kitchen inventory: replace the `kitchen_equipment` rows with
 * `owned`, and set `kitchen_notes` JSON on the `profile` row — all in one batch.
 */
export async function setKitchen(env: Env, tenant: string, inventory: KitchenInventory): Promise<void> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [
    d.prepare("DELETE FROM kitchen_equipment WHERE tenant = ?1", tenant),
  ];
  for (const slug of inventory.owned) {
    stmts.push(
      d.prepare("INSERT INTO kitchen_equipment (tenant, slug) VALUES (?1, ?2)", tenant, slug),
    );
  }
  const notesJson = Object.keys(inventory.notes).length ? JSON.stringify(inventory.notes) : null;
  const notesStmt = profileUpsertStmt(env, tenant, { kitchen_notes: notesJson });
  if (notesStmt) stmts.push(notesStmt);
  await d.batch(stmts);
}

/** Replace the caller's ready-to-eat rows with the given items (delete-then-insert). */
export async function setReadyToEat(
  env: Env,
  tenant: string,
  items: Record<string, unknown>[],
): Promise<void> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [
    d.prepare("DELETE FROM ready_to_eat WHERE tenant = ?1", tenant),
  ];
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const flag = (v: unknown): number | null => (v ? 1 : null);
  for (const it of items) {
    stmts.push(
      d.prepare(
        "INSERT INTO ready_to_eat (tenant, slug, meal, name, favorite, reject, category, source, brand, notes) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        tenant,
        str(it.slug) ?? "",
        str(it.meal),
        str(it.name),
        flag(it.favorite),
        flag(it.reject),
        str(it.category),
        str(it.discovery_source) ?? str(it.source),
        str(it.brand),
        str(it.notes),
      ),
    );
  }
  await d.batch(stmts);
}
