import { describe, it, expect } from "vitest";
import { handleAdmin } from "./admin-request.js";
import type { Env } from "../src/env.js";

/** In-memory KV (get/put/delete/list single page) — enough for the admin deps the gate builds. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

/** Returns no-op object; only used where the gate 404s before any DB access. */
const throwingD1 = () => ({}) as unknown as Env["DB"];

interface DiscoveryRow {
  id: string;
  url: string | null;
  title: string | null;
  source: string | null;
  outcome: string;
  slug: string | null;
  detail: string | null; // stored as a JSON string (the column shape readDiscoveryLog parses)
  created_at: string | null;
}

/**
 * A minimal D1 fake honoring exactly what readDiscoveryLog does: a SELECT over discovery_log,
 * `ORDER BY created_at DESC`, with a positional `LIMIT ?1` it actually applies — so the test can
 * assert both most-recent-first ordering AND that the read is bounded by the cap, and capture the
 * limit the endpoint passed.
 */
function discoveryD1(rows: DiscoveryRow[]): { DB: Env["DB"]; lastLimit: () => number | undefined } {
  let lastLimit: number | undefined;
  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async all<T>() {
        if (/FROM discovery_log/i.test(sql)) {
          const limit = Number(binds[0]);
          lastLimit = limit;
          const ordered = [...rows].sort((a, b) =>
            (a.created_at ?? "") < (b.created_at ?? "") ? 1 : (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 0,
          );
          return { results: ordered.slice(0, limit) as unknown as T[], success: true as const, meta: { changes: 0 } };
        }
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { success: true as const, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as Env["DB"];
  return { DB, lastLimit: () => lastLimit };
}

function row(over: Partial<DiscoveryRow> & Pick<DiscoveryRow, "id" | "outcome" | "created_at">): DiscoveryRow {
  return {
    url: null,
    title: null,
    source: null,
    slug: null,
    detail: null,
    ...over,
  };
}

describe("handleAdmin (logs › discovery)", () => {
  it("404s the discovery log when the surface is disabled (no Access config)", async () => {
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB: throwingD1() } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/logs/discovery"), env);
    expect(res.status).toBe(404);
  });

  it("403s the discovery log when Access is configured but no assertion is present", async () => {
    const env = {
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: throwingD1(),
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "aud123",
    } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/logs/discovery"), env);
    expect(res.status).toBe(403);
  });

  it("returns the discovery log entries most-recent-first (group-wide)", async () => {
    const { DB } = discoveryD1([
      row({ id: "a", outcome: "imported", created_at: "2026-06-27T10:00:00.000Z", title: "Older", slug: "older", detail: JSON.stringify({ attribution: [{ tenant: "casey", score: 0.8 }] }) }),
      row({ id: "b", outcome: "duplicate", created_at: "2026-06-27T12:00:00.000Z", title: "Newer", detail: JSON.stringify({ duplicate_of: "stew" }) }),
    ]);
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB, ADMIN_DEV_BYPASS: "1" } as unknown as Env;
    const res = await handleAdmin(new Request("http://localhost/admin/api/logs/discovery"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ id: string; outcome: string; detail: unknown }> };
    // Most-recent-first: b (12:00) before a (10:00).
    expect(body.entries.map((e) => e.id)).toEqual(["b", "a"]);
    // detail is parsed back into an object (not the raw JSON string).
    expect(body.entries[0].detail).toEqual({ duplicate_of: "stew" });
    expect(body.entries[1]).toMatchObject({ outcome: "imported", detail: { attribution: [{ tenant: "casey", score: 0.8 }] } });
  });

  it("bounds the read to the cap (most recent N, not the whole history)", async () => {
    // 250 rows, increasing timestamps — the endpoint must cap at 200 and keep the newest.
    const many = Array.from({ length: 250 }, (_, i) =>
      row({ id: `r${i}`, outcome: "no_match", created_at: `2026-06-27T${String(i).padStart(4, "0")}` }),
    );
    const { DB, lastLimit } = discoveryD1(many);
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB, ADMIN_DEV_BYPASS: "1" } as unknown as Env;
    const res = await handleAdmin(new Request("http://localhost/admin/api/logs/discovery"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<{ id: string }> };
    // Bounded: a cap of at most 200 rows was requested AND returned.
    expect(lastLimit()).toBeLessThanOrEqual(200);
    expect(body.entries.length).toBeLessThanOrEqual(200);
    expect(body.entries.length).toBe(200);
    // The newest row (highest timestamp) is kept; the oldest fall off.
    expect(body.entries[0].id).toBe("r249");
  });

});
