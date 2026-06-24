// Tests for migrations/0002-cooking-log-d1.mjs — the first DATA backfill: it reads
// each users/<username>/cooking_log.toml from the data-repo checkout and INSERTs a
// row per entry into the D1 `cooking_log` table (delete-then-insert per tenant,
// idempotent). Run via node:test (npm run test:tooling). A fake `d1` client (the
// { query } surface run-migrations passes) records DELETE/INSERT calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { up, id } from '../migrations/0002-cooking-log-d1.mjs';

const log = () => {};

// Build a data-repo checkout under dataRoot with the given users/<u>/cooking_log.toml.
async function tmpData(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'cooking-backfill-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return root;
}

// A fake d1 client recording every statement; INSERTs accumulate as rows-by-tenant.
function fakeD1() {
  const calls = [];
  const rows = new Map(); // tenant -> array of inserted column tuples
  return {
    calls,
    rows,
    client: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql.startsWith('DELETE FROM cooking_log')) {
          rows.set(params[0], []);
        } else if (sql.startsWith('INSERT INTO cooking_log')) {
          const [tenant, ...rest] = params;
          if (!rows.has(tenant)) rows.set(tenant, []);
          rows.get(tenant).push(rest);
        }
        return [];
      },
      async exec() {
        return [];
      },
    },
  };
}

test('exports a stable id', () => {
  assert.equal(id, '0002-cooking-log-d1');
});

test('backfills each tenant cooking_log.toml into D1 rows', async () => {
  const root = await tmpData({
    'users/everett/cooking_log.toml': `[[entries]]
date = "2026-06-09"
type = "recipe"
recipe = "arroz-caldo"

[[entries]]
date = "2026-06-08"
type = "ready_to_eat"
name = "frozen lasagna"
`,
    'users/maya/cooking_log.toml': `[[entries]]
date = 2026-06-01
type = "ad_hoc"
name = "stir fry"
protein = "chicken"
`,
  });
  const d1 = fakeD1();
  await up({ kv: null, d1: d1.client, dataRoot: root, log });

  assert.deepEqual(d1.rows.get('everett'), [
    ['2026-06-09', 'recipe', 'arroz-caldo', null, null, null],
    ['2026-06-08', 'ready_to_eat', null, 'frozen lasagna', null, null],
  ]);
  // A bare TOML date is accepted and normalized to YYYY-MM-DD; inline protein kept.
  assert.deepEqual(d1.rows.get('maya'), [
    ['2026-06-01', 'ad_hoc', null, 'stir fry', 'chicken', null],
  ]);
  await rm(root, { recursive: true, force: true });
});

test('is idempotent: a re-run deletes-then-reinserts, no duplicates', async () => {
  const root = await tmpData({
    'users/everett/cooking_log.toml': `[[entries]]
date = "2026-06-09"
type = "recipe"
recipe = "tacos"
`,
  });
  const d1 = fakeD1();
  await up({ kv: null, d1: d1.client, dataRoot: root, log });
  await up({ kv: null, d1: d1.client, dataRoot: root, log }); // re-run

  // delete-then-insert: each run resets the tenant's rows, so the final state is one row.
  assert.deepEqual(d1.rows.get('everett'), [['2026-06-09', 'recipe', 'tacos', null, null, null]]);
  // Two DELETEs (one per run) were issued for the tenant.
  const deletes = d1.calls.filter((c) => c.sql.startsWith('DELETE FROM cooking_log') && c.params[0] === 'everett');
  assert.equal(deletes.length, 2);
  await rm(root, { recursive: true, force: true });
});

test('a tenant without a cooking_log.toml inserts nothing (no DELETE either)', async () => {
  const root = await tmpData({ 'users/everett/preferences.toml': 'x = 1\n' });
  const d1 = fakeD1();
  await up({ kv: null, d1: d1.client, dataRoot: root, log });
  assert.equal(d1.calls.length, 0);
  await rm(root, { recursive: true, force: true });
});

test('drops structurally-invalid entries (bad date / unknown type / missing field)', async () => {
  const root = await tmpData({
    'users/everett/cooking_log.toml': `[[entries]]
date = "nope"
type = "recipe"
recipe = "x"

[[entries]]
date = "2026-06-09"
type = "ate_out"
name = "diner"

[[entries]]
date = "2026-06-09"
type = "recipe"

[[entries]]
date = "2026-06-09"
type = "recipe"
recipe = "valid"
`,
  });
  const d1 = fakeD1();
  await up({ kv: null, d1: d1.client, dataRoot: root, log });
  // Only the last (valid) entry survives.
  assert.deepEqual(d1.rows.get('everett'), [['2026-06-09', 'recipe', 'valid', null, null, null]]);
  await rm(root, { recursive: true, force: true });
});

test('a null d1 client is a no-op (D1 not provisioned yet)', async () => {
  const root = await tmpData({
    'users/everett/cooking_log.toml': '[[entries]]\ndate = "2026-06-09"\ntype = "recipe"\nrecipe = "x"\n',
  });
  // Should simply return without throwing.
  await up({ kv: null, d1: null, dataRoot: root, log });
  await rm(root, { recursive: true, force: true });
});

test('no users/ directory is a no-op', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cooking-backfill-empty-'));
  const d1 = fakeD1();
  await up({ kv: null, d1: d1.client, dataRoot: root, log });
  assert.equal(d1.calls.length, 0);
  await rm(root, { recursive: true, force: true });
});
