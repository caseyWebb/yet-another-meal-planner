import { describe, it, expect } from "vitest";
import { handleAuthorize, handleAuthorizeStatus } from "../src/authorize.js";
import { mintApproval, approveApproval } from "../src/connect-approval.js";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";

const OAUTH_REQ = {
  responseType: "code",
  clientId: "claude-connector",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  scope: ["mcp"],
  state: "xyz",
  codeChallenge: "abc",
  codeChallengeMethod: "S256",
};

/**
 * A fake env whose OAUTH_PROVIDER records completeAuthorization calls. Backed by a
 * real-SQLite D1: both completion sites are gated through `resolveIdentity`
 * (households-friends-and-people-page 7.1b), so the surface reads the `members` table
 * (the lazy convergence guard mints founding members for the legacy fixtures here).
 */
function fakeEnv(kv: Record<string, string> = {}) {
  const completeCalls: Array<{ userId: string; props: unknown }> = [];
  const h = sqliteEnv();
  const env = {
    ...(h.env as unknown as Record<string, unknown>),
    OAUTH_PROVIDER: {
      parseAuthRequest: async () => ({ ...OAUTH_REQ }),
      lookupClient: async (clientId: string) => ({ clientId, clientName: "Claude" }),
      completeAuthorization: async (opts: { userId: string; props: unknown }) => {
        completeCalls.push({ userId: opts.userId, props: opts.props });
        return { redirectTo: "https://claude.ai/api/mcp/auth_callback?code=GRANT&state=xyz" };
      },
    },
  } as unknown as Env;
  for (const [k, v] of Object.entries(kv)) void env.TENANT_KV.put(k, v); // memKv sets synchronously
  return { env, completeCalls, raw: h.raw };
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

  it("POST with a valid code completes the grant with props { tenantId, memberId } and redirects", async () => {
    const { env, completeCalls } = fakeEnv({
      "invite:LET-ME-IN": "alice", // a LEGACY record: no member field → founding member
      "tenant:alice": JSON.stringify({ id: "alice" }),
    });
    const res = await handleAuthorize(postForm({ invite_code: "LET-ME-IN", oauth_req: oauthReqB64 }), env);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("code=GRANT");
    expect(completeCalls).toHaveLength(1);
    // The roster grant-scan contract: userId is the TENANT id (grant:<userId>:* keys group by
    // tenant), NEVER the member — the member rides only in props.
    expect(completeCalls[0].userId).toBe("alice");
    expect(completeCalls[0].props).toEqual({ tenantId: "alice", memberId: "alice" });
  });

  it("POST binds a member-addressed bootstrap invite's pair into the grant props", async () => {
    const { env, completeCalls, raw } = fakeEnv({
      "invite:BOOT": JSON.stringify({ v: 1, tenant: "alice", member: "m2", single_use: true, expires_at: 0 }),
      "tenant:alice": JSON.stringify({ id: "alice" }),
    });
    // The member-liveness gate (7.1b): a non-founding member must exist as a row.
    raw.prepare("INSERT INTO members (id, tenant, handle, created_at) VALUES ('m2', 'alice', 'm2', 1)").run();
    const res = await handleAuthorize(postForm({ invite_code: "BOOT", oauth_req: oauthReqB64 }), env);
    expect(res.status).toBe(302);
    expect(completeCalls[0].userId).toBe("alice"); // still the tenant (roster contract)
    expect(completeCalls[0].props).toEqual({ tenantId: "alice", memberId: "m2" });
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
    const { env, completeCalls } = fakeEnv({ "tenant:casey": JSON.stringify({ id: "casey" }) });
    const { ref } = await mintApproval(env, oauthReqB64, "Claude");

    const pending = await (await handleAuthorizeStatus(statusReq(ref), env)).json();
    expect(pending).toEqual({ status: "pending" });
    expect(completeCalls).toHaveLength(0);

    await approveApproval(env, ref, "casey", "casey");
    const approved = (await (await handleAuthorizeStatus(statusReq(ref), env)).json()) as {
      status: string;
      redirect: string;
    };
    expect(approved.status).toBe("approved");
    expect(approved.redirect).toContain("code=GRANT");
    expect(completeCalls).toHaveLength(1);
    // userId = tenant id (the roster grant-scan contract); the approving member in props.
    expect(completeCalls[0]).toEqual({ userId: "casey", props: { tenantId: "casey", memberId: "casey" } });

    // A second poll after the single completion is a no-op — the ref is consumed.
    const after = await (await handleAuthorizeStatus(statusReq(ref), env)).json();
    expect(after).toEqual({ status: "expired" });
    expect(completeCalls).toHaveLength(1);
  });

  it("a PRE-SPLIT approved authz record (no member) completes as the founding member", async () => {
    const { env, completeCalls } = fakeEnv({ "tenant:casey": JSON.stringify({ id: "casey" }) });
    await env.TENANT_KV.put(
      "authz:legacy",
      JSON.stringify({ oauth: oauthReqB64, clientName: "Claude", code: "ABC234", status: "approved", tenant: "casey" }),
    );
    const approved = (await (await handleAuthorizeStatus(statusReq("legacy"), env)).json()) as { status: string };
    expect(approved.status).toBe("approved");
    expect(completeCalls[0]).toEqual({ userId: "casey", props: { tenantId: "casey", memberId: "casey" } });
  });

  it("an unknown ref is expired and issues no grant", async () => {
    const { env, completeCalls } = fakeEnv();
    const res = await handleAuthorizeStatus(statusReq("nope"), env);
    expect(await res.json()).toEqual({ status: "expired" });
    expect(completeCalls).toHaveLength(0);
  });
});
