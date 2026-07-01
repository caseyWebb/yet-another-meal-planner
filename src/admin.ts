// The operator admin surface (operator-admin capability) — the Cloudflare Access gate plus
// the member-lifecycle operations (onboard / revoke / rotate / list) and the Kroger
// consent-link bootstrap, performed directly against the Worker's own bindings. These are
// the in-Worker replacement for the onboard/revoke GitHub Actions, so a minted invite code
// is shown once to the authenticated operator and never written to a git-hosted log. The
// HTTP surface itself is the Hono app (`src/admin/app.tsx`), which SSRs every page and calls
// these functions directly; this module owns the gate + the operations, not the routing.
//
// This is the 4th surface that runs WITHOUT a per-tenant OAuth session (alongside the cron,
// the email() handler, and /health). It is deliberately cross-tenant — its job is to manage
// every tenant — so instead of a tenant token it is gated by **Cloudflare Access**: the
// operator authenticates at the edge, Access injects a signed `Cf-Access-Jwt-Assertion`, and
// `requireAccess` verifies it (signature via the team JWKS + audience) as defense-in-depth
// against a *.workers.dev bypass. Opt-in and fails closed: with no Access config the surface
// is 404 (disabled).
//
// The Access gate covers `/admin*` only; the MCP surface keeps its own OAuth
// provider (multi-tenancy: the MCP-surface identity does not rely on Access).

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env.js";
import type { Db } from "./db.js";
import { ToolError } from "./errors.js";
import {
  kvTenantStore,
  normalizeTenantId,
  resolveTenant,
  directoryFromEnv,
  type Tenant,
} from "./tenant.js";
import { buildKrogerConsentUrl } from "./oauth.js";
import { KROGER_REFRESH_PREFIX, type KvStore } from "./kroger-user.js";

const TENANT_PREFIX = "tenant:"; // mirrors src/tenant.ts (the allowlist directory)
const INVITE_PREFIX = "invite:"; // mirrors src/tenant.ts (invite:<code> -> username)

/**
 * Per-tenant D1 tables purged on revoke. Centralized here (not inlined in the
 * purge loop) so a future per-tenant table is added in ONE place and can't silently
 * escape revocation. `TENANT_TABLES` carry a `tenant` column; `AUTHOR_TABLES` are
 * attributed notes keyed by `author`. (Mirrors the retired data-revoke.yml list;
 * recipes are shared corpus, not tenant-owned, so nothing recipe-side is purged.)
 */
export const TENANT_TABLES = [
  "profile",
  "brand_prefs",
  "kitchen_equipment",
  "staples",
  "overlay",
  "ready_to_eat",
  "stockup",
  "pantry",
  "meal_plan",
  "grocery_list",
  "cooking_log",
  "discovery_matches", // per-member discovery attribution (migration 0016)
  "taste_derived", // per-member taste vector (migration 0016)
] as const;
export const AUTHOR_TABLES = ["recipe_notes", "store_notes"] as const;

/** Injectable surface the admin operations close over (real bindings in prod, in-memory in tests). */
export interface AdminDeps {
  /** TENANT_KV: the `tenant:*` allowlist + `invite:*` codes. */
  tenantKv: KVNamespace;
  /** KROGER_KV: holds the per-tenant `kroger:refresh:<id>` token revoke must purge. */
  krogerKv: KvStore;
  /** OAUTH_KV: the `@cloudflare/workers-oauth-provider` store — read (never written) here for its
   *  `grant:<userId>:<grantId>` keys, the source of the roster's active/pending status. */
  oauthKv: KvStore;
  /** The D1 access layer (src/db.ts) for the per-tenant purge. */
  db: Db;
  /** Mint a fresh invite code (16 hex chars, matching the retired workflow's `openssl rand -hex 8`). */
  randomCode: () => string;
}

/** A random invite code: 8 random bytes as 16 lowercase hex chars. */
export function randomInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Cloudflare Access gate -------------------------------------------------

/** Gate outcome: `ok` admit, `disabled` -> 404 (opt-in unset), `denied` -> 403 (bad/absent assertion). */
export type AccessResult =
  | { status: "ok"; email?: string }
  | { status: "disabled" }
  | { status: "denied" };

