import { describe, expect, it, vi } from "vitest";
import type { BatchResponse } from "@grocery-agent/contract";
import { runTick, type TickDeps } from "../src/scheduler.js";
import type { ScraperConfig, SourceConfig } from "../src/config.js";
import { BUILTIN_ADAPTERS } from "../src/adapter.js";
import type { FetchResult, FetchTier } from "../src/fetch.js";
import type { StorageState } from "../src/session.js";
import type { FetchImpl } from "../src/push.js";

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
const EMPTY_SESSION: StorageState = { cookies: [], origins: [] };

const SITEMAP = `<?xml version="1.0"?>
<urlset><url><loc>https://paid.example/recipes/one</loc></url>
<url><loc>https://paid.example/recipes/two</loc></url></urlset>`;

const recipePage = (name: string, url: string) => `<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"${name}","url":"${url}",
 "recipeIngredient":["1 cup a","2 cups b"],
 "recipeInstructions":["Do the first thing.","Then the second."]}
</script></head><body></body></html>`;

/** A fake tier: returns the sitemap for the sitemap URL, a recipe page for recipe URLs. */
function fakeTier(): FetchTier {
  return {
    fetch: vi.fn((url: string): Promise<FetchResult> => {
      if (url.endsWith("sitemap.xml")) return Promise.resolve({ html: SITEMAP, finalUrl: url, status: 200 });
      const name = url.endsWith("one") ? "Recipe One" : "Recipe Two";
      return Promise.resolve({ html: recipePage(name, url), finalUrl: url, status: 200 });
    }),
    close: () => Promise.resolve(),
  };
}

/** A fake cursor backed by a Set (no filesystem). */
function fakeCursor() {
  const set = new Set<string>();
  return {
    has: (u: string) => set.has(u),
    add: (u: string) => void set.add(u),
    save: vi.fn(),
    _set: set,
  };
}

/** A fake push transport returning a fixed 200 summary. */
function fakePush(summary: BatchResponse): FetchImpl & { calls: unknown[] } {
  const calls: unknown[] = [];
  const impl = ((url: string, init: unknown) => {
    calls.push({ url, init });
    return Promise.resolve({ status: 200, json: () => Promise.resolve(summary) });
  }) as FetchImpl & { calls: unknown[] };
  impl.calls = calls;
  return impl;
}

const config = (sources: SourceConfig[]): ScraperConfig => ({ connector_url: "https://mcp.example", sources });

const baseDeps = (over: Partial<TickDeps>): TickDeps => ({
  loadSession: () => EMPTY_SESSION,
  tierFor: () => fakeTier(),
  adapters: BUILTIN_ADAPTERS,
  cursor: fakeCursor(),
  fetchImpl: fakePush({ received: 2, accepted: 2, deduped: 0, rejected: 0, results: [] }),
  connectorUrl: "https://mcp.example",
  ingestKey: "k",
  log: noopLog,
  pushOptions: { baseDelayMs: 0, sleep: () => Promise.resolve() },
  ...over,
});

