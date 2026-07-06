-- 0039_satellite_rejections — the satellite source-audit substrate (satellite-source-audit):
-- the rejection LEDGER + a per-source accept-tally + a per-source quarantine flag.
--
-- Unlike reconcile_errors (DELETE + re-insert every reconcile pass — it always reflects the
-- LATEST projection), satellite_rejections is an APPEND-with-rolling-prune LOG: each rejected
-- observation is a point-in-time event, appended and pruned by AGE (mirroring pruneIngestPushes /
-- pruneStaleOrderLists / pruneTerminalTasks), never wholesale-replaced. A row whose `count` > 1 is
-- a PRE-AGGREGATED local-reject summary entry (a satellite reports {reason_category, count, sample}
-- per envelope, landing as ONE row) — so the ledger stays one-row-per-reject-EVENT and a local
-- flood of, say, 40 malformed items does not explode into 40 rows.
--
-- All access goes through src/satellite-audit-db.ts → src/db.ts (throw-free → structured
-- storage_error). The tables start EMPTY; there is no backfill (the satellite spine is dormant
-- until an operator provisions a satellite — the ledger populates from its first reject).
CREATE TABLE satellite_rejections (
  id           TEXT PRIMARY KEY,            -- uuid
  tenant       TEXT,                        -- the CARRYING ingest key's tenant binding: NULL for an operator-global key, else the bound tenant. Keyed off the KEY, not the kind (sale is operator-global, order tenant-bound, recipe MAY be either).
  key_id       TEXT,                        -- the ingest key that carried it (NULL for a synthesized origin)
  kind         TEXT NOT NULL,               -- recipe | sale | order
  source       TEXT NOT NULL,               -- recipe: the batch/feed source; sale/order: the store slug
  origin       TEXT NOT NULL,               -- worker | local
  reason       TEXT NOT NULL,               -- the reject reason (worker) or the reason-category (local)
  provenance   TEXT,                        -- nullable: the offending url / productId / item_id / a local sample
  count        INTEGER NOT NULL DEFAULT 1,  -- 1 for a worker reject; N for a pre-aggregated local-summary entry
  rejected_at  INTEGER NOT NULL             -- epoch ms
);
-- Most-recent-first per-source reads (the reliability rollup numerator + the read tool + the admin detail).
CREATE INDEX satellite_rejections_source ON satellite_rejections (kind, source, rejected_at);
-- Rolling-prune scan by age.
CREATE INDEX satellite_rejections_age ON satellite_rejections (rejected_at);

-- The per-source accept-tally — the uniform denominator the reliability rate-math needs. Bumped from
-- the ONE intakeObservations choke point for all three arms (ingest_pushes is left UNTOUCHED —
-- Decision B: zero blast radius on the shipped recency view): a tiny counter per {tenant, kind,
-- source, DAY}, advancing last_accepted_at on an accept. `deduped` is counted but excluded from the
-- rate denominators (a benign re-report, not a health signal). A stale source simply stops being
-- bumped. DAY-BUCKETED (an epoch-day, floor(rejected_at / 86_400_000)) so the reliability rollup can
-- sum accepts over a RECENT window W the same way it counts rejects over that window — a huge STALE
-- accept history must not dilute the windowed fail-rate below the quarantine threshold. The buckets
-- age out on the same rolling prune as the ledger (`pruneSourceStats`, retention = logRetentionDays).
CREATE TABLE satellite_source_stats (
  tenant           TEXT,                       -- the key's tenant binding (NULL = operator-global)
  kind             TEXT NOT NULL,              -- recipe | sale | order
  source           TEXT NOT NULL,              -- as satellite_rejections.source
  day              INTEGER NOT NULL,           -- epoch-day bucket = floor(bump_ms / 86_400_000); the windowing/prune key
  accepted         INTEGER NOT NULL DEFAULT 0,
  deduped          INTEGER NOT NULL DEFAULT 0,
  last_accepted_at INTEGER                     -- epoch ms of the most recent accept in this bucket (NULL until first); staleness = now − max over buckets
);
-- One tally row per {source, day}. A plain UNIQUE(tenant, kind, source, day) would NOT collide two
-- operator-global rows (SQLite treats NULLs as distinct in a UNIQUE), so the key is COALESCE(tenant,'')
-- — the upsert targets this exact index with ON CONFLICT, keeping a single row per operator-global
-- source per day.
CREATE UNIQUE INDEX satellite_source_stats_key ON satellite_source_stats (COALESCE(tenant, ''), kind, source, day);
-- Rolling-prune scan by bucket age (pruneSourceStats), the accept-tally's analog of satellite_rejections_age.
CREATE INDEX satellite_source_stats_day ON satellite_source_stats (day);

-- The per-source quarantine flag — a reversible, operator-confirmed Worker-side reject (the standing
-- "quarantinable through the pipeline" SHALL as a per-source lever, complementing whole-machine key
-- revocation). A {tenant, kind, source} marked here has its future observations REJECTED at intake
-- (origin:worker, reason:"quarantined") before acceptance, persisting nothing downstream; clearing
-- the row lets the next observation flow again. Never auto-applied — the operator toggles it.
CREATE TABLE satellite_quarantine (
  tenant         TEXT,                        -- the key's tenant binding (NULL = operator-global)
  kind           TEXT NOT NULL,               -- recipe | sale | order
  source         TEXT NOT NULL,               -- as satellite_rejections.source
  quarantined_at INTEGER NOT NULL,            -- epoch ms the operator toggled it on
  note           TEXT                         -- nullable operator note
);
-- One flag per source (COALESCE key for the same NULL-distinct reason as the accept-tally).
CREATE UNIQUE INDEX satellite_quarantine_key ON satellite_quarantine (COALESCE(tenant, ''), kind, source);
