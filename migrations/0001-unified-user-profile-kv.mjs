// 0001-unified-user-profile-kv — move each tenant's per-tenant operational state
// from their GitHub users/<username>/ subtree into DATA_KV.
//
//   profile:<username>          → JSON bundle of raw file-content strings
//                                 (preferences, taste, diet_principles, kitchen,
//                                  staples, overlay, ready_to_eat, stockup)
//   state:<username>:pantry     → JSON array of pantry items
//   state:<username>:meal_plan  → JSON array of planned rows
//   state:<username>:grocery_list → JSON array of grocery items
//
// Reads files from the data repo checkout (dataRoot) — no GitHub API. Idempotent:
// skips any tenant whose profile:<username> key already exists, so a re-run (or a
// re-applied migration) never clobbers live KV state. The coercion mirrors the
// shapes the Worker's read helpers expect (src/user-kv.ts, src/meal-plan.ts).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

export const id = '0001-unified-user-profile-kv';

// Profile bundle fields → their GitHub filename (raw content carried verbatim).
const PROFILE_FILES = {
  preferences: 'preferences.toml',
  taste: 'taste.md',
  diet_principles: 'diet_principles.md',
  kitchen: 'kitchen.toml',
  staples: 'staples.toml',
  overlay: 'overlay.toml',
  ready_to_eat: 'ready_to_eat.toml',
  stockup: 'stockup.toml',
};

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function listTenants(usersDir) {
  let entries;
  try {
    entries = await readdir(usersDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function itemsArray(text) {
  if (!text) return [];
  const data = parseToml(text);
  return Array.isArray(data.items) ? data.items : [];
}

// Mirror src/meal-plan.ts coercePlanned: recipe + planned_for, sides only when non-empty.
function coercePlanned(raw) {
  const item = {
    recipe: typeof raw.recipe === 'string' ? raw.recipe : '',
    planned_for: typeof raw.planned_for === 'string' ? raw.planned_for : null,
  };
  if (Array.isArray(raw.sides)) {
    const sides = raw.sides.filter((s) => typeof s === 'string');
    if (sides.length) item.sides = sides;
  }
  return item;
}

function plannedArray(text) {
  if (!text) return [];
  const data = parseToml(text);
  return (Array.isArray(data.planned) ? data.planned : []).map(coercePlanned);
}

// Mirror the old src/user-kv.ts coerceGroceryItem so migrated items match the
// GroceryItem shape the Worker reads back (defaults for absent fields).
function coerceGroceryItem(raw, today) {
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    quantity: typeof raw.quantity === 'string' ? raw.quantity : '1',
    kind: ['grocery', 'household', 'other'].includes(raw.kind) ? raw.kind : 'grocery',
    domain: typeof raw.domain === 'string' ? raw.domain : 'grocery',
    status: ['active', 'in_cart', 'ordered'].includes(raw.status) ? raw.status : 'active',
    source: ['ad_hoc', 'menu', 'pantry_low', 'stockup'].includes(raw.source) ? raw.source : 'ad_hoc',
    for_recipes: Array.isArray(raw.for_recipes) ? raw.for_recipes : [],
    note: typeof raw.note === 'string' ? raw.note : null,
    added_at: typeof raw.added_at === 'string' ? raw.added_at : today,
    ordered_at: typeof raw.ordered_at === 'string' ? raw.ordered_at : null,
  };
}

function groceryArray(text) {
  if (!text) return [];
  const today = new Date().toISOString().slice(0, 10);
  return itemsArray(text).map((r) => coerceGroceryItem(r, today));
}

export async function up({ kv, dataRoot, log }) {
  const usersDir = path.join(dataRoot, 'users');
  const tenants = await listTenants(usersDir);
  if (tenants.length === 0) {
    log('no users/ tenants found — nothing to migrate');
    return;
  }

  let migrated = 0;
  for (const username of tenants) {
    const dir = path.join(usersDir, username);

    // Idempotent: a tenant already in KV is left untouched (don't clobber live state).
    if (await kv.get(`profile:${username}`)) {
      log(`${username}: profile already in KV — skipping`);
      continue;
    }

    // Profile bundle — raw file content, absent fields omitted.
    const bundle = {};
    await Promise.all(
      Object.entries(PROFILE_FILES).map(async ([field, name]) => {
        const content = await readOptional(path.join(dir, name));
        if (content !== null) bundle[field] = content;
      }),
    );
    await kv.put(`profile:${username}`, JSON.stringify(bundle));

    // Session state — JSON arrays in the Worker's expected shapes.
    await kv.put(`state:${username}:pantry`, JSON.stringify(itemsArray(await readOptional(path.join(dir, 'pantry.toml')))));
    await kv.put(`state:${username}:meal_plan`, JSON.stringify(plannedArray(await readOptional(path.join(dir, 'meal_plan.toml')))));
    await kv.put(`state:${username}:grocery_list`, JSON.stringify(groceryArray(await readOptional(path.join(dir, 'grocery_list.toml')))));

    migrated++;
    log(`${username}: migrated profile bundle + session state`);
  }
  log(`migrated ${migrated} tenant(s), skipped ${tenants.length - migrated} already in KV`);
}
