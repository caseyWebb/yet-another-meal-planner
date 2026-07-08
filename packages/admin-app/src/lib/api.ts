// The typed API client (operator-admin): `hc` over the Worker's chained /admin/api route type.
// The import is TYPE-ONLY (erased from the bundle — no workerd code can reach the browser);
// the runtime is just hono/client. Same-origin by construction: the base is "/", and under
// `aubr dev:admin` the Vite proxy carries /admin/api to the local Worker.
import { hc } from "hono/client";
import type { AdminApp } from "@grocery-agent/worker/admin-api";

// --- Access-expiry detection (admin-spa D7) -----------------------------------------------
// The Access cookie rides every same-origin fetch transparently — until it expires, when
// Cloudflare Access answers a fetch with a redirect toward the IdP (the browser follows it
// cross-origin and CORS kills it, surfacing as a network error) or an HTML interstitial. The
// one shared wrapper below classifies those — and ONLY those — as `access_expired` and flips
// a module-level flag the root layout renders as the blocking reload overlay. A plain-404
// unknown API route (text/plain) and a structured JSON ToolError are NOT expiry — they flow
// through as ordinary responses/errors. Under the loopback ADMIN_DEV_BYPASS this path is
// simply never taken.

/** The error a query/mutation receives when the Access session expired mid-flight. The
 *  QueryClient's retry predicate keys on it (an expired session never retries). */
export class AccessExpiredError extends Error {
  readonly kind = "access_expired";
  constructor() {
    super("Access session expired — reload to sign back in");
    this.name = "AccessExpiredError";
  }
}

let expired = false;
const listeners = new Set<() => void>();

/** Subscribe to the expiry flag (useSyncExternalStore-shaped, for the root overlay). */
export function subscribeAccessExpired(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function accessExpiredSnapshot(): boolean {
  return expired;
}

function signalAccessExpired(): void {
  if (expired) return;
  expired = true;
  for (const l of listeners) l();
}

/**
 * Classify a settled /admin/api response: `expired` when the body is an Access artifact —
 * an HTML content-type (the interstitial, or any shell HTML leaking onto the API surface)
 * or an opaque/redirected response toward a login — else `ok` (JSON results, structured
 * JSON errors, and the unknown-route plain-404 all pass through untouched).
 */
export function classifyAdminResponse(res: { ok: boolean; status: number; type: string; headers: Headers }): "ok" | "expired" {
  if (res.type === "opaqueredirect") return "expired";
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) return "expired";
  return "ok";
}

/**
 * The one shared fetch: every hc call rides it. A network failure on a same-origin API call
 * is the CORS-killed Access redirect (or a dropped connection — the same reload prompt is
 * the honest answer for an online-only operator tool); an HTML/redirect response is the
 * interstitial. Both flip the module flag and surface as `AccessExpiredError`.
 */
export const adminFetch: typeof fetch = async (input, init) => {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    signalAccessExpired();
    throw new AccessExpiredError();
  }
  if (classifyAdminResponse(res) === "expired") {
    signalAccessExpired();
    throw new AccessExpiredError();
  }
  return res;
};

export const api = hc<AdminApp>("/", { fetch: adminFetch });

/** The structured error body every /admin/api failure carries (`ToolError.toShape()`). */
export interface ApiError {
  error: string;
  message: string;
}

/** Parse a failed response's structured error, degrading to a generic shape. (Structural
 *  param: hc's ClientResponse and the global Response both satisfy it.) */
export async function apiError(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (typeof body?.error === "string") return { error: body.error, message: body.message ?? "" };
  } catch {
    // fall through
  }
  return { error: "internal", message: `Request failed (${res.status})` };
}

/** Unwrap an hc call: OK → the typed json body; failure → throw the structured ApiError (as
 *  an Error carrying the shape) so it lands INSIDE the query/mutation error state, typed.
 *  The conditional return type distributes over a route's response UNION (a handler with two
 *  `c.json` shapes), yielding the union of bodies. */
export async function unwrap<R extends { ok: boolean; status: number; json(): Promise<unknown> }>(
  resP: Promise<R>,
): Promise<R extends { json(): Promise<infer T> } ? T : never> {
  const res = await resP;
  if (!res.ok) {
    const err = await apiError(res);
    throw Object.assign(new Error(err.message || err.error), { api: err });
  }
  return (await res.json()) as R extends { json(): Promise<infer T> } ? T : never;
}

/** Narrow an unknown thrown value to its structured ApiError, when it carries one. */
export function apiErrorOf(e: unknown): ApiError | null {
  if (e && typeof e === "object" && "api" in e) return (e as { api: ApiError }).api;
  return null;
}
