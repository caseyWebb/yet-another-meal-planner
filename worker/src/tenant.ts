// Multi-tenancy foundation (multi-tenancy capability). A `Tenant` is the
// per-request identity context every tool closes over: the single operator-owned
// data repo every tenant shares, and the `users/<username>/` path prefix under
// which THIS caller's personal state lives in that repo.
//
// Repository model (single private data repo): one repo holds `recipes/` + shared
// reference data at the root and one `users/<username>/` subtree per member. A
// single GitHub App installation on the operator's account covers it. There is no
// org and no per-tenant repo; "which tenant" is a path prefix, not a separate repo.
//
// The tenant DIRECTORY is the operator-curated allowlist of usernames, in KV, so
// it is operational mapping, never domain data (D9). The OAuth provider (Section 3)
// validates the access token and hands the MCP handler a `tenantId` via grant
// `props`; `resolveTenant` then re-checks that id against the allowlist and builds
// the `Tenant`. The identity STEP is an operator-issued **invite code** (D2):
// `resolveInvite` maps a code to an allowlisted username at the authorize step.

import type { Env } from "./env.js";

/** Coordinates of the GitHub repository the Worker reads/writes. */
export interface RepoCoords {
  owner: string;
  repo: string;
  ref: string;
}

/** The per-request tenant context. Assembled by `resolveTenant`. */
export interface Tenant {
  /** Opaque operator-assigned username, e.g. "alice". Allowlist key + Kroger key + subtree. */
  id: string;
  /** The single shared data repo (objective content + reference data + all users' subtrees). */
  dataRepo: RepoCoords;
  /** Repo-relative prefix for this tenant's personal files, e.g. "users/alice" (empty during the pre-migration single-user bootstrap). */
  userPrefix: string;
  /** GitHub App installation covering the data repo (on the operator's account). */
  installationId: string;
}

/** Structured rejection returned when a bearer token resolves to no tenant. */
export interface Unauthorized {
  error: "unauthorized";
  message: string;
}

/**
 * What the directory persists per tenant. The data repo, installation, and
 * `users/<id>` prefix are all derivable globally (from `env` + the id), so the
 * record is just the allowlist entry — `resolveTenant` joins the rest on.
 */
export interface TenantRecord {
  /** Must equal the directory key (the username) it is stored under. */
  id: string;
}

/** A directory of tenants keyed by opaque tenant id. Injectable for tests. */
export interface TenantStore {
  /** The record for `tenantId`, or null if no such tenant exists. */
  get(tenantId: string): Promise<TenantRecord | null>;
}

const DIRECTORY_PREFIX = "tenant:";
const INVITE_PREFIX = "invite:";

/** The single data-repo coordinates, identical for every tenant, from `env`. */
export function dataCoords(env: Env): RepoCoords {
  return { owner: env.DATA_OWNER, repo: env.DATA_REPO, ref: env.DATA_REF };
}

/** This tenant's personal-file path prefix within the data repo. */
export function userPrefix(tenantId: string): string {
  return `users/${tenantId}`;
}

/** A KV-backed tenant directory. Records are JSON under `tenant:<id>`. */
export function kvTenantStore(kv: KVNamespace): TenantStore {
  return {
    async get(tenantId: string): Promise<TenantRecord | null> {
      const raw = await kv.get(`${DIRECTORY_PREFIX}${tenantId}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as TenantRecord;
        if (!parsed?.id) return null;
        return parsed;
      } catch {
        return null;
      }
    },
  };
}

/** Default directory wiring from the environment (the tenant-directory KV). */
export function directoryFromEnv(env: Env): TenantStore {
  return kvTenantStore(env.TENANT_KV);
}

/** Build the full per-request `Tenant` from a directory record + global env config. */
export function tenantFromRecord(env: Env, record: TenantRecord): Tenant {
  return {
    id: record.id,
    dataRepo: dataCoords(env),
    userPrefix: userPrefix(record.id),
    installationId: env.GITHUB_INSTALLATION_ID,
  };
}

/**
 * Resolve a provider-validated `tenantId` (from grant `props`) to its `Tenant`,
 * re-checking it against the allowlist. Returns a structured `unauthorized` when
 * the id is missing or absent from the directory. No tool runs until this succeeds.
 */
export async function resolveTenant(
  env: Env,
  tenantId: string | null | undefined,
  directory: TenantStore,
): Promise<Tenant | Unauthorized> {
  if (!tenantId) {
    return { error: "unauthorized", message: "No tenant on the request" };
  }
  const record = await directory.get(tenantId);
  if (!record) {
    return { error: "unauthorized", message: `Username ${tenantId} is not on the allowlist` };
  }
  return tenantFromRecord(env, record);
}

/**
 * The invite-code identity step (D2): map an operator-issued invite code to its
 * allowlisted username. Returns the username, or null when the code is unknown or
 * maps to a username no longer on the allowlist. Operator provisions a code with
 * `kv put invite:<code> <username>` (and `tenant:<username>` for the allowlist).
 */
export async function resolveInvite(kv: KVNamespace, code: string): Promise<string | null> {
  if (!code) return null;
  const tenantId = await kv.get(`${INVITE_PREFIX}${code}`);
  if (!tenantId) return null;
  const record = await kvTenantStore(kv).get(tenantId);
  return record ? record.id : null;
}
