import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";

/** Minimal in-memory KV (just enough for the Access gate's loopback bypass). */
function memKv(): KVNamespace {
  const m = new Map<string, string>();
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

/** A dev-bypass (loopback) env over a fakeD1-seeded corpus. */
function devEnv(tables: Record<string, Record<string, unknown>[]>): { env: Env; tables: Record<string, Record<string, unknown>[]> } {
  const { env: dbEnv, tables: t } = fakeD1({ tables });
  return {
    env: {
      ADMIN_DEV_BYPASS: "1",
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: dbEnv.DB,
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as unknown as Env,
    tables: t,
  };
}

describe("Config › shared-corpus editors (SSR pages)", () => {
  it("server-renders a corpus editor page seeding the island from listCorpus", async () => {
    const { env } = devEnv({ aliases: [{ variant: "EVOO", canonical: "olive oil" }] });
    const res = await app.request("/admin/config/aliases", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Ingredient aliases");
    // The sub-nav pill is marked active for the current table.
    expect(html).toContain('class="pill active"');
    // The seeded row + table config ride in the props, and the generic editor island bootstraps.
    expect(html).toContain("EVOO");
    expect(html).toContain("olive oil");
    expect(html).toContain("/admin/islands/corpus.js");
  });

  it("404s an unknown corpus table slug as a structured not_found, not a 500", async () => {
    const { env } = devEnv({ aliases: [] });
    const res = await app.request("/admin/config/nonsense", {}, env);
    // No SSR route matches /config/nonsense, so it falls through to ASSETS (404 here).
    expect(res.status).toBe(404);
  });
});

describe("Config › shared-corpus editors (typed API routes)", () => {
  it("lists a table via GET /admin/api/corpus/:table", async () => {
    const { env } = devEnv({ aliases: [{ variant: "EVOO", canonical: "olive oil" }] });
    const res = await app.request("/admin/api/corpus/aliases", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      table: "aliases",
      columns: ["variant", "canonical"],
      rows: [{ variant: "EVOO", canonical: "olive oil" }],
    });
  });

  it("adds a row via POST and removes it via DELETE", async () => {
    const { env, tables } = devEnv({ flyer_terms: [] });
    const add = await app.request(
      "/admin/api/corpus/flyer-terms",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term: "cheese" }) },
      env,
    );
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ added: 1 });
    expect(tables.flyer_terms.map((r) => r.term)).toEqual(["cheese"]);

    const del = await app.request("/admin/api/corpus/flyer-terms/cheese", { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ removed: true });
    expect(tables.flyer_terms).toHaveLength(0);
  });

  it("surfaces an unknown table as a structured 404 (not a 500)", async () => {
    const { env } = devEnv({ aliases: [] });
    const res = await app.request("/admin/api/corpus/nonsense", {}, env);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_found" });
  });

  it("rejects an invalid add (missing canonical) with a structured 400, writing nothing", async () => {
    const { env, tables } = devEnv({ aliases: [] });
    const res = await app.request(
      "/admin/api/corpus/aliases",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ variant: "EVOO" }) },
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
    expect(tables.aliases).toHaveLength(0);
  });

  const post = (body: unknown) =>
    ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as RequestInit;

  it("rejects feed tags that are not a string array (400)", async () => {
    const { env } = devEnv({ feeds: [] });
    const res = await app.request("/admin/api/corpus/feeds", post({ url: "https://a.com", tags: "x" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a negative feed weight (400)", async () => {
    const { env } = devEnv({ feeds: [] });
    const res = await app.request("/admin/api/corpus/feeds", post({ url: "https://a.com", weight: -1 }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed member address (no @) with 400 instead of a silent no-op", async () => {
    const { env, tables } = devEnv({ discovery_members: [] });
    const res = await app.request("/admin/api/corpus/members", post({ address: "notanaddress" }), env);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
    expect(tables.discovery_members).toHaveLength(0);
  });

  it("removes by primary key idempotently (removed: true, then false)", async () => {
    const { env, tables } = devEnv({ flyer_terms: [{ term: "fruit" }] });
    const hit = await app.request("/admin/api/corpus/flyer-terms/fruit", { method: "DELETE" }, env);
    expect(await hit.json()).toEqual({ removed: true });
    expect(tables.flyer_terms).toHaveLength(0);
    const miss = await app.request("/admin/api/corpus/flyer-terms/fruit", { method: "DELETE" }, env);
    expect(await miss.json()).toEqual({ removed: false });
  });

  it("normalizes an address key on delete", async () => {
    const { env } = devEnv({ discovery_members: [{ address: "me@x.com" }] });
    const res = await app.request("/admin/api/corpus/members/Me@X.com", { method: "DELETE" }, env);
    expect(await res.json()).toEqual({ removed: true });
  });
});
