// 0003-profile-d1 — move each tenant's profile from the DATA_KV bundle
// (profile:<username>, a JSON envelope of TOML/markdown strings) into the normalized
// D1 profile tables (migrations/d1/0004_profile.sql). The bundle's six structured
// fields are TOML; this parses them into rows. The two markdown fields (taste,
// diet_principles) carry over verbatim onto the singleton `profile` row.
//
// preferences: its TOML decodes to a flat-ish object; we fold the defined keys into
//   the profile columns (scalars + stores/dietary JSON), brands into brand_prefs
//   rows, and everything unrecognized into the `custom` JSON column. A legacy
//   top-level `location_zip` folds under stores. brands tri-state is preserved:
//   ranks '[]' = don't-care, non-empty = ranked (an absent brand stays absent — no
//   row). kitchen → kitchen_equipment rows + kitchen_notes JSON. staples/stockup →
//   their rows (normalized-name dedup) + freezer estimate on the profile row.
//   ready_to_eat → ready_to_eat rows. overlay → overlay rows.
//
// Idempotent: per tenant we DELETE the tenant's rows across every profile table,
// re-INSERT from the bundle, then kv.delete the bundle key. A re-run converges. An
// absent bundle key means already-migrated (D1 authoritative) — skip. state:* keys
// (pantry/meal_plan/grocery_list) are NOT touched (slice 5). A null `d1` (D1 not
// provisioned yet) makes the whole migration a no-op (the bundle is left in place).

import { parse as parseToml } from 'smol-toml';

export const id = '0003-profile-d1';

// Defined top-level preference keys → how they map onto the profile/brand tables.
const SCALAR_KEYS = ['default_cooking_nights', 'lunch_strategy', 'ready_to_eat_default_action'];
const STORE_KEYS = ['primary', 'preferred_location', 'location_zip'];

function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseOrEmpty(text) {
  if (!text || typeof text !== 'string') return {};
  try {
    return parseToml(text);
  } catch {
    return {};
  }
}

// Decompose the parsed preferences object into the table-shaped pieces.
function decomposePreferences(prefs) {
  const out = {
    default_cooking_nights: null,
    lunch_strategy: null,
    ready_to_eat_default_action: null,
    stores: null,
    dietary: null,
    custom: null,
    brands: [], // [{ term, ranks: number/string[] }]
  };
  const stores = {};
  const custom = {};

  // A legacy top-level location_zip folds under stores.
  if (typeof prefs.location_zip === 'string') stores.location_zip = prefs.location_zip;

  for (const [key, value] of Object.entries(prefs)) {
    if (key === 'location_zip') continue; // handled above
    if (SCALAR_KEYS.includes(key)) {
      out[key] = value;
    } else if (key === 'stores' && value && typeof value === 'object') {
      for (const sk of STORE_KEYS) {
        if (typeof value[sk] === 'string') stores[sk] = value[sk];
      }
      // any non-standard store sub-key → custom.stores
      for (const [sk, sv] of Object.entries(value)) {
        if (!STORE_KEYS.includes(sk)) {
          custom.stores = custom.stores ?? {};
          custom.stores[sk] = sv;
        }
      }
    } else if (key === 'dietary' && value && typeof value === 'object') {
      out.dietary = value;
    } else if (key === 'brands' && value && typeof value === 'object') {
      for (const [term, ranks] of Object.entries(value)) {
        out.brands.push({ term, ranks: Array.isArray(ranks) ? ranks : [] });
      }
    } else if (key === 'custom' && value && typeof value === 'object') {
      Object.assign(custom, value);
    } else {
      // Unrecognized top-level key → fold under custom (keeps the typed surface clean).
      custom[key] = value;
    }
  }

  if (Object.keys(stores).length) out.stores = stores;
  if (Object.keys(custom).length) out.custom = custom;
  return out;
}

function stockupRows(parsed) {
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    const name = typeof it.name === 'string' ? it.name : null;
    if (!name) continue;
    const norm = normalizeName(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    rows.push({
      name,
      normalized_name: norm,
      unit: typeof it.unit === 'string' ? it.unit : null,
      typical_purchase: typeof it.typical_purchase === 'string' ? it.typical_purchase : null,
      notes: typeof it.notes === 'string' ? it.notes : null,
      baseline_price: typeof it.baseline_price === 'number' ? it.baseline_price : null,
      buy_at_or_below: typeof it.buy_at_or_below === 'number' ? it.buy_at_or_below : null,
    });
  }
  return rows;
}

function staplesRows(parsed) {
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    const name = typeof it.name === 'string' ? it.name : null;
    if (!name) continue;
    const norm = normalizeName(name);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    rows.push({ name, normalized_name: norm, perishable: it.perishable === true ? 1 : 0 });
  }
  return rows;
}

function readyToEatRows(parsed) {
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);
  const seen = new Set();
  const rows = [];
  for (const it of items) {
    const slug = str(it.slug);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    rows.push({
      slug,
      meal: str(it.meal),
      name: str(it.name),
      status: str(it.status),
      category: str(it.category),
      source: str(it.discovery_source) ?? str(it.discovery_source ?? it.source),
      brand: str(it.brand),
      notes: str(it.notes),
    });
  }
  return rows;
}

function overlayRows(parsed) {
  const raw = parsed.overlay && typeof parsed.overlay === 'object' ? parsed.overlay : {};
  const rows = [];
  for (const [recipe, row] of Object.entries(raw)) {
    if (!row || typeof row !== 'object') continue;
    const rating = typeof row.rating === 'number' ? row.rating : null;
    const status = typeof row.status === 'string' ? row.status : null;
    if (rating === null && status === null) continue;
    rows.push({ recipe, rating, status });
  }
  return rows;
}

