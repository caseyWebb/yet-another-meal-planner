-- 0024_tenant_activity — best-effort tenant first-seen/last-seen tracking
-- (admin-ui-redesign-members), backing the Members roster's active/pending status and
-- joined/last-active timestamps.
--
-- Written from the MCP tenant-resolution path (`src/tenant.ts`), THROTTLED so it is not a
-- write on every tool call: `first_seen_at` is set once (write-if-absent), `last_seen_at`
-- is only updated when the stored value is stale (older than the throttle window), so a
-- chatty session costs at most one write per window, not one per tool call. Best-effort —
-- a write failure here must never fail the tool call it rides alongside.
--
-- One row per tenant id (no FK — tenants are a KV/identity concept, not a D1 table):
--   * tenant         — the tenant id (matches the `tenant:<id>` KV allowlist key).
--   * first_seen_at  — epoch ms of the first successful tenant resolution (≈ "joined").
--   * last_seen_at   — epoch ms of the most recent successful tenant resolution, updated
--                       at most once per throttle window (≈ "active").
--
-- Absent for a tenant that has never completed an MCP OAuth exchange — that absence IS the
-- roster's "pending" signal (an allowlist entry with no `tenant_activity` row).
CREATE TABLE tenant_activity (
  tenant        TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,  -- epoch ms
  last_seen_at  INTEGER NOT NULL   -- epoch ms
);
