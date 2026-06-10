import { describe, it, expect } from "vitest";
import { handleAuthorize } from "../src/authorize.js";
import type { Env } from "../src/env.js";

function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return { async get(key: string) { return m.get(key) ?? null; } } as unknown as KVNamespace;
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

describe("handleAuthorize — invite-code consent", () => {
  it("GET renders the invite-code form carrying the parsed request", async () => {
    const { env } = fakeEnv();
    const res = await handleAuthorize(new Request("https://worker.example/authorize?response_type=code"), env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.toLowerCase()).toContain("invite code");
    expect(html).toContain('name="invite_code"');
    expect(html).toContain(oauthReqB64); // the round-tripped request
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