type KeySetGetter = (teamDomain: string) => ReturnType<typeof createRemoteJWKSet>;

// One remote JWKS per team domain (jose caches the keys with a cooldown).
const remoteJwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const defaultKeySet: KeySetGetter = (team) => {
  let set = remoteJwks.get(team);
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    remoteJwks.set(team, set);
  }
  return set;
};

/** True when the request's URL host is loopback — the only place the dev bypass may engage. */
export function isLoopbackHost(request: Request): boolean {
  // `URL.hostname` lowercases, strips the port, and brackets IPv6 (`[::1]`), so those forms
  // are what we match; the bare `::1` arm only covers a hand-built host (defensive, not reached via URL).
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/** Parse `ACCESS_ALLOWED_EMAILS` into a normalized (trimmed, lowercased, non-empty) list. */
function parseAllowedEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The gate's decision for a request that presents NO valid assertion, as a function of
 * config + host. The SINGLE source of truth shared by `requireAccess` (the live gate) and
 * `adminPosture` (the `/health` report) so the two can never drift:
 *   - `gated`      — Access is configured; a real request must present a valid assertion.
 *   - `dev-bypass` — Access unset, `ADMIN_DEV_BYPASS=1`, AND the host is loopback (local dev only).
 *   - `disabled`   — anything else (incl. the bypass flag on a non-loopback/deployed host) → 404.
 */
export type GateDisposition = "gated" | "dev-bypass" | "disabled";
export function adminGateDisposition(env: Env, opts: { isLoopback: boolean }): GateDisposition {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (team && aud) return "gated";
  if (env.ADMIN_DEV_BYPASS === "1" && opts.isLoopback) return "dev-bypass";
  return "disabled";
}

/**
 * Verify a request's Cloudflare Access assertion. When Access is unconfigured the surface is
 * disabled (404) — unless `ADMIN_DEV_BYPASS=1` AND the request host is loopback, the local-dev
 * escape so `wrangler dev` can serve the panel; the loopback gate makes it structurally inert in
 * any deployed context, regardless of the flag. With Access configured, a missing/invalid
 * `Cf-Access-Jwt-Assertion` is denied (403); and when `ACCESS_ALLOWED_EMAILS` is set, a verified
 * assertion whose `email` claim is absent or off the list is denied too (defense-in-depth beyond
 * the Access policy). `getKeySet` is injectable so the dev/disabled/denied paths test offline.
 */
export async function requireAccess(
  request: Request,
  env: Env,
  getKeySet: KeySetGetter = defaultKeySet,
): Promise<AccessResult> {
  const disposition = adminGateDisposition(env, { isLoopback: isLoopbackHost(request) });
  if (disposition === "disabled") return { status: "disabled" };
  if (disposition === "dev-bypass") {
    console.warn(
      "[admin] ADMIN_DEV_BYPASS engaged — serving /admin without Access verification (loopback dev only)",
    );
    return { status: "ok" };
  }
  // disposition === "gated": Access is configured, so both vars are present (re-read for jose).
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!team || !aud) return { status: "disabled" }; // defensive; "gated" implies both set
  const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? "";
  if (!token) return { status: "denied" };
  try {
    const { payload } = await jwtVerify(token, getKeySet(team), {
      issuer: `https://${team}`,
      audience: aud,
      clockTolerance: "5s",
    });
    const email = typeof payload.email === "string" ? payload.email : undefined;
    const allow = parseAllowedEmails(env.ACCESS_ALLOWED_EMAILS);
    if (allow.length > 0 && (!email || !allow.includes(email.trim().toLowerCase()))) {
      return { status: "denied" };
    }
    return { status: "ok", email };
  } catch {
    return { status: "denied" };
  }
}

