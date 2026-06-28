import { describe, it, expect } from "vitest";
import { handleAdmin } from "../src/admin.js";
import { fakeD1 } from "./fake-d1.js";
import type { Env } from "../src/env.js";

/** Minimal in-memory KV (just enough for the Access gate). */
function memKv(): KVNamespace {
  const m = new Map<string, string>();
  return {
    async get(key: string) { return m.get(key) ?? null; },
    async put(key: string, value: string) { m.set(key, value); },
    async delete(key: string) { m.delete(key); },
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
    env: { TENANT_KV: memKv(), KROGER_KV: memKv(), DB: dbEnv.DB, ADMIN_DEV_BYPASS: "1" } as unknown as Env,
    tables: t,
  };
}

const url = (table: string, key?: string) =>
  `http://localhost/admin/api/corpus/${table}${key ? `/${encodeURIComponent(key)}` : ""}`;

describe("GET /admin/api/corpus/<table>", () => {
  it("lists aliases as {variant, canonical} rows with the server column order", async () => {
    const { env } = devEnv({ aliases: [{ variant: "EVOO", canonical: "olive oil" }] });
    const res = await handleAdmin(new Request(url("aliases")), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { table: string; columns: string[]; rows: unknown[] };
    expect(body.table).toBe("aliases");
    expect(body.columns).toEqual(["variant", "canonical"]);
    expect(body.rows).toEqual([{ variant: "EVOO", canonical: "olive oil" }]);
  });

  it("lists the discovery senders/members allowlists by address", async () => {
    const { env } = devEnv({
      discovery_senders: [{ address: "n@news.com", name: "News" }],
      discovery_members: [{ address: "me@x.com" }],
    });
    const senders = (await (await handleAdmin(new Request(url("senders")), env)).json()) as { rows: unknown[] };
    expect(senders.rows).toEqual([{ address: "n@news.com" }]);
    const members = (await (await handleAdmin(new Request(url("members")), env)).json()) as { rows: unknown[] };
    expect(members.rows).toEqual([{ address: "me@x.com" }]);
  });
});

describe("POST /admin/api/corpus/<table>", () => {
  it("adds a feed and a flyer term", async () => {
    const { env, tables } = devEnv({ feeds: [], flyer_terms: [] });
    const feedRes = await handleAdmin(
      new Request(url("feeds"), { method: "POST", body: JSON.stringify({ url: "https://a.com", tags: ["x"] }) }),
      env,
    );
    expect(feedRes.status).toBe(200);
    expect((await feedRes.json()) as { added: number }).toEqual({ added: 1 });
    expect(tables.feeds).toHaveLength(1);

    const termRes = await handleAdmin(
      new Request(url("flyer-terms"), { method: "POST", body: JSON.stringify({ term: "cheese" }) }),
      env,
    );
    expect(termRes.status).toBe(200);
    expect(tables.flyer_terms.map((r) => r.term)).toEqual(["cheese"]);
  });

  it("rejects an invalid add (missing canonical) with 400 and writes nothing", async () => {
    const { env, tables } = devEnv({ aliases: [] });
    const res = await handleAdmin(
      new Request(url("aliases"), { method: "POST", body: JSON.stringify({ variant: "EVOO" }) }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
    expect(tables.aliases).toHaveLength(0);
  });

  it("rejects feed tags that are not a string array (400)", async () => {
    const { env } = devEnv({ feeds: [] });
    const res = await handleAdmin(
      new Request(url("feeds"), { method: "POST", body: JSON.stringify({ url: "https://a.com", tags: "x" }) }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a negative feed weight (400)", async () => {
    const { env } = devEnv({ feeds: [] });
    const res = await handleAdmin(
      new Request(url("feeds"), { method: "POST", body: JSON.stringify({ url: "https://a.com", weight: -1 }) }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a malformed member address (no @) with 400 instead of a silent no-op", async () => {
    const { env, tables } = devEnv({ discovery_members: [] });
    const res = await handleAdmin(
      new Request(url("members"), { method: "POST", body: JSON.stringify({ address: "notanaddress" }) }),
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
    expect(tables.discovery_members).toHaveLength(0);
  });
});

describe("DELETE /admin/api/corpus/<table>/<key>", () => {
  it("removes by primary key and reports whether a row went", async () => {
    const { env, tables } = devEnv({ flyer_terms: [{ term: "fruit" }] });
    const hit = await handleAdmin(new Request(url("flyer-terms", "fruit"), { method: "DELETE" }), env);
    expect(hit.status).toBe(200);
    expect((await hit.json()) as { removed: boolean }).toEqual({ removed: true });
    expect(tables.flyer_terms).toHaveLength(0);

    const miss = await handleAdmin(new Request(url("flyer-terms", "fruit"), { method: "DELETE" }), env);
    expect((await miss.json()) as { removed: boolean }).toEqual({ removed: false });
  });

  it("normalizes an address key on delete", async () => {
    const { env, tables } = devEnv({ discovery_members: [{ address: "me@x.com" }] });
    const res = await handleAdmin(new Request(url("members", "Me@X.com"), { method: "DELETE" }), env);
    expect((await res.json()) as { removed: boolean }).toEqual({ removed: true });
    expect(tables.discovery_members).toHaveLength(0);
  });
});

describe("corpus route guards", () => {
  it("404s an unknown table", async () => {
    const { env } = devEnv({});
    const res = await handleAdmin(new Request(url("bogus")), env);
    expect(res.status).toBe(404);
  });

  it("405s an unsupported method on a valid table", async () => {
    const { env } = devEnv({ aliases: [] });
    const res = await handleAdmin(new Request(url("aliases"), { method: "PUT" }), env);
    expect(res.status).toBe(405);
  });

  it("404s the whole namespace when the Access surface is disabled", async () => {
    const { env: dbEnv } = fakeD1({ tables: { aliases: [] } });
    const env = { TENANT_KV: memKv(), KROGER_KV: memKv(), DB: dbEnv.DB } as unknown as Env;
    const res = await handleAdmin(new Request("https://x/admin/api/corpus/aliases"), env);
    expect(res.status).toBe(404);
  });
});