// Read the tenant list from the KV directory (tenant:<username>), falling back to
// scanning profile:<username> bundle keys. Either source covers "who is in the group".
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
      const res = await kv.list({ prefix: 'profile:', cursor: cursor2 });
      for (const k of res.keys ?? []) ids.add(k.name.slice('profile:'.length));
      if (res.list_complete) break;
      cursor2 = res.cursor;
      if (!cursor2) break;
    }
  }
  return [...ids].sort();
}

export async function up({ kv, d1, log }) {
  if (!d1) {
    log('D1 client unavailable — skipping profile backfill (will run on a later deploy)');
    return;
  }

  const tenants = await listTenants(kv);
  if (tenants.length === 0) {
    log('no tenants found — nothing to migrate');
    return;
  }

  let migrated = 0;
  for (const tenant of tenants) {
    const raw = await kv.get(`profile:${tenant}`);
    if (raw === null) {
      log(`${tenant}: no profile bundle in KV — already migrated, skipping`);
      continue;
    }
    let bundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      log(`${tenant}: profile bundle is not valid JSON — skipping`);
      continue;
    }

    const prefs = decomposePreferences(parseOrEmpty(bundle.preferences));
    const kitchen = parseOrEmpty(bundle.kitchen);
    const owned = Array.isArray(kitchen.owned) ? kitchen.owned.filter((s) => typeof s === 'string') : [];
    const kitchenNotes =
      kitchen.notes && typeof kitchen.notes === 'object' && !Array.isArray(kitchen.notes)
        ? kitchen.notes
        : null;
    const stockup = parseOrEmpty(bundle.stockup);
    const freezer =
      typeof stockup.freezer_capacity_estimate === 'string' ? stockup.freezer_capacity_estimate : null;

    // Delete-then-insert the tenant's rows across every profile table (idempotent).
    for (const table of [
      'profile',
      'brand_prefs',
      'kitchen_equipment',
      'staples',
      'overlay',
      'ready_to_eat',
      'stockup',
    ]) {
      await d1.query(`DELETE FROM ${table} WHERE tenant = ?1`, [tenant]);
    }

    // The singleton profile row (scalars + markdown + JSON columns + freezer).
    await d1.query(
      'INSERT INTO profile (tenant, taste, diet_principles, default_cooking_nights, lunch_strategy, ' +
        'ready_to_eat_default_action, stores, dietary, custom, kitchen_notes, freezer_capacity_estimate) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)',
      [
        tenant,
        typeof bundle.taste === 'string' ? bundle.taste : null,
        typeof bundle.diet_principles === 'string' ? bundle.diet_principles : null,
        typeof prefs.default_cooking_nights === 'number' ? prefs.default_cooking_nights : null,
        typeof prefs.lunch_strategy === 'string' ? prefs.lunch_strategy : null,
        typeof prefs.ready_to_eat_default_action === 'string' ? prefs.ready_to_eat_default_action : null,
        prefs.stores ? JSON.stringify(prefs.stores) : null,
        prefs.dietary ? JSON.stringify(prefs.dietary) : null,
        prefs.custom ? JSON.stringify(prefs.custom) : null,
        kitchenNotes ? JSON.stringify(kitchenNotes) : null,
        freezer,
      ],
    );

    for (const { term, ranks } of prefs.brands) {
      await d1.query('INSERT INTO brand_prefs (tenant, term, ranks) VALUES (?1, ?2, ?3)', [
        tenant,
        term,
        JSON.stringify(ranks),
      ]);
    }
    for (const slug of owned) {
      await d1.query('INSERT INTO kitchen_equipment (tenant, slug) VALUES (?1, ?2)', [tenant, slug]);
    }
    for (const r of staplesRows(parseOrEmpty(bundle.staples))) {
      await d1.query(
        'INSERT INTO staples (tenant, name, normalized_name, perishable) VALUES (?1, ?2, ?3, ?4)',
        [tenant, r.name, r.normalized_name, r.perishable],
      );
    }
    for (const r of overlayRows(parseOrEmpty(bundle.overlay))) {
      await d1.query('INSERT INTO overlay (tenant, recipe, rating, status) VALUES (?1, ?2, ?3, ?4)', [
        tenant,
        r.recipe,
        r.rating,
        r.status,
      ]);
    }
    for (const r of readyToEatRows(parseOrEmpty(bundle.ready_to_eat))) {
      await d1.query(
        'INSERT INTO ready_to_eat (tenant, slug, meal, name, status, category, source, brand, notes) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)',
        [tenant, r.slug, r.meal, r.name, r.status, r.category, r.source, r.brand, r.notes],
      );
    }
    for (const r of stockupRows(stockup)) {
      await d1.query(
        'INSERT INTO stockup (tenant, name, normalized_name, unit, typical_purchase, notes, ' +
          'baseline_price, buy_at_or_below) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
        [tenant, r.name, r.normalized_name, r.unit, r.typical_purchase, r.notes, r.baseline_price, r.buy_at_or_below],
      );
    }

    // The bundle is now authoritative in D1 — drop the KV key (state:* untouched).
    await kv.delete(`profile:${tenant}`);
    migrated++;
    log(`${tenant}: migrated profile bundle → D1 rows, removed KV bundle key`);
  }
  log(`migrated ${migrated} tenant(s); ${tenants.length - migrated} already migrated/skipped`);
}
