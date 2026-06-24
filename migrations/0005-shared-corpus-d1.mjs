// 0005-shared-corpus-d1 — move the remaining shared, tool-written GitHub TOML into
// the D1 shared-corpus tables (migrations/d1/0006_shared_corpus.sql). Unlike the
// prior backfills (which read KV blobs), these artifacts are SHARED SINGLETONS in
// the data-repo checkout, so the migration reads the filesystem (`dataRoot`) — the
// authoritative pre-migration source — parses each TOML, and INSERTs rows.
//
// Sources at the data-repo root: aliases.toml, feeds.toml, discovery_sources.toml,
// flyer_terms.toml, skus/kroger.toml, discoveries_inbox.toml; plus the per-file trees
// stores/<slug>.toml, and the per-tenant attributed trees users/<id>/notes/<slug>.toml
// and users/<id>/store_notes/<slug>.toml (author = the enclosing users/<id> path).
//
// Idempotent: each table is reloaded whole (DELETE then re-INSERT) — these are shared
// singletons and the checkout is authoritative, so truncate-and-reload converges. A
// null `d1` (D1 not provisioned yet / brand-new operator) makes the whole migration a
// no-op. The .toml files are deleted from the data repo as a separate cleanup commit
// once D1 is confirmed authoritative (the runner can't `git rm`).

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

export const id = '0005-shared-corpus-d1';

async function readMaybe(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function parseOrEmpty(text) {
  if (!text) return {};
  try {
    return parseToml(text);
  } catch {
    return {};
  }
}

// Recursively list `users/<id>/<sub>/*.toml`, returning { author, slug, file } rows.
async function listAttributed(dataRoot, sub) {
  const out = [];
  const usersDir = path.join(dataRoot, 'users');
  let tenants;
  try {
    tenants = await readdir(usersDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const t of tenants) {
    if (!t.isDirectory()) continue;
    const author = t.name;
    const dir = path.join(usersDir, author, sub);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.toml')) {
        out.push({ author, slug: e.name.slice(0, -'.toml'.length), file: path.join(dir, e.name) });
      }
    }
  }
  return out;
}

// List the flat stores/<slug>.toml registry tree.
async function listStores(dataRoot) {
  const dir = path.join(dataRoot, 'stores');
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.toml'))
    .map((e) => ({ slug: e.name.slice(0, -'.toml'.length), file: path.join(dir, e.name) }));
}

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null);

function noteRows(text) {
  const parsed = parseOrEmpty(text);
  const raw = Array.isArray(parsed.notes) ? parsed.notes : [];
  const rows = [];
  for (const n of raw) {
    if (!n || typeof n.body !== 'string') continue;
    rows.push({
      body: n.body,
      tags: Array.isArray(n.tags) ? n.tags.filter((t) => typeof t === 'string') : [],
      private: n.private === true ? 1 : 0,
      created_at: typeof n.created_at === 'string' ? n.created_at : '',
    });
  }
  return rows;
}

