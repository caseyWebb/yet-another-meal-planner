// Tiered fetch: plain-HTTP session replay (the default) and a lazy Playwright/Chromium
// browser tier (per-source opt-in). Both take a target URL + the source's loaded session
// and return the fetched HTML with the final (post-redirect) URL and status, so the
// caller can run the auth-wall heuristic and the shared parse uniformly across tiers.
//
// The browser tier is lazy: `playwright` is only imported when a browser-tier source is
// actually fetched, so a machine with only HTTP sources never loads it. One Chromium
// process is reused across sources; each fetch gets its own context built from that
// source's storageState (Playwright's own session format), then disposed.

import { cookieHeaderFor, type StorageState } from "./session.js";
// Import the Playwright TYPES only (erased at compile time by verbatimModuleSyntax +
// `import type`), so no runtime dependency is created — the value import is dynamic below.
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";

/** A browser-like UA so paid sources don't refuse a bare Node fetch. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The result of fetching one page through any tier. */
export interface FetchResult {
  html: string;
  /** The URL after redirects — what the auth-wall heuristic inspects. */
  finalUrl: string;
  status: number;
}

/** A fetch mechanism. `session` is the source's loaded storageState (or null when uncaptured). */
export interface FetchTier {
  fetch(url: string, session: StorageState | null): Promise<FetchResult>;
  /** Release any held resources (the browser tier's Chromium process). No-op for HTTP. */
  close(): Promise<void>;
}

/** Plain-HTTP tier: global fetch with a browser UA + the session's Cookie header, following redirects. */
export const httpTier: FetchTier = {
  async fetch(url, session): Promise<FetchResult> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    };
    if (session) {
      const cookie = cookieHeaderFor(session, url);
      if (cookie) headers.cookie = cookie;
    }
    const res = await fetch(url, { headers, redirect: "follow" });
    const html = await res.text();
    return { html, finalUrl: res.url || url, status: res.status };
  },
  async close(): Promise<void> {
    // Nothing to release — the global fetch holds no per-tier process.
  },
};

/**
 * Browser tier: one lazily-launched, reused Chromium process; a fresh context per fetch,
 * built from the source's storageState. Chromium is pre-installed in the image
 * (PLAYWRIGHT_BROWSERS_PATH), so launch never downloads. Not exercised by the unit tests
 * (they never launch a real browser); its logic is smoke-covered instead.
 */
export function createBrowserTier(): FetchTier {
  // The launched browser is memoized so multiple sources share one process.
  let browserPromise: Promise<Browser> | null = null;

  async function getBrowser(): Promise<Browser> {
    if (!browserPromise) {
      browserPromise = (async () => {
        const { chromium } = await import("playwright");
        return chromium.launch({ headless: true });
      })();
    }
    return browserPromise;
  }

  return {
    async fetch(url, session): Promise<FetchResult> {
      const browser = await getBrowser();
      let context: BrowserContext | undefined;
      try {
        // A storageState-seeded context replays the operator's captured session. Our
        // StorageState is the same JSON shape Playwright accepts; cast to its option type.
        const options: BrowserContextOptions = { userAgent: USER_AGENT };
        if (session) options.storageState = session as BrowserContextOptions["storageState"];
        context = await browser.newContext(options);
        const page = await context.newPage();
        const response = await page.goto(url, { waitUntil: "domcontentloaded" });
        const html = await page.content();
        return { html, finalUrl: page.url(), status: response?.status() ?? 0 };
      } finally {
        // Dispose the per-fetch context; the browser process stays up for reuse.
        if (context) await context.close();
      }
    },
    async close(): Promise<void> {
      if (browserPromise) {
        const browser = await browserPromise;
        await browser.close();
        browserPromise = null;
      }
    },
  };
}

/**
 * Pick the tier for a source or a scan store: plain HTTP by default, the (shared) browser tier when
 * it declares `fetch_tier = "browser"`. The browser tier is passed in so one process is reused
 * across all browser fetchers in a tick; pass a fresh HTTP tier otherwise. Takes just the
 * `{ fetch_tier }` a `SourceConfig` or a `ScanStoreConfig` carries.
 */
export function selectTier(source: { fetch_tier?: "http" | "browser" }, browserTier: FetchTier): FetchTier {
  return source.fetch_tier === "browser" ? browserTier : httpTier;
}
