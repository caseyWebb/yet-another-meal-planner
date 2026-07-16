-- 0058_member_identity — the member-identity substrate (member-identity-split,
-- multi-tenancy capability). Three statement groups:
--
--   * members — one row per member within a tenant (household). Every tenant has a
--     FOUNDING MEMBER whose id and handle EQUAL the canonical tenant id, so every
--     credential value already in the wild (grant props, session records, WebAuthn
--     user handles, invite mappings, note-author values) is already a valid member
--     id — zero re-keying, by construction. `handle` is deployment-unique NOW so
--     uniqueness is never retrofitted; founding handles are tenant ids verbatim,
--     grandfathered even where they fall outside the product handle grammar. No FK
--     to `tenants` — tenant identity is a KV/registry concept and per-tenant tables
--     deliberately carry bare `tenant` columns. Purged with the household
--     (TENANT_TABLES, src/admin.ts); read/written through src/members-db.ts over
--     src/db.ts.
--
--   * the founding-member seed — idempotent (INSERT OR IGNORE) over the D1 `tenants`
--     registry. A KV-allowlisted tenant the registry missed is converged by the lazy
--     founding-member guard at identity resolution (src/tenant.ts), not here.
--
--   * webauthn_credentials.member — the member dimension on enrolled passkeys,
--     backfilled to `tenant`: exactly the member id every burned-in WebAuthn user
--     handle already asserts (the user handle IS the member id). The ALTER is the
--     one non-idempotent statement; the migration runner applies it exactly once.
CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,   -- opaque member id; founding member: equals the tenant id
  tenant     TEXT NOT NULL,      -- owning household (isolation column)
  handle     TEXT NOT NULL,      -- deployment-unique display key; founding: equals the tenant id
  created_at INTEGER NOT NULL    -- epoch ms, matching the tenants registry idiom
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_handle ON members(handle);
CREATE INDEX IF NOT EXISTS idx_members_tenant ON members(tenant);

INSERT OR IGNORE INTO members (id, tenant, handle, created_at)
  SELECT id, id, id, created_at FROM tenants;

ALTER TABLE webauthn_credentials ADD COLUMN member TEXT;
UPDATE webauthn_credentials SET member = tenant WHERE member IS NULL;
