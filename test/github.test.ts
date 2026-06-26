import { describe, it, expect, vi, afterEach } from "vitest";
import { createGitHubClient, prefixedClient, type GitHubClient, type TreeFile } from "../src/github.js";

afterEach(() => vi.unstubAllGlobals());

/** A fake client that records the paths it was asked to read/write. */
function recorder() {
  const reads: string[] = [];
  let treePaths: string[] = [];
  const gh: GitHubClient = {
    async getFile(path) { reads.push(path); return `contents of ${path}`; },
    async listDir(path) { reads.push(path); return []; },
    async getRef() { return "refsha"; },
    async getCommitTree() { return "treesha"; },
    async createTree(_base, files: TreeFile[]) { treePaths = files.map((f) => f.path); return "newtree"; },
    async createCommit() { return "commitsha"; },
    async updateRef() {},
    async createIssue() { return { url: "https://example.test/issues/1", number: 1 }; },
    async getPagesUrl() { return { url: null, enabled: false }; },
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

describe("listDir", () => {
  const auth = { token: async () => "tok" };
  const coords = { owner: "o", repo: "r", ref: "main" };

  it("returns the file/dir entries from a Contents API listing, dropping unknown types", async () => {
    let captured = "";
    vi.stubGlobal("fetch", (async (url: string) => {
      captured = url;
      return new Response(
        JSON.stringify([
          { name: "tender-herbs.md", type: "file" },
          { name: "sub", type: "dir" },
          { name: "weird", type: "symlink" },
        ]),
        { status: 200 },
      );
    }) as unknown as typeof fetch);

    const gh = createGitHubClient(coords, auth);
    expect(await gh.listDir("guidance/ingredient_storage")).toEqual([
      { name: "tender-herbs.md", type: "file" },
      { name: "sub", type: "dir" },
    ]);
    expect(captured).toBe(
      "https://api.github.com/repos/o/r/contents/guidance/ingredient_storage?ref=main",
    );
  });

  it("throws GitHubError(404) when the directory is absent", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    await expect(gh.listDir("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("getPagesUrl", () => {
  const auth = { token: async () => "tok" };
  const coords = { owner: "o", repo: "r", ref: "main" };

  it("returns the published html_url when Pages is enabled", async () => {
    let captured = "";
    vi.stubGlobal("fetch", (async (url: string) => {
      captured = url;
      return new Response(JSON.stringify({ html_url: "https://recipes.example.org", status: "built" }), {
        status: 200,
      });
    }) as unknown as typeof fetch);
    const gh = createGitHubClient(coords, auth);
    expect(await gh.getPagesUrl()).toEqual({ url: "https://recipes.example.org", enabled: true });
    expect(captured).toBe("https://api.github.com/repos/o/r/pages");
  });

  it("reports not enabled when Pages returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    expect(await gh.getPagesUrl()).toEqual({ url: null, enabled: false });
  });

  it("surfaces a 403 (App lacks Pages: read) as GitHubError", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response("Forbidden", {
          status: 403,
          headers: { "x-ratelimit-remaining": "100" },
        })) as unknown as typeof fetch,
    );
    const gh = createGitHubClient(coords, auth);
    await expect(gh.getPagesUrl()).rejects.toMatchObject({ status: 403 });
  });
});
