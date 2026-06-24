// Per-tenant KV helpers. Session-state keys (`state:<username>:pantry|meal_plan|
// grocery_list`) hold item arrays as JSON; KV is the source of truth (a miss returns
// null/empty). The per-tenant PROFILE no longer lives here — it moved to normalized
// D1 tables (src/profile-db.ts, d1-profile). Only these session-state helpers remain
// (they move to D1 in slice 5). Existing GitHub files were migrated into KV/D1 once,
// at deploy time, by the migration runner (scripts/run-migrations.mjs) — there is no
// runtime GitHub fallback.

import type { PlannedItem } from "./meal-plan.js";
import type { GroceryItem } from "./grocery.js";

function stateKey(username: string, name: "pantry" | "meal_plan" | "grocery_list"): string {
  return `state:${username}:${name}`;
}

// --- Session state: pantry ---

export async function readPantryState(
  kv: KVNamespace,
  username: string,
): Promise<Record<string, unknown>[] | null> {
  const raw = await kv.get(stateKey(username, "pantry"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
  } catch {
    return null;
  }
}

export async function writePantryState(
  kv: KVNamespace,
  username: string,
  items: Record<string, unknown>[],
): Promise<void> {
  await kv.put(stateKey(username, "pantry"), JSON.stringify(items));
}

export async function getPantryState(
  kv: KVNamespace,
  username: string,
): Promise<Record<string, unknown>[]> {
  return (await readPantryState(kv, username)) ?? [];
}

export async function deletePantryState(
  kv: KVNamespace,
  username: string,
): Promise<void> {
  await kv.delete(stateKey(username, "pantry"));
}

// --- Session state: meal plan ---

export async function readMealPlanState(
  kv: KVNamespace,
  username: string,
): Promise<PlannedItem[] | null> {
  const raw = await kv.get(stateKey(username, "meal_plan"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlannedItem[]) : null;
  } catch {
    return null;
  }
}

export async function writeMealPlanState(
  kv: KVNamespace,
  username: string,
  items: PlannedItem[],
): Promise<void> {
  await kv.put(stateKey(username, "meal_plan"), JSON.stringify(items));
}

export async function getMealPlanState(
  kv: KVNamespace,
  username: string,
): Promise<PlannedItem[]> {
  return (await readMealPlanState(kv, username)) ?? [];
}

export async function deleteMealPlanState(
  kv: KVNamespace,
  username: string,
): Promise<void> {
  await kv.delete(stateKey(username, "meal_plan"));
}

// --- Session state: grocery list ---

export async function readGroceryListState(
  kv: KVNamespace,
  username: string,
): Promise<GroceryItem[] | null> {
  const raw = await kv.get(stateKey(username, "grocery_list"));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as GroceryItem[]) : null;
  } catch {
    return null;
  }
}

export async function writeGroceryListState(
  kv: KVNamespace,
  username: string,
  items: GroceryItem[],
): Promise<void> {
  await kv.put(stateKey(username, "grocery_list"), JSON.stringify(items));
}

export async function getGroceryListState(
  kv: KVNamespace,
  username: string,
): Promise<GroceryItem[]> {
  return (await readGroceryListState(kv, username)) ?? [];
}

export async function deleteGroceryListState(
  kv: KVNamespace,
  username: string,
): Promise<void> {
  await kv.delete(stateKey(username, "grocery_list"));
}
