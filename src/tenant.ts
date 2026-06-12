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
  /** GitHub App installation covering the data repo. Optional: when unset the auth
   *  provider resolves it at runtime from `dataRepo` (see createInstallationAuth). */
  installationId?: string;
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
  /** Every tenant id on the allowlist — drives group-wide note/rating aggregation (§8.2). */
  list(): Promise<string[]>;
}

const DIRECTORY_PREFIX = "tenant:";
const INVITE_PREFIX = "invite:";

/**
 * Canonical tenant-id form. Usernames are case-insensitive: a member onboarded as
 * "Casey", connecting as "Casey"/"CASEY", and their data subtree `users/casey/`
 * are all one identity. We pick lowercase as that form and apply it at EVERY
 * boundary that derives a key or path from the id — the directory key
 * (`tenant:<id>`), the invite mapping target, the grant prop, the Kroger
 * refresh-token key, and the `users/<id>/` path prefix — so a casing mismatch
 * can't silently split one member's state across two subtrees. Mint writes the
 * lowercase form too (data-onboard.yml), so the KV directory key and the path
 * prefix always agree.
 */
export function normalizeTenantId(tenantId: string): string {
  return tenantId.trim().toLowerCase();
}

/** The single data-repo coordinates, identical for every tenant, from `env`. */
export function dataCoords(env: Env): RepoCoords {
  return { owner: env.DATA_OWNER, repo: env.DATA_REPO, ref: env.DATA_REF };
}

/** This tenant's personal-file path prefix within the data repo (always lowercase). */
export function userPrefix(tenantId: string): string {
  return `users/${normalizeTenantId(tenantId)}`;
}

/** A KV-backed tenant directory. Records are JSON under `tenant:<id>`. */
export function kvTenantStore(kv: KVNamespace): TenantStore {
  return {
    async get(tenantId: string): Promise<TenantRecord | null> {
      // Look up under the normalized key so any casing resolves to the one entry.
      const id = normalizeTenantId(tenantId);
      const raw = await kv.get(`${DIRECTORY_PREFIX}${id}`);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as TenantRecord;
        if (!parsed?.id) return null;
        // Canonicalize the id so the prefix/Kroger key never inherit stored casing.
        return { ...parsed, id: normalizeTenantId(parsed.id) };
      } catch {
        return null;
      }
    },
    async list(): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | undefined;
      // Page through `tenant:*` keys; the id is the key minus the prefix. The
      // allowlist is the source of truth for "who is in the group" (§8.2).
      for (;;) {
        const res = await kv.list({ prefix: DIRECTORY_PREFIX, cursor });
        for (const k of res.keys) ids.push(k.name.slice(DIRECTORY_PREFIX.length));
        if (res.list_complete) break;
        cursor = res.cursor;
      }
      return ids;
    },
  };
}

/** Default directory wiring from the environment (the tenant-directory KV). */
export function directoryFromEnv(env: Env): TenantStore {
  return kvTenantStore(env.TENANT_KV);
}

/** Build the full per-request `Tenant` from a directory record + global env config. */
export function tenantFromRecord(env: Env, record: TenantRecord): Tenant {
  const id = normalizeTenantId(record.id);
  return {
    id,
    dataRepo: dataCoords(env),
    userPrefix: userPrefix(id),
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
  // Normalize before the directory lookup so a mixed-case grant prop (e.g.
  // "Casey") matches the lowercase allowlist key and resolves to `users/casey/`.
  // This is the single defensive point even when `directory` doesn't normalize.
  const id = normalizeTenantId(tenantId);
  const record = await directory.get(id);
  if (!record) {
    return { error: "unauthorized", message: `Username ${id} is not on the allowlist` };
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
  // `get` re-checks the allowlist and returns the canonical (lowercase) id, so the
  // grant prop set from this is already normalized.
  const record = await kvTenantStore(kv).get(tenantId);
  return record ? record.id : null;
}
