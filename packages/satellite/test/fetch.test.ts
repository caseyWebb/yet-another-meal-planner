import { describe, expect, it } from "vitest";
import { createBrowserTier, httpTier, selectTier } from "../src/fetch.js";
import type { SourceConfig } from "../src/config.js";

// Light/smoke coverage only: we NEVER launch a real browser in vitest. We exercise tier
// SELECTION (pure config → tier routing) and confirm the browser tier's close() is a safe
// no-op when the browser was never launched — the daemon calls close() unconditionally.

describe("selectTier", () => {
  const browserTier = createBrowserTier();

  it("routes an http (default) source to the HTTP tier", () => {
    const http: SourceConfig = { id: "a", adapter: "jsonld" };
    expect(selectTier(http, browserTier)).toBe(httpTier);
  });

  it("routes a declared http source to the HTTP tier", () => {
    const http: SourceConfig = { id: "a", adapter: "jsonld", fetch_tier: "http" };
    expect(selectTier(http, browserTier)).toBe(httpTier);
  });

  it("routes a browser source to the (shared) browser tier", () => {
    const browser: SourceConfig = { id: "b", adapter: "jsonld", fetch_tier: "browser" };
    expect(selectTier(browser, browserTier)).toBe(browserTier);
  });
});

describe("browser tier close()", () => {
  it("is a safe no-op when no browser was ever launched", async () => {
    const tier = createBrowserTier();
    await expect(tier.close()).resolves.toBeUndefined();
  });
});
