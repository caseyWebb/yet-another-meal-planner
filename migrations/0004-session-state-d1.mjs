// 0004-session-state-d1 — move each tenant's working state out of the DATA_KV blobs
// (state:<username>:pantry|meal_plan|grocery_list, each a JSON array) into the
// normalized D1 row tables (migrations/d1/0005_session_state.sql). The SCHEMA is
// applied by `wrangler d1 migrations apply` BEFORE this runs (deploy step ordering,
// same as the cooking-log / profile backfills).
//
// Per tenant we read the three blobs, DELETE the tenant's rows across the three tables,
// re-INSERT from the parsed arrays (deduped by the table's key — normalized name for
// pantry/grocery, recipe slug for meal_plan), then kv.delete the three blob keys.
// Idempotent: delete-then-insert converges, and an absent blob key means already
// migrated. A null `d1` (D1 not provisioned yet / brand-new operator) makes the whole
// migration a no-op — the blobs are left in place for a later deploy.

export const id = '0004-session-state-d1';

function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseArray(raw) {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);

// --- per-table row coercion (dedup by the table's key) -----------------------

function pantryRows(items) {
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = str(it.name);
    if (!name) continue;
    const norm = normalizeName(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    rows.push({
      name,
      normalized_name: norm,
      quantity: str(it.quantity),
      category: str(it.category),
      prepared_from: str(it.prepared_from),
      added_at: str(it.added_at),
      last_verified_at: str(it.last_verified_at),
    });
  }
  return rows;
}

function mealPlanRows(items) {
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const recipe = str(it.recipe);
    if (!recipe) continue;
    const key = recipe.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sides = Array.isArray(it.sides)
      ? it.sides.filter((s) => typeof s === 'string')
      : [];
    rows.push({
      recipe,
      planned_for: str(it.planned_for),
      sides: sides.length ? JSON.stringify(sides) : null,
    });
  }
  return rows;
}

function groceryRows(items) {
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = str(it.name);
    if (!name) continue;
    const norm = normalizeName(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    const forRecipes = Array.isArray(it.for_recipes)
      ? it.for_recipes.filter((s) => typeof s === 'string')
      : [];
    rows.push({
      name,
      normalized_name: norm,
      quantity: str(it.quantity),
      kind: str(it.kind),
      domain: str(it.domain),
      status: str(it.status),
      source: str(it.source),
      for_recipes: JSON.stringify(forRecipes),
      note: str(it.note),
      added_at: str(it.added_at),
      ordered_at: str(it.ordered_at),
    });
  }
  return rows;
}

// Read the tenant list from the KV directory (tenant:<username>), falling back to
// scanning state:<username>:* blob keys. Either source covers "who is in the group".
async function listTenants(kv) {
  const ids = new Set();
  if (typeof kv.list === 'function') {
    let cursor;
    for (;;) {
      const res = await kv.list({ prefix: 'tenant:', cursor });
      for (const k of res.keys ?? []) ids.add(k.name.slice('tenant:'.length));
      if (res.list_complete) break;
      cursor = res.cursor;
      if (!cursor) break;
    }
    let cursor2;
    for (;;) {
      const res = await kv.list({ prefix: 'state:', cursor: cursor2 });
      for (const k of res.keys ?? []) {
        // state:<username>:<which> — the username is everything between the prefix
        // and the final ":pantry|:meal_plan|:grocery_list" segment.
        const rest = k.name.slice('state:'.length);
        const lastColon = rest.lastIndexOf(':');
        if (lastColon > 0) ids.add(rest.slice(0, lastColon));
      }
      if (res.list_complete) break;
      cursor2 = res.cursor;
      if (!cursor2) break;
    }
  }
  return [...ids].sort();
}

export async function up({ kv, d1, log }) {
  if (!d1) {
    log('D1 client unavailable — skipping session-state backfill (will run on a later deploy)');
    return;
  }

  const tenants = await listTenants(kv);
  if (tenants.length === 0) {
    log('no tenants found — nothing to migrate');
    return;
  }

  let migrated = 0;
  for (const tenant of tenants) {
    const pantryRaw = await kv.get(`state:${tenant}:pantry`);
    const mealPlanRaw = await kv.get(`state:${tenant}:meal_plan`);
    const groceryRaw = await kv.get(`state:${tenant}:grocery_list`);

    // All three blobs absent ⇒ already migrated (D1 authoritative) — skip.
    if (pantryRaw === null && mealPlanRaw === null && groceryRaw === null) {
      log(`${tenant}: no session-state blobs in KV — already migrated, skipping`);
      continue;
    }

    const pantry = pantryRows(parseArray(pantryRaw) ?? []);
    const mealPlan = mealPlanRows(parseArray(mealPlanRaw) ?? []);
    const grocery = groceryRows(parseArray(groceryRaw) ?? []);

    // Delete-then-insert the tenant's rows across the three tables (idempotent).
    for (const table of ['pantry', 'meal_plan', 'grocery_list']) {
      await d1.query(`DELETE FROM ${table} WHERE tenant = ?1`, [tenant]);
    }

    for (const r of pantry) {
      await d1.query(
        'INSERT INTO pantry (tenant, name, normalized_name, quantity, category, ' +
          'prepared_from, added_at, last_verified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
        [tenant, r.name, r.normalized_name, r.quantity, r.category, r.prepared_from, r.added_at, r.last_verified_at],
      );
    }
    for (const r of mealPlan) {
      await d1.query('INSERT INTO meal_plan (tenant, recipe, planned_for, sides) VALUES (?1, ?2, ?3, ?4)', [
        tenant,
        r.recipe,
        r.planned_for,
        r.sides,
      ]);
    }
    for (const r of grocery) {
      await d1.query(
        'INSERT INTO grocery_list (tenant, name, normalized_name, quantity, kind, domain, ' +
          'status, source, for_recipes, note, added_at, ordered_at) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)',
        [
          tenant,
          r.name,
          r.normalized_name,
          r.quantity,
          r.kind,
          r.domain,
          r.status,
          r.source,
          r.for_recipes,
          r.note,
          r.added_at,
          r.ordered_at,
        ],
      );
    }

    // The blobs are now authoritative in D1 — drop the KV keys.
    await kv.delete(`state:${tenant}:pantry`);
    await kv.delete(`state:${tenant}:meal_plan`);
    await kv.delete(`state:${tenant}:grocery_list`);
    migrated++;
    log(
      `${tenant}: backfilled ${pantry.length} pantry / ${mealPlan.length} meal-plan / ` +
        `${grocery.length} grocery row(s), removed KV blobs`,
    );
  }
  log(`migrated ${migrated} tenant(s); ${tenants.length - migrated} already migrated/skipped`);
}
