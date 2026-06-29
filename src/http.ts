// Outbound fetch with browser-like headers (design D7) AND the egress safety guard
// (outbound-fetch-safety). Used by parse_recipe, the discovery sweep's feed + recipe-page
// fetches, and the operator feed-probe — the one chokepoint, so all three inherit the guard.
//
// The browser headers are request hygiene — they recover sites that gate on a bare/absent
// User-Agent — NOT a bot-wall bypass: the 2026-06-10 edge-egress spike confirmed Cloudflare/
// Vercel bot management (Serious Eats, Food52) fingerprints below the header layer and stays
// blocked regardless. So there is no retry/evasion logic; a wall just surfaces as a non-2xx the
// caller maps to `unreachable`.
//
// Hardening, all applied here so no caller can bypass it:
//   * SSRF guard — `assertPublicHttpUrl` before connecting (http(s) only, no userinfo, no
//     private/loopback/link-local host); a refusal throws, which the caller's try/catch maps to
//     `unreachable` with NO status (indistinguishable from a dead host — no reachability oracle).
//   * Manual redirects — `redirect: "manual"` + a bounded loop re-validating each hop's Location,
//     so a benign host cannot 30x-redirect us into an internal target.
//   * Timeout — `AbortSignal.timeout`, so a host that accepts then never responds surfaces as a
//     per-call failure instead of holding the invocation open (this is what lets a batched
//     caller's per-feed try/catch recover from a STALL, not just a rejection/non-2xx).
//   * Body cap — an over-cap `Content-Length` is refused here; `readTextCapped` additionally
//     caps the streamed read for servers that omit Content-Length.
// `fetchImpl` stays injectable so tests can stub the network.

import { assertPublicHttpUrl } from "./url.js";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Per-request timeout. A host that accepts the connection but stalls aborts here. */
const TIMEOUT_MS = 10_000;
/** Max redirect hops followed (each re-validated). An over-long chain surfaces as unreachable. */
const MAX_REDIRECTS = 5;
/** Max response body bytes read into memory (feeds/pages are well under this). */
export const MAX_BODY_BYTES = 2_000_000;

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Fetch a URL with browser-like headers under the egress guard: validates the target (and every
 * redirect hop) is a public http(s) host, follows redirects manually up to a hop cap, times out a
 * stalled host, and refuses an over-cap `Content-Length`. Throws on a guard refusal, a bad hop, an
 * over-long redirect chain, a timeout, or a network failure (no retry) — the caller's try/catch
 * maps any throw to `unreachable`.
 */
export async function fetchWithBrowserHeaders(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  let target = assertPublicHttpUrl(url); // throws UnsafeUrlError → caller maps to unreachable
  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(target.href, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!isRedirectStatus(res.status)) {
      const len = Number(res.headers.get("content-length"));
      if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
        throw new Error(`Response body too large (${len} bytes) from ${target.href}`);
      }
      return res;
    }
    if (hop >= MAX_REDIRECTS) throw new Error(`Too many redirects from ${url}`);
    const location = res.headers.get("location");
    if (!location) return res; // a 3xx with no Location — hand back as-is (non-2xx → unreachable)
    // Resolve a relative redirect against the current target, then RE-VALIDATE the hop.
    target = assertPublicHttpUrl(new URL(location, target).href);
  }
}

/**
 * Read a response body to text under a byte cap. Short-circuits on an over-cap `Content-Length`,
 * then caps the streamed read so a server that omits Content-Length cannot stream unbounded bytes.
 * Throws when the cap is exceeded — the caller's try/catch treats it as an unusable/unreachable
 * source. Used by the feed-poll and feed-probe paths (which read the whole body as text).
 */
export async function readTextCapped(res: Response, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) {
    throw new Error(`Response body too large (${len} bytes)`);
  }
  const body = res.body;
  if (!body) return res.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Response body exceeded ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}
