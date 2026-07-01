-- 0026_ingest_candidates — the pushed-content inbox (recipe-ingestion).
--
-- POST /admin/api/ingest persists each ACCEPTED, non-duplicate recipe item here with
-- its pre-parsed content; the discovery sweep drains it (a third intake source beside
-- feeds + the email inbox), classifying/matching/importing WITHOUT a fetch. A row lives
-- until the candidate reaches a terminal outcome (imported / rejected / contract-park),
-- then it is deleted; a transient infrastructure failure KEEPS the row so the next tick
-- retries from the stored content (no re-fetch). Deduped by canonical url.
CREATE TABLE ingest_candidates (
  id           TEXT PRIMARY KEY,   -- uuid
  url          TEXT NOT NULL UNIQUE, -- canonical source URL (the dedup key)
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,      -- JSON { ingredients[], instructions[], summary?, servings?, time_total?, time_active? }
  origin       TEXT NOT NULL,      -- the batch `source` name (provenance shown in the admin views)
  key_id       TEXT NOT NULL,      -- the minting ingest key
  received_at  TEXT NOT NULL       -- ISO 8601
);