describe("runTick", () => {
  it("discovers, extracts, and pushes the happy path for a source", async () => {
    const cursor = fakeCursor();
    const push = fakePush({ received: 2, accepted: 2, deduped: 0, rejected: 0, results: [] });
    const deps = baseDeps({ cursor, fetchImpl: push });
    const source: SourceConfig = { id: "paid", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" };

    const [summary] = await runTick(config([source]), deps);
    expect(summary.source).toBe("paid");
    expect(summary.authExpired).toBe(false);
    expect(summary.push).toBe("accepted");
    expect(summary.pushed).toBe(2);
    // Both discovered recipe URLs are now marked seen.
    expect(cursor._set.has("https://paid.example/recipes/one")).toBe(true);
    expect(cursor._set.has("https://paid.example/recipes/two")).toBe(true);
    // One push (per-source batch) was POSTed.
    expect(push.calls).toHaveLength(1);
  });

  it("skips a source whose session is missing and reports auth_expired", async () => {
    const push = fakePush({ received: 0, accepted: 0, deduped: 0, rejected: 0, results: [] });
    const deps = baseDeps({ loadSession: () => null, fetchImpl: push });
    const source: SourceConfig = { id: "expired", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" };

    const [summary] = await runTick(config([source]), deps);
    expect(summary.authExpired).toBe(true);
    expect(summary.pushed).toBe(0);
    // No push attempted for an auth-expired source.
    expect(push.calls).toHaveLength(0);
  });

  it("reports auth_expired when a fetched page is an auth wall", async () => {
    const authWallTier: FetchTier = {
      fetch: vi.fn((url: string): Promise<FetchResult> => {
        if (url.endsWith("sitemap.xml")) return Promise.resolve({ html: SITEMAP, finalUrl: url, status: 200 });
        // Bounced to a login page.
        return Promise.resolve({
          html: "<html><body>Please subscribe to continue</body></html>",
          finalUrl: "https://paid.example/subscribe",
          status: 200,
        });
      }),
      close: () => Promise.resolve(),
    };
    const push = fakePush({ received: 0, accepted: 0, deduped: 0, rejected: 0, results: [] });
    const deps = baseDeps({ tierFor: () => authWallTier, fetchImpl: push });
    const source: SourceConfig = { id: "wall", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" };

    const [summary] = await runTick(config([source]), deps);
    expect(summary.authExpired).toBe(true);
    expect(push.calls).toHaveLength(0);
  });

  it("filters already-seen URLs via the cursor", async () => {
    const cursor = fakeCursor();
    cursor._set.add("https://paid.example/recipes/one"); // pretend one was already pushed
    const push = fakePush({ received: 1, accepted: 1, deduped: 0, rejected: 0, results: [] });
    const deps = baseDeps({ cursor, fetchImpl: push });
    const source: SourceConfig = { id: "paid", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" };

    const [summary] = await runTick(config([source]), deps);
    expect(summary.skippedSeen).toBe(1);
    expect(summary.pushed).toBe(1);
  });

  it("processes multiple sources independently", async () => {
    const push = fakePush({ received: 2, accepted: 2, deduped: 0, rejected: 0, results: [] });
    const deps = baseDeps({
      loadSession: (id: string) => (id === "good" ? EMPTY_SESSION : null),
      fetchImpl: push,
    });
    const summaries = await runTick(
      config([
        { id: "good", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" },
        { id: "no-session", adapter: "jsonld", sitemap_url: "https://paid.example/sitemap.xml" },
      ]),
      deps,
    );
    expect(summaries).toHaveLength(2);
    expect(summaries[0].push).toBe("accepted");
    expect(summaries[1].authExpired).toBe(true);
  });

  it("chunks a large backfill into batches of at most MAX_BATCH_ITEMS", async () => {
    // 201 discovered recipes → the worker does one D1 write per item, so the scraper must
    // split into 200 + 1 rather than POSTing a single oversized batch (which the endpoint
    // would reject with bad_payload / blow the subrequest budget).
    const N = 201;
    const urls = Array.from({ length: N }, (_, i) => `https://paid.example/recipes/${i}`);
    const sitemap = `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
    const bigTier: FetchTier = {
      fetch: vi.fn((url: string): Promise<FetchResult> => {
        if (url.endsWith("sitemap.xml")) return Promise.resolve({ html: sitemap, finalUrl: url, status: 200 });
        return Promise.resolve({ html: recipePage("R", url), finalUrl: url, status: 200 });
      }),
      close: () => Promise.resolve(),
    };

    // A push that echoes each batch's actual size back as `accepted`, and records the sizes.
    const sizes: number[] = [];
    const echoPush = ((_url: string, init: { body: string }) => {
      const n = (JSON.parse(init.body) as { recipes: unknown[] }).recipes.length;
      sizes.push(n);
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ received: n, accepted: n, deduped: 0, rejected: 0, results: [] }),
      });
    }) as unknown as FetchImpl;

    const cursor = fakeCursor();
    const deps = baseDeps({ cursor, tierFor: () => bigTier, fetchImpl: echoPush });
    const source: SourceConfig = {
      id: "paid",
      adapter: "jsonld",
      mode: "backfill",
      sitemap_url: "https://paid.example/sitemap.xml",
    };

    const [summary] = await runTick(config([source]), deps);
    expect(sizes).toEqual([200, 1]); // chunked, no batch over the cap
    expect(summary.pushed).toBe(N); // every item accepted across the two chunks
    expect(cursor._set.size).toBe(N); // all URLs marked seen
  });
});
