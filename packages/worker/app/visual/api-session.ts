// API-session helpers for specs that drive the REAL member API alongside the browser
// (households-friends-and-people-page): a second identity's login, and a per-run-fresh
// signup. The session token rides an EXPLICIT cookie header — the `__Host-` session
// cookie is Secure, and Playwright's APIRequestContext cookie jar drops Secure cookies
// over the harness's plain-http origin (the browser applies the trustworthy-localhost
// exception; the API jar does not).
import { request as apiRequest, type APIRequestContext } from "@playwright/test";
import { SEED } from "../../admin/visual/seed.mjs";

export const CSRF = { "X-App-Csrf": "1" };

/** A per-context synthetic client IP. The people/join limiters key per-IP with windows
 *  up to a day, and their KV counters live in `.wrangler/state` — shared across local
 *  re-runs against a reused server. A unique spoofed `CF-Connecting-IP` per context
 *  keeps each run inside its own buckets (local dev trusts the header). */
export function uniqueIp(): string {
  const b = () => 1 + Math.floor(Math.random() * 250);
  return `10.${b()}.${b()}.${b()}`;
}

/** Build a cookie-carrying context from a login response's Set-Cookie. */
async function contextFromLogin(
  baseURL: string,
  res: { ok(): boolean; status(): number; headersArray(): { name: string; value: string }[] },
): Promise<APIRequestContext> {
  if (!res.ok()) throw new Error(`api login failed (${res.status()})`);
  const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie")?.value ?? "";
  const token = /__Host-session=([^;]+)/.exec(setCookie)?.[1];
  if (!token) throw new Error("login set no session cookie");
  return apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `__Host-session=${token}`, "CF-Connecting-IP": uniqueIp() },
  });
}

/** An API session for a seeded identity via its invite code. NEVER call this with the
 *  ACTIVE member's invite: passkey.spec's first enrollment CONSUMES every invite
 *  resolving to that member (consume-on-first-enrollment), so on a fresh state dir the
 *  code is dead by the time the authed project runs — use `activeMemberContext`. */
export async function memberLogin(baseURL: string, inviteCode: string): Promise<APIRequestContext> {
  const login = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "CF-Connecting-IP": uniqueIp() } });
  const res = await login.post("/api/session", { headers: CSRF, data: { invite_code: inviteCode } });
  const ctx = await contextFromLogin(baseURL, res);
  await login.dispose();
  return ctx;
}

/**
 * An API session for the SEEDED ACTIVE MEMBER (casey), from the same deterministic
 * server-side session setup.mjs mints for the browser storageState — no login HTTP, no
 * dependence on the consumable invite code, order-independent (app-ui-suite-
 * deterministic-auth). The cookie rides an explicit header (the Secure-cookie/http
 * jar limitation above); setup seeds the session into BOTH servers' KV, so this works
 * against the default and saas baseURLs alike.
 */
export async function activeMemberContext(baseURL: string): Promise<APIRequestContext> {
  // Load the storageState through Playwright itself (the harness tsconfig carries no
  // node types, so no node:fs here) and lift the cookie into an explicit header.
  const probe = await apiRequest.newContext({
    baseURL,
    storageState: `app/visual/.auth/${SEED.members.active}.json`,
  });
  const state = await probe.storageState();
  await probe.dispose();
  const token = state.cookies.find((c) => c.name === "__Host-session")?.value;
  if (!token) throw new Error("no seeded session cookie in the storageState file");
  return apiRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `__Host-session=${token}`, "CF-Connecting-IP": uniqueIp() },
  });
}

/**
 * A per-run-fresh identity via the seeded group code (the signup spec's uniqueness
 * idiom) — the decline flows need one: a decline mints a REAL 30-day cooldown for the
 * (sender, invitee) pair, so a fixed sender's re-sends would silently swallow on a
 * re-used local server (the feature, not a flake).
 */
export async function freshSender(baseURL: string): Promise<{ ctx: APIRequestContext; handle: string }> {
  const handle = `zz${Date.now() % 1_000_000_000}`;
  const signup = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { "CF-Connecting-IP": uniqueIp() } });
  const res = await signup.post("/api/signup", { headers: CSRF, data: { code: SEED.groupCode.open, username: handle } });
  const ctx = await contextFromLogin(baseURL, res);
  await signup.dispose();
  return { ctx, handle };
}
