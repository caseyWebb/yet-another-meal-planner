import { describe, it, expect } from "vitest";
import {
  loadRecipeIndex,
  recipeSourceMap,
  recipeSlugForSource,
  recipeMeta,
} from "../src/recipe-index.js";
import { ToolError } from "../src/errors.js";
import type { Env } from "../src/env.js";

// The vitest harness has no real D1 binding, so we exercise the row↔RecipeIndex
// mapping against a fake D1Database (same approach as test/db.test.ts). `all`/`first`
// dispatch on the SQL prefix so one fake serves loadRecipeIndex (SELECT *),
// recipeSourceMap (SELECT slug, source_url), recipeMeta (SELECT … IN), and
// recipeSlugForSource (SELECT slug … WHERE source_url).
function fakeEnv(
  rows: Record<string, unknown>[],
  opts: { throwOnAll?: boolean } = {},
): { env: Env; calls: { sql: string; binds: unknown[] }[] } {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const make = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async all<T>() {
        calls.push({ sql, binds });
        if (opts.throwOnAll) throw new Error("no such table: recipes");
        let out = rows;
        if (/WHERE source_url IS NOT NULL/.test(sql)) {
          out = rows.filter((r) => r.source_url != null);
        } else if (/slug IN \(/.test(sql)) {
          out = rows.filter((r) => binds.includes(r.slug));
        }
        return { results: out as T[], success: true as const, meta: { changes: 0 } };
      },
      async first<T>() {
        calls.push({ sql, binds });
        const hit = rows.find((r) => r.source_url === binds[0]);
        return (hit ? { slug: hit.slug } : null) as T | null;
      },
      async run() {
        return { success: true as const, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => make(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { env: { DB } as unknown as Env, calls };
}

const ROW = (over: Record<string, unknown> = {}) => ({
  slug: "r",
  title: "R",
  protein: null,
  cuisine: null,
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
  ...over,
});

describe("loadRecipeIndex", () => {
  it("reconstructs the RecipeIndex: scalars, source_url → source, JSON arrays, extra", async () => {
    const { env } = fakeEnv([
      ROW({
        slug: "salmon-with-rice",
        title: "Salmon with Rice",
        protein: "fish",
        cuisine: "japanese",
        time_total: 30,
        source_url: "https://ex.test/salmon",
        ingredients_key: JSON.stringify(["salmon", "rice"]),
        tags: JSON.stringify(["weeknight"]),
        course: JSON.stringify(["main"]),
        season: JSON.stringify([]),
        dietary: JSON.stringify(["pescatarian"]),
        pairs_with: JSON.stringify(["greens"]),
        perishable_ingredients: JSON.stringify(["salmon"]),
        requires_equipment: JSON.stringify([]),
        extra: JSON.stringify({ style: "sheet-pan", servings: 2 }),
      }),
    ]);
    const index = await loadRecipeIndex(env);
    expect(index["salmon-with-rice"]).toEqual({
      slug: "salmon-with-rice",
      title: "Salmon with Rice",
      protein: "fish",
      cuisine: "japanese",
      time_total: 30,
      source: "https://ex.test/salmon",
      ingredients_key: ["salmon", "rice"],
      tags: ["weeknight"],
      course: ["main"],
      season: [],
      dietary: ["pescatarian"],
      pairs_with: ["greens"],
      perishable_ingredients: ["salmon"],
      requires_equipment: [],
      style: "sheet-pan",
      servings: 2,
    });
  });

  it("an empty table is a valid empty corpus ({}), not an error", async () => {
    const { env } = fakeEnv([]);
    expect(await loadRecipeIndex(env)).toEqual({});
  });

  it("an unreadable table throws a storage_error (caller remaps to index_unavailable)", async () => {
    const { env } = fakeEnv([], { throwOnAll: true });
    await expect(loadRecipeIndex(env)).rejects.toBeInstanceOf(ToolError);
    await expect(loadRecipeIndex(env)).rejects.toMatchObject({ code: "storage_error" });
  });

  it("a column always wins over a stale copy in extra", async () => {
    const { env } = fakeEnv([
      ROW({ slug: "x", title: "Real", extra: JSON.stringify({ title: "Stale" }) }),
    ]);
    const index = await loadRecipeIndex(env);
    expect(index["x"].title).toBe("Real");
  });
});

describe("recipeSourceMap / recipeSlugForSource / recipeMeta", () => {
  it("recipeSourceMap returns raw source_url → slug, skipping null sources", async () => {
    const { env } = fakeEnv([
      ROW({ slug: "a", source_url: "https://ex.test/a" }),
      ROW({ slug: "b", source_url: null }),
    ]);
    const map = await recipeSourceMap(env);
    expect(map.get("https://ex.test/a")).toBe("a");
    expect(map.size).toBe(1);
  });

  it("recipeSlugForSource is an indexed point lookup (WHERE source_url = ?)", async () => {
    const { env, calls } = fakeEnv([ROW({ slug: "a", source_url: "https://ex.test/a" })]);
    expect(await recipeSlugForSource(env, "https://ex.test/a")).toBe("a");
    expect(await recipeSlugForSource(env, "https://ex.test/missing")).toBeNull();
    expect(calls.some((c) => /WHERE source_url = \?1/.test(c.sql))).toBe(true);
  });

  it("recipeMeta resolves protein/cuisine for the given slugs; empty input is a no-op", async () => {
    const { env } = fakeEnv([
      ROW({ slug: "a", protein: "beef", cuisine: "mexican" }),
      ROW({ slug: "b", protein: "fish", cuisine: "japanese" }),
    ]);
    const meta = await recipeMeta(env, ["a"]);
    expect(meta.get("a")).toEqual({ protein: "beef", cuisine: "mexican" });
    expect(meta.has("b")).toBe(false);
    expect((await recipeMeta(env, [])).size).toBe(0);
  });
});
