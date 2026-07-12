// The typed API client (member-api): `hc` over the Worker's composed app type. The
// import is TYPE-ONLY (erased from the bundle — no workerd code can reach the browser);
// the runtime is just hono/client. Same-origin by construction: the base is "/", and
// under `aubr dev:app` the Vite proxy carries /api to the local Worker.
import { hc } from "hono/client";
import type { MemberApi } from "@yamp/worker/api";

/** The SPA's embedded build id — compared against the `X-App-Build` response header
 *  (the version-skew contract). `"dev"` when unstamped (local dev; the harness). */
export const APP_BUILD: string = import.meta.env.VITE_APP_BUILD ?? "dev";

// --- version-skew detection (member-app-offline D7) ---------------------------------
// The shared fetch wrapper below taps every response's `X-App-Build`. A mismatch means
// the Worker is ahead of the running bundle — but a bare header mismatch is NOT proof a
// new bundle is downloaded and ready, so it does not itself prompt: it only kicks a
// throttled service-worker update check so a WAITING worker (`needRefresh`) can
// materialize, and that — not the header — is what renders the reload prompt. Inert
// unless both ids are stamped (non-"dev") and differ; local dev and the harness
// baseline never fire. No polling loop, no subscribable skew flag.

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
      // no registration / blocked SW — nothing to check; the banner is needRefresh-only,
      // so it simply won't fire (a no-SW client updates on its next natural refresh)
    });
}

function noteServerBuild(header: string | null): void {
  if (!header || header === "dev" || APP_BUILD === "dev" || header === APP_BUILD) return;
  // Worker is ahead: nudge a bounded SW update check so a new build can download and
  // wait (surfacing as `needRefresh`). The header alone never prompts.
  requestSwUpdateCheck();
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
  context?: Record<string, unknown>;
}

/** Parse a failed response's structured error, degrading to a generic shape. (Structural
 *  param: hc's ClientResponse and the global Response both satisfy it.) */
export async function apiError(res: { status: number; json(): Promise<unknown> }): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiError> & Record<string, unknown>;
    if (typeof body?.error === "string") {
      const { error, message, context, ...details } = body;
      const merged = {
        ...details,
        ...(context && typeof context === "object" ? (context as Record<string, unknown>) : {}),
      };
      return {
        error,
        message: typeof message === "string" ? message : "",
        ...(Object.keys(merged).length ? { context: merged } : {}),
      };
    }
  } catch {
    // fall through
  }
  return { error: "internal", message: `Request failed (${res.status})` };
}
