-- 0006_shared_corpus — the remaining shared, tool-written corpus as D1 tables
-- (d1-shared-corpus, slice 6 — the last). Moves the GitHub shared TOML (aliases,
-- the store registry + store notes, recipe notes, RSS feeds, the newsletter
-- allowlist + discovery inbox, the Kroger SKU cache, flyer terms) into D1, leaving
-- GitHub holding only `recipes/*.md`. The one-time backfill that fills these from
-- the data-repo checkout TOML is migrations/0005-shared-corpus-d1.mjs.
--
-- Most tables are GLOBAL shared config (no tenant column): a single group shares one
-- alias map, one feed set, one allowlist, one SKU cache, one inbox, one store
-- registry. The two ATTRIBUTED kinds carry an `author` (the writing tenant) + a
-- `private` flag: `store_notes`, `recipe_notes`. `read_recipe_notes`/`read_store_notes`
-- return the caller's own private notes plus everyone's shared notes
-- (WHERE recipe=? AND (private=0 OR author=?)).
--
-- Caches/inboxes get the indexes their access pattern wants: sku_cache keyed
-- (ingredient, location_id) — the indexed lookup the matcher does today by scanning a
-- parsed blob; discovery_candidates dedups by URL via UNIQUE(url).

-- Ingredient name variants → canonical form (the matcher's normalization step).
CREATE TABLE IF NOT EXISTS aliases (
  variant   TEXT PRIMARY KEY,
  canonical TEXT NOT NULL
);

-- RSS/Atom discovery feeds (the pool fetch_rss_discoveries reads). Deduped by url.
CREATE TABLE IF NOT EXISTS feeds (
  url    TEXT PRIMARY KEY,
  name   TEXT,
  weight REAL,
  tags   TEXT                              -- JSON array of strings
);

-- Inbound-newsletter allowlist: trusted member + sender addresses. `name` labels a
-- newsletter sender (never a person). Keyed by normalized address.
CREATE TABLE IF NOT EXISTS discovery_senders (
  address TEXT PRIMARY KEY,
  name    TEXT
);

CREATE TABLE IF NOT EXISTS discovery_members (
  address TEXT PRIMARY KEY
);

-- Broad flyer scan terms (the cron's sweep terms). A flat set.
CREATE TABLE IF NOT EXISTS flyer_terms (
  term TEXT PRIMARY KEY
);

-- Kroger SKU resolution cache, keyed (ingredient, location_id) — the indexed lookup
-- the matcher does. `last_used` for revalidation/pruning. location_id '' = legacy
-- untagged (still part of the composite PK so an untagged + a tagged mapping coexist).
CREATE TABLE IF NOT EXISTS sku_cache (
  ingredient  TEXT,
  location_id TEXT,
  sku         TEXT,
  brand       TEXT,
  size        TEXT,
  last_used   TEXT,
  PRIMARY KEY (ingredient, location_id)
);
CREATE INDEX IF NOT EXISTS idx_sku_cache_lookup ON sku_cache(ingredient, location_id);

-- Email-ingest discovery inbox. Each candidate is one forwarded message captured by
-- the Worker email() handler; the agent parses `body` for recipe links. Deduped by
-- url (UNIQUE), replacing the in-memory "already seen?" set built from the file.
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id            TEXT PRIMARY KEY,
  url           TEXT UNIQUE,
  source        TEXT,                       -- sender address (`from`)
  subject       TEXT,
  body          TEXT,
  discovered_at TEXT,                       -- received date (YYYY-MM-DD)
  status        TEXT
);

-- Store registry — objective store IDENTITY (shared, unattributed). Layout lives in
-- attributed store_notes, not here. `extra` keeps any other identity fields (label,
-- chain, address, location_id) losslessly as JSON.
CREATE TABLE IF NOT EXISTS stores (
  slug   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  domain TEXT,
  extra  TEXT                               -- JSON object: label/chain/address/location_id
);

-- Attributed store notes (the store analog of recipe notes). author = the writing
-- tenant; private → owner-only on read.
CREATE TABLE IF NOT EXISTS store_notes (
  id         TEXT PRIMARY KEY,
  store      TEXT,
  author     TEXT,
  body       TEXT,
  tags       TEXT,                          -- JSON array of strings
  private    INTEGER,                       -- 0/1
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_store_notes_store ON store_notes(store);

-- Attributed recipe notes — the spin-capture mechanism. author = the writing tenant;
-- private → owner-only. read_recipe_notes joins these with the overlay ratings query.
CREATE TABLE IF NOT EXISTS recipe_notes (
  id         TEXT PRIMARY KEY,
  recipe     TEXT,
  author     TEXT,
  body       TEXT,
  tags       TEXT,                          -- JSON array of strings
  private    INTEGER,                       -- 0/1
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipe_notes_recipe ON recipe_notes(recipe);