/** The admin gate's posture, as tenant-clean booleans for `/health` (never the emails themselves). */
export interface AdminPosture {
  /** Both Access vars set — the surface is gated by a verified Access assertion. */
  access_configured: boolean;
  /** An `ACCESS_ALLOWED_EMAILS` allowlist is configured (defense-in-depth beyond the Access policy). */
  email_allowlist: boolean;
  /** `ADMIN_DEV_BYPASS` is set (inert in any deployed context, but surfaced so a stray prod flag shows). */
  dev_bypass_set: boolean;
  /**
   * The surface's only safeguard is the loopback dev-guard: Access unset AND the dev bypass set.
   * An alarm-worthy deployment misconfiguration — the gate still 404s on a deployed host, but the
   * config is surfaced so health degrades. Derived from the shared disposition (asking "could the
   * bypass admit?"), so a regression that drops the loopback guard flips this too.
   */
  exposed: boolean;
}

/** Compute the admin gate posture from env alone (`exposed` asks the deployed-risk question). */
export function adminPosture(env: Env): AdminPosture {
  return {
    access_configured: !!(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim()),
    email_allowlist: parseAllowedEmails(env.ACCESS_ALLOWED_EMAILS).length > 0,
    dev_bypass_set: env.ADMIN_DEV_BYPASS === "1",
    exposed: adminGateDisposition(env, { isLoopback: true }) === "dev-bypass",
  };
}

// --- Member lifecycle operations (pure over AdminDeps) ----------------------

/** One member's roster row — operational status only, never per-tenant domain data. */
export interface TenantRosterRow {
  id: string;
  /** True iff `id === env.OWNER_TENANT_ID`. Unset env -> no member is owner. */
  owner: boolean;
  /** `active` once the member has a persisted OAuth grant (completed the Claude.ai
   *  connection at least once); `pending` until then, or again if the grant is revoked. */
  status: "active" | "pending";
  /** Whether a Kroger refresh token exists for this member (`kroger:refresh:<id>` in KROGER_KV). */
  kroger: "linked" | "unlinked";
  /** First-seen epoch ms (≈ onboarding/first connection), or null for a pending member. */
  joined: number | null;
  /** Most recent best-effort activity touch (epoch ms), or null for a pending member. */
  lastActive: number | null;
  /** COUNT(*) over cooking_log for this tenant. */
  cooked: number;
  /** COUNT(*) over overlay WHERE favorite = 1 for this tenant. */
  favorites: number;
}

/** The `@cloudflare/workers-oauth-provider` grant-key prefix — see `oauthGrantTenantIds`. */
const OAUTH_GRANT_PREFIX = "grant:";

/**
 * Derive the set of tenant ids with at least one persisted OAuth grant in `OAUTH_KV`, by a
 * single prefix `list()` over `grant:` (mirroring the Kroger-linked `listAllKeys` pattern —
 * one unbounded-pagination pass, no per-tenant get). `@cloudflare/workers-oauth-provider`
 * persists every completed authorization under the key `grant:<userId>:<grantId>` (see
 * `saveGrantWithTTL`/`listUserGrants` in the installed package, and `src/authorize.ts`'s
 * `completeAuthorization({ userId: tenantId, ... })`, which is what puts the tenant id in that
 * `userId` slot) — so the tenant id is the FIRST `:`-delimited segment after the `grant:`
 * prefix, not a fixed-length suffix (the grant id follows it and may itself contain no `:`,
 * but we only need the segment immediately after the prefix regardless).
 *
 * A grant, not a live/unexpired token, is the "connected" signal: access/refresh tokens
 * rotate and expire, but the grant persists until explicitly revoked (e.g. the member
 * disconnects in Claude.ai), so its presence is the durable "has this member ever completed
 * the OAuth connection" fact this function answers.
 *
 * THROW-FREE: a KV list failure degrades to an empty set (every tenant reports `pending`)
 * rather than throwing — the roster must still render every allowlisted member, and
 * mislabeling a connected member as pending during a transient KV outage is preferable to
 * the whole roster failing to load.
 */
export async function oauthGrantTenantIds(kv: KvStore): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    let cursor: string | undefined;
    for (;;) {
      const res = await kv.list({ prefix: OAUTH_GRANT_PREFIX, cursor });
      for (const k of res.keys) {
        const rest = k.name.slice(OAUTH_GRANT_PREFIX.length);
        const idx = rest.indexOf(":");
        if (idx < 0) continue; // malformed key (no `<userId>:<grantId>` split) — skip rather than derive a corrupted tenant id
        const userId = rest.slice(0, idx);
        if (userId) ids.add(userId);
      }
      if (res.list_complete) break;
      cursor = res.cursor;
    }
  } catch {
    return new Set();
  }
  return ids;
}

