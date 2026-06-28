import { describe, it, expect, vi, afterEach } from "vitest";
import { handleAdmin } from "../src/admin.js";
import { PROBE_SAMPLE_SIZE } from "../src/discovery-probe.js";
import type { Env } from "../src/env.js";

// The JSON-LD acquisition legs (no_jsonld / not_a_recipe / incomplete) run through HTMLRewriter,
// which doesn't exist in Node — so these route tests cover the reachability paths that
// short-circuit before it: a walled feed (entries 403), an unreachable feed, and the re-probe
// over still-unreachable rows. The parse-level taxonomy is exercised by the live smoke test.

function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) { return m.get(key) ?? null; },
    async put(key: string, value: string) { m.set(key, value); },
    async delete(key: string) { m.delete(key); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}


function devEnv(DB?: Env["DB"]): Env {
  return {
    TENANT_KV: memKv(),
    KROGER_KV: memKv(),
    DB: DB ?? ({ prepare: () => ({ bind: () => ({}) }) } as unknown as Env["DB"]),
    ADMIN_DEV_BYPASS: "1",
  } as unknown as Env;
}

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>F</title>
  <item><title>One</title><link>https://walled.example/one</link></item>
  <item><title>Two</title><link>https://walled.example/two</link></item>
</channel></rss>`;

afterEach(() => vi.unstubAllGlobals());

describe("POST /admin/api/discovery/test-feed", () => {
  it("404s when the admin surface is disabled (no Access, no dev bypass)", async () => {
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB: devEnv().DB } as unknown as Env;
    const res = await handleAdmin(
      new Request("https://x/admin/api/discovery/test-feed", { method: "POST", body: JSON.stringify({ url: "https://f" }) }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("405s on GET", async () => {
    const res = await handleAdmin(new Request("http://localhost/admin/api/discovery/test-feed"), devEnv());
    expect(res.status).toBe(405);
  });

  it("rejects a missing url with a validation error", async () => {
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/discovery/test-feed", { method: "POST", body: JSON.stringify({}) }),
      devEnv(),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_failed");
  });

  it("reports a parsed feed whose entry pages are all bot-walled (403) as not viable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/feed")) return new Response(RSS, { status: 200 });
      return new Response("blocked", { status: 403 }); // every entry page is walled
    }));
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/discovery/test-feed", { method: "POST", body: JSON.stringify({ url: "https://walled.example/feed" }) }),
      devEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feed: { reachable: boolean; parsed: boolean; itemCount: number }; sample: Array<{ outcome: string; status?: number }> };
    expect(body.feed).toMatchObject({ reachable: true, parsed: true, itemCount: 2 });
    expect(body.sample.length).toBeGreaterThan(0);
    expect(body.sample.length).toBeLessThanOrEqual(PROBE_SAMPLE_SIZE);
    expect(body.sample.every((s) => s.outcome === "unreachable" && s.status === 403)).toBe(true);
  });

  it("reports an unreachable feed (fetch throws) without sampling", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/discovery/test-feed", { method: "POST", body: JSON.stringify({ url: "https://down.example/feed" }) }),
      devEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { feed: { reachable: boolean }; sample: unknown[] };
    expect(body.feed.reachable).toBe(false);
    expect(body.sample).toEqual([]);
  });
});

