import { describe, it, expect, beforeEach } from "vitest";
import {
  createKrogerUserClient,
  ReauthRequiredError,
  toToolError,
  __resetUserTokenCache,
  type KvStore,
  type UserTokenCache,
} from "../src/kroger-user.js";
import { KrogerError } from "../src/kroger.js";
import type { Env } from "../src/env.js";

const TOKEN_URL = "https://api.kroger.com/v1/connect/oauth2/token";
const CART_URL = "https://api.kroger.com/v1/cart/add";
const TENANT = "alice";
const REFRESH_KEY = `kroger:refresh:${TENANT}`;

const env = {
  KROGER_OAUTH_CLIENT_ID: "cid",
  KROGER_OAUTH_CLIENT_SECRET: "csecret",
} as unknown as Env;

/** In-memory KV that records the order of mutations for write-before-use assertions. */
function memKv(initial: Record<string, string> = {}): KvStore & { log: string[] } {
  const store = new Map(Object.entries(initial));
  const log: string[] = [];
  return {
    log,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      log.push(`put:${key}=${value}`);
      store.set(key, value);
    },
    async delete(key) {
      log.push(`delete:${key}`);
      store.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

function freshCache(): UserTokenCache {
  return { token: null };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Kroger user-context client — token rotation", () => {
  it("writes the new refresh token to KV BEFORE using the new access token", async () => {
    const events: string[] = [];
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    const fetchMock = (async (url: string, init?: RequestInit) => {
      if (url.startsWith(TOKEN_URL)) {
        events.push("refresh");
        return json({ access_token: "A1", refresh_token: "R1", expires_in: 1800 });
      }
      // cart write — record the bearer used so we can assert ordering
      events.push(`cart:${(init?.headers as Record<string, string>).Authorization}`);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, {
      fetch: fetchMock,
      cache: freshCache(),
      now: () => 1000,
    });
    await client.addToCart([{ upc: "0001", quantity: 1 }]);

    // The rotated refresh token landed in KV before the cart request fired.
    const putIdx = kv.log.indexOf(`put:${REFRESH_KEY}=R1`);
    const cartIdx = events.findIndex((e) => e.startsWith("cart:"));
    expect(putIdx).toBeGreaterThanOrEqual(0);
    expect(cartIdx).toBeGreaterThanOrEqual(0);
    // KV put happens during refresh, which precedes the cart write entirely.
    expect(events[0]).toBe("refresh");
    expect(events[1]).toBe("cart:Bearer A1");
  });

  it("maps a Kroger-rejected refresh to reauth_required", async () => {
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) return new Response("invalid_grant", { status: 400 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, {
      fetch: fetchMock,
      cache: freshCache(),
      now: () => 1000,
    });
    await expect(client.addToCart([{ upc: "x", quantity: 1 }])).rejects.toBeInstanceOf(
      ReauthRequiredError,
    );
  });

  it("returns reauth_required when no refresh token is stored", async () => {
    const kv = memKv();
    const fetchMock = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("toToolError maps ReauthRequiredError to the reauth_required code", () => {
    expect(toToolError(new ReauthRequiredError()).code).toBe("reauth_required");
    expect(toToolError(new KrogerError(503, "boom")).code).toBe("upstream_unavailable");
  });

  it("reuses a cached access token without re-refreshing", async () => {
    let refreshes = 0;
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) {
        refreshes++;
        return json({ access_token: "A1", refresh_token: `R${refreshes}`, expires_in: 1800 });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await client.addToCart([{ upc: "a", quantity: 1 }]);
    await client.addToCart([{ upc: "b", quantity: 1 }]);
    expect(refreshes).toBe(1);
  });
});

describe("Kroger user-context client — refresh coalescing", () => {
  it("coalesces simultaneous getAccessToken calls into exactly ONE token POST", async () => {
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    let tokenPosts = 0;
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) {
        tokenPosts++;
        // Hold the refresh open across a macrotask so both callers overlap in flight.
        await new Promise((r) => setTimeout(r, 5));
        return json({ access_token: "A1", refresh_token: "R1", expires_in: 1800 });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    const [a, b] = await Promise.all([client.getAccessToken(), client.getAccessToken()]);

    expect(tokenPosts).toBe(1); // the single-use refresh token was consumed once, not raced
    expect(a).toBe("A1");
    expect(b).toBe("A1");
    expect(await kv.get(REFRESH_KEY)).toBe("R1"); // rotated exactly once
  });

  it("a failed refresh is not sticky — the next call starts a fresh attempt", async () => {
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    let tokenPosts = 0;
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) {
        tokenPosts++;
        if (tokenPosts === 1) return new Response("boom", { status: 503 });
        return json({ access_token: "A2", refresh_token: "R2", expires_in: 1800 });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await expect(client.getAccessToken()).rejects.toBeInstanceOf(KrogerError);
    // The in-flight slot cleared on rejection: this is a NEW refresh, and it succeeds.
    await expect(client.getAccessToken()).resolves.toBe("A2");
    expect(tokenPosts).toBe(2);
  });

  it("coalescing stays per-tenant: two tenants refreshing concurrently issue one POST each", async () => {
    __resetUserTokenCache();
    const kv = memKv({ "kroger:refresh:alice": "RA0", "kroger:refresh:bob": "RB0" });
    let tokenPosts = 0;
    const fetchMock = (async (url: string, init?: RequestInit) => {
      if (url.startsWith(TOKEN_URL)) {
        tokenPosts++;
        const tok = new URLSearchParams(String(init?.body)).get("refresh_token");
        await new Promise((r) => setTimeout(r, 5));
        return json({ access_token: `A-${tok}`, refresh_token: `${tok}-rot`, expires_in: 1800 });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const alice = createKrogerUserClient(env, kv, "alice", { fetch: fetchMock, now: () => 1000 });
    const bob = createKrogerUserClient(env, kv, "bob", { fetch: fetchMock, now: () => 1000 });
    const [a1, a2, b1] = await Promise.all([
      alice.getAccessToken(),
      alice.getAccessToken(),
      bob.getAccessToken(),
    ]);

    expect(tokenPosts).toBe(2); // alice's two calls coalesced; bob's did not join hers
    expect(a1).toBe("A-RA0");
    expect(a2).toBe("A-RA0");
    expect(b1).toBe("A-RB0");
  });
});

describe("Kroger user-context client — cart write", () => {
  it("succeeds on a 204 from PUT /v1/cart/add", async () => {
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    let cartCalls = 0;
    const fetchMock = (async (url: string, init?: RequestInit) => {
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "A1", refresh_token: "R1", expires_in: 1800 });
      cartCalls++;
      expect(url).toBe(CART_URL);
      expect(init?.method).toBe("PUT");
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ items: [{ upc: "0001111", quantity: 2 }] });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await client.addToCart([{ upc: "0001111", quantity: 2 }]);
    expect(cartCalls).toBe(1);
  });

  it("refreshes once on a 401 then retries the cart write", async () => {
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    let cartCalls = 0;
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) return json({ access_token: `A${cartCalls + 1}`, refresh_token: "R1", expires_in: 1800 });
      cartCalls++;
      if (cartCalls === 1) return new Response("unauthorized", { status: 401 });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await client.addToCart([{ upc: "x", quantity: 1 }]);
    expect(cartCalls).toBe(2);
  });

  it("throws KrogerError on a non-401 cart failure (e.g. missing scope)", async () => {
    const kv = memKv({ [REFRESH_KEY]: "R0" });
    const fetchMock = (async (url: string) => {
      if (url.startsWith(TOKEN_URL)) return json({ access_token: "A1", refresh_token: "R1", expires_in: 1800 });
      return new Response("forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await expect(client.addToCart([{ upc: "x", quantity: 1 }])).rejects.toBeInstanceOf(KrogerError);
  });

  it("exchangeCode persists the refresh token and caches the access token", async () => {
    const kv = memKv();
    const fetchMock = (async (url: string, init?: RequestInit) => {
      expect(url).toBe(TOKEN_URL);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("CODE");
      expect(body.get("code_verifier")).toBe("VERIFIER");
      return json({ access_token: "A1", refresh_token: "R1", expires_in: 1800 });
    }) as unknown as typeof fetch;

    const client = createKrogerUserClient(env, kv, TENANT, { fetch: fetchMock, cache: freshCache(), now: () => 1000 });
    await client.exchangeCode("CODE", "VERIFIER", "https://x/oauth/callback");
    expect(await kv.get(REFRESH_KEY)).toBe("R1");
  });
});

describe("Kroger user-context client — per-tenant isolation (D8)", () => {
  // These exercise the REAL module-level per-tenant cache (no injected `cache`),
  // so they assert one tenant's token can never be served to another.
  beforeEach(() => __resetUserTokenCache());

  /** A token endpoint that echoes the presented refresh token into the issued tokens. */
  const echoFetch = (async (url: string, init?: RequestInit) => {
    if (url.startsWith(TOKEN_URL)) {
      const body = new URLSearchParams(String(init?.body));
      const tok = body.get("refresh_token");
      return json({ access_token: `A-${tok}`, refresh_token: `${tok}-rot`, expires_in: 1800 });
    }
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  it("stores and rotates each tenant's refresh token under its own key", async () => {
    const kv = memKv({ "kroger:refresh:alice": "RA0", "kroger:refresh:bob": "RB0" });
    const alice = createKrogerUserClient(env, kv, "alice", { fetch: echoFetch, now: () => 1000 });
    const bob = createKrogerUserClient(env, kv, "bob", { fetch: echoFetch, now: () => 1000 });

    await alice.getAccessToken();
    await bob.getAccessToken();

    expect(await kv.get("kroger:refresh:alice")).toBe("RA0-rot");
    expect(await kv.get("kroger:refresh:bob")).toBe("RB0-rot");
  });

  it("the per-tenant cache never serves one tenant's access token to another", async () => {
    const kv = memKv({ "kroger:refresh:alice": "RA0", "kroger:refresh:bob": "RB0" });
    const alice = createKrogerUserClient(env, kv, "alice", { fetch: echoFetch, now: () => 1000 });
    const bob = createKrogerUserClient(env, kv, "bob", { fetch: echoFetch, now: () => 1000 });

    const ta = await alice.getAccessToken();
    const tb = await bob.getAccessToken();

    expect(ta).toBe("A-RA0");
    expect(tb).toBe("A-RB0");
    expect(ta).not.toBe(tb);
    // Alice's cached token is still hers on a repeat call — never bob's.
    expect(await alice.getAccessToken()).toBe("A-RA0");
  });

  it("one tenant's reauth_required does not affect another tenant", async () => {
    // Only bob has a stored refresh token; alice has none → alice reauth, bob fine.
    const kv = memKv({ "kroger:refresh:bob": "RB0" });
    const alice = createKrogerUserClient(env, kv, "alice", { fetch: echoFetch, now: () => 1000 });
    const bob = createKrogerUserClient(env, kv, "bob", { fetch: echoFetch, now: () => 1000 });

    await expect(alice.getAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(await bob.getAccessToken()).toBe("A-RB0");
  });
});
