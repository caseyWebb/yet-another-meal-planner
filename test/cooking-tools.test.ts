import { describe, it, expect } from "vitest";
import { loadRetrospective } from "../src/cooking-tools.js";
import { GitHubError, type GitHubClient } from "../src/github.js";
import type { Env } from "../src/env.js";

function ghWith(files: Record<string, string>): GitHubClient {
  return {
    async getFile(path: string) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async listDir(path: string) {
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async getRef() {
      return "x";
    },
    async getCommitTree() {
      return "x";
    },
    async createTree() {
      return "x";
    },
    async createCommit() {
      return "x";
    },
    async updateRef() {},
    async createIssue() {
      return { url: "https://example.test/issues/1", number: 1 };
    },
    async getPagesUrl() {
      return { url: null, enabled: false };
    },
  };
}

// A fake D1Database for the recipe index (loadRecipeIndex does `SELECT * FROM
// recipes`). `rows` are the table rows; `throwOnAll` simulates an unreadable table.
function envWithRecipes(
  rows: Record<string, unknown>[],
  opts: { throwOnAll?: boolean } = {},
): Env {
  const stmt = {
    bind() {
      return stmt;
    },
    async all<T>() {
      if (opts.throwOnAll) throw new Error("no such table: recipes");
      return { results: rows as T[], success: true as const, meta: { changes: 0 } };
    },
    async first<T>() {
      return (rows[0] ?? null) as T | null;
    },
    async run() {
      return { success: true as const, meta: { changes: 0 } };
    },
  };
  const DB = {
    prepare: () => stmt as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { DB } as unknown as Env;
}

const LOG = `[[entries]]
date = "2026-06-10"
type = "recipe"
recipe = "tacos"
`;

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

describe("loadRetrospective — D1 index routing", () => {
  it("reads cooking_log from the personal client and the recipe index from D1", async () => {
    const personal = ghWith({ "cooking_log.toml": LOG });
    const env = envWithRecipes([TACOS_ROW]);
    const r = await loadRetrospective(personal, env, "all");
    expect(r.recipes_cooked.find((x) => x.recipe === "tacos")).toBeTruthy();
    expect(r.protein_mix.beef).toBe(1);
  });

  it("surfaces index_unavailable when the recipes table is unreadable", async () => {
    const personal = ghWith({ "cooking_log.toml": LOG });
    const env = envWithRecipes([], { throwOnAll: true });
    await expect(loadRetrospective(personal, env, "all")).rejects.toMatchObject({
      code: "index_unavailable",
    });
  });

  it("an empty recipes table is not an error — empty history, index just empty", async () => {
    const personal = ghWith({});
    const env = envWithRecipes([]);
    const r = await loadRetrospective(personal, env, "all");
    expect(r.recipes_cooked).toEqual([]);
  });
});
