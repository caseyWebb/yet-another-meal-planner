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
  parseInviteRecord,
  resolveTenant,
  directoryFromEnv,
  type Tenant,
} from "./tenant.js";
import { buildKrogerConsentUrl } from "./oauth.js";
import { KROGER_REFRESH_PREFIX, type KvStore } from "./kroger-user.js";
import { SESSION_PREFIX } from "./session.js";
import { getMember, countMembers, insertFoundingMember } from "./members-db.js";
import {
  createSignupInvite,
  listSignupInvites,
  revokeSignupInvite,
  type SignupInviteWithUsage,
} from "./signup-db.js";

const TENANT_PREFIX = "tenant:"; // mirrors src/tenant.ts (the allowlist directory)
const INVITE_PREFIX = "invite:"; // mirrors src/tenant.ts (invite:<code> -> username)

/**
 * Per-tenant D1 tables purged on household-purge. Centralized here (not inlined in the
 * purge loop) so a future per-tenant table is added in ONE place and can't silently
 * escape revocation. `TENANT_TABLES` carry a `tenant` column; `AUTHOR_TABLES` are
 * attributed notes keyed by `author` (member ids — founding member ids equal tenant
 * ids). (Mirrors the retired data-revoke.yml list; recipes are shared corpus, not
 * tenant-owned, so nothing recipe-side is purged.)
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
  "night_vibes", // per-member night-vibe palette (migration 0025)
  "night_vibe_derived", // per-member night-vibe embeddings (migration 0025)
  "pending_proposals", // per-member profile-reconciliation queue (migration 0027)
  "webauthn_credentials", // enrolled passkeys (migration 0046)
  "signup_redemptions", // provenance of a self-service tenant's creating code (migration 0047)
  "members", // member-identity rows incl. the founding member (migration 0058)
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

/**
 * Single-use bootstrap invite lifetime (webauthn-passkey-auth): the window a member has to
 * enroll a passkey with a freshly issued code before the operator must re-issue via `rotate`.
 * Enforced as the KV `expirationTtl`, so an unredeemed code self-expires and cannot linger as a
 * standing secret.
 */
export const BOOTSTRAP_INVITE_TTL_S = 30 * 24 * 60 * 60; // 30 days

/**
 * A single-use bootstrap invite record (JSON), consumed on the member's first passkey enrollment
 * (`src/api/passkey.ts`). `tenant` is the canonical id; `member` is the member the code resolves
 * to (the founding member on today's admin surface); `expires_at` mirrors the KV TTL for
 * display/debugging (the KV TTL is the authoritative clock). `parseInviteRecord` decodes it.
 */
