// The operator admin surface (operator-admin capability). A static admin SPA at
// `/admin` plus a small JSON API at `/admin/api/*` that performs member
// onboard / revoke / rotate / list directly against the Worker's own bindings —
// the in-Worker replacement for the onboard/revoke GitHub Actions, so a minted
// invite code is shown once to the authenticated operator and never written to a
// git-hosted log.
//
// This is the 4th surface that runs WITHOUT a per-tenant OAuth session (alongside
// the cron, the email() handler, and /health). It is deliberately cross-tenant —
// its job is to manage every tenant — so instead of a tenant token it is gated by
// **Cloudflare Access**: the operator authenticates at the edge, Access injects a
// signed `Cf-Access-Jwt-Assertion`, and `requireAccess` verifies it (signature via
// the team JWKS + audience) as defense-in-depth against a *.workers.dev bypass.
// Opt-in and fails closed: with no Access config the surface is 404 (disabled).
//
// The Access gate covers `/admin*` only; the MCP surface keeps its own OAuth
// provider (multi-tenancy: the MCP-surface identity does not rely on Access).

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env.js";
import { db, type Db } from "./db.js";
import { ToolError } from "./errors.js";
import {
  kvTenantStore,
  normalizeTenantId,
  resolveTenant,
  directoryFromEnv,
  type Tenant,
} from "./tenant.js";
import { listToolsFor, callToolFor } from "./admin-tools.js";
import { listBugReports } from "./bug-reports.js";
import {
  recipeList,
  recipeDetail,
  memberDetail,
  readTable,
  guidanceListing,
  guidanceObject,
} from "./admin-data.js";
import type { KvStore } from "./kroger-user.js";

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
] as const;
export const AUTHOR_TABLES = ["recipe_notes", "store_notes"] as const;

