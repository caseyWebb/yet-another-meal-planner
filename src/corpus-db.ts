// D1 shared-corpus data layer (d1-shared-corpus, slice 6 — the last). The remaining
// shared, tool-written corpus — ingredient aliases, the store registry + store notes,
// recipe notes, RSS feeds, the newsletter allowlist + discovery inbox, the Kroger SKU
// cache, flyer terms — lives in the D1 tables of migrations/d1/0006_shared_corpus.sql.
// This module is the SINGLE place those rows are read into the agent-facing shapes and
// mutated — every tool's shared-corpus read/write goes through here, over src/db.ts
// (so a D1 failure surfaces as a structured `storage_error`). It replaces the GitHub
// TOML these artifacts used to live in; after this slice GitHub holds only recipes/*.md.
//
// Most tables are GLOBAL shared config (no tenant column). The two attributed kinds
// (store_notes, recipe_notes) carry an `author` (the writing tenant) + a `private`
// flag; the read filters apply own-private + group-shared (private=0 OR author=?).

import type { Env } from "./env.js";
import { db } from "./db.js";
import { canonicalizeUrl } from "./url.js";
import type { CachedMapping } from "./matching.js";

/** Parse a JSON column, tolerating null/empty/garbage as `[]`. */
function parseJsonArray(value: string | null): string[] {
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// === Aliases =================================================================

/** Read the shared ingredient-alias map (variant → canonical). Empty when none. */
export async function readAliases(env: Env): Promise<Record<string, string>> {
  const rows = await db(env).all<{ variant: string; canonical: string }>(
    "SELECT variant, canonical FROM aliases",
  );
  const out: Record<string, string> = {};
  for (const { variant, canonical } of rows) out[variant] = canonical;
  return out;
}

/**
 * Add alias mappings (variant → canonical), upserting each by variant. Returns the
 * count added/updated. An empty variant or canonical is skipped.
 */
export async function addAliases(
  env: Env,
  mappings: { variant: string; canonical: string }[],
): Promise<number> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  for (const { variant, canonical } of mappings) {
    if (!variant.trim() || !canonical.trim()) continue;
    stmts.push(
      d.prepare(
        "INSERT INTO aliases (variant, canonical) VALUES (?1, ?2) " +
          "ON CONFLICT(variant) DO UPDATE SET canonical = excluded.canonical",
        variant,
        canonical,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
  return stmts.length;
}

// === SKU cache ===============================================================

interface SkuRow {
  ingredient: string;
  location_id: string;
  sku: string;
  brand: string | null;
  size: string | null;
}

/**
 * Read the shared SKU cache as the matcher's CachedMapping[]. `location_id` '' (the
 * untagged backfill sentinel) reads as absent so the matcher's same-location
 * preference treats it as legacy/untagged.
 */
export async function readSkuCache(env: Env): Promise<CachedMapping[]> {
  const rows = await db(env).all<SkuRow>(
    "SELECT ingredient, location_id, sku, brand, size FROM sku_cache",
  );
  return rows.map((r) => {
    const m: CachedMapping = { ingredient: r.ingredient, sku: r.sku };
    if (r.brand != null) m.brand = r.brand;
    if (r.size != null) m.size = r.size;
    if (r.location_id) m.locationId = r.location_id;
    return m;
  });
}

/** One new SKU-cache mapping to persist (the order path's learned resolution). */
export interface NewSkuMapping {
  ingredient: string;
  sku: string;
  brand?: string;
  size?: string;
  locationId?: string;
  last_used?: string;
}

/**
 * Upsert learned SKU mappings, keyed (ingredient, location_id). An untagged mapping
 * stores location_id '' so it shares the composite PK; revalidation overwrites in
 * place. Returns the count written. Mirrors the old append-only TOML cache writer,
 * but upsert-by-key (the indexed lookup the matcher wants).
 */
export async function upsertSkuMappings(env: Env, mappings: NewSkuMapping[]): Promise<number> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  for (const m of mappings) {
    if (!m.ingredient || !m.sku) continue;
    stmts.push(
      d.prepare(
        "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
          "ON CONFLICT(ingredient, location_id) DO UPDATE SET " +
          "sku = excluded.sku, brand = excluded.brand, size = excluded.size, last_used = excluded.last_used",
        m.ingredient,
        m.locationId ?? "",
        m.sku,
        m.brand ?? null,
        m.size ?? null,
        m.last_used ?? null,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
  return stmts.length;
}

// === Flyer terms =============================================================

/** Read the shared flyer broad-scan terms. */
export async function readFlyerTerms(env: Env): Promise<string[]> {
  const rows = await db(env).all<{ term: string }>("SELECT term FROM flyer_terms");
  return rows.map((r) => r.term);
}

// === Feeds ===================================================================

export interface FeedRow {
  url: string;
  name: string | null;
  weight: number | null;
  tags: string[];
}

/** Read the shared RSS/Atom discovery feeds. */
export async function readFeeds(env: Env): Promise<FeedRow[]> {
  const rows = await db(env).all<{ url: string; name: string | null; weight: number | null; tags: string | null }>(
    "SELECT url, name, weight, tags FROM feeds",
  );
  return rows.map((r) => ({
    url: r.url,
    name: r.name,
    weight: r.weight,
    tags: parseJsonArray(r.tags),
  }));
}

/**
 * Add discovery feeds, deduped by url (existing rows untouched — add-only, the shared
 * `feeds` table's dedup semantics). Returns the count of feeds actually added.
 */
export async function addFeedRows(
  env: Env,
  feeds: { url: string; name?: string; weight?: number; tags?: string[] }[],
): Promise<number> {
  const have = new Set((await readFeeds(env)).map((f) => f.url));
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  for (const f of feeds) {
    if (typeof f.url !== "string" || !f.url.trim() || have.has(f.url)) continue;
    have.add(f.url);
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO feeds (url, name, weight, tags) VALUES (?1, ?2, ?3, ?4)",
        f.url,
        f.name ?? null,
        f.weight ?? 1,
        f.tags && f.tags.length ? JSON.stringify(f.tags) : null,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
  return stmts.length;
}

// === Discovery allowlist =====================================================

export interface Allowlist {
  members: Set<string>;
  senders: Set<string>;
}

/** Read the shared inbound-newsletter allowlist (trusted member + sender addresses). */
export async function readAllowlist(env: Env): Promise<Allowlist> {
  const [members, senders] = await Promise.all([
    db(env).all<{ address: string }>("SELECT address FROM discovery_members"),
    db(env).all<{ address: string }>("SELECT address FROM discovery_senders"),
  ]);
  return {
    members: new Set(members.map((r) => r.address)),
    senders: new Set(senders.map((r) => r.address)),
  };
}

/**
 * Add trusted members/senders to the allowlist, deduped by address (existing
 * untouched). Addresses are normalized (trim + lowercase) — only valid `@` addresses
 * are kept. Returns how many of each kind were added.
 */
export async function addSourceRows(
  env: Env,
  additions: { members?: { address: string }[]; senders?: { address: string; name?: string }[] },
): Promise<{ members: number; senders: number }> {
  const norm = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const a = raw.trim().toLowerCase();
    return a.includes("@") ? a : null;
  };
  const current = await readAllowlist(env);
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  let memberCount = 0;
  let senderCount = 0;
  for (const m of additions.members ?? []) {
    const a = norm(m.address);
    if (!a || current.members.has(a)) continue;
    current.members.add(a);
    stmts.push(d.prepare("INSERT OR IGNORE INTO discovery_members (address) VALUES (?1)", a));
    memberCount++;
  }
  for (const s of additions.senders ?? []) {
    const a = norm(s.address);
    if (!a || current.senders.has(a)) continue;
    current.senders.add(a);
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO discovery_senders (address, name) VALUES (?1, ?2)",
        a,
        typeof s.name === "string" && s.name ? s.name : null,
      ),
    );
    senderCount++;
  }
  if (stmts.length > 0) await d.batch(stmts);
  return { members: memberCount, senders: senderCount };
}

// === Discovery inbox =========================================================

export interface InboxCandidate {
  from: string;
  subject: string;
  received_at: string | null;
  body: string;
}

/**
 * Read the shared email-discovery inbox as the agent reads it (newest-relevant set),
 * dropping any candidate whose URL has been group-rejected (the disposition collapse —
 * a rejected discovery never resurfaces for anyone). Compared on the canonical URL so
 * a tracker-wrapped reject still suppresses the bare candidate.
 */
export async function readDiscoveryInbox(env: Env): Promise<InboxCandidate[]> {
  const [rows, rejected] = await Promise.all([
    db(env).all<{
      url: string | null;
      source: string | null;
      subject: string | null;
      body: string | null;
      discovered_at: string | null;
    }>(
      "SELECT url, source, subject, body, discovered_at FROM discovery_candidates ORDER BY discovered_at DESC, id",
    ),
    readDiscoveryRejections(env),
  ]);
  return rows
    .filter((r) => !(r.url && rejected.has(canonicalizeUrl(r.url))))
    .map((r) => ({
      from: r.source ?? "",
      subject: r.subject ?? "",
      received_at: r.discovered_at && r.discovered_at.length ? r.discovered_at : null,
      body: r.body ?? "",
    }));
}

/** Canonical URLs the group has rejected — the suppression set both discovery read
 *  paths consult (fetch_rss_discoveries unions it into `seen`; the inbox drops them). */
export async function readDiscoveryRejections(env: Env): Promise<Set<string>> {
  const rows = await db(env).all<{ url: string }>("SELECT url FROM discovery_rejections");
  return new Set(rows.map((r) => r.url));
}

/** Record a group-wide discovery rejection (idempotent on the canonical URL; a repeat
 *  refreshes the reason/provenance). `url` must already be canonicalized by the caller. */
export async function addDiscoveryRejection(
  env: Env,
  rejection: { url: string; reason: string | null; rejectedBy: string; rejectedAt: string },
): Promise<void> {
  await db(env).run(
    "INSERT INTO discovery_rejections (url, reason, rejected_by, rejected_at) VALUES (?1, ?2, ?3, ?4) " +
      "ON CONFLICT(url) DO UPDATE SET reason = excluded.reason, rejected_by = excluded.rejected_by, rejected_at = excluded.rejected_at",
    rejection.url,
    rejection.reason,
    rejection.rejectedBy,
    rejection.rejectedAt,
  );
}

/**
 * Insert one email-discovery candidate, deduped by the UNIQUE url column. Returns
 * whether a row was written (false = an exact re-delivery already present).
 */
export async function insertDiscoveryCandidate(
  env: Env,
  cand: { url: string; from: string; subject: string; body: string; received_at: string },
): Promise<boolean> {
  const res = await db(env).run(
    "INSERT OR IGNORE INTO discovery_candidates (id, url, source, subject, body, discovered_at, status) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'new')",
    cand.url,
    cand.url,
    cand.from,
    cand.subject,
    cand.body,
    cand.received_at,
  );
  return res.changes > 0;
}

// === Stores ==================================================================

/**
 * Objective store IDENTITY (shared, unattributed). The non-core identity fields
 * (label/chain/address/location_id) are kept in the `extra` JSON column.
 */
export interface Store {
  slug: string;
  name: string;
  label?: string;
  chain?: string;
  address?: string;
  domain: string;
  location_id?: string;
}

const STORE_EXTRA_KEYS = ["label", "chain", "address", "location_id"] as const;

function storeOfRow(r: { slug: string; name: string; domain: string | null; extra: string | null }): Store {
  const store: Store = { slug: r.slug, name: r.name, domain: r.domain ?? "grocery" };
  if (r.extra) {
    try {
      const extra = JSON.parse(r.extra) as Record<string, unknown>;
      for (const k of STORE_EXTRA_KEYS) {
        if (typeof extra[k] === "string" && extra[k]) store[k] = extra[k] as string;
      }
    } catch {
      /* ignore malformed extra */
    }
  }
  return store;
}

function storeExtraJson(store: Store): string | null {
  const extra: Record<string, string> = {};
  for (const k of STORE_EXTRA_KEYS) {
    const v = store[k];
    if (typeof v === "string" && v) extra[k] = v;
  }
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

/** List the registered stores (identity only), sorted by slug. */
export async function listStoreRows(env: Env): Promise<Store[]> {
  const rows = await db(env).all<{ slug: string; name: string; domain: string | null; extra: string | null }>(
    "SELECT slug, name, domain, extra FROM stores ORDER BY slug",
  );
  return rows.map(storeOfRow);
}

/** Read one store by slug, or null when absent. */
export async function readStoreRow(env: Env, slug: string): Promise<Store | null> {
  const row = await db(env).first<{ slug: string; name: string; domain: string | null; extra: string | null }>(
    "SELECT slug, name, domain, extra FROM stores WHERE slug = ?1",
    slug,
  );
  return row ? storeOfRow(row) : null;
}

/** Insert a new store row (caller checks the slug isn't already registered). */
export async function insertStore(env: Env, store: Store): Promise<void> {
  await db(env).run(
    "INSERT INTO stores (slug, name, domain, extra) VALUES (?1, ?2, ?3, ?4)",
    store.slug,
    store.name,
    store.domain,
    storeExtraJson(store),
  );
}

/** Upsert a store row by slug (used by update_store after applying its ops). */
export async function upsertStore(env: Env, store: Store): Promise<void> {
  await db(env).run(
    "INSERT INTO stores (slug, name, domain, extra) VALUES (?1, ?2, ?3, ?4) " +
      "ON CONFLICT(slug) DO UPDATE SET name = excluded.name, domain = excluded.domain, extra = excluded.extra",
    store.slug,
    store.name,
    store.domain,
    storeExtraJson(store),
  );
}

/** Delete a store by slug. Returns whether a row was removed. */
export async function deleteStore(env: Env, slug: string): Promise<boolean> {
  const res = await db(env).run("DELETE FROM stores WHERE slug = ?1", slug);
  return res.changes > 0;
}

// === Notes (attributed: recipe_notes, store_notes) ===========================

/** A note surfaced in a group read, carrying its author + privacy. */
export interface AttributedNote {
  author: string;
  created_at: string;
  body: string;
  tags: string[];
  private: boolean;
}

/** A note as the caller owns it (used by update/remove, addressed by created_at). */
export interface OwnedNote extends AttributedNote {
  id: string;
}

type NoteTable = "recipe_notes" | "store_notes";
const noteSubjectCol = (table: NoteTable): "recipe" | "store" =>
  table === "recipe_notes" ? "recipe" : "store";

function attributedNoteOf(r: {
  author: string;
  created_at: string | null;
  body: string;
  tags: string | null;
  private: number | null;
}): AttributedNote {
  return {
    author: r.author,
    created_at: r.created_at ?? "",
    body: r.body,
    tags: parseJsonArray(r.tags),
    private: r.private === 1,
  };
}

/**
 * Read a subject's group notes with the privacy rule applied: the caller's own
 * private notes plus everyone's shared notes (private=0 OR author=caller). Ordered
 * by created_at (author as tiebreak) for determinism.
 */
async function readNotes(
  env: Env,
  table: NoteTable,
  subject: string,
  caller: string,
): Promise<AttributedNote[]> {
  const col = noteSubjectCol(table);
  const rows = await db(env).all<{
    author: string;
    created_at: string | null;
    body: string;
    tags: string | null;
    private: number | null;
  }>(
    `SELECT author, body, tags, private, created_at FROM ${table} ` +
      `WHERE ${col} = ?1 AND (private = 0 OR author = ?2)`,
    subject,
    caller,
  );
  const notes = rows.map(attributedNoteOf);
  notes.sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.author < b.author ? -1 : 1,
  );
  return notes;
}

export const readRecipeNotes = (env: Env, recipe: string, caller: string) =>
  readNotes(env, "recipe_notes", recipe, caller);
export const readStoreNotes = (env: Env, store: string, caller: string) =>
  readNotes(env, "store_notes", store, caller);

/** Insert an attributed note; returns its id (the addressing key for update/remove). */
async function insertNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  note: { created_at: string; body: string; tags: string[]; private: boolean },
): Promise<string> {
  const col = noteSubjectCol(table);
  const id = `${author} ${subject} ${note.created_at}`;
  await db(env).run(
    `INSERT INTO ${table} (id, ${col}, author, body, tags, private, created_at) ` +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    id,
    subject,
    author,
    note.body,
    JSON.stringify(note.tags),
    note.private ? 1 : 0,
    note.created_at,
  );
  return id;
}

export const insertRecipeNote = (
  env: Env,
  recipe: string,
  author: string,
  note: { created_at: string; body: string; tags: string[]; private: boolean },
) => insertNote(env, "recipe_notes", recipe, author, note);
export const insertStoreNote = (
  env: Env,
  store: string,
  author: string,
  note: { created_at: string; body: string; tags: string[]; private: boolean },
) => insertNote(env, "store_notes", store, author, note);

/**
 * Find the caller's OWN note on a subject by created_at (self-scoped — only the
 * caller's rows are queryable here, mirroring the structural self-scoping of the old
 * per-tenant note files). Returns null when none matches.
 */
async function findOwnNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  createdAt: string,
): Promise<OwnedNote | null> {
  const col = noteSubjectCol(table);
  const row = await db(env).first<{
    id: string;
    author: string;
    created_at: string | null;
    body: string;
    tags: string | null;
    private: number | null;
  }>(
    `SELECT id, author, body, tags, private, created_at FROM ${table} ` +
      `WHERE ${col} = ?1 AND author = ?2 AND created_at = ?3`,
    subject,
    author,
    createdAt,
  );
  if (!row) return null;
  return { id: row.id, ...attributedNoteOf(row) };
}

/** Patch fields on the caller's own note (by created_at). Returns false when no match. */
async function updateOwnNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  createdAt: string,
  patch: { body?: string; tags?: string[]; private?: boolean },
): Promise<boolean> {
  const existing = await findOwnNote(env, table, subject, author, createdAt);
  if (!existing) return false;
  const body = patch.body ?? existing.body;
  const tags = patch.tags ?? existing.tags;
  const priv = patch.private ?? existing.private;
  await db(env).run(
    `UPDATE ${table} SET body = ?1, tags = ?2, private = ?3 WHERE id = ?4`,
    body,
    JSON.stringify(tags),
    priv ? 1 : 0,
    existing.id,
  );
  return true;
}

/** Delete the caller's own note (by created_at). Returns false when no match. */
async function removeOwnNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  createdAt: string,
): Promise<boolean> {
  const existing = await findOwnNote(env, table, subject, author, createdAt);
  if (!existing) return false;
  await db(env).run(`DELETE FROM ${table} WHERE id = ?1`, existing.id);
  return true;
}

export const updateRecipeNote = (
  env: Env,
  recipe: string,
  author: string,
  createdAt: string,
  patch: { body?: string; tags?: string[]; private?: boolean },
) => updateOwnNote(env, "recipe_notes", recipe, author, createdAt, patch);
export const removeRecipeNote = (env: Env, recipe: string, author: string, createdAt: string) =>
  removeOwnNote(env, "recipe_notes", recipe, author, createdAt);
export const updateStoreNote = (
  env: Env,
  store: string,
  author: string,
  createdAt: string,
  patch: { body?: string; tags?: string[]; private?: boolean },
) => updateOwnNote(env, "store_notes", store, author, createdAt, patch);
export const removeStoreNote = (env: Env, store: string, author: string, createdAt: string) =>
  removeOwnNote(env, "store_notes", store, author, createdAt);
