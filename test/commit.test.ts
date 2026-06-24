import { describe, it, expect } from "vitest";
import { commitFiles } from "../src/commit.js";
import { GitHubError, type GitHubClient, type TreeFile } from "../src/github.js";

/** A scriptable fake GitHub client. `updateRefBehavior` decides each updateRef call. */
function fakeGh(opts: {
  updateRef: (attempt: number) => "ok" | "conflict" | "error";
}): GitHubClient & { counts: Record<string, number> } {
  const counts = { getRef: 0, getCommitTree: 0, createTree: 0, createCommit: 0, updateRef: 0 };
  return {
    counts,
    async getFile() {
      throw new GitHubError(404, "not used");
    },
    async listDir() {
      throw new GitHubError(404, "not used");
    },
    async getRef() {
      counts.getRef++;
      return `base-sha-${counts.getRef}`;
    },
    async getCommitTree() {
      counts.getCommitTree++;
      return "base-tree";
    },
    async createTree(_base: string, _files: TreeFile[]) {
      counts.createTree++;
      return "new-tree";
    },
    async createCommit() {
      counts.createCommit++;
      return `commit-${counts.createCommit}`;
    },
    async updateRef() {
      counts.updateRef++;
      const outcome = opts.updateRef(counts.updateRef);
      if (outcome === "conflict") throw new GitHubError(422, "not a fast-forward");
      if (outcome === "error") throw new GitHubError(500, "server error");
    },
    async createIssue() {
      return { url: "https://example.test/issues/1", number: 1 };
    },
    async getPagesUrl() {
      return { url: null, enabled: false };
    },
  };
}

const FILES: TreeFile[] = [
  { path: "pantry.toml", content: "items = []\n" },
  { path: "recipes/x.md", content: "---\nstatus: active\n---\nbody\n" },
];

describe("commitFiles", () => {
  it("batches multiple files into one commit", async () => {
    const gh = fakeGh({ updateRef: () => "ok" });
    const res = await commitFiles(gh, FILES, "msg");
    expect(res.commit_sha).toBe("commit-1");
    expect(res.files).toEqual(["pantry.toml", "recipes/x.md"]);
    expect(gh.counts.createCommit).toBe(1);
    expect(gh.counts.updateRef).toBe(1);
  });

  it("retries on a non-fast-forward and re-reads the base", async () => {
    const gh = fakeGh({ updateRef: (n) => (n < 3 ? "conflict" : "ok") });
    const res = await commitFiles(gh, FILES, "msg");
    expect(res.commit_sha).toBe("commit-3");
    expect(gh.counts.getRef).toBe(3); // re-read base each attempt
    expect(gh.counts.updateRef).toBe(3);
  });

  it("gives up with a structured conflict after the retry bound", async () => {
    const gh = fakeGh({ updateRef: () => "conflict" });
    await expect(commitFiles(gh, FILES, "msg")).rejects.toMatchObject({ code: "conflict" });
  });

  it("maps other GitHub errors to upstream_unavailable", async () => {
    const gh = fakeGh({ updateRef: () => "error" });
    await expect(commitFiles(gh, FILES, "msg")).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });

  it("rejects an invalid staged file before committing", async () => {
    const gh = fakeGh({ updateRef: () => "ok" });
    const bad: TreeFile[] = [{ path: "recipes/x.md", content: "no frontmatter fence" }];
    await expect(commitFiles(gh, bad, "msg")).rejects.toMatchObject({ code: "validation_failed" });
    expect(gh.counts.createCommit).toBe(0); // nothing committed
  });

  it("rejects an empty changeset", async () => {
    const gh = fakeGh({ updateRef: () => "ok" });
    await expect(commitFiles(gh, [], "msg")).rejects.toMatchObject({ code: "validation_failed" });
  });
});
