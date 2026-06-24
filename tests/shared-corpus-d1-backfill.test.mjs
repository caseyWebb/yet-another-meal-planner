// Tests for migrations/0005-shared-corpus-d1.mjs — the shared-corpus backfill. Unlike
// the prior KV-blob backfills, these are SHARED SINGLETONS in the data-repo checkout,
// so the migration reads the filesystem (`dataRoot`) TOML and INSERTs rows. Run via
// node:test (npm run test:tooling). A temp data-repo checkout + a fake `d1` ({ query })
// record what happens; we assert each artifact projects to the right rows, that note
// attribution/private carry over, and that a null d1 is a no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { up, id } from '../migrations/0005-shared-corpus-d1.mjs';

const log = () => {};

// A fake d1 recording every statement; INSERT/UPSERT accumulate rows per table.
function fakeD1() {
  const calls = [];
  const tables = new Map(); // table -> array of param tuples
  return {
    calls,
    tables,
    client: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        const m = /(?:DELETE FROM|INSERT (?:OR IGNORE )?INTO)\s+(\w+)/.exec(sql);
        const table = m?.[1];
        if (/^DELETE/.test(sql)) {
          tables.set(table, []);
        } else if (/INSERT/.test(sql)) {
          if (!tables.has(table)) tables.set(table, []);
          tables.get(table).push(params);
        }
        return [];
      },
      async exec() {
        return [];
      },
    },
  };
}

async function makeCheckout(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'data-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

const rowsOf = (d1, table) => d1.tables.get(table) ?? [];

test('id is stable', () => {
  assert.equal(id, '0005-shared-corpus-d1');
});

test('null d1 is a no-op', async () => {
  await up({ d1: null, dataRoot: '/nonexistent', log });
});

test('backfills every shared-corpus artifact into the right rows', async () => {
  const root = await makeCheckout({
    'aliases.toml': '[aliases]\n"EVOO" = "olive oil"\n"chx" = "chicken"\n',
    'feeds.toml':
      '[[feeds]]\nurl = "https://a.com/feed"\nname = "A"\nweight = 1\ntags = ["x"]\n' +
      '[[feeds]]\nurl = "https://b.com/feed"\n',
    'discovery_sources.toml':
      '[[members]]\naddress = "Me@Example.com"\n[[senders]]\naddress = "n@news.com"\nname = "News"\n',
    'flyer_terms.toml': 'terms = ["fruit", "cheese"]\n',
    'skus/kroger.toml':
      '[[mappings]]\ningredient = "whole milk"\nsku = "111"\nbrand = "Kroger"\nsize = "1 gal"\n' +
      '[[mappings]]\ningredient = "salmon"\nsku = "222"\nlocationId = "03500520"\n',
    'discoveries_inbox.toml':
      '[[entries]]\nfrom = "casey@x.com"\nsubject = "hi"\nreceived_at = "2026-06-11"\nbody = "find recipes"\n',
    'stores/west-7th.toml': 'slug = "west-7th"\nname = "West 7th Kroger"\ndomain = "grocery"\nlocation_id = "03500520"\n',
    'users/casey/notes/tacos.toml':
      '[[notes]]\ncreated_at = "2026-06-01T00:00:00Z"\nbody = "subbed gochujang"\ntags = ["tweak"]\n' +
      '[[notes]]\ncreated_at = "2026-06-02T00:00:00Z"\nbody = "secret"\nprivate = true\n',
    'users/casey/store_notes/west-7th.toml':
      '[[notes]]\ncreated_at = "2026-06-03T00:00:00Z"\nbody = "Aisle 7: baking"\ntags = ["layout"]\n',
  });
  try {
    const d1 = fakeD1();
    await up({ d1: d1.client, dataRoot: root, log });

    // aliases
    const aliases = rowsOf(d1, 'aliases');
    assert.equal(aliases.length, 2);
    assert.deepEqual(aliases.find((r) => r[0] === 'EVOO'), ['EVOO', 'olive oil']);

    // feeds
    const feeds = rowsOf(d1, 'feeds');
    assert.equal(feeds.length, 2);
    const feedA = feeds.find((r) => r[0] === 'https://a.com/feed');
    assert.equal(feedA[1], 'A');
    assert.equal(feedA[2], 1);
    assert.equal(feedA[3], JSON.stringify(['x']));
    // a feed with no weight defaults to 1
    assert.equal(feeds.find((r) => r[0] === 'https://b.com/feed')[2], 1);

    // allowlist — addresses normalized (lowercased)
    assert.deepEqual(rowsOf(d1, 'discovery_members'), [['me@example.com']]);
    assert.deepEqual(rowsOf(d1, 'discovery_senders'), [['n@news.com', 'News']]);

    // flyer terms
    assert.deepEqual(rowsOf(d1, 'flyer_terms').map((r) => r[0]).sort(), ['cheese', 'fruit']);

    // sku cache — location_id defaults to '' when untagged
    const skus = rowsOf(d1, 'sku_cache');
    assert.equal(skus.length, 2);
    const milk = skus.find((r) => r[0] === 'whole milk');
    assert.equal(milk[1], ''); // location_id
    assert.equal(milk[2], '111');
    const salmon = skus.find((r) => r[0] === 'salmon');
    assert.equal(salmon[1], '03500520');

    // inbox candidates — body preserved, dedup url synthesized
    const cands = rowsOf(d1, 'discovery_candidates');
    assert.equal(cands.length, 1);
    assert.equal(cands[0][2], 'casey@x.com'); // source
    assert.equal(cands[0][4], 'find recipes'); // body

    // stores — identity + extra JSON
    const stores = rowsOf(d1, 'stores');
    assert.equal(stores.length, 1);
    assert.equal(stores[0][0], 'west-7th');
    assert.equal(stores[0][1], 'West 7th Kroger');
    assert.deepEqual(JSON.parse(stores[0][3]), { location_id: '03500520' });

    // recipe notes — attribution + private preserved
    const notes = rowsOf(d1, 'recipe_notes');
    assert.equal(notes.length, 2);
    for (const n of notes) {
      assert.equal(n[1], 'tacos'); // recipe
      assert.equal(n[2], 'casey'); // author
    }
    const priv = notes.find((n) => n[3] === 'secret');
    assert.equal(priv[5], 1); // private
    const shared = notes.find((n) => n[3] === 'subbed gochujang');
    assert.equal(shared[5], 0);
    assert.deepEqual(JSON.parse(shared[4]), ['tweak']);

    // store notes — attribution
    const storeNotes = rowsOf(d1, 'store_notes');
    assert.equal(storeNotes.length, 1);
    assert.equal(storeNotes[0][1], 'west-7th'); // store
    assert.equal(storeNotes[0][2], 'casey'); // author
    assert.deepEqual(JSON.parse(storeNotes[0][4]), ['layout']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('absent files yield empty tables (DELETE only), idempotent reload', async () => {
  const root = await makeCheckout({});
  try {
    const d1 = fakeD1();
    await up({ d1: d1.client, dataRoot: root, log });
    // Every table got a DELETE; no INSERTs from absent sources.
    for (const table of ['aliases', 'feeds', 'flyer_terms', 'sku_cache', 'stores', 'recipe_notes']) {
      assert.deepEqual(rowsOf(d1, table), []);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
