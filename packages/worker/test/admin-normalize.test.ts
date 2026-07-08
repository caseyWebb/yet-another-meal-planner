import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";

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
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

function devEnv(tables: Record<string, Record<string, unknown>[]>): { env: Env; tables: Record<string, Record<string, unknown>[]> } {
  const { env: dbEnv, tables: t } = fakeD1({ tables });
  return {
    env: {
      ADMIN_DEV_BYPASS: "1",
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: (dbEnv as { DB: unknown }).DB,
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as unknown as Env,
    tables: t,
  };
}

const post = (body: unknown) =>
  ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as RequestInit;

function seeded() {
  return {
    ingredient_identity: [
      { id: "green onion", base: "green onion", detail: null, concrete: 1, representative: null },
      { id: "ground beef", base: "ground beef", detail: null, concrete: 1, representative: null },
      { id: "ground beef::fat-80-20", base: "ground beef", detail: "fat-80-20", concrete: 1, representative: null },
    ],
    ingredient_alias: [{ variant: "scallions", id: "green onion", source: "auto" }],
    ingredient_edge: [{ from_id: "ground beef::fat-80-20", to_id: "ground beef", kind: "general" }],
    novel_ingredient_terms: [{ term: "gochugaru", first_seen: 1, attempts: 0, next_retry_at: null }],
    ingredient_normalization_log: [
      { id: 1, term: "scallions", outcome: "same", resolved_id: "green onion", candidates: JSON.stringify([{ id: "green onion", score: 0.63 }]), model: "m", detail: JSON.stringify({ reason: "synonym" }), created_at: 1 },
      { id: 2, term: "80/20 ground beef", outcome: "specialization", resolved_id: "ground beef::fat-80-20", candidates: null, model: "m", detail: null, created_at: 2 },
    ],
    job_health: [{ name: "ingredient-normalize", ok: 1, last_run_at: 1, summary: "{}" }],
  };
}

describe("Normalization admin area", () => {
  it("serves the Normalize page model via GET /admin/api/normalization/page", async () => {
    const { env } = devEnv(seeded());
    const res = await app.request("/admin/api/normalization/page", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { decisions: { term: string }[]; aliases: unknown[] }; now: number };
    expect(body.data.decisions.map((d) => d.term)).toContain("scallions");
    expect(body.now).toBeGreaterThan(0);
  });

  it("adds a human alias via POST /api/normalization/alias", async () => {
    const { env, tables } = devEnv(seeded());
    const res = await app.request("/admin/api/normalization/alias", post({ variant: "EVOO", canonicalId: "olive oil" }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 1 });
    expect(tables.ingredient_alias).toContainEqual(expect.objectContaining({ variant: "evoo", id: "olive oil", source: "human" }));
  });

  it("rejects an alias add missing a field (400, structured)", async () => {
    const { env } = devEnv(seeded());
    const res = await app.request("/admin/api/normalization/alias", post({ variant: "EVOO" }), env);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
  });

  it("deletes an alias and re-queues a term", async () => {
    const { env, tables } = devEnv(seeded());
    const del = await app.request("/admin/api/normalization/alias/scallions", { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ removed: true });
    expect(tables.ingredient_alias).toHaveLength(0);

    const rq = await app.request("/admin/api/normalization/requeue", post({ term: "cavolo nero" }), env);
    expect(rq.status).toBe(200);
    expect(tables.novel_ingredient_terms.map((r) => r.term)).toContain("cavolo nero");
  });

  it("deletes a decision row via DELETE /api/normalization/decision/:id", async () => {
    const { env, tables } = devEnv(seeded());
    const res = await app.request("/admin/api/normalization/decision/1", { method: "DELETE" }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(tables.ingredient_normalization_log.map((r) => r.id)).toEqual([2]);
  });
});
