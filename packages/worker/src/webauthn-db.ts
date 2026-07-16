// D1 data layer for enrolled WebAuthn passkeys (webauthn-passkey-auth / passkey-auth).
// One row per device in `webauthn_credentials` (migration 0046), keyed by credential id
// with a `tenant` isolation column and a `member` attribution column (migration 0058 —
// backfilled to `tenant`, exactly the member id each burned-in user handle asserts; the
// column is nullable in DDL but code treats it as required and always writes it, with a
// stray NULL read defaulting to the founding member). This is the SINGLE place those
// rows are read/written, over src/db.ts (so a D1 failure surfaces as a structured
// `storage_error`, keeping the auth path throw-free). Deletion on household purge is
// the admin `TENANT_TABLES` batch; member-revoke deletes only the member's rows
// (src/admin.ts) — neither via a helper here.
//
// Binary fields (credential id, COSE public key) are stored base64url TEXT; `transports`
// is a JSON array; the signature counter is stored but NEVER enforced (design D4).

import type { Env } from "./env.js";
import { db } from "./db.js";

/** An enrolled credential in the agent-facing shape (binary fields base64url-encoded). */
export interface StoredCredential {
  tenant: string;
  /** The owning member (the credential's burned-in user handle). */
  member: string;
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

interface CredentialRow {
  tenant: string;
  member: string | null;
  credential_id: string;
  public_key: string;
  sign_count: number;
  transports: string | null;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
}

/** Parse the `transports` JSON column, tolerating null/empty/garbage as `[]`. */
function parseTransports(value: string | null): string[] {
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function credentialOf(r: CredentialRow): StoredCredential {
  return {
    tenant: r.tenant,
    // A NULL member is never expected (the migration backfills; inserts always write) —
    // but the uniform legacy-defaulting rule holds if one is ever observed.
    member: r.member ?? r.tenant,
    credentialId: r.credential_id,
    publicKey: r.public_key,
    signCount: r.sign_count,
    transports: parseTransports(r.transports),
    label: r.label,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  };
}

const SELECT =
  "SELECT tenant, member, credential_id, public_key, sign_count, transports, label, created_at, last_used_at " +
  "FROM webauthn_credentials";

/** Insert a freshly enrolled credential. The credential id is the primary key. */
export async function insertCredential(
  env: Env,
  c: Omit<StoredCredential, "lastUsedAt">,
): Promise<void> {
  await db(env).run(
    "INSERT INTO webauthn_credentials (tenant, member, credential_id, public_key, sign_count, transports, label, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    c.tenant,
    c.member,
    c.credentialId,
    c.publicKey,
    c.signCount,
    JSON.stringify(c.transports),
    c.label,
    c.createdAt,
  );
}

/** Every credential enrolled to a tenant (the account's device list). */
export async function listCredentialsByTenant(env: Env, tenant: string): Promise<StoredCredential[]> {
  const rows = await db(env).all<CredentialRow>(`${SELECT} WHERE tenant = ?1 ORDER BY created_at`, tenant);
  return rows.map(credentialOf);
}

/** Resolve a credential (and its owning tenant) from the asserted credential id, or null. */
export async function getCredentialById(env: Env, credentialId: string): Promise<StoredCredential | null> {
  const row = await db(env).first<CredentialRow>(`${SELECT} WHERE credential_id = ?1`, credentialId);
  return row ? credentialOf(row) : null;
}

/** Record a successful assertion: store the new counter and stamp last-used. Never enforced. */
export async function touchCredential(
  env: Env,
  credentialId: string,
  signCount: number,
  lastUsedAt: number,
): Promise<void> {
  await db(env).run(
    "UPDATE webauthn_credentials SET sign_count = ?2, last_used_at = ?3 WHERE credential_id = ?1",
    credentialId,
    signCount,
    lastUsedAt,
  );
}

/** How many credentials a tenant holds (the account's device count, across members). */
export async function countCredentialsByTenant(env: Env, tenant: string): Promise<number> {
  const row = await db(env).first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM webauthn_credentials WHERE tenant = ?1",
    tenant,
  );
  return row?.n ?? 0;
}

/** How many credentials one MEMBER holds — drives the first-enrollment (0 → 1) consume rule,
 *  which is member-scoped: a member's bootstrap code dies when THEIR first passkey lands. */
export async function countCredentialsByMember(env: Env, tenant: string, member: string): Promise<number> {
  const row = await db(env).first<{ n: number }>(
    "SELECT COUNT(*) AS n FROM webauthn_credentials WHERE tenant = ?1 AND member = ?2",
    tenant,
    member,
  );
  return row?.n ?? 0;
}
