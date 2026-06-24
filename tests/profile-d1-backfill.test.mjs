// Tests for migrations/0003-profile-d1.mjs — the profile backfill: it reads each
// tenant's profile:<username> KV bundle (a JSON envelope of TOML/markdown strings),
// parses the fields into rows, delete-then-inserts across the D1 profile tables, and
// removes the KV bundle key. Run via node:test (npm run test:tooling). A fake `kv`
// (get/put/delete/list) and a fake `d1` ({ query }) record what happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { up, id } from '../migrations/0003-profile-d1.mjs';

const log = () => {};

// A fake KV with a directory (tenant:<u>) + profile:<u> bundles + state:<u>:* keys.
function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async put(k, v) {
      store.set(k, v);
    },
    async delete(k) {
      store.delete(k);
    },
    async list({ prefix, cursor } = {}) {
      void cursor;
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

// A fake d1 recording every statement; INSERTs accumulate as rows keyed by table+tenant.
function fakeD1() {
  const calls = [];
  const rows = new Map(); // `${table}:${tenant}` -> array of column tuples
  return {
    calls,
    rows,
    client: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        const m = /(?:DELETE FROM|INSERT INTO)\s+(\w+)/.exec(sql);
        const table = m?.[1];
        if (/^DELETE/.test(sql)) {
          rows.set(`${table}:${params[0]}`, []);
        } else if (/^INSERT/.test(sql)) {
          const key = `${table}:${params[0]}`;
          if (!rows.has(key)) rows.set(key, []);
          rows.get(key).push(params.slice(1));
        }
        return [];
      },
      async exec() {
        return [];
      },
    },
  };
}

const BUNDLE = JSON.stringify({
  preferences:
    'default_cooking_nights = 3\n' +
    'lunch_strategy = "leftovers"\n' +
    'location_zip = "76104"\n' +
    '[stores]\n' +
    'primary = "kroger"\n' +
    '[brands]\n' +
    'olive_oil = ["Cobram"]\n' +
    'yellow_onion = []\n' +
    '[dietary]\n' +
    'avoid = []\n' +
    'limit = ["cilantro"]\n',
  taste: 'I lean spicy.',
  diet_principles: 'Fish once a week.',
  kitchen: 'owned = ["blender"]\n[notes]\novens = 2\n',
  staples: '[[items]]\nname = "Eggs"\nperishable = true\n[[items]]\nname = "Olive Oil"\n',
  overlay: '[overlay.tacos]\nstatus = "active"\nrating = 4\n',
  ready_to_eat: '[[items]]\nname = "Oats"\nslug = "oats"\nmeal = "breakfast"\nstatus = "active"\n',
  stockup: 'freezer_capacity_estimate = "moderate"\n[[items]]\nname = "Salmon"\nunit = "lb"\n',
});

test('backfill parses every bundle field into the right rows', async () => {
  const kv = fakeKv({ 'tenant:everett': 'x', 'profile:everett': BUNDLE, 'state:everett:pantry': '[]' });
  const d1 = fakeD1();
  await up({ kv, d1: d1.client, log });

  // The singleton profile row carries scalars + markdown + JSON columns + freezer.
  const profile = d1.rows.get('profile:everett');
  assert.equal(profile.length, 1);
  const [taste, diet, nights, lunch, rteAction, stores, dietary, custom, kitchenNotes, freezer] = profile[0];
  assert.equal(taste, 'I lean spicy.');
  assert.equal(diet, 'Fish once a week.');
  assert.equal(nights, 3);
  assert.equal(lunch, 'leftovers');
  assert.equal(rteAction, null);
  assert.deepEqual(JSON.parse(stores), { location_zip: '76104', primary: 'kroger' });
  assert.deepEqual(JSON.parse(dietary), { avoid: [], limit: ['cilantro'] });
  assert.equal(custom, null);
  assert.deepEqual(JSON.parse(kitchenNotes), { ovens: 2 });
  assert.equal(freezer, 'moderate');

  // brands tri-state preserved: ranked vs don't-care ([]).
  const brands = Object.fromEntries(d1.rows.get('brand_prefs:everett').map(([term, ranks]) => [term, ranks]));
  assert.equal(brands.olive_oil, '["Cobram"]');
  assert.equal(brands.yellow_onion, '[]');

  assert.deepEqual(d1.rows.get('kitchen_equipment:everett'), [['blender']]);

  // staples: name, normalized_name, perishable flag.
  const staples = d1.rows.get('staples:everett');
  assert.deepEqual(
    staples.map(([name, norm, per]) => [name, norm, per]).sort(),
    [['Eggs', 'eggs', 1], ['Olive Oil', 'olive oil', 0]].sort(),
  );

  assert.deepEqual(d1.rows.get('overlay:everett'), [['tacos', 4, 'active']]);

  const rte = d1.rows.get('ready_to_eat:everett');
  assert.equal(rte[0][0], 'oats');

  const stockup = d1.rows.get('stockup:everett');
  assert.equal(stockup[0][0], 'Salmon');
  assert.equal(stockup[0][2], 'lb'); // unit

  // The KV bundle key is removed; state:* is untouched.
  assert.equal(kv.store.has('profile:everett'), false);
  assert.equal(kv.store.has('state:everett:pantry'), true);
});

test('re-running is a no-op (bundle key already removed → skip)', async () => {
  const kv = fakeKv({ 'tenant:everett': 'x', 'profile:everett': BUNDLE });
  await up({ kv, d1: fakeD1().client, log });
  assert.equal(kv.store.has('profile:everett'), false);
  // Second run: no bundle key, so no inserts happen.
  const d1b = fakeD1();
  await up({ kv, d1: d1b.client, log });
  assert.equal(d1b.calls.length, 0);
});

test('an unrecognized preference key folds into custom', async () => {
  const bundle = JSON.stringify({ preferences: 'spice_tolerance = "high"\n' });
  const kv = fakeKv({ 'profile:everett': bundle });
  const d1 = fakeD1();
  await up({ kv, d1: d1.client, log });
  const [, , , , , , , custom] = d1.rows.get('profile:everett')[0];
  assert.deepEqual(JSON.parse(custom), { spice_tolerance: 'high' });
});

test('a null d1 leaves the bundle in place (runs on a later deploy)', async () => {
  const kv = fakeKv({ 'profile:everett': BUNDLE });
  await up({ kv, d1: null, log });
  assert.equal(kv.store.has('profile:everett'), true);
});

test('exports a stable id', () => {
  assert.equal(id, '0003-profile-d1');
});
