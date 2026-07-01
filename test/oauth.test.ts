import { describe, it, expect } from "vitest";
import {
  handleOAuthRequest,
  challengeFromVerifier,
  generateVerifier,
  mintAuthNonce,
  redeemAuthNonce,
  buildKrogerConsentUrl,
  type OAuthDeps,
  type Pkce,
} from "../src/oauth.js";
import type { KrogerUserClient, KvStore } from "../src/kroger-user.js";

function memKv(initial: Record<string, string> = {}): KvStore {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

function stubClient(overrides: Partial<KrogerUserClient> = {}): KrogerUserClient {
  return {
    buildAuthorizeUrl: (redirectUri, state, challenge) =>
      `https://kroger/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${challenge}`,
    exchangeCode: async () => {},
    getAccessToken: async () => "A1",
    addToCart: async () => {},
    ...overrides,
  };
}

const fixedPkce: Pkce = {
  generateVerifier: () => "fixed-verifier",
  generateState: () => "fixed-state",
  challengeFromVerifier: async () => "fixed-challenge",
};

/** A clientFor factory that records which tenant each built client was bound to. */
function recordingClientFor(overrides: Partial<KrogerUserClient> = {}) {
  const tenants: string[] = [];
  const clientFor = (tenantId: string): KrogerUserClient => {
    tenants.push(tenantId);
    return stubClient(overrides);
  };
  return { clientFor, tenants };
}

describe("/oauth route handling", () => {
  it("init redeems the nonce, stores the verifier+bound tenant under state, and redirects", async () => {
    const kv = memKv();
    const { clientFor } = recordingClientFor();
    const deps: OAuthDeps = { kv, clientFor, pkce: fixedPkce };
    const nonce = await mintAuthNonce(kv, "alice");

    const res = await handleOAuthRequest(
      deps,
      new URL(`https://grocery-mcp.example.com/oauth/init?nonce=${nonce}`),
    );

    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("state=fixed-state");
    expect(loc).toContain("code_challenge=fixed-challenge");
    expect(loc).toContain(encodeURIComponent("https://grocery-mcp.example.com/oauth/callback"));
    expect(JSON.parse((await kv.get("kroger:pkce:fixed-state"))!)).toEqual({
      verifier: "fixed-verifier",
      tenant: "alice",
    });
    // The nonce is single-use: consumed by the redemption.
    expect(await redeemAuthNonce(kv, nonce)).toBeNull();
  });

  it("rejects an init with no nonce, writing no flow", async () => {
    const kv = memKv();
    const { clientFor } = recordingClientFor();
    const res = await handleOAuthRequest({ kv, clientFor, pkce: fixedPkce }, new URL("https://x.com/oauth/init"));
    expect(res.status).toBe(400);
    expect(await kv.get("kroger:pkce:fixed-state")).toBeNull();
  });

  it("rejects an init with an unknown/expired nonce, writing no flow", async () => {
    const kv = memKv();
    const { clientFor } = recordingClientFor();
    const res = await handleOAuthRequest(
      { kv, clientFor, pkce: fixedPkce },
      new URL("https://x.com/oauth/init?nonce=does-not-exist"),
    );
    expect(res.status).toBe(400);
    expect(await kv.get("kroger:pkce:fixed-state")).toBeNull();
  });

  it("rejects re-use of a nonce that already started a flow", async () => {
    const kv = memKv();
    const { clientFor } = recordingClientFor();
    const deps: OAuthDeps = { kv, clientFor, pkce: fixedPkce };
    const nonce = await mintAuthNonce(kv, "alice");

    const first = await handleOAuthRequest(deps, new URL(`https://x.com/oauth/init?nonce=${nonce}`));
    expect(first.status).toBe(302);
    const second = await handleOAuthRequest(deps, new URL(`https://x.com/oauth/init?nonce=${nonce}`));
    expect(second.status).toBe(400);
  });

  it("completes the init→callback handshake bound to the nonce's tenant", async () => {
    const kv = memKv();
    let exchanged: { code: string; verifier: string } | null = null;
    const { clientFor, tenants } = recordingClientFor({
      exchangeCode: async (code, verifier) => {
        exchanged = { code, verifier };
      },
    });
    const deps: OAuthDeps = { kv, clientFor, pkce: fixedPkce };
    const nonce = await mintAuthNonce(kv, "alice");

    await handleOAuthRequest(deps, new URL(`https://x.com/oauth/init?nonce=${nonce}`));
    const res = await handleOAuthRequest(
      deps,
      new URL("https://x.com/oauth/callback?code=THECODE&state=fixed-state"),
    );

    expect(res.status).toBe(200);
    expect(exchanged).toEqual({ code: "THECODE", verifier: "fixed-verifier" });
    // The callback resolved the client for the SAME tenant the nonce was bound to.
    expect(tenants).toEqual(["alice", "alice"]);
    // The single-use record is consumed.
    expect(await kv.get("kroger:pkce:fixed-state")).toBeNull();
  });

  it("rejects a forged/replayed callback whose state has no stored record", async () => {
    const kv = memKv();
    let exchangeCalled = false;
    const { clientFor } = recordingClientFor({
      exchangeCode: async () => {
        exchangeCalled = true;
      },
    });
    const deps: OAuthDeps = { kv, clientFor, pkce: fixedPkce };

    const res = await handleOAuthRequest(
      deps,
      new URL("https://x.com/oauth/callback?code=c&state=attacker-state"),
    );

    expect(res.status).toBe(400);
    expect(exchangeCalled).toBe(false);
  });

  it("rejects a callback missing state, with no exchange", async () => {
    const kv = memKv();
    let exchangeCalled = false;
    const { clientFor } = recordingClientFor({ exchangeCode: async () => { exchangeCalled = true; } });
    const deps: OAuthDeps = { kv, clientFor, pkce: fixedPkce };
    const res = await handleOAuthRequest(deps, new URL("https://x.com/oauth/callback?code=c"));
    expect(res.status).toBe(400);
    expect(exchangeCalled).toBe(false);
  });

  it("surfaces a Kroger error param without attempting exchange", async () => {
    const kv = memKv({ "kroger:pkce:fixed-state": JSON.stringify({ verifier: "fixed-verifier", tenant: "alice" }) });
    let exchangeCalled = false;
    const { clientFor } = recordingClientFor({ exchangeCode: async () => { exchangeCalled = true; } });
    const deps: OAuthDeps = { kv, clientFor, pkce: fixedPkce };
    const res = await handleOAuthRequest(
      deps,
      new URL("https://x.com/oauth/callback?error=access_denied&state=fixed-state"),
    );
    expect(res.status).toBe(400);
    expect(exchangeCalled).toBe(false);
  });

  it("PKCE S256 challenge is the base64url SHA-256 of the verifier", async () => {
    // Known RFC 7636 Appendix B test vector.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await challengeFromVerifier(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("generateVerifier yields a URL-safe string of adequate length", () => {
    const v = generateVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(v.length).toBeGreaterThanOrEqual(43);
  });
});

describe("Kroger consent nonce", () => {
  it("mints then redeems a nonce to its bound (canonical) tenant", async () => {
    const kv = memKv();
    const nonce = await mintAuthNonce(kv, "Casey");
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    // Bound tenant is canonicalized (lowercased) at mint time.
    expect(await redeemAuthNonce(kv, nonce)).toBe("casey");
  });

  it("is single-use: a second redemption returns null", async () => {
    const kv = memKv();
    const nonce = await mintAuthNonce(kv, "alice");
    expect(await redeemAuthNonce(kv, nonce)).toBe("alice");
    expect(await redeemAuthNonce(kv, nonce)).toBeNull();
  });

  it("returns null for an unknown or empty nonce", async () => {
    const kv = memKv();
    expect(await redeemAuthNonce(kv, "never-minted")).toBeNull();
    expect(await redeemAuthNonce(kv, "")).toBeNull();
  });

  it("buildKrogerConsentUrl embeds a redeemable nonce for the tenant", async () => {
    const kv = memKv();
    const url = await buildKrogerConsentUrl(kv, "https://grocery-mcp.example.com", "alice");
    expect(url).toMatch(/^https:\/\/grocery-mcp\.example\.com\/oauth\/init\?nonce=[A-Za-z0-9_-]+$/);
    const nonce = new URL(url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(kv, nonce)).toBe("alice");
  });
});
