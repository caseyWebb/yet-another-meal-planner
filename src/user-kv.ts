// Per-tenant KV helpers. `profile:<username>` holds the full profile bundle as
// a JSON object of named raw-content fields. Session-state keys hold item
// arrays as JSON. On a KV miss, each helper falls back to the corresponding
// GitHub file (lazy migration): it reads, populates KV, and returns the data
// so the transition is transparent and zero-downtime.

import type { GitHubClient } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { plannedOf } from "./meal-plan.js";
import type { PlannedItem } from "./meal-plan.js";
import type { GroceryItem } from "./grocery.js";

// --- Profile bundle ---

const PROFILE_MIGRATION_FILES = {
  preferences: "preferences.toml",
  taste: "taste.md",
  diet_principles: "diet_principles.md",
  kitchen: "kitchen.toml",
  staples: "staples.toml",
  overlay: "overlay.toml",
  ready_to_eat: "ready_to_eat.toml",
  stockup: "stockup.toml",
} as const;

export type ProfileField = keyof typeof PROFILE_MIGRATION_FILES;

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

async function migrateProfileBundle(
  kv: KVNamespace,
  username: string,
  gh: GitHubClient,
): Promise<ProfileBundle> {
  const entries = await Promise.all(
    (Object.entries(PROFILE_MIGRATION_FILES) as [ProfileField, string][]).map(
      async ([field, path]) => {
        const content = await readOptional(gh, path);
        return [field, content] as [ProfileField, string | null];
      },
    ),
  );
  const bundle: ProfileBundle = {};
  for (const [field, content] of entries) {
    if (content !== null) bundle[field] = content;
  }
  await writeProfileBundle(kv, username, bundle);
  return bundle;
}

export async function getProfileBundle(
  kv: KVNamespace,
  username: string,
  gh: GitHubClient,
): Promise<ProfileBundle> {
  const existing = await readProfileBundle(kv, username);
  if (existing !== null) return existing;
  return migrateProfileBundle(kv, username, gh);
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
  gh: GitHubClient,
): Promise<Record<string, unknown>[]> {
  const existing = await readPantryState(kv, username);
  if (existing !== null) return existing;
  const text = await readOptional(gh, "pantry.toml");
  const items: Record<string, unknown>[] = text
    ? (() => {
        const data = parseToml(text, "pantry.toml");
        return Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      })()
    : [];
  await writePantryState(kv, username, items);
  return items;
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
  gh: GitHubClient,
): Promise<PlannedItem[]> {
  const existing = await readMealPlanState(kv, username);
  if (existing !== null) return existing;
  const text = await readOptional(gh, "meal_plan.toml");
  const items = text ? plannedOf(parseToml(text, "meal_plan.toml")) : [];
  await writeMealPlanState(kv, username, items);
  return items;
}

export async function deleteMealPlanState(
  kv: KVNamespace,
  username: string,
): Promise<void> {
  await kv.delete(stateKey(username, "meal_plan"));
}

// --- Session state: grocery list ---

function coerceGroceryItem(raw: Record<string, unknown>, today: string): GroceryItem {
  return {
    name: typeof raw.name === "string" ? raw.name : "",
    quantity: typeof raw.quantity === "string" ? raw.quantity : "1",
    kind:
      raw.kind === "grocery" || raw.kind === "household" || raw.kind === "other"
        ? raw.kind
        : "grocery",
    domain: typeof raw.domain === "string" ? raw.domain : "grocery",
    status:
      raw.status === "active" || raw.status === "in_cart" || raw.status === "ordered"
        ? raw.status
        : "active",
    source:
      raw.source === "ad_hoc" ||
      raw.source === "menu" ||
      raw.source === "pantry_low" ||
      raw.source === "stockup"
        ? raw.source
        : "ad_hoc",
    for_recipes: Array.isArray(raw.for_recipes) ? (raw.for_recipes as string[]) : [],
    note: typeof raw.note === "string" ? raw.note : null,
    added_at: typeof raw.added_at === "string" ? raw.added_at : today,
    ordered_at: typeof raw.ordered_at === "string" ? raw.ordered_at : null,
  };
}

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
  gh: GitHubClient,
): Promise<GroceryItem[]> {
  const existing = await readGroceryListState(kv, username);
  if (existing !== null) return existing;
  const text = await readOptional(gh, "grocery_list.toml");
  const items: GroceryItem[] = (() => {
    if (!text) return [];
    const data = parseToml(text, "grocery_list.toml");
    const raw = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    const today = new Date().toISOString().slice(0, 10);
    return raw.map((r) => coerceGroceryItem(r, today));
  })();
  await writeGroceryListState(kv, username, items);
  return items;
}

export async function deleteGroceryListState(
  kv: KVNamespace,
  username: string,
): Promise<void> {
  await kv.delete(stateKey(username, "grocery_list"));
}
