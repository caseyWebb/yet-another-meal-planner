import { describe, it, expect } from "vitest";
import { buildServer } from "../src/tools.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { redeemAuthNonce } from "../src/oauth.js";
import type { KvStore } from "../src/kroger-user.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";

/** An in-memory KV satisfying the small surface the consent-nonce path uses. */
function memKv(): KvStore {
  const store = new Map<string, string>();
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
  };
}

/** A minimal Env: `kroger_login_url` only reaches `KROGER_KV`; the rest of buildServer's
 *  wiring is constructed lazily, so undefined bindings are fine for this tool. */
function fakeEnv(kv: KvStore): Env {
  return { KROGER_KV: kv, CORPUS: {} } as unknown as Env;
}

const tenant: Tenant = { id: "casey" } as Tenant;

describe("kroger_login_url tool", () => {
  it("returns a consent URL embedding a nonce bound to the caller's tenant", async () => {
    const kv = memKv();
    const server = buildServer(fakeEnv(kv), tenant, "https://grocery-mcp.example.com");
    const out = await withServer(server, (c) => invokeTool(c, "kroger_login_url", {}));

    expect(out.isError).toBe(false);
    const url = (out.result as { url: string }).url;
    expect(url).toMatch(
      /^https:\/\/grocery-mcp\.example\.com\/oauth\/init\?nonce=[A-Za-z0-9_-]+$/,
    );
    const nonce = new URL(url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(kv, nonce)).toBe("casey");
  });

  it("ignores any tenant passed as an argument — the link binds to the grant tenant", async () => {
    const kv = memKv();
    const server = buildServer(fakeEnv(kv), tenant, "https://grocery-mcp.example.com");
    // The empty input schema strips unknown keys; an attempt to name another tenant is ignored.
    const out = await withServer(server, (c) =>
      invokeTool(c, "kroger_login_url", { tenant: "victim" }),
    );

    expect(out.isError).toBe(false);
    const nonce = new URL((out.result as { url: string }).url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(kv, nonce)).toBe("casey");
  });
});
