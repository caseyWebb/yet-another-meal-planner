// Multi-tenancy foundation (multi-tenancy capability). A `Tenant` is the
// per-request identity context every tool closes over. All per-tenant state lives in
// D1 keyed by tenant id; the shared authored corpus lives in R2 (one bucket every
// tenant reads/writes through the corpus store). There is no GitHub data repo on the
// data path — identity is just the tenant id.
//
// The tenant DIRECTORY is the operator-curated allowlist of usernames, in KV, so
// it is operational mapping, never domain data (D9). The OAuth provider (Section 3)
// validates the access token and hands the MCP handler a `tenantId` via grant
// `props`; `resolveTenant` then re-checks that id against the allowlist and builds
// the `Tenant`. The identity STEP is an operator-issued **invite code** (D2):
// `resolveInvite` maps a code to an allowlisted username at the authorize step.

import type { Env } from "./env.js";
import { db } from "./db.js";

/** The per-request tenant context. Assembled by `resolveTenant`. */
export interface Tenant {
  /** Opaque operator-assigned username, e.g. "alice". Allowlist key + Kroger key + D1 tenant column. */
  id: string;
}

/** Structured rejection returned when a bearer token resolves to no tenant. */
export interface Unauthorized {
  error: "unauthorized";
  message: string;
}

/**
 * What the directory persists per tenant. The data repo and installation are
 * derivable globally (from `env` + the id), so the record is just the allowlist
 * entry — `resolveTenant` joins the rest on.
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
 * "Casey" who connects as "Casey"/"CASEY" is one identity. We pick lowercase as
 * that form and apply it at EVERY boundary that derives a key from the id — the
 * directory key (`tenant:<id>`), the invite mapping target, the grant prop, and the
 * Kroger refresh-token key — so a casing mismatch can't silently split one member's
 * state across two keys. Mint writes the lowercase form too (the admin onboard in
 * `src/admin.ts`), so the KV directory key and the derived keys always agree.
 */
export function normalizeTenantId(tenantId: string): string {
  return tenantId.trim().toLowerCase();
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
        // Normalize on the way out, matching get(): cross-tenant group-aggregation
        // tools derive `users/<id>/...` paths and `profile:<id>` keys from these ids,
        // so they must be canonical even if a directory key was written with casing.
        for (const k of res.keys)
          ids.push(normalizeTenantId(k.name.slice(DIRECTORY_PREFIX.length)));
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

/** Build the full per-request `Tenant` from a directory record. */
export function tenantFromRecord(_env: Env, record: TenantRecord): Tenant {
  return { id: normalizeTenantId(record.id) };
}

// How stale `last_seen_at` must be before a resolution re-writes it (admin-ui-redesign-members).
// Keeps the write a THROTTLED, best-effort signal rather than a write on every tool call — a
// chatty session costs at most one `tenant_activity` write per hour, not one per MCP request.
const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Best-effort, throttled tenant-activity touch: write-once `first_seen_at`, and refresh
 * `last_seen_at` only when the stored value is missing or older than the throttle window.
 * Never throws — a `tenant_activity` write failure must not fail the MCP request it rides
 * alongside (D4: tools/identity resolution stay throw-free on storage hiccups).
 */
export async function touchTenantActivity(env: Env, tenantId: string, nowMs = Date.now()): Promise<void> {
  try {
    const row = await db(env).first<{ first_seen_at: number; last_seen_at: number }>(
      "SELECT first_seen_at, last_seen_at FROM tenant_activity WHERE tenant = ?1",
      tenantId,
    );
    if (!row) {
      await db(env).run(
        "INSERT INTO tenant_activity (tenant, first_seen_at, last_seen_at) VALUES (?1, ?2, ?3) " +
          "ON CONFLICT(tenant) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        tenantId,
        nowMs,
        nowMs,
      );
      return;
    }
    if (nowMs - row.last_seen_at >= LAST_SEEN_THROTTLE_MS) {
      // An upsert (not a bare UPDATE) so the write is idempotent against a racing first-touch
      // INSERT from a near-simultaneous request — "eventually consistent" is an accepted
      // trade-off for this best-effort signal (design.md Risks).
      await db(env).run(
        "INSERT INTO tenant_activity (tenant, first_seen_at, last_seen_at) VALUES (?1, ?2, ?3) " +
          "ON CONFLICT(tenant) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        tenantId,
        nowMs,
        nowMs,
      );
    }
  } catch (e) {
    // Best-effort: a storage hiccup here must never fail tenant resolution — but a genuine
    // write failure must not present identically to "no activity yet" (design.md Risk: a
    // silently swallowed error here made the Members "awaiting connection" status
    // undiagnosable). Log it; never throw, never add latency to the caller.
    console.warn(`[tenant] touchTenantActivity write failed for ${tenantId}:`, e instanceof Error ? e.message : e);
  }
}

/**
 * Resolve a provider-validated `tenantId` (from grant `props`) to its `Tenant`,
 * re-checking it against the allowlist. Returns a structured `unauthorized` when
 * the id is missing or absent from the directory. No tool runs until this succeeds.
 *
 * `recordSeen` (default false) fires the best-effort, throttled `tenant_activity` touch —
 * pass `true` only from the MCP request path (`src/index.ts`), NOT from operator-driven
 * resolutions (the admin Kroger-consent mint, the Data explorer's member lookup), which
 * resolve a tenant without that tenant actually being active.
 */
export async function resolveTenant(
  env: Env,
  tenantId: string | null | undefined,
  directory: TenantStore,
  recordSeen = false,
): Promise<Tenant | Unauthorized> {
  if (!tenantId) {
    return { error: "unauthorized", message: "No tenant on the request" };
  }
  // Normalize before the directory lookup so a mixed-case grant prop (e.g.
  // "Casey") matches the lowercase allowlist key (the one canonical entry).
  // This is the single defensive point even when `directory` doesn't normalize.
  const id = normalizeTenantId(tenantId);
  const record = await directory.get(id);
  if (!record) {
    return { error: "unauthorized", message: `Username ${id} is not on the allowlist` };
  }
  if (recordSeen) {
    // Fire-and-forget: never let the activity touch delay or fail tenant resolution.
    void touchTenantActivity(env, id);
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
