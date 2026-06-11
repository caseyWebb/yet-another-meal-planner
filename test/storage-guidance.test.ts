import { describe, it, expect } from "vitest";
import { listStorageGuidance, readStorageGuidance, slugFromFile } from "../src/storage-guidance.js";
import { GitHubError, type GitHubClient, type DirEntry } from "../src/github.js";
import { ToolError } from "../src/errors.js";

/** A fake GitHub client backed by an in-memory file map + optional dir listing. */
function fakeGh(opts: { dir?: DirEntry[] | "404"; files?: Record<string, string> }): GitHubClient {
  const files = opts.files ?? {};
  const notUsed = () => {
    throw new Error("not used");
  };
  return {
    async getFile(path) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async listDir(path) {
      if (opts.dir === undefined || opts.dir === "404") throw new GitHubError(404, `Not found: ${path}`);
      return opts.dir;
    },
    getRef: notUsed,
    getCommitTree: notUsed,
    createTree: notUsed,
    createCommit: notUsed,
    updateRef: notUsed,
    createIssue: notUsed,
    getPagesUrl: notUsed,
  };
}

describe("slugFromFile", () => {
  it("strips the .md extension", () => {
    expect(slugFromFile("tender-herbs.md")).toBe("tender-herbs");
  });
  it("keeps the leading underscore of a relational file", () => {
    expect(slugFromFile("_ethylene.md")).toBe("_ethylene");
  });
  it("returns null for a non-markdown entry", () => {
    expect(slugFromFile("README")).toBeNull();
  });
});

describe("listStorageGuidance", () => {
  it("returns the slug set with descriptions, sorted, ignoring non-md files and dirs", async () => {
    const gh = fakeGh({
      dir: [
        { name: "tender-herbs.md", type: "file" },
        { name: "_ethylene.md", type: "file" },
        { name: "nested", type: "dir" },
        { name: "notes.txt", type: "file" },
      ],
      files: {
        "storage_guidance/tender-herbs.md":
          "---\ndescription: cilantro & parsley — stems in water, in the fridge\n---\n\n# Tender herbs\nbody",
        "storage_guidance/_ethylene.md": "# Ethylene\nno frontmatter here",
      },
    });
    const res = await listStorageGuidance(gh);
    expect(res.entries).toEqual([
      { slug: "_ethylene" },
      { slug: "tender-herbs", description: "cilantro & parsley — stems in water, in the fridge" },
    ]);
  });

  it("returns empty entries when the tree does not exist (404)", async () => {
    const gh = fakeGh({ dir: "404" });
    expect(await listStorageGuidance(gh)).toEqual({ entries: [] });
  });
});

describe("readStorageGuidance", () => {
  it("returns content for known slugs", async () => {
    const gh = fakeGh({
      files: {
        "storage_guidance/basil.md": "# Basil\ncounter, in water",
        "storage_guidance/_ethylene.md": "# Ethylene\nkeep apart",
      },
    });
    const res = await readStorageGuidance(gh, ["basil", "_ethylene"]);
    expect(res.entries).toEqual([
      { slug: "basil", content: "# Basil\ncounter, in water" },
      { slug: "_ethylene", content: "# Ethylene\nkeep apart" },
    ]);
  });

  it("yields a structured not_found for an unknown slug", async () => {
    const gh = fakeGh({ files: {} });
    await expect(readStorageGuidance(gh, ["nope"])).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects a malformed slug (path traversal) without fetching", async () => {
    const gh = fakeGh({ files: {} });
    const err = await readStorageGuidance(gh, ["../secrets"]).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("not_found");
    expect(err.context).toEqual({ slug: "../secrets" });
  });
});
