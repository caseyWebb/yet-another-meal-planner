// The typed API client (member-api): `hc` over the Worker's composed app type. The
// import is TYPE-ONLY (erased from the bundle — no workerd code can reach the browser);
// the runtime is just hono/client. Same-origin by construction: the base is "/", and
// under `aubr dev:app` the Vite proxy carries /api to the local Worker.
import { hc } from "hono/client";
import type { MemberApi } from "@grocery-agent/worker/api";

/** The SPA's embedded build id — compared against the `X-App-Build` response header
 *  (the version-skew contract). `"dev"` when unstamped (local dev; the harness). */
export const APP_BUILD: string = import.meta.env.VITE_APP_BUILD ?? "dev";

// --- the version-skew store (member-app-offline D7) ---------------------------------
// Passive detection: the shared fetch wrapper below taps every response's
// `X-App-Build`; a skew is signaled ONLY when both ids are stamped (non-"dev") and
// differ — local dev and the unstamped case stay inert. Subscribable
// (useSyncExternalStore-shaped) for the reload prompt; a detected skew also fires a
// throttled SW update check so `needRefresh` can materialize. No polling loop.

let skewDetected = false;
const skewListeners = new Set<() => void>();

export function subscribeSkew(onChange: () => void): () => void {
  skewListeners.add(onChange);
  return () => skewListeners.delete(onChange);
}

export function skewSnapshot(): boolean {
  return skewDetected;
}

const UPDATE_CHECK_THROTTLE_MS = 60 * 60_000;
let lastUpdateCheckAt = 0;

/** Ask the SW registration to check for a new build — throttled to once an hour
 *  (shared by the skew trigger and the visibility-return check; cost posture §1). */
export function requestSwUpdateCheck(): void {
  const now = Date.now();
  if (now - lastUpdateCheckAt < UPDATE_CHECK_THROTTLE_MS) return;
  lastUpdateCheckAt = now;
  navigator.serviceWorker
    ?.getRegistration()
    .then((reg) => reg?.update())
    .catch(() => {
      // no registration / blocked SW — the skew banner's plain-reload path covers it
    });
}

function noteServerBuild(header: string | null): void {
  if (!header || header === "dev" || APP_BUILD === "dev" || header === APP_BUILD) return;
  requestSwUpdateCheck();
  if (skewDetected) return;
  skewDetected = true;
  for (const l of skewListeners) l();
}

/**
 * The one shared fetch wrapper: every state-changing request carries `X-App-Csrf`
 * (the Worker's CSRF guard rejects it otherwise) — set here once, never per call
 * site — and every response's `X-App-Build` feeds the skew store above. Exported so
 * the rare non-hc read (the aisles-enriched to-buy fetch) rides the same tap.
 */
export const appFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  let res: Response;
  if (method === "GET" || method === "HEAD") {
    res = await fetch(input, init);
  } else {
    const headers = new Headers(init?.headers);
    headers.set("X-App-Csrf", "1");
    res = await fetch(input, { ...init, headers });
  }
  noteServerBuild(res.headers.get("X-App-Build"));
  return res;
};

export const api = hc<MemberApi>("/", { fetch: appFetch });

/** The structured error body every `/api` failure carries (the SPA branches on `error`). */
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
