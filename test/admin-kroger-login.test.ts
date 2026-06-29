import { describe, it, expect } from "vitest";
import { handleAdmin } from "../src/admin.js";
import { redeemAuthNonce } from "../src/oauth.js";
import type { Env } from "../src/env.js";
import type { KvStore } from "../src/kroger-user.js";
import { fakeD1 } from "./fake-d1.js";

/** In-memory KV with get/put/delete/list — satisfies KVNamespace + KvStore. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) { return m.get(key) ?? null; },
    async put(key: string, value: string) { m.set(key, value); },
    async delete(key: string) { m.delete(key); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

/** Env with the admin dev-bypass on (Access unset) so `handleAdmin` runs offline on a
 *  loopback host — the same escape `wrangler dev` uses. */
function devEnv(over: Partial<Env> = {}): Env {
  return {
    ADMIN_DEV_BYPASS: "1",
    TENANT_KV: memKv({ "tenant:casey": JSON.stringify({ id: "casey" }) }),
    KROGER_KV: memKv(),
    DB: fakeD1(),
    ...over,
  } as unknown as Env;
}

const post = (url: string) => new Request(url, { method: "POST" });

describe("admin Kroger consent-link mint", () => {
  it("mints a redeemable consent link for an allowlisted member", async () => {
    const env = devEnv();
    const res = await handleAdmin(
      post("https://localhost/admin/api/tenants/casey/kroger-login"),
      env,
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^https:\/\/localhost\/oauth\/init\?nonce=[A-Za-z0-9_-]+$/);
    const nonce = new URL(url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(env.KROGER_KV as unknown as KvStore, nonce)).toBe("casey");
  });

  it("rejects minting for a non-allowlisted tenant (404)", async () => {
    const res = await handleAdmin(
      post("https://localhost/admin/api/tenants/ghost/kroger-login"),
      devEnv(),
    );
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe("not_found");
  });

  it("404s when the admin surface is unconfigured (no Access, no dev bypass)", async () => {
    const env = devEnv({ ADMIN_DEV_BYPASS: undefined });
    // Non-loopback host with Access unset and no bypass → the surface is disabled.
    const res = await handleAdmin(
      post("https://admin.example.com/admin/api/tenants/casey/kroger-login"),
      env,
    );
    expect(res.status).toBe(404);
  });
});
