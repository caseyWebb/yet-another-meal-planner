import { describe, it, expect } from "vitest";
import { loadRetrospective } from "../src/cooking-tools.js";
import { GitHubError, type GitHubClient } from "../src/github.js";

/** A read-only fake client: serves the given paths, 404s everything else. */
function ghWith(files: Record<string, string>): GitHubClient {
  return {
    async getFile(path: string) {
      if (path in files) return files[path];
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
  };
}

const LOG = `[[entries]]
date = "2026-06-10"
type = "recipe"
recipe = "tacos"
`;

const INDEX = JSON.stringify({
  tacos: { slug: "tacos", title: "Tacos", protein: "beef", cuisine: "mexican", status: "active" },
});

describe("loadRetrospective — shared vs per-tenant client routing", () => {
  it("reads cooking_log from the personal client and the recipe index from the SHARED client", async () => {
    // Mirrors the live layout: the index lives at the shared root, NOT under
    // users/<id>/. Personal has the log only; shared has the index only.
    const personal = ghWith({ "cooking_log.toml": LOG });
    const shared = ghWith({ "_indexes/recipes.json": INDEX });
    const r = await loadRetrospective(personal, shared, "all");
    expect(r.recipes_cooked.find((x) => x.recipe === "tacos")).toBeTruthy();
    expect(r.protein_mix.beef).toBe(1);
  });

  it("regression: reading the index through the per-tenant client (where it doesn't exist) is index_unavailable", async () => {
    // The original bug: cooking tools got only the prefixed client, so the index
    // read resolved to users/<id>/_indexes/recipes.json → 404 → index_unavailable.
    const personal = ghWith({ "cooking_log.toml": LOG });
    await expect(loadRetrospective(personal, personal, "all")).rejects.toMatchObject({
      code: "index_unavailable",
    });
  });

  it("works with no cooking log yet — empty history, index still from shared", async () => {
    const personal = ghWith({});
    const shared = ghWith({ "_indexes/recipes.json": INDEX });
    const r = await loadRetrospective(personal, shared, "all");
    expect(r.recipes_cooked).toEqual([]);
  });
});