/**
 * List every allowlisted member as a structured roster row (operational status only, no
 * domain data — see the "Tenant listing is operational-only" requirement). Assembled from:
 *  - the `tenant:*` KV allowlist (ids),
 *  - a single prefix `list` over OAUTH_KV's `grant:<userId>:<grantId>` keys (active/pending
 *    status — see `oauthGrantTenantIds`; degrades to "pending" on a KV failure, never throws),
 *  - `tenant_activity` (joined/last-active ONLY — no longer the status source),
 *  - a single prefix `list` over KROGER_KV (Kroger-linked status, no N+1 gets),
 *  - two single `GROUP BY tenant` D1 aggregates (cooked, favorites — no N+1 queries),
 *  - `env.OWNER_TENANT_ID` (owner flag; unset => no member is owner).
 */
export async function listTenants(env: Env, deps: AdminDeps): Promise<{ tenants: TenantRosterRow[] }> {
  const ids = [...(await kvTenantStore(deps.tenantKv).list())].sort();

  const [activityRows, connectedIds, krogerKeys, cookedRows, favoriteRows] = await Promise.all([
    deps.db.all<{ tenant: string; first_seen_at: number; last_seen_at: number }>(
      "SELECT tenant, first_seen_at, last_seen_at FROM tenant_activity",
    ),
    oauthGrantTenantIds(deps.oauthKv),
    listAllKeys(deps.krogerKv, KROGER_REFRESH_PREFIX),
    deps.db.all<{ tenant: string; n: number }>("SELECT tenant, COUNT(*) AS n FROM cooking_log GROUP BY tenant"),
    deps.db.all<{ tenant: string; n: number }>(
      "SELECT tenant, COUNT(*) AS n FROM overlay WHERE favorite = 1 GROUP BY tenant",
    ),
  ]);

  const activityById = new Map(activityRows.map((r) => [r.tenant, r]));
  const krogerLinked = new Set(krogerKeys.map((name) => name.slice(KROGER_REFRESH_PREFIX.length)));
  const cookedById = new Map(cookedRows.map((r) => [r.tenant, r.n]));
  const favoritesById = new Map(favoriteRows.map((r) => [r.tenant, r.n]));
  const ownerId = env.OWNER_TENANT_ID ? normalizeTenantId(env.OWNER_TENANT_ID) : null;

  const tenants: TenantRosterRow[] = ids.map((id) => {
    const activity = activityById.get(id);
    return {
      id,
      owner: ownerId !== null && id === ownerId,
      status: connectedIds.has(id) ? "active" : "pending",
      kroger: krogerLinked.has(id) ? "linked" : "unlinked",
      joined: activity?.first_seen_at ?? null,
      lastActive: activity?.last_seen_at ?? null,
      cooked: cookedById.get(id) ?? 0,
      favorites: favoritesById.get(id) ?? 0,
    };
  });
  return { tenants };
}

/** Page through every key under `prefix` in one KV namespace, returning the full key-name list. */
async function listAllKeys(kv: KvStore, prefix: string): Promise<string[]> {
  const names: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix, cursor });
    for (const k of res.keys) names.push(k.name);
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return names;
}

