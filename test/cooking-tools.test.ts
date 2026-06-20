import { describe, it, expect } from "vitest";
import { loadRetrospective } from "../src/cooking-tools.js";
import { GitHubError, type GitHubClient } from "../src/github.js";

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

function kvWith(keys: Record<string, string>): KVNamespace {
  return {
    async get(key: string) {
      return (keys[key] as string) ?? null;
    },
  } as unknown as KVNamespace;
}

const LOG = `[[entries]]
date = "2026-06-10"
type = "recipe"
recipe = "tacos"
`;

const INDEX = JSON.stringify({
  tacos: { slug: "tacos", title: "Tacos", protein: "beef", cuisine: "mexican", status: "active" },
});

describe("loadRetrospective — KV index routing", () => {
  it("reads cooking_log from the personal client and the recipe index from DATA_KV", async () => {
    const personal = ghWith({ "cooking_log.toml": LOG });
    const dataKv = kvWith({ "index:recipes": INDEX });
    const r = await loadRetrospective(personal, dataKv, "all");
    expect(r.recipes_cooked.find((x) => x.recipe === "tacos")).toBeTruthy();
    expect(r.protein_mix.beef).toBe(1);
  });

  it("returns index_unavailable when the KV key is absent (index not yet published)", async () => {
    const personal = ghWith({ "cooking_log.toml": LOG });
    const dataKv = kvWith({});
    await expect(loadRetrospective(personal, dataKv, "all")).rejects.toMatchObject({
      code: "index_unavailable",
    });
  });

  it("works with no cooking log yet — empty history, index still from KV", async () => {
    const personal = ghWith({});
    const dataKv = kvWith({ "index:recipes": INDEX });
    const r = await loadRetrospective(personal, dataKv, "all");
    expect(r.recipes_cooked).toEqual([]);
  });
});
