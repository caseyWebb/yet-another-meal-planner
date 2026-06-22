// Per-tenant KV helpers. `profile:<username>` holds the full profile bundle as
// a JSON object of named raw-content fields. Session-state keys hold item
// arrays as JSON. KV is the source of truth: a miss returns null/empty and the
// caller treats it as an absent profile. Existing GitHub files are migrated into
// KV once, at deploy time, by the migration runner (scripts/run-migrations.mjs)
// — there is no runtime GitHub fallback.

import type { PlannedItem } from "./meal-plan.js";
import type { GroceryItem } from "./grocery.js";

// --- Profile bundle ---

export type ProfileField =
  | "preferences"
  | "taste"
  | "diet_principles"
  | "kitchen"
  | "staples"
  | "overlay"
  | "ready_to_eat"
  | "stockup";

export interface ProfileBundle {
  preferences?: string;
  taste?: string;
  diet_principles?: string;
  kitchen?: string;
  staples?: string;
  overlay?: string;
  ready_to_eat?: string;
  stockup?: string;
}

function profileKey(username: string): string {
  return `profile:${username}`;
}

function stateKey(username: string, name: "pantry" | "meal_plan" | "grocery_list"): string {
  return `state:${username}:${name}`;
}

export async function readProfileBundle(
  kv: KVNamespace,
  username: string,
): Promise<ProfileBundle | null> {
  const raw = await kv.get(profileKey(username));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ProfileBundle;
  } catch {
    return null;
  }
}

export async function writeProfileBundle(
  kv: KVNamespace,
  username: string,
  bundle: ProfileBundle,
): Promise<void> {
  await kv.put(profileKey(username), JSON.stringify(bundle));
}

export async function updateProfileField(
  kv: KVNamespace,
  username: string,
  field: ProfileField,
  content: string | null,
): Promise<void> {
  const existing = (await readProfileBundle(kv, username)) ?? {};
  const next: ProfileBundle = { ...existing };
  if (content === null) {
    delete next[field];
  } else {
    next[field] = content;
  }
  await writeProfileBundle(kv, username, next);
}

// Convenience: a guaranteed (non-null) bundle. A KV miss is an empty profile —
// no GitHub fallback (the deploy-time migration runner populates KV).
export async function getProfileBundle(
  kv: KVNamespace,
  username: string,
): Promise<ProfileBundle> {
  return (await readProfileBundle(kv, username)) ?? {};
}

export async function deleteProfileBundle(
  kv: KVNamespace,
  username: string,
): Promise<void> {
  await kv.delete(profileKey(username));
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
