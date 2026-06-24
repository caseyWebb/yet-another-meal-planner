import { describe, it, expect } from "vitest";
import { registerCookingWriteTools } from "../src/cooking-write.js";
import type { Env } from "../src/env.js";

// Minimal KV fake (meal-plan state under state:<username>:meal_plan).
function fakeKv(initial: Record<string, string> = {}): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

// A fake D1 capturing INSERTs and answering the recipe-resolution SELECT. `slugs`
// is the set of recipes that exist; `SELECT 1 … WHERE slug=?` returns a row iff the
// bound slug is in it.
function fakeD1(slugs: string[]): {
  env: Env;
  inserts: { sql: string; binds: unknown[] }[];
} {
  const known = new Set(slugs);
  const inserts: { sql: string; binds: unknown[] }[] = [];
  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async first<T>() {
        // SELECT 1 AS ok FROM recipes WHERE slug = ?1
        const slug = binds[0];
        return (typeof slug === "string" && known.has(slug) ? { ok: 1 } : null) as T | null;
      },
      async all<T>() {
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        if (sql.startsWith("INSERT INTO cooking_log")) inserts.push({ sql, binds });
        return { success: true as const, meta: { changes: 1 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { env: { DB } as unknown as Env, inserts };
}

function collect(env: Env, kv: KVNamespace, username: string) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerCookingWriteTools(
    server as unknown as Parameters<typeof registerCookingWriteTools>[0],
    env,
    kv,
    username,
  );
  return handlers;
}

function parse(res: { content: { text: string }[] }) {
  return JSON.parse(res.content[0].text);
}

describe("log_cooked", () => {
  it("inserts a recipe entry (tenant-scoped) and clears it from the meal plan", async () => {
    const { kv, store } = fakeKv({
      "state:everett:meal_plan": JSON.stringify([
        { recipe: "miso-salmon", planned_for: null },
        { recipe: "tacos", planned_for: null },
      ]),
    });
    const { env, inserts } = fakeD1(["miso-salmon"]);
    const handlers = collect(env, kv, "everett");

    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "miso-salmon", date: "2026-06-20" }));
    expect(out.logged).toMatchObject({ type: "recipe", recipe: "miso-salmon", date: "2026-06-20" });
    expect(out.commit_sha).toBeUndefined();

    // INSERT bound tenant + columns.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].binds).toEqual(["everett", "2026-06-20", "recipe", "miso-salmon", null, null, null]);

    // The cooked recipe was removed from the meal plan; the other remains.
    const plan = JSON.parse(store.get("state:everett:meal_plan")!) as { recipe: string }[];
    expect(plan.map((p) => p.recipe)).toEqual(["tacos"]);
  });

  it("defaults date to today when omitted", async () => {
    const { kv } = fakeKv();
    const { env, inserts } = fakeD1(["tacos"]);
    const handlers = collect(env, kv, "everett");
    const today = new Date().toISOString().slice(0, 10);
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "tacos" }));
    expect(out.logged.date).toBe(today);
    expect(inserts[0].binds[1]).toBe(today);
  });

  it("rejects a recipe entry whose slug does not resolve (not_found), writing nothing", async () => {
    const { kv } = fakeKv();
    const { env, inserts } = fakeD1([]); // no recipes exist
    const handlers = collect(env, kv, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "not-a-recipe" }));
    expect(out.error).toBe("not_found");
    expect(inserts).toHaveLength(0);
  });

  it("inserts a ready_to_eat entry with inline dims (no recipe resolution)", async () => {
    const { kv } = fakeKv();
    const { env, inserts } = fakeD1([]);
    const handlers = collect(env, kv, "everett");
    const out = parse(
      await handlers.get("log_cooked")!({ type: "ready_to_eat", name: "frozen lasagna", protein: "beef", date: "2026-06-21" }),
    );
    expect(out.logged).toMatchObject({ type: "ready_to_eat", name: "frozen lasagna" });
    expect(inserts[0].binds).toEqual(["everett", "2026-06-21", "ready_to_eat", null, "frozen lasagna", "beef", null]);
  });

  it("rejects a non-recipe entry with no name (validation_failed)", async () => {
    const { kv } = fakeKv();
    const { env, inserts } = fakeD1([]);
    const handlers = collect(env, kv, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "ad_hoc" }));
    expect(out.error).toBe("validation_failed");
    expect(inserts).toHaveLength(0);
  });

  it("rejects a bad date (validation_failed)", async () => {
    const { kv } = fakeKv();
    const { env, inserts } = fakeD1(["tacos"]);
    const handlers = collect(env, kv, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "tacos", date: "June 21" }));
    expect(out.error).toBe("validation_failed");
    expect(inserts).toHaveLength(0);
  });
});
