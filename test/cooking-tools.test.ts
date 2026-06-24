import { describe, it, expect } from "vitest";
import { loadRetrospective } from "../src/cooking-tools.js";
import type { Env } from "../src/env.js";

// Minimal KV fake (meal-plan state; loadRetrospective no longer reads the profile
// from KV — the overlay is the D1 `overlay` table, served empty by envWith below).
function fakeKv(initial: Record<string, string> = {}): KVNamespace {
  const store = new Map(Object.entries(initial));
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
  } as unknown as KVNamespace;
}

// A fake D1Database that routes by SQL: the `cooking_log LEFT JOIN recipes` window
// query returns `joinRows`; `SELECT * FROM recipes` returns `recipeRows`.
// `throwOnRecipes` simulates an unreadable recipes table (index_unavailable).
function envWith(
  joinRows: Record<string, unknown>[],
  recipeRows: Record<string, unknown>[],
  opts: { throwOnRecipes?: boolean } = {},
): Env {
  const makeStmt = (sql: string) => {
    const stmt = {
      bind() {
        return stmt;
      },
      async all<T>() {
        if (sql.includes("FROM cooking_log")) {
          return { results: joinRows as T[], success: true as const, meta: { changes: 0 } };
        }
        if (sql.includes("FROM recipes")) {
          if (opts.throwOnRecipes) throw new Error("no such table: recipes");
          return { results: recipeRows as T[], success: true as const, meta: { changes: 0 } };
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
  } as unknown as D1Database;
  return { DB } as unknown as Env;
}

// One D1 `recipes` row (objective columns only — JSON arrays as TEXT).
const TACOS_ROW = {
  slug: "tacos",
  title: "Tacos",
  protein: "beef",
  cuisine: "mexican",
  time_total: null,
  ingredients_key: null,
  source_url: null,
  tags: null,
  course: null,
  season: null,
  dietary: null,
  pairs_with: null,
  perishable_ingredients: null,
  requires_equipment: null,
  extra: null,
};

describe("loadRetrospective — D1 cooking_log + recipe index", () => {
  it("aggregates protein/cuisine from the joined cooking_log rows", async () => {
    // The join row carries protein/cuisine already COALESCE'd in (recipe-derived).
    const joinRows = [{ type: "recipe", date: "2026-06-10", recipe: "tacos", name: null, protein: "beef", cuisine: "mexican" }];
    const env = envWith(joinRows, [TACOS_ROW]);
    const r = await loadRetrospective(env, fakeKv(), "everett", "all");
    expect(r.recipes_cooked.find((x) => x.recipe === "tacos")).toBeTruthy();
    expect(r.protein_mix.beef).toBe(1);
    expect(r.cuisine_mix.mexican).toBe(1);
  });

  it("counts a non-recipe entry's inline dims", async () => {
    const joinRows = [{ type: "ad_hoc", date: "2026-06-11", recipe: null, name: "stir fry", protein: "chicken", cuisine: null }];
    const env = envWith(joinRows, []);
    const r = await loadRetrospective(env, fakeKv(), "everett", "all");
    expect(r.protein_mix.chicken).toBe(1);
    expect(r.cuisine_mix.unknown).toBe(1);
  });

  it("surfaces index_unavailable when the recipes table is unreadable", async () => {
    const joinRows = [{ type: "recipe", date: "2026-06-10", recipe: "tacos", name: null, protein: "beef", cuisine: "mexican" }];
    const env = envWith(joinRows, [], { throwOnRecipes: true });
    await expect(loadRetrospective(env, fakeKv(), "everett", "all")).rejects.toMatchObject({
      code: "index_unavailable",
    });
  });

  it("an empty log is not an error — empty history", async () => {
    const env = envWith([], []);
    const r = await loadRetrospective(env, fakeKv(), "everett", "all");
    expect(r.recipes_cooked).toEqual([]);
  });
});
