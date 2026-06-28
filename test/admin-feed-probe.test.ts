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

/** A D1 fake backing the discovery_log table for the re-probe (legacy SELECT + detail UPDATE). */
function logD1(rows: Array<{ id: string; url: string; detail: Record<string, unknown> }>): {
  DB: Env["DB"];
  current: () => Map<string, Record<string, unknown>>;
} {
  const store = new Map(rows.map((r) => [r.id, { ...r, detail: JSON.stringify(r.detail) }]));
  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) { binds = v; return stmt; },
      async first<T>() { return null as T | null; },
      async all<T>() {
        if (/json_extract\(detail, '\$\.reason'\) = 'unreachable'/.test(sql)) {
          const results = [...store.values()]
            .filter((r) => (JSON.parse(r.detail).reason === "unreachable"))
            .map((r) => ({ id: r.id, url: r.url, title: null, source: null, outcome: "error", slug: null, detail: r.detail, created_at: null }));
          return { results: results as T[], success: true as const, meta: { changes: 0 } };
        }
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        if (/UPDATE discovery_log SET detail/.test(sql)) {
          const [id, detail] = binds as [string, string];
          const row = store.get(id);
          if (row) row.detail = detail;
        }
        return { success: true as const, meta: { changes: 1 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() { return []; },
  } as unknown as Env["DB"];
  return {
    DB,
    current: () => new Map([...store.values()].map((r) => [r.id, JSON.parse(r.detail)])),
  };
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

describe("POST /admin/api/discovery/reprobe-parked", () => {
  it("405s on GET", async () => {
    const res = await handleAdmin(new Request("http://localhost/admin/api/discovery/reprobe-parked"), devEnv());
    expect(res.status).toBe(405);
  });

  it("keeps still-unreachable rows unreachable and skips already-specific rows", async () => {
    const { DB, current } = logD1([
      { id: "r1", url: "https://dead.example/a", detail: { reason: "unreachable" } },
      { id: "r2", url: "https://ok.example/b", detail: { reason: "not_a_recipe" } }, // already specific → not selected
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/discovery/reprobe-parked", { method: "POST" }),
      devEnv(DB),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scanned: number; stillUnreachable: number; reclassified: number };
    expect(body.scanned).toBe(1); // r2 excluded by the json_extract filter
    expect(body.stillUnreachable).toBe(1);
    const after = current();
    expect(after.get("r1")).toMatchObject({ reason: "unreachable", status: 404 });
    expect(after.get("r2")).toEqual({ reason: "not_a_recipe" }); // untouched
  });

  it("is idempotent — a second run with no legacy rows scans nothing", async () => {
    const { DB } = logD1([{ id: "r1", url: "https://ok.example/a", detail: { reason: "not_a_recipe" } }]);
    const res = await handleAdmin(
      new Request("http://localhost/admin/api/discovery/reprobe-parked", { method: "POST" }),
      devEnv(DB),
    );
    const body = (await res.json()) as { scanned: number };
    expect(body.scanned).toBe(0);
  });
});
