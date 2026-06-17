import { describe, it, expect } from "vitest";
import { createKrogerClient, KrogerError, type KrogerCache } from "../src/kroger.js";
import { runTool } from "../src/errors.js";
import type { Env } from "../src/env.js";

const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";

const env = {
  KROGER_CLIENT_ID: "id",
  KROGER_CLIENT_SECRET: "secret",
} as unknown as Env;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const PRODUCT = {
  productId: "0001111041700",
  brand: "Kroger",
  description: "Kroger 2% Milk",
  categories: ["Dairy"],
  items: [
    {
      size: "1 gal",
      price: { regular: 2.99, promo: 0 },
      fulfillment: { curbside: true, delivery: true, inStore: true },
      aisleLocation: { number: "14", description: "Dairy", side: "L" },
    },
  ],
};

function freshCache(): KrogerCache {
  return { token: null, locationId: null };
}

describe("Kroger client", () => {
  it("mints one client_credentials token and reuses it across calls", async () => {
    const calls: string[] = [];
    const fetchMock = (async (url: string) => {
      calls.push(url);
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "T1", expires_in: 1800 });
      return json({ data: [PRODUCT] });
    }) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    await k.search("milk", { locationId: "loc1" });
    await k.search("eggs", { locationId: "loc1" });

    expect(calls.filter((c) => c.startsWith(TOKEN_URL)).length).toBe(1);
  });

  it("re-mints the token after expiry", async () => {
    let tokenCount = 0;
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) {
        tokenCount++;
        return json({ access_token: `T${tokenCount}`, expires_in: 1800 });
      }
      return json({ data: [PRODUCT] });
    }) as unknown as typeof fetch;

    const cache = freshCache();
    let t = 1000;
    const k = createKrogerClient(env, { fetch: fetchMock, cache, now: () => t, sleep: async () => {} });
    await k.search("milk", { locationId: "loc1" });
    t += 1_900_000; // advance past the 1800s lifetime
    await k.search("eggs", { locationId: "loc1" });

    expect(tokenCount).toBe(2);
  });

  it("normalizes products with price, fulfillment flags, and aisleLocation", async () => {
    const fetchMock = (async (url: string) =>
      url.startsWith(TOKEN_URL)
        ? json({ access_token: "T1", expires_in: 1800 })
        : json({ data: [PRODUCT] })) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    const [c] = await k.search("milk", { locationId: "loc1" });
    expect(c).toEqual({
      productId: "0001111041700",
      brand: "Kroger",
      description: "Kroger 2% Milk",
      categories: ["Dairy"],
      size: "1 gal",
      price: { regular: 2.99, promo: 0 },
      fulfillment: { curbside: true, delivery: true, inStore: true },
      aisleLocation: { number: "14", description: "Dairy", side: "L" },
    });
  });

  it("normalizes a product with no aisleLocation to null", async () => {
    const noLocation = {
      ...PRODUCT,
      items: [{ size: "1 gal", price: { regular: 2.99, promo: 0 }, fulfillment: { curbside: true, delivery: true, inStore: false } }],
    };
    const fetchMock = (async (url: string) =>
      url.startsWith(TOKEN_URL)
        ? json({ access_token: "T1", expires_in: 1800 })
        : json({ data: [noLocation] })) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    const [c] = await k.search("milk", { locationId: "loc1" });
    expect(c.aisleLocation).toBeNull();
    expect(c.fulfillment.inStore).toBe(false);
  });

  it("normalizes a product with no fulfillment object (all flags false, no aisleLocation)", async () => {
    const bare = { productId: "x", brand: "B", description: "D", categories: [], items: [{ size: null }] };
    const fetchMock = (async (url: string) =>
      url.startsWith(TOKEN_URL)
        ? json({ access_token: "T1", expires_in: 1800 })
        : json({ data: [bare] })) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    const [c] = await k.search("bare", { locationId: "loc1" });
    expect(c.fulfillment).toEqual({ curbside: false, delivery: false, inStore: false });
    expect(c.aisleLocation).toBeNull();
  });

  it("honors Retry-After on 429 then succeeds", async () => {
    const slept: number[] = [];
    let productAttempts = 0;
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "T1", expires_in: 1800 });
      productAttempts++;
      if (productAttempts === 1) {
        return new Response("rate limited", { status: 429, headers: { "Retry-After": "2" } });
      }
      return json({ data: [PRODUCT] });
    }) as unknown as typeof fetch;

    const k = createKrogerClient(env, {
      fetch: fetchMock,
      cache: freshCache(),
      now: () => 1000,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const out = await k.search("milk", { locationId: "loc1" });
    expect(out).toHaveLength(1);
    expect(slept).toEqual([2000]); // Retry-After: 2 seconds honored
  });

  it("backs off (with jitter) on 429 lacking Retry-After", async () => {
    const slept: number[] = [];
    let productAttempts = 0;
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "T1", expires_in: 1800 });
      productAttempts++;
      if (productAttempts === 1) return new Response("rate limited", { status: 429 });
      return json({ data: [PRODUCT] });
    }) as unknown as typeof fetch;

    const k = createKrogerClient(env, {
      fetch: fetchMock,
      cache: freshCache(),
      now: () => 1000,
      random: () => 0, // deterministic: no jitter
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    await k.search("milk", { locationId: "loc1" });
    expect(slept).toEqual([200]); // base * 2^0 + 0 jitter
  });

  it("throws KrogerError after retries are exhausted", async () => {
    const fetchMock = (async (url: string) =>
      url.startsWith(TOKEN_URL)
        ? json({ access_token: "T1", expires_in: 1800 })
        : new Response("boom", { status: 500 })) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, random: () => 0, sleep: async () => {} });
    await expect(k.search("milk", { locationId: "loc1" })).rejects.toBeInstanceOf(KrogerError);
  });

  it("maps an exhausted upstream to a structured upstream_unavailable at the tool boundary", async () => {
    const fetchMock = (async (url: string) =>
      url.startsWith(TOKEN_URL)
        ? json({ access_token: "T1", expires_in: 1800 })
        : new Response("boom", { status: 500 })) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, random: () => 0, sleep: async () => {} });
    const res = await runTool(() => k.search("milk", { locationId: "loc1" }));
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe("upstream_unavailable");
  });

  it("resolves a location once and reuses the cached id", async () => {
    const calls: string[] = [];
    const fetchMock = (async (url: string) => {
      calls.push(url);
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "T1", expires_in: 1800 });
      if (url.includes("/locations")) return json({ data: [{ locationId: "01400943" }] });
      return json({ data: [PRODUCT] });
    }) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    const id1 = await k.resolveLocationId("Kroger - 76104");
    const id2 = await k.resolveLocationId("Kroger - 76104");
    expect(id1).toBe("01400943");
    expect(id2).toBe("01400943");
    expect(calls.filter((c) => c.includes("/locations")).length).toBe(1);
  });

  it("rejects a preferred_location label with no parseable ZIP", async () => {
    const fetchMock = (async () => json({ access_token: "T1", expires_in: 1800 })) as unknown as typeof fetch;
    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    await expect(k.resolveLocationId("Kroger Downtown")).rejects.toBeInstanceOf(KrogerError);
  });

  it("bypasses the Locations API when given a pre-resolved locationId (no spaces)", async () => {
    const calls: string[] = [];
    const fetchMock = (async (url: string) => {
      calls.push(url);
      return json({ access_token: "T1", expires_in: 1800 });
    }) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    const id = await k.resolveLocationId("70100156");
    expect(id).toBe("70100156");
    expect(calls.filter((c) => c.includes("/locations")).length).toBe(0);
  });

  it("still parses a ZIP and fetches when given a preferred_location label (has spaces)", async () => {
    const calls: string[] = [];
    const fetchMock = (async (url: string) => {
      calls.push(url);
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "T1", expires_in: 1800 });
      if (url.includes("/locations")) return json({ data: [{ locationId: "01400943" }] });
      return json({ data: [] });
    }) as unknown as typeof fetch;

    const k = createKrogerClient(env, { fetch: fetchMock, cache: freshCache(), now: () => 1000, sleep: async () => {} });
    const id = await k.resolveLocationId("Kroger - 76104");
    expect(id).toBe("01400943");
    expect(calls.filter((c) => c.includes("/locations")).length).toBe(1);
  });

  it("caps concurrent in-flight requests at maxConcurrency across a fan-out", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchMock = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return json({ data: [PRODUCT] });
    }) as unknown as typeof fetch;

    // Pre-seed token + location so the burst issues only product reads.
    const cache: KrogerCache = { token: { accessToken: "T1", expiresAt: 9_999_999_999 }, locationId: "loc1" };
    const k = createKrogerClient(env, { fetch: fetchMock, cache, now: () => 1000, sleep: async () => {}, maxConcurrency: 3 });

    // search and productById both flow through authedGet, so both are gated.
    await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => k.search(`t${i}`, { locationId: "loc1" })),
      ...Array.from({ length: 6 }, (_, i) => k.productById(`p${i}`, "loc1")),
    ]);

    expect(peak).toBe(3);
  });
});
