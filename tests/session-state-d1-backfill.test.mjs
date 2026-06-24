// Tests for migrations/0004-session-state-d1.mjs — the session-state backfill: it reads
// each tenant's state:<username>:pantry|meal_plan|grocery_list KV blobs (JSON arrays),
// coerces them into rows, delete-then-inserts across the D1 pantry / meal_plan /
// grocery_list tables, and removes the KV blob keys. Run via node:test (npm run
// test:tooling). A fake `kv` (get/put/delete/list) and a fake `d1` ({ query }) record
// what happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { up, id } from '../migrations/0004-session-state-d1.mjs';

const log = () => {};

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

const PANTRY = JSON.stringify([
  { name: 'Milk', quantity: 'full', category: 'fridge', added_at: '2026-01-01', last_verified_at: '2026-06-01' },
  { name: 'Sofrito', category: 'fridge', prepared_from: 'batch' },
  { name: 'milk', quantity: 'dupe' }, // duplicate normalized name → deduped
]);
const MEAL_PLAN = JSON.stringify([
  { recipe: 'miso-salmon', planned_for: '2026-06-25', sides: ['rice', 'broccoli'] },
  { recipe: 'tacos' },
]);
const GROCERY = JSON.stringify([
  { name: 'Olive Oil', quantity: '1', kind: 'grocery', domain: 'grocery', status: 'active', source: 'menu', for_recipes: ['pasta'], added_at: '2026-06-01' },
]);

test('backfill coerces every blob into the right rows', async () => {
  const kv = fakeKv({
    'tenant:everett': 'x',
    'state:everett:pantry': PANTRY,
    'state:everett:meal_plan': MEAL_PLAN,
    'state:everett:grocery_list': GROCERY,
  });
  const d1 = fakeD1();
  await up({ kv, d1: d1.client, log });

  // pantry: deduped by normalized name (2 rows, not 3); fields carried through.
  const pantry = d1.rows.get('pantry:everett');
  assert.equal(pantry.length, 2);
  const [name, norm, qty, category, preparedFrom, addedAt, lastVerified] = pantry[0];
  assert.equal(name, 'Milk');
  assert.equal(norm, 'milk');
  assert.equal(qty, 'full');
  assert.equal(category, 'fridge');
  assert.equal(preparedFrom, null);
  assert.equal(addedAt, '2026-01-01');
  assert.equal(lastVerified, '2026-06-01');
  assert.equal(pantry[1][4], 'batch'); // sofrito prepared_from

  // meal_plan: sides as JSON, planned_for null when absent.
  const plan = d1.rows.get('meal_plan:everett');
  assert.equal(plan.length, 2);
  const [recipe, plannedFor, sides] = plan[0];
  assert.equal(recipe, 'miso-salmon');
  assert.equal(plannedFor, '2026-06-25');
  assert.deepEqual(JSON.parse(sides), ['rice', 'broccoli']);
  assert.equal(plan[1][2], null); // tacos has no sides

  // grocery_list: for_recipes JSON, fields carried.
  const grocery = d1.rows.get('grocery_list:everett');
  assert.equal(grocery.length, 1);
  const [gName, gNorm, gQty, gKind, gDomain, gStatus, gSource, gForRecipes] = grocery[0];
  assert.equal(gName, 'Olive Oil');
  assert.equal(gNorm, 'olive oil');
  assert.equal(gQty, '1');
  assert.equal(gKind, 'grocery');
  assert.equal(gDomain, 'grocery');
  assert.equal(gStatus, 'active');
  assert.equal(gSource, 'menu');
  assert.deepEqual(JSON.parse(gForRecipes), ['pasta']);

  // The three KV blob keys are removed.
  assert.equal(kv.store.has('state:everett:pantry'), false);
  assert.equal(kv.store.has('state:everett:meal_plan'), false);
  assert.equal(kv.store.has('state:everett:grocery_list'), false);
});

test('discovers tenants from state:* blobs even without a tenant directory', async () => {
  const kv = fakeKv({ 'state:dana:grocery_list': GROCERY });
  const d1 = fakeD1();
  await up({ kv, d1: d1.client, log });
  assert.ok(d1.rows.get('grocery_list:dana'));
  assert.equal(kv.store.has('state:dana:grocery_list'), false);
});

test('re-running is a no-op (blob keys already removed → skip)', async () => {
  const kv = fakeKv({ 'tenant:everett': 'x', 'state:everett:pantry': PANTRY });
  await up({ kv, d1: fakeD1().client, log });
  assert.equal(kv.store.has('state:everett:pantry'), false);
  // Second run: no blobs, so no inserts happen.
  const d1b = fakeD1();
  await up({ kv, d1: d1b.client, log });
  assert.equal(d1b.calls.length, 0);
});

test('a null d1 leaves the blobs in place (runs on a later deploy)', async () => {
  const kv = fakeKv({ 'state:everett:pantry': PANTRY });
  await up({ kv, d1: null, log });
  assert.equal(kv.store.has('state:everett:pantry'), true);
});

test('exports a stable id', () => {
  assert.equal(id, '0004-session-state-d1');
});