/** Injectable surface the admin operations close over (real bindings in prod, in-memory in tests). */
export interface AdminDeps {
  /** TENANT_KV: the `tenant:*` allowlist + `invite:*` codes. */
  tenantKv: KVNamespace;
  /** KROGER_KV: holds the per-tenant `kroger:refresh:<id>` token revoke must purge. */
  krogerKv: KvStore;
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

/** List the allowlisted member ids (canonical lowercase, sorted) — operational only, no domain data. */
export async function listTenants(deps: AdminDeps): Promise<{ tenants: string[] }> {
  const ids = await kvTenantStore(deps.tenantKv).list();
  return { tenants: [...ids].sort() };
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

// --- HTTP routing -----------------------------------------------------------

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Resolve the operator-chosen "acting as" tenant the SAME way the MCP surface does
 * (allowlist re-check via `resolveTenant`), mapping a missing id to `validation_failed`
 * (400) and a non-member to `not_found` (404) so the tool-console routes fail like the
 * rest of the admin API. The resulting `Tenant` is identical to what `/mcp` builds.
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

/** Route an `/admin/api/*` request to an operation. Throws ToolError; the caller serializes. */
async function routeAdminApi(
  env: Env,
  deps: AdminDeps,
  request: Request,
  url: URL,
): Promise<unknown> {
  const method = request.method;
  const path = url.pathname;

  if (path === "/admin/api/tenants") {
    if (method === "GET") return listTenants(deps);
    if (method === "POST") {
      const body = await readJsonBody(request);
      const result = await onboard(
        deps,
        String(body.username ?? ""),
        body.invite_code != null ? String(body.invite_code) : undefined,
      );
      return { ...result, connector_url: `${url.origin}/mcp` };
    }
    throw new ToolError("unsupported", `Method ${method} not supported on ${path}`);
  }

  const rotateMatch = path.match(/^\/admin\/api\/tenants\/([^/]+)\/rotate$/);
  if (rotateMatch && method === "POST") {
    const result = await rotate(deps, decodeURIComponent(rotateMatch[1]));
    return { ...result, connector_url: `${url.origin}/mcp` };
  }

  const tenantMatch = path.match(/^\/admin\/api\/tenants\/([^/]+)$/);
  if (tenantMatch && method === "DELETE") {
    return revoke(deps, decodeURIComponent(tenantMatch[1]));
  }

  // Bug reports: the operator's review queue for agent-filed reports (report_bug → D1).
  if (path === "/admin/api/bug-reports") {
    if (method === "GET") return { reports: await listBugReports(deps.db) };
    throw new ToolError("unsupported", `Method ${method} not supported on ${path}`);
  }

  // Data explorer (operator-data-explorer): read-only, cross-tenant views over D1 + the
  // R2 corpus. Every route is GET — a write method is `unsupported` (405) — and the whole
  // block sits inside `handleAdmin`, so it inherits the Access gate (404 when disabled)
  // with no auth code of its own. Member resolution reuses the same allowlist check the
  // tool console uses (`resolveActingTenant`), so an unknown id is `not_found` (404).
  if (path.startsWith("/admin/api/data/")) {
    if (method !== "GET") {
      throw new ToolError("unsupported", `Method ${method} not supported on ${path}`);
    }
    const rest = path.slice("/admin/api/data/".length);

    if (rest === "recipes") return recipeList(env);
    const recipeMatch = rest.match(/^recipes\/([^/]+)$/);
    if (recipeMatch) return recipeDetail(env, decodeURIComponent(recipeMatch[1]));

    const memberMatch = rest.match(/^members\/([^/]+)$/);
    if (memberMatch) {
      const tenant = await resolveActingTenant(env, decodeURIComponent(memberMatch[1]));
      return memberDetail(env, tenant.id);
    }

    // Guidance R2 browse (exact paths matched before the generic corpus/<table>).
    if (rest === "corpus/guidance") {
      return guidanceListing(env, url.searchParams.get("prefix") ?? undefined);
    }
    if (rest === "corpus/guidance/object") {
      const p = url.searchParams.get("path");
      if (!p) throw new ToolError("validation_failed", "A guidance object path is required");
      return guidanceObject(env, p);
    }
    const corpusMatch = rest.match(/^corpus\/([^/]+)$/);
    if (corpusMatch) return readTable(env, "corpus", decodeURIComponent(corpusMatch[1]));

    const discoveryMatch = rest.match(/^discovery\/([^/]+)$/);
    if (discoveryMatch) return readTable(env, "discovery", decodeURIComponent(discoveryMatch[1]));

    const systemMatch = rest.match(/^system\/([^/]+)$/);
    if (systemMatch) return readTable(env, "system", decodeURIComponent(systemMatch[1]));

    throw new ToolError("not_found", `No data route for ${method} ${path}`);
  }

  // Tool console (the operator dev workbench): list + invoke the live MCP tool surface
  // AS a chosen tenant, over the same `buildServer` path `/mcp` uses (src/admin-tools.ts).
  if (path === "/admin/api/tools") {
    if (method === "GET") {
      const tenant = await resolveActingTenant(env, url.searchParams.get("tenant"));
      return listToolsFor(env, tenant);
    }
    throw new ToolError("unsupported", `Method ${method} not supported on ${path}`);
  }

  const toolMatch = path.match(/^\/admin\/api\/tools\/([^/]+)$/);
  if (toolMatch && method === "POST") {
    const body = await readJsonBody(request);
    const tenant = await resolveActingTenant(env, body.tenant != null ? String(body.tenant) : null);
    // Only a JSON object is valid `arguments`; anything else is an empty arg set, which
    // the tool's own input schema then accepts or rejects (validation stays the tool's).
    const args =
      body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments)
        ? (body.arguments as Record<string, unknown>)
        : {};
    return callToolFor(env, tenant, decodeURIComponent(toolMatch[1]), args);
  }

  throw new ToolError("not_found", `No admin route for ${method} ${path}`);
}

function statusFor(err: ToolError): number {
  if (err.code === "not_found") return 404;
  if (err.code === "validation_failed") return 400;
  if (err.code === "unsupported") return 405;
  return 500;
}

/**
 * Handle an `/admin*` request: gate on Cloudflare Access, then either run a JSON
 * API operation or serve the static SPA from the ASSETS binding. The static shell
 * is Access-gated here too (this handler runs worker-first for `/admin*`), so an
 * unconfigured deployment serves nothing — 404.
 */
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const access = await requireAccess(request, env);
  if (access.status === "disabled") return new Response("Not found", { status: 404 });
  if (access.status === "denied") return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/admin/api/")) {
    const deps: AdminDeps = {
      tenantKv: env.TENANT_KV,
      krogerKv: env.KROGER_KV as unknown as KvStore,
      db: db(env),
      randomCode: randomInviteCode,
    };
    try {
      return json(await routeAdminApi(env, deps, request, url), 200);
    } catch (e) {
      if (e instanceof ToolError) return json(e.toShape(), statusFor(e));
      const message = e instanceof Error ? e.message : String(e);
      return json({ error: "upstream_unavailable", message }, 500);
    }
  }

  // Static SPA: serve from the ASSETS binding (already past the Access gate). Pass the
  // request through UNCHANGED and let Static Assets' html_handling resolve it — `/admin`
  // → `/admin/` (trailing-slash redirect, so the page's `/admin/elm.js` resolves),
  // `/admin/` → index.html, `/admin/elm.js` → the bundle.
  //
  // The SPA is client-routed (`Browser.application`), so a GET for an in-app route that
  // maps to NO asset (e.g. `/admin/dev/tools/place_order`) comes back 404 from ASSETS.
  // That is a client route: serve the SPA shell CONTENT at the original URL so the deep
  // link / refresh resolves client-side. We fetch the canonical `/admin/` (html_handling
  // returns index.html with 200) rather than `/admin/index.html` (which 307s back to
  // `/admin/`, and returning that redirect would drop the client route from the URL).
  // `env.ASSETS.fetch` bypasses run_worker_first, so this never re-enters and loops.
  if (request.method === "GET" || request.method === "HEAD") {
    const direct = await env.ASSETS.fetch(request);
    if (direct.status !== 404) return direct;
    // A 404 for a path whose last segment has a file extension (`/admin/elm.js`) is a
    // GENUINE asset miss — keep it a 404 rather than masking it with the HTML shell (which
    // would hand back `text/html` 200 under a `.js` URL on a broken deploy). Only
    // extension-less paths are client routes; serve those the shell so they resolve.
    const lastSegment = path.split("/").pop() ?? "";
    if (lastSegment.includes(".")) return direct;
    const shellUrl = new URL(request.url);
    shellUrl.pathname = "/admin/";
    shellUrl.search = "";
    return env.ASSETS.fetch(
      new Request(shellUrl.toString(), { method: request.method, headers: request.headers }),
    );
  }
  return new Response("Method not allowed", { status: 405 });
}
