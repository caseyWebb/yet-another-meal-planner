import { describe, it, expect } from "vitest";
import { prefixedClient, type GitHubClient, type TreeFile } from "../src/github.js";

/** A fake client that records the paths it was asked to read/write. */
function recorder() {
  const reads: string[] = [];
  let treePaths: string[] = [];
  const gh: GitHubClient = {
    async getFile(path) { reads.push(path); return `contents of ${path}`; },
    async getRef() { return "refsha"; },
    async getCommitTree() { return "treesha"; },
    async createTree(_base, files: TreeFile[]) { treePaths = files.map((f) => f.path); return "newtree"; },
    async createCommit() { return "commitsha"; },
    async updateRef() {},
    async createIssue() { return { url: "https://example.test/issues/1", number: 1 }; },
  };
  return { gh, reads, get treePaths() { return treePaths; } };
}

describe("prefixedClient", () => {
  it("prefixes read paths under the user subtree", async () => {
    const r = recorder();
    const c = prefixedClient(r.gh, "users/alice");
    await c.getFile("pantry.toml");
    expect(r.reads).toEqual(["users/alice/pantry.toml"]);
  });

  it("prefixes tree file paths on write", async () => {
    const r = recorder();
    const c = prefixedClient(r.gh, "users/alice");
    await c.createTree("base", [
      { path: "overlay.toml", content: "x" },
      { path: "notes/foo.md", content: "y" },
    ]);
    expect(r.treePaths).toEqual(["users/alice/overlay.toml", "users/alice/notes/foo.md"]);
  });

  it("leaves ref/commit operations untouched (same repo, same ref)", async () => {
    const r = recorder();
    const c = prefixedClient(r.gh, "users/alice");
    expect(await c.getRef()).toBe("refsha");
    expect(await c.getCommitTree("c")).toBe("treesha");
    expect(await c.createCommit("m", "t", "p")).toBe("commitsha");
  });

  it("an empty prefix returns the client unchanged (pre-migration root layout)", async () => {
    const r = recorder();
    const c = prefixedClient(r.gh, "");
    expect(c).toBe(r.gh);
    await c.getFile("pantry.toml");
    expect(r.reads).toEqual(["pantry.toml"]);
  });

  it("two tenants' clients never reach each other's subtree", async () => {
    const r = recorder();
    const alice = prefixedClient(r.gh, "users/alice");
    const bob = prefixedClient(r.gh, "users/bob");
    await alice.getFile("pantry.toml");
    await bob.getFile("pantry.toml");
    expect(r.reads).toEqual(["users/alice/pantry.toml", "users/bob/pantry.toml"]);
  });
});