/** Delete every `invite:*` whose value resolves to `id`. Returns how many were removed. */
async function deleteInvitesFor(kv: KVNamespace, id: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix: INVITE_PREFIX, cursor });
    for (const k of res.keys) {
      const value = await kv.get(k.name);
      if (value !== null && normalizeTenantId(value) === id) {
        await kv.delete(k.name);
        removed++;
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return removed;
}

/**
 * Onboard a member: write the allowlist entry + an invite mapping (canonical
 * lowercase). Generates a code when none is supplied. The caller surfaces the
 * returned code once; it is never logged.
 */
export async function onboard(
  deps: AdminDeps,
  username: string,
  inviteCode?: string,
): Promise<{ username: string; invite_code: string }> {
  const id = normalizeTenantId(username);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  const code = (inviteCode ?? "").trim() || deps.randomCode();
  await deps.tenantKv.put(`${TENANT_PREFIX}${id}`, JSON.stringify({ id }));
  await deps.tenantKv.put(`${INVITE_PREFIX}${code}`, id);
  return { username: id, invite_code: code };
}

/**
 * Rotate a member's invite: delete their prior invite mapping(s) and mint a new
 * one, leaving the allowlist entry and per-tenant data untouched. Errors if the
 * member is not on the allowlist.
 */
export async function rotate(
  deps: AdminDeps,
  username: string,
): Promise<{ username: string; invite_code: string }> {
  const id = normalizeTenantId(username);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  if (!(await deps.tenantKv.get(`${TENANT_PREFIX}${id}`))) {
    throw new ToolError("not_found", `No member ${id} on the allowlist`);
  }
  await deleteInvitesFor(deps.tenantKv, id);
  const code = deps.randomCode();
  await deps.tenantKv.put(`${INVITE_PREFIX}${code}`, id);
  return { username: id, invite_code: code };
}

/**
 * Revoke a member completely: remove the allowlist entry + every invite mapping +
 * the per-tenant Kroger refresh token, and purge the per-tenant D1 rows in one
 * batch. After this the member's previously-issued token no longer resolves (the
 * allowlist re-check fails), even though it may still exist in the OAuth store.
 */
export async function revoke(
  deps: AdminDeps,
  username: string,
): Promise<{ username: string; revoked: true; invites_removed: number }> {
  const id = normalizeTenantId(username);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  // Purge per-tenant D1 FIRST. `db.batch` maps any D1 failure to a thrown storage_error,
  // so doing it before we delist means a purge failure aborts here — leaving the member
  // consistently present and the whole revoke safe to retry — rather than locking them
  // off the allowlist while their rows linger orphaned.
  const stmts = [
    ...TENANT_TABLES.map((t) => deps.db.prepare(`DELETE FROM ${t} WHERE tenant = ?1`, id)),
    ...AUTHOR_TABLES.map((t) => deps.db.prepare(`DELETE FROM ${t} WHERE author = ?1`, id)),
  ];
  await deps.db.batch(stmts);
  // Then the lock-out: drop the allowlist entry, every invite, and the Kroger token.
  await deps.tenantKv.delete(`${TENANT_PREFIX}${id}`);
  const invitesRemoved = await deleteInvitesFor(deps.tenantKv, id);
  await deps.krogerKv.delete(`kroger:refresh:${id}`);
  return { username: id, revoked: true, invites_removed: invitesRemoved };
}

// --- Kroger consent-link bootstrap ------------------------------------------

/**
 * Resolve the operator-chosen "acting as" tenant the SAME way the MCP surface does
 * (allowlist re-check via `resolveTenant`), mapping a missing id to `validation_failed`
 * (400) and a non-member to `not_found` (404). The resulting `Tenant` is identical to
 * what `/mcp` builds.
 */
async function resolveActingTenant(env: Env, tenantId: string | null): Promise<Tenant> {
  if (!tenantId || !tenantId.trim()) {
    throw new ToolError("validation_failed", "An acting-as tenant is required");
  }
  const resolved = await resolveTenant(env, tenantId, directoryFromEnv(env));
  if ("error" in resolved) {
    throw new ToolError("not_found", resolved.message);
  }
  return resolved;
}

/**
 * Mint a single-use Kroger consent link bound to a chosen ALLOWLISTED member — the same nonce
 * the `kroger_login_url` MCP tool mints (kroger-user-auth), so the operator can link a member
 * who has no `/mcp` session yet. Resolved by the same allowlist check the MCP surface uses
 * (an unknown id is `not_found`); never exposed as an MCP tool. The nonce is not logged — it
 * rides only in the returned url, carried in this Access-authenticated response.
 */
export async function krogerConsentLink(
  env: Env,
  deps: AdminDeps,
  tenantId: string,
  origin: string,
): Promise<{ url: string }> {
  const tenant = await resolveActingTenant(env, tenantId);
  return { url: await buildKrogerConsentUrl(deps.krogerKv, origin, tenant.id) };
}
