-- 0046_webauthn_credentials — enrolled WebAuthn passkeys, one row per device
-- (webauthn-passkey-auth / passkey-auth capability). A member (tenant = person) MAY hold
-- several credentials (one per device); the credential id is the primary key and `tenant`
-- is the isolation column, so the enrolled-credentials set is per-tenant relational data
-- in D1's tier — strong read-after-write for the per-assertion counter/last-used writes,
-- unlike KV. Read/written only through src/webauthn-db.ts over src/db.ts (structured
-- storage_error mapping); ephemeral ceremony state (challenges, authorize approval refs)
-- stays in KV, not here.
--
--   * tenant         — the owning tenant id (canonical lowercase username). Indexed for
--                       the per-tenant list + the revoke purge.
--   * credential_id  — the WebAuthn credential id (base64url). PRIMARY KEY: an assertion
--                       resolves a member by looking this up (discoverable/usernameless).
--   * public_key     — the COSE public key (base64url) verification checks assertions against.
--   * sign_count     — the authenticator signature counter. STORED for diagnostics but never
--                       enforced: synced passkeys (iCloud/Google) report 0 / non-incrementing,
--                       so counter regression is NOT treated as a cloning signal (design D4).
--   * transports     — JSON array of the credential's reported transports (hints only).
--   * label          — optional human label (e.g. "Casey's phone"); null when unset.
--   * created_at     — epoch ms of enrollment.
--   * last_used_at   — epoch ms of the most recent successful assertion (null until first use).
--
-- Purged on member revocation alongside every other per-tenant table (src/admin.ts
-- TENANT_TABLES). No FK — tenants are a KV/identity concept, not a D1 table (mirrors
-- tenant_activity, migration 0024).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  tenant        TEXT NOT NULL,
  credential_id TEXT PRIMARY KEY,
  public_key    TEXT NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,               -- JSON array of transport hints
  label         TEXT,
  created_at    INTEGER NOT NULL,   -- epoch ms
  last_used_at  INTEGER             -- epoch ms, null until first assertion
);

CREATE INDEX IF NOT EXISTS idx_webauthn_tenant ON webauthn_credentials(tenant);
