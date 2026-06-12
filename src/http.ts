// Outbound fetch with browser-like headers (design D7). Used by parse_recipe
// and the feed fetches. This is request hygiene — it recovers sites that gate on
// a bare/absent User-Agent — NOT a bot-wall bypass: the 2026-06-10 edge-egress
// spike confirmed Cloudflare/Vercel bot management (Serious Eats, Food52)
// fingerprint below the header layer and stay blocked regardless. So there is no
// retry/evasion logic here; a wall just surfaces as a non-2xx the caller maps to
// `unreachable`. `fetchImpl` is injectable so tests can stub the network.

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Fetch a URL with browser-like headers. Throws on network failure (no retry). */
export function fetchWithBrowserHeaders(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  return fetchImpl(url, { headers: BROWSER_HEADERS, redirect: "follow" });
}
