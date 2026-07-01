-- 0025_ingest_keys — the walled-source ingest key roster (recipe-ingestion).
--
-- One row per SCRAPER machine. A key authenticates POST /admin/api/ingest as a
-- key-authed carve-out from the Cloudflare Access gate (a headless scraper has no
-- Access JWT). The plaintext secret is shown ONCE at mint and never stored: we keep
-- a SHA-256 hash (the lookup key) + a short display prefix. `last_used_at` and the
-- last-reported scraper/contract versions drive the admin liveness + skew views.
CREATE TABLE ingest_keys (
  id                    TEXT PRIMARY KEY,               -- "ik_<hex>"
  label                 TEXT NOT NULL,                  -- scraper machine label (e.g. home-nas-scraper)
  key_hash              TEXT NOT NULL UNIQUE,           -- SHA-256 hex of the secret (the lookup key)
  key_prefix            TEXT NOT NULL,                  -- display-only prefix (e.g. "ing_live_9f2a")
  created_at            INTEGER NOT NULL,               -- epoch ms
  last_used_at          INTEGER,                        -- epoch ms of the last accepted push; NULL = never
  status                TEXT NOT NULL DEFAULT 'active', -- active | revoked
  last_scraper_version  TEXT,                           -- last reported build
  last_contract_version TEXT                            -- last reported targeted contract version (skew source)
);
CREATE INDEX ingest_keys_hash ON ingest_keys(key_hash);
