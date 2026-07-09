import { describe, it, expect } from "vitest";
import { handleAuthorize, handleAuthorizeStatus } from "../src/authorize.js";
import { mintApproval, approveApproval } from "../src/connect-approval.js";
import type { Env } from "../src/env.js";

function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) { return m.get(key) ?? null; },
    async put(key: string, value: string) { m.set(key, value); },
    async delete(key: string) { m.delete(key); },
  } as unknown as KVNamespace;
}

const OAUTH_REQ = {
  responseType: "code",
  clientId: "claude-connector",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  scope: ["mcp"],
  state: "xyz",
  codeChallenge: "abc",
  codeChallengeMethod: "S256",
};

/** A fake env whose OAUTH_PROVIDER records completeAuthorization calls. */
function fakeEnv(kv: Record<string, string> = {}) {
  const completeCalls: Array<{ userId: string; props: unknown }> = [];
  const env = {
    TENANT_KV: memKv(kv),
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => ({ ...OAUTH_REQ }),
      lookupClient: async (clientId: string) => ({ clientId, clientName: "Claude" }),
      completeAuthorization: async (opts: { userId: string; props: unknown }) => {
        completeCalls.push({ userId: opts.userId, props: opts.props });
        return { redirectTo: "https://claude.ai/api/mcp/auth_callback?code=GRANT&state=xyz" };
      },
    },
  } as unknown as Env;
  return { env, completeCalls };
}

const oauthReqB64 = btoa(JSON.stringify(OAUTH_REQ));

function postForm(fields: Record<string, string>): Request {
  return new Request("https://worker.example/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

describe("handleAuthorize — cross-device approval + grace-gated invite fallback", () => {
  it("GET renders the cross-device approval page (deep link + poll)", async () => {
    const { env } = fakeEnv();
    const res = await handleAuthorize(new Request("https://worker.example/authorize?response_type=code"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/connect?authz="); // the deep link into the web app
    expect(html).toContain("/authorize/status?authz="); // the poll endpoint
    expect(html).toContain("Claude"); // the requesting client name
    expect(html).toMatch(/<div class="qr"><svg[\s\S]*<\/svg><\/div>/); // an inline scannable QR of the deep link
  });

  it("GET shows the legacy invite form while grace is on, hides it when off", async () => {
    const onEnv = fakeEnv().env;
    const graceOn = await (await handleAuthorize(new Request("https://worker.example/authorize"), onEnv)).text();
    expect(graceOn).toContain('name="invite_code"');

    const offEnv = fakeEnv().env;
    (offEnv as unknown as { INVITE_GRACE: string }).INVITE_GRACE = "off";
    const graceOff = await (await handleAuthorize(new Request("https://worker.example/authorize"), offEnv)).text();
    expect(graceOff).not.toContain('name="invite_code"');
  });

  it("GET with a malformed request yields a 400 page, not an uncaught 500", async () => {
    const { env } = fakeEnv();
    // parseAuthRequest THROWS on a malformed request / invalid redirect_uri.
    (env.OAUTH_PROVIDER as unknown as { parseAuthRequest: () => Promise<never> }).parseAuthRequest =
      async () => {
        throw new Error("invalid redirect_uri");
      };
    const res = await handleAuthorize(new Request("https://worker.example/authorize?bogus=1"), env);
    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain("malformed authorization request");
  });

  it("POST with a valid code completes the grant with props.tenantId and redirects", async () => {
    const { env, completeCalls } = fakeEnv({
      "invite:LET-ME-IN": "alice",
      "tenant:alice": JSON.stringify({ id: "alice" }),
    });
    const res = await handleAuthorize(postForm({ invite_code: "LET-ME-IN", oauth_req: oauthReqB64 }), env);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("code=GRANT");
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0].userId).toBe("alice");
    expect(completeCalls[0].props).toEqual({ tenantId: "alice" });
  });

  it("POST with an unknown code re-renders with an error and issues NO grant", async () => {
    const { env, completeCalls } = fakeEnv({ "tenant:alice": JSON.stringify({ id: "alice" }) });
    const res = await handleAuthorize(postForm({ invite_code: "WRONG", oauth_req: oauthReqB64 }), env);

    expect(res.status).toBe(400);
    expect((await res.text()).toLowerCase()).toContain("check it and try again");
    expect(completeCalls).toHaveLength(0);
  });

  it("trims whitespace around the entered code", async () => {
    const { env, completeCalls } = fakeEnv({
      "invite:CODE": "bob",
      "tenant:bob": JSON.stringify({ id: "bob" }),
    });
    const res = await handleAuthorize(postForm({ invite_code: "  CODE  ", oauth_req: oauthReqB64 }), env);
    expect(res.status).toBe(302);
    expect(completeCalls[0].userId).toBe("bob");
  });
});

describe("handleAuthorizeStatus — cross-device poll", () => {
  const statusReq = (ref: string) => new Request(`https://worker.example/authorize/status?authz=${ref}`);

  it("stays pending until approved, then completes the grant EXACTLY once", async () => {
    const { env, completeCalls } = fakeEnv();
    const { ref } = await mintApproval(env, oauthReqB64, "Claude");

    const pending = await (await handleAuthorizeStatus(statusReq(ref), env)).json();
    expect(pending).toEqual({ status: "pending" });
    expect(completeCalls).toHaveLength(0);

    await approveApproval(env, ref, "casey");
    const approved = (await (await handleAuthorizeStatus(statusReq(ref), env)).json()) as {
      status: string;
      redirect: string;
    };
    expect(approved.status).toBe("approved");
    expect(approved.redirect).toContain("code=GRANT");
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]).toEqual({ userId: "casey", props: { tenantId: "casey" } });

    // A second poll after the single completion is a no-op — the ref is consumed.
    const after = await (await handleAuthorizeStatus(statusReq(ref), env)).json();
    expect(after).toEqual({ status: "expired" });
    expect(completeCalls).toHaveLength(1);
  });

  it("an unknown ref is expired and issues no grant", async () => {
    const { env, completeCalls } = fakeEnv();
    const res = await handleAuthorizeStatus(statusReq("nope"), env);
    expect(await res.json()).toEqual({ status: "expired" });
    expect(completeCalls).toHaveLength(0);
  });
});
