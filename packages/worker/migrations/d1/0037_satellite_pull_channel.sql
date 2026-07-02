-- 0037_satellite_pull_channel — the outbound-only PULL CHANNEL (satellite-pull-channel).
--
-- The satellite is strictly outbound-only, so the Worker cannot push Worker-decided work at
-- it. Instead the satellite CLAIMS work: `satellite_tasks` is a D1 queue whose rows move
-- pending → claimed → done|failed. A claim is one atomic conditional `UPDATE … RETURNING`
-- that leases a bounded batch (stamping owner + lease expiry); a claimed row whose lease
-- expired is re-claimable. Correctness rests on RESULT-side arrival dedup (inherited from the
-- recipe raw-observation intake), not on the lease — the lease only avoids needless
-- concurrent double-work. There is NO concrete task `kind` yet: this migration is the seam a
-- later capability (sale-scan, order-fill) fills with a producer + kinds; the channel treats
-- `payload` as opaque. All access goes through src/satellite-tasks-db.ts → src/db.ts.
CREATE TABLE satellite_tasks (
  id                TEXT PRIMARY KEY,                -- opaque task id (the results correlation key)
  kind              TEXT NOT NULL,                   -- discriminated-union discriminant (no concrete kinds yet)
  scope             TEXT NOT NULL,                   -- 'operator' (cross-tenant, public-derived) | 'tenant'
  tenant            TEXT,                            -- NULL for operator-scope; the owning tenant id for tenant-scope
  dedup_key         TEXT NOT NULL,                   -- logical task identity for idempotent enqueue
  payload           TEXT NOT NULL,                   -- JSON task body, opaque to the channel
  status            TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'claimed' | 'done' | 'failed'
  claimed_by        TEXT,                            -- ingest key id holding the lease
  claimed_at        INTEGER,                         -- epoch ms of the claim
  lease_expires_at  INTEGER,                         -- epoch ms; a 'claimed' row past this is re-claimable
  attempts          INTEGER NOT NULL DEFAULT 0,      -- claim/report attempts (each claim bumps it)
  max_attempts      INTEGER NOT NULL DEFAULT 3,      -- attempt cap; at/above it a failed task is parked terminal
  last_error        TEXT,                            -- last reported failure reason (surfaced to the operator)
  created_at        INTEGER NOT NULL,                -- epoch ms
  updated_at        INTEGER NOT NULL,                -- epoch ms of the last lifecycle write
  -- Scope/tenant consistency (the multi-tenancy invariant): an operator-scope task is deliberately
  -- cross-tenant so it carries NO tenant; a tenant-scope task MUST name its owning tenant. This makes
  -- the impossible states (operator+tenant, tenant+NULL) unwritable by any future producer.
  CHECK ((scope = 'operator' AND tenant IS NULL) OR (scope = 'tenant' AND tenant IS NOT NULL))
);
-- The claim scan: claimable rows filtered by scope × tenant × kind, oldest first.
CREATE INDEX satellite_tasks_claimable ON satellite_tasks (status, scope, tenant, kind, created_at);
-- Idempotent enqueue: at most ONE non-terminal (pending|claimed) row per logical key. A
-- producer that re-runs does not stack a second in-flight row; once terminal, the key is
-- enqueuable afresh (the partial predicate excludes done|failed rows).
CREATE UNIQUE INDEX satellite_tasks_dedup ON satellite_tasks (dedup_key) WHERE status IN ('pending', 'claimed');

-- The ingest key's OPTIONAL tenant binding (additive, nullable). NULL = operator-global (the
-- default; every already-minted recipe-scrape key reads as operator-global, unaffected). A
-- bound key may claim operator-scope work AND its own tenant's tenant-scope work, never
-- another tenant's. The binding is immutable (re-mint to change it) and governs ONLY the pull
-- channel's claim scope — the recipe-scrape push path stays operator-global regardless.
ALTER TABLE ingest_keys ADD COLUMN tenant TEXT;
