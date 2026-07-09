-- 0047_self_service_signup — group invite codes + the tenant uniqueness registry
-- (multi-use-invite-codes / self-service-signup capability). Three tables:
--
--   * tenants — the FIRST strongly-consistent registry of tenant ids. Until now a tenant
--     was only a KV allowlist entry (`tenant:<id>`), created serially by the operator, so
--     uniqueness was never contended. Self-service signup lets strangers pick their own
--     usernames concurrently, so the id needs an atomic uniqueness authority: the PRIMARY
--     KEY here. A self-service claim INSERTs (ON CONFLICT DO NOTHING) and wins iff it is the
--     first; the KV `tenant:<id>` entry is written only after the claim wins and remains the
--     hot-path resolution authority. Existing tenants are backfilled here idempotently
--     (via_code NULL for operator-onboarded members). Purged on member revocation.
--
--   * signup_invites — an operator-issued GROUP INVITE CODE (multi-use). `used` is bumped by
--     a guarded UPDATE (`used < max_redemptions`) that is the atomic cap gate, so the cap is
--     never exceeded under concurrency. Separate from the KV `invite:<code>` single-use
--     bootstrap path: a group code CREATES a tenant, a bootstrap code RESOLVES one.
--
--   * signup_redemptions — provenance: which tenant was created from which code.
--
-- Read/written only through src/signup-db.ts over src/db.ts (structured storage_error
-- mapping). No FKs (SQLite/D1 idiom here; the app layer owns referential intent).
CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,   -- canonical lowercase username; the uniqueness authority
  created_at INTEGER NOT NULL,   -- epoch ms
  via_code   TEXT                -- the group code that created it; NULL for operator-onboarded
);

CREATE TABLE IF NOT EXISTS signup_invites (
  code            TEXT PRIMARY KEY,
  max_redemptions INTEGER NOT NULL,       -- the cap
  used            INTEGER NOT NULL DEFAULT 0,
  expires_at      INTEGER,                -- epoch ms; NULL = never expires
  revoked_at      INTEGER,                -- epoch ms; NULL = active
  label           TEXT,                   -- optional operator label ("summer camp crew")
  created_at      INTEGER NOT NULL        -- epoch ms
);

CREATE TABLE IF NOT EXISTS signup_redemptions (
  code       TEXT NOT NULL,
  tenant     TEXT NOT NULL,   -- the created tenant id (isolation column for the revoke purge)
  created_at INTEGER NOT NULL -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_signup_redemptions_code ON signup_redemptions(code);
CREATE INDEX IF NOT EXISTS idx_signup_redemptions_tenant ON signup_redemptions(tenant);