export async function up({ d1, dataRoot, log }) {
  if (!d1) {
    log('D1 client unavailable — skipping shared-corpus backfill (will run on a later deploy)');
    return;
  }

  // --- aliases -------------------------------------------------------------
  await d1.query('DELETE FROM aliases', []);
  const aliasMap = parseOrEmpty(await readMaybe(path.join(dataRoot, 'aliases.toml'))).aliases ?? {};
  let aliasCount = 0;
  for (const [variant, canonical] of Object.entries(aliasMap)) {
    if (typeof variant === 'string' && typeof canonical === 'string') {
      await d1.query('INSERT INTO aliases (variant, canonical) VALUES (?1, ?2)', [variant, canonical]);
      aliasCount++;
    }
  }

  // --- feeds ---------------------------------------------------------------
  await d1.query('DELETE FROM feeds', []);
  const feeds = parseOrEmpty(await readMaybe(path.join(dataRoot, 'feeds.toml'))).feeds;
  let feedCount = 0;
  for (const f of Array.isArray(feeds) ? feeds : []) {
    const url = str(f.url);
    if (!url) continue;
    await d1.query('INSERT OR IGNORE INTO feeds (url, name, weight, tags) VALUES (?1, ?2, ?3, ?4)', [
      url,
      str(f.name),
      typeof f.weight === 'number' ? f.weight : 1,
      Array.isArray(f.tags) ? JSON.stringify(f.tags.filter((t) => typeof t === 'string')) : null,
    ]);
    feedCount++;
  }

  // --- discovery sources (allowlist) ---------------------------------------
  await d1.query('DELETE FROM discovery_members', []);
  await d1.query('DELETE FROM discovery_senders', []);
  const sources = parseOrEmpty(await readMaybe(path.join(dataRoot, 'discovery_sources.toml')));
  const addr = (v) => (typeof v === 'string' && v.includes('@') ? v.trim().toLowerCase() : null);
  let memberCount = 0;
  let senderCount = 0;
  for (const m of Array.isArray(sources.members) ? sources.members : []) {
    const a = addr(m.address);
    if (!a) continue;
    await d1.query('INSERT OR IGNORE INTO discovery_members (address) VALUES (?1)', [a]);
    memberCount++;
  }
  for (const s of Array.isArray(sources.senders) ? sources.senders : []) {
    const a = addr(s.address);
    if (!a) continue;
    await d1.query('INSERT OR IGNORE INTO discovery_senders (address, name) VALUES (?1, ?2)', [a, str(s.name)]);
    senderCount++;
  }

  // --- flyer terms ---------------------------------------------------------
  await d1.query('DELETE FROM flyer_terms', []);
  const terms = parseOrEmpty(await readMaybe(path.join(dataRoot, 'flyer_terms.toml'))).terms;
  let termCount = 0;
  for (const t of Array.isArray(terms) ? terms : []) {
    if (typeof t !== 'string' || !t.trim()) continue;
    await d1.query('INSERT OR IGNORE INTO flyer_terms (term) VALUES (?1)', [t]);
    termCount++;
  }

  // --- SKU cache -----------------------------------------------------------
  await d1.query('DELETE FROM sku_cache', []);
  const mappings = parseOrEmpty(await readMaybe(path.join(dataRoot, 'skus', 'kroger.toml'))).mappings;
  let skuCount = 0;
  for (const m of Array.isArray(mappings) ? mappings : []) {
    const ingredient = str(m.ingredient);
    const sku = str(m.sku);
    if (!ingredient || !sku) continue;
    const locationId = str(m.locationId) ?? '';
    // Composite PK (ingredient, location_id); last writer wins on a dup pair.
    await d1.query(
      'INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(ingredient, location_id) DO UPDATE SET ' +
        'sku = excluded.sku, brand = excluded.brand, size = excluded.size, last_used = excluded.last_used',
      [ingredient, locationId, sku, str(m.brand), str(m.size), str(m.last_used)],
    );
    skuCount++;
  }

  // --- discovery inbox (candidates) ----------------------------------------
  await d1.query('DELETE FROM discovery_candidates', []);
  const inbox = parseOrEmpty(await readMaybe(path.join(dataRoot, 'discoveries_inbox.toml')));
  const inboxEntries = Array.isArray(inbox.entries) ? inbox.entries : [];
  let candCount = 0;
  const seenUrls = new Set();
  for (const e of inboxEntries) {
    // Each [[entries]] is one received message captured by email() — one candidate
    // per message keyed by a synthetic url (the message has no single canonical url;
    // dedup is by from+subject+received_at like the old appendInboxEntry, but the
    // table dedups by the UNIQUE url column).
    const from = str(e.from) ?? '';
    const subject = str(e.subject) ?? '';
    const receivedAt = str(e.received_at) ?? '';
    const body = str(e.body) ?? '';
    const url = `inbox:${from} ${subject} ${receivedAt}`;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    await d1.query(
      'INSERT OR IGNORE INTO discovery_candidates (id, url, source, subject, body, discovered_at, status) ' +
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
      [url, url, from, subject, body, receivedAt, 'new'],
    );
    candCount++;
  }

  // --- stores --------------------------------------------------------------
  await d1.query('DELETE FROM stores', []);
  let storeCount = 0;
  for (const { slug, file } of await listStores(dataRoot)) {
    const parsed = parseOrEmpty(await readMaybe(file));
    const name = str(parsed.name);
    if (!name) continue;
    const extra = {};
    for (const k of ['label', 'chain', 'address', 'location_id']) {
      if (str(parsed[k])) extra[k] = parsed[k];
    }
    await d1.query('INSERT OR IGNORE INTO stores (slug, name, domain, extra) VALUES (?1, ?2, ?3, ?4)', [
      str(parsed.slug) ?? slug,
      name,
      str(parsed.domain) ?? 'grocery',
      Object.keys(extra).length ? JSON.stringify(extra) : null,
    ]);
    storeCount++;
  }

  // --- store notes (attributed) -------------------------------------------
  await d1.query('DELETE FROM store_notes', []);
  let storeNoteCount = 0;
  for (const { author, slug, file } of await listAttributed(dataRoot, 'store_notes')) {
    for (const n of noteRows(await readMaybe(file))) {
      const noteId = `${author} ${slug} ${n.created_at}`;
      await d1.query(
        'INSERT OR IGNORE INTO store_notes (id, store, author, body, tags, private, created_at) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        [noteId, slug, author, n.body, JSON.stringify(n.tags), n.private, n.created_at],
      );
      storeNoteCount++;
    }
  }

  // --- recipe notes (attributed) ------------------------------------------
  await d1.query('DELETE FROM recipe_notes', []);
  let recipeNoteCount = 0;
  for (const { author, slug, file } of await listAttributed(dataRoot, 'notes')) {
    for (const n of noteRows(await readMaybe(file))) {
      const noteId = `${author} ${slug} ${n.created_at}`;
      await d1.query(
        'INSERT OR IGNORE INTO recipe_notes (id, recipe, author, body, tags, private, created_at) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        [noteId, slug, author, n.body, JSON.stringify(n.tags), n.private, n.created_at],
      );
      recipeNoteCount++;
    }
  }

  log(
    `backfilled ${aliasCount} aliases, ${feedCount} feeds, ${memberCount} members, ` +
      `${senderCount} senders, ${termCount} flyer terms, ${skuCount} sku mappings, ` +
      `${candCount} inbox candidates, ${storeCount} stores, ${storeNoteCount} store notes, ` +
      `${recipeNoteCount} recipe notes`,
  );
}