function bootstrapInvite(tenant: string, member: string, nowMs: number): string {
  return JSON.stringify({ v: 1, tenant, member, single_use: true, expires_at: nowMs + BOOTSTRAP_INVITE_TTL_S * 1000 });
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

/**
 * The ONE D2-aware identity a stored credential-adjacent KV record resolves to: its
 * canonical tenant plus its member, with an absent member defaulting to the founding
 * member (`member = tenant`). Shared by the invite and session scans below so
 * household-purge (match by tenant) and member-revoke (match by tenant AND member)
 * can never disagree about which member a legacy record belongs to.
 */
function resolvedPairOf(record: { tenant?: unknown; member?: unknown }): { tenant: string; member: string } | null {
  if (typeof record.tenant !== "string" || !record.tenant) return null;
  const tenant = normalizeTenantId(record.tenant);
  return { tenant, member: typeof record.member === "string" && record.member ? record.member : tenant };
}

/** Delete every `invite:*` whose value resolves to the given tenant — and, when `member` is
 *  given, ONLY that member's codes (D2-aware: a record without a member field belongs to the
 *  founding member). Covers both the JSON bootstrap shape and the legacy bare-string value
 *  (via `parseInviteRecord`). Returns how many were removed. */
async function deleteInvitesMatching(kv: KVNamespace, tenant: string, member?: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix: INVITE_PREFIX, cursor });
    for (const k of res.keys) {
      const parsed = parseInviteRecord(await kv.get(k.name));
      const pair = parsed && resolvedPairOf(parsed);
      if (pair && pair.tenant === tenant && (member === undefined || pair.member === member)) {
        await kv.delete(k.name);
        removed++;
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return removed;
}

/** Delete every invite resolving to a tenant, any member (the household-purge scope). */
export async function deleteInvitesFor(kv: KVNamespace, id: string): Promise<number> {
  return deleteInvitesMatching(kv, id);
}

/** Delete every invite resolving to ONE member (rotation + first-passkey-enrollment
 *  consumption in src/api/passkey.ts, and the member-revoke scope). */
export async function deleteInvitesForMember(kv: KVNamespace, tenant: string, member: string): Promise<number> {
  return deleteInvitesMatching(kv, tenant, member);
}

/** Delete every `session:*` web session whose record resolves to the given tenant — and, when
 *  `member` is given, ONLY that member's sessions (same D2-aware matching as the invite scan) —
 *  the scan-by-value pattern, bounded at friend-group scale (expired sessions age out via TTL).
 *  A malformed record is left to its TTL. */
async function deleteSessionsMatching(kv: KVNamespace, tenant: string, member?: string): Promise<number> {
  let removed = 0;
  let cursor: string | undefined;
  for (;;) {
    const res = await kv.list({ prefix: SESSION_PREFIX, cursor });
    for (const k of res.keys) {
      const value = await kv.get(k.name);
      if (value === null) continue;
      try {
        const pair = resolvedPairOf(JSON.parse(value) as { tenant?: unknown; member?: unknown });
        if (pair && pair.tenant === tenant && (member === undefined || pair.member === member)) {
          await kv.delete(k.name);
          removed++;
        }
      } catch {
        // Not a session record shape — leave it to the KV TTL.
      }
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return removed;
}

/**
 * Onboard a member: write the allowlist entry, the tenant's FOUNDING MEMBER row (id and
 * handle = the canonical tenant id, in the same flow that creates the tenant), and a
 * single-use bootstrap invite mapping resolving to that `(tenant, member)` pair (canonical
 * lowercase, JSON, KV-TTL'd — consumed on the member's first passkey enrollment).
 * Generates a code when none is supplied. The caller surfaces the returned code once; it is
 * never logged.
 */
export async function onboard(
  deps: AdminDeps,
  username: string,
  inviteCode?: string,
): Promise<{ username: string; invite_code: string }> {
  const id = normalizeTenantId(username);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  const code = (inviteCode ?? "").trim() || deps.randomCode();
  const now = Date.now();
  // Claim the id in the strongly-consistent D1 registry (self-service-signup) so a concurrent
  // self-service signup for the same username conflicts and is rejected. The KV allowlist alone
  // is eventually consistent and cannot close that race for a just-onboarded member.
  await deps.db.run(
    `INSERT INTO tenants(id, created_at, via_code) VALUES(?1, ?2, NULL) ON CONFLICT(id) DO NOTHING`,
    id,
    now,
  );
  await insertFoundingMember(deps.db, id, now);
  await deps.tenantKv.put(`${TENANT_PREFIX}${id}`, JSON.stringify({ id }));
  await deps.tenantKv.put(`${INVITE_PREFIX}${code}`, bootstrapInvite(id, id, now), {
    expirationTtl: BOOTSTRAP_INVITE_TTL_S,
  });
  return { username: id, invite_code: code };
}

/**
 * Rotate a member's invite: delete that member's prior invite mapping(s) and mint a new
 * single-use bootstrap resolving to their `(tenant, member)` pair, leaving the allowlist
 * entry, the member row, and per-tenant data untouched. Member-addressed with the FOUNDING
 * member as the default — which keeps the existing tenant-addressed admin endpoint contract
 * unchanged while every household has exactly one member. Errors if the tenant is not on the
 * allowlist. This is the RECOVERY primitive (webauthn-passkey-auth): a bootstrap code
 * authenticates regardless of the `INVITE_GRACE` control, so it admits a member who lost every
 * device or who never enrolled before grace was turned off — they redeem it once to enroll a
 * (new) passkey, which consumes it.
 */
export async function rotate(
  deps: AdminDeps,
  username: string,
  member?: string,
): Promise<{ username: string; invite_code: string }> {
  const id = normalizeTenantId(username);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  if (!(await deps.tenantKv.get(`${TENANT_PREFIX}${id}`))) {
    throw new ToolError("not_found", `No member ${id} on the allowlist`);
  }
  const target = member ?? id;
  await deleteInvitesForMember(deps.tenantKv, id, target);
  const code = deps.randomCode();
  await deps.tenantKv.put(`${INVITE_PREFIX}${code}`, bootstrapInvite(id, target, Date.now()), {
    expirationTtl: BOOTSTRAP_INVITE_TTL_S,
  });
  return { username: id, invite_code: code };
}

/**
 * HOUSEHOLD PURGE — revoke a whole tenant: remove the allowlist entry + every invite
 * mapping + the per-tenant Kroger refresh token + every web session, and purge the
 * per-tenant D1 rows (every TENANT_TABLE, `members` included, plus the FOUNDING
 * member's attributed AUTHOR_TABLES rows — `author = ?1` binds the tenant id, which
 * covers every author while households are single-member; once the People change
 * mints non-founding members (ULID author values) this batch must delete
 * AUTHOR_TABLES via the member-set subquery BEFORE the `members` delete, or their
 * rows orphan) in one batch. After this the household's
 * previously-issued tokens no longer resolve (the allowlist re-check fails), even
 * though they may still exist in the OAuth store — and its session cookies no longer
 * authenticate (the session middleware's allowlist re-check locks them out even
 * before this purge runs; the purge removes the records). The single-member half of
 * the split lifecycle is `revokeMember` below.
 */
export async function revoke(
  deps: AdminDeps,
  username: string,
): Promise<{ username: string; revoked: true; invites_removed: number; sessions_removed: number }> {
  const id = normalizeTenantId(username);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  // Purge per-tenant D1 FIRST. `db.batch` maps any D1 failure to a thrown storage_error,
  // so doing it before we delist means a purge failure aborts here — leaving the member
  // consistently present and the whole revoke safe to retry — rather than locking them
  // off the allowlist while their rows linger orphaned.
  const stmts = [
    ...TENANT_TABLES.map((t) => deps.db.prepare(`DELETE FROM ${t} WHERE tenant = ?1`, id)),
    ...AUTHOR_TABLES.map((t) => deps.db.prepare(`DELETE FROM ${t} WHERE author = ?1`, id)),
    // The tenant uniqueness registry keys on `id`, not `tenant` — freeing the username so it
    // can be re-onboarded or re-claimed (the KV allowlist entry is dropped just below).
    deps.db.prepare(`DELETE FROM tenants WHERE id = ?1`, id),
  ];
  await deps.db.batch(stmts);
  // Then the lock-out: drop the allowlist entry, every invite, the Kroger token, and
  // every web session. (Even a session key this scan missed is dead: the session
  // middleware re-checks the allowlist on every request.)
  await deps.tenantKv.delete(`${TENANT_PREFIX}${id}`);
  const invitesRemoved = await deleteInvitesFor(deps.tenantKv, id);
  await deps.krogerKv.delete(`kroger:refresh:${id}`);
  const sessionsRemoved = await deleteSessionsMatching(deps.tenantKv, id);
  return { username: id, revoked: true, invites_removed: invitesRemoved, sessions_removed: sessionsRemoved };
}

/**
 * MEMBER REVOKE — remove ONE member without disturbing the household: the `members` row,
 * the member's enrolled passkeys, their attributed AUTHOR_TABLES rows (`author = member`),
 * every web session resolving to that member, and every invite resolving to that member
 * (both scans D2-aware: a pre-split record with no member field belongs to the founding
 * member). It does NOT touch the allowlist entry, the `tenants` registry row, the Kroger
 * refresh token, or any household-scoped per-tenant table. The member's outstanding MCP
 * grants die via the resolver's member-liveness check — the same posture household purge
 * takes toward the OAuth store. Revoking a tenant's LAST member is refused (structured
 * `conflict` naming household purge): an allowlisted household with zero members is a
 * half-revoked zombie no flow expects.
 */
export async function revokeMember(
  deps: AdminDeps,
  tenant: string,
  member: string,
): Promise<{ username: string; member: string; revoked: true; invites_removed: number; sessions_removed: number }> {
  const id = normalizeTenantId(tenant);
  if (!id) throw new ToolError("validation_failed", "A username is required");
  const target = (member ?? "").trim();
  if (!target) throw new ToolError("validation_failed", "A member id is required");
  if (!(await getMember(deps.db, target, id))) {
    throw new ToolError("not_found", `No member ${target} in ${id}`);
  }
  if ((await countMembers(deps.db, id)) <= 1) {
    throw new ToolError(
      "conflict",
      `${target} is the last member of ${id} — revoke the household instead (household purge)`,
    );
  }
  // Member-scoped D1 rows FIRST (same retry-safe ordering as household purge): the member
  // row, their passkeys, their authored notes — one transactional batch.
  await deps.db.batch([
    deps.db.prepare(`DELETE FROM members WHERE tenant = ?1 AND id = ?2`, id, target),
    deps.db.prepare(`DELETE FROM webauthn_credentials WHERE tenant = ?1 AND member = ?2`, id, target),
    ...AUTHOR_TABLES.map((t) => deps.db.prepare(`DELETE FROM ${t} WHERE author = ?1`, target)),
  ]);
  // Then the lock-out: the member's invites and sessions. (Even a session this scan missed
  // is dead: the resolver's member-liveness check now fails on every surface.)
  const invitesRemoved = await deleteInvitesForMember(deps.tenantKv, id, target);
  const sessionsRemoved = await deleteSessionsMatching(deps.tenantKv, id, target);
  return { username: id, member: target, revoked: true, invites_removed: invitesRemoved, sessions_removed: sessionsRemoved };
}

// --- Group invite codes (self-service-signup) --------------------------------

/**
 * Mint a multi-use GROUP INVITE CODE authorizing bounded self-service signup. `cap` is the
 * maximum redemptions; `expiresAt` (epoch ms) and `label` are optional. Returns the code once
 * — the caller surfaces it under the same no-log guarantee as onboarding, and it is never
 * written to a log or run summary.
 */
export async function createGroupInvite(
  env: Env,
  input: { cap: number; expiresAt?: number | null; label?: string | null },
  now: number = Date.now(),
): Promise<{ code: string; max_redemptions: number; expires_at: number | null; label: string | null }> {
  const cap = Math.trunc(Number(input.cap));
  if (!Number.isFinite(cap) || cap < 1) {
    throw new ToolError("validation_failed", "A redemption cap of at least 1 is required");
  }
  const expiresAt = input.expiresAt != null ? Math.trunc(Number(input.expiresAt)) : null;
  if (expiresAt != null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    throw new ToolError("validation_failed", "The expiry must be in the future");
  }
  const label = input.label?.trim() ? input.label.trim() : null;
  const code = randomInviteCode();
  await createSignupInvite(env, { code, maxRedemptions: cap, expiresAt, label, now });
  return { code, max_redemptions: cap, expires_at: expiresAt, label };
}

/** Every group invite code with live usage (used/cap, expiry, revoked) + provenance. */
export async function listGroupInvites(env: Env): Promise<SignupInviteWithUsage[]> {
  return listSignupInvites(env);
}

/**
 * Revoke a group invite code so it admits no further signups. Accounts already created
 * through it are ordinary tenants and are NOT touched (they are revoked individually).
 */
export async function revokeGroupInvite(
  env: Env,
  code: string,
  now: number = Date.now(),
): Promise<{ code: string; revoked: boolean }> {
  const trimmed = (code ?? "").trim();
  if (!trimmed) throw new ToolError("validation_failed", "A code is required");
  const { revoked } = await revokeSignupInvite(env, trimmed, now);
  return { code: trimmed, revoked };
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
