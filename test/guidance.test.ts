import { describe, it, expect } from "vitest";
import {
  listGuidance,
  readGuidance,
  saveGuidance,
  slugFromFile,
  GUIDANCE_DOMAINS,
  WRITABLE_DOMAINS,
} from "../src/guidance.js";
import {
  GitHubError,
  isDeletion,
  type GitHubClient,
  type DirEntry,
  type TreeChange,
} from "../src/github.js";
import { ToolError } from "../src/errors.js";

/** A read-only fake GitHub client backed by an in-memory file map + per-dir listings. */
function fakeGh(opts: {
  dirs?: Record<string, DirEntry[]>;
  files?: Record<string, string>;
}): GitHubClient {
  const files = opts.files ?? {};
  const dirs = opts.dirs ?? {};
  const notUsed = () => {
    throw new Error("not used");
  };
  return {
    async getFile(path) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async listDir(path) {
      if (path in dirs) return dirs[path];
      throw new GitHubError(404, `Not found: ${path}`);
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

describe("domain vocabulary", () => {
  it("includes the three corpora; ingredient_storage is read-only, the rest writable", () => {
    expect(GUIDANCE_DOMAINS).toEqual(["ingredient_storage", "cooking_techniques", "purchasing"]);
    expect(WRITABLE_DOMAINS).toEqual(["cooking_techniques", "purchasing"]);
  });
});

describe("listGuidance — single domain", () => {
  it("returns one domain's slug set with descriptions, sorted, ignoring non-md files and dirs", async () => {
    const gh = fakeGh({
      dirs: {
        "guidance/ingredient_storage": [
          { name: "tender-herbs.md", type: "file" },
          { name: "_ethylene.md", type: "file" },
          { name: "nested", type: "dir" },
          { name: "notes.txt", type: "file" },
        ],
      },
      files: {
        "guidance/ingredient_storage/tender-herbs.md":
          "---\ndescription: cilantro & parsley — stems in water, in the fridge\n---\n\n# Tender herbs\nbody",
        "guidance/ingredient_storage/_ethylene.md": "# Ethylene\nno frontmatter here",
      },
    });
    const res = await listGuidance(gh, "ingredient_storage");
    expect(res).toEqual({
      domain: "ingredient_storage",
      entries: [
        { slug: "_ethylene" },
        { slug: "tender-herbs", description: "cilantro & parsley — stems in water, in the fridge" },
      ],
    });
  });

  it("returns empty entries when the tree does not exist (404)", async () => {
    const gh = fakeGh({});
    expect(await listGuidance(gh, "cooking_techniques")).toEqual({
      domain: "cooking_techniques",
      entries: [],
    });
  });

  it("rejects an unknown domain with validation_failed", async () => {
    const gh = fakeGh({});
    const err = await listGuidance(gh, "nonsense").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
  });
});

describe("listGuidance — all domains", () => {
  it("returns every domain grouped when no domain is given", async () => {
    const gh = fakeGh({
      dirs: {
        "guidance/ingredient_storage": [{ name: "alliums.md", type: "file" }],
        "guidance/cooking_techniques": [{ name: "browning-meat.md", type: "file" }],
        "guidance/purchasing": [{ name: "canned-tomatoes.md", type: "file" }],
      },
      files: {
        "guidance/ingredient_storage/alliums.md": "# Alliums\nbody",
        "guidance/cooking_techniques/browning-meat.md":
          "---\ndescription: brown not gray\n---\n\n# Browning meat\nbody",
        "guidance/purchasing/canned-tomatoes.md":
          "---\ndescription: no calcium chloride for sauce\n---\n\n# Canned tomatoes\nbody",
      },
    });
    const res = await listGuidance(gh);
    expect(res).toEqual({
      domains: [
        { domain: "ingredient_storage", entries: [{ slug: "alliums" }] },
        {
          domain: "cooking_techniques",
          entries: [{ slug: "browning-meat", description: "brown not gray" }],
        },
        {
          domain: "purchasing",
          entries: [{ slug: "canned-tomatoes", description: "no calcium chloride for sauce" }],
        },
      ],
    });
  });
});

describe("readGuidance", () => {
  it("returns content for known slugs within a domain", async () => {
    const gh = fakeGh({
      files: {
        "guidance/cooking_techniques/browning-meat.md": "# Browning meat\neven layer, don't disturb",
        "guidance/ingredient_storage/basil.md": "# Basil\ncounter, in water",
      },
    });
    const res = await readGuidance(gh, "cooking_techniques", ["browning-meat"]);
    expect(res).toEqual({
      domain: "cooking_techniques",
      entries: [{ slug: "browning-meat", content: "# Browning meat\neven layer, don't disturb" }],
    });
  });

  it("yields a structured not_found for an unknown slug", async () => {
    const gh = fakeGh({ files: {} });
    await expect(readGuidance(gh, "cooking_techniques", ["nope"])).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects a malformed slug (path traversal) without fetching", async () => {
    const gh = fakeGh({ files: {} });
    const err = await readGuidance(gh, "ingredient_storage", ["../secrets"]).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("not_found");
    expect(err.context).toEqual({ slug: "../secrets" });
  });

  it("rejects an unknown domain with validation_failed", async () => {
    const gh = fakeGh({ files: {} });
    const err = await readGuidance(gh, "nonsense", ["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
  });
});

describe("saveGuidance", () => {
  /** A writable fake that records the single batched commit (the save path). */
  function recordingGh() {
    const state: { path?: string; content?: string; message?: string } = {};
    const gh: GitHubClient = {
      getFile: async () => {
        throw new GitHubError(404, "absent");
      },
      listDir: async () => {
        throw new GitHubError(404, "absent");
      },
      getRef: async () => "basecommit",
      getCommitTree: async () => "basetree",
      createTree: async (_baseTree: string, changes: TreeChange[]) => {
        const c = changes[0];
        state.path = c.path;
        if (!isDeletion(c)) state.content = c.content;
        return "newtree";
      },
      createCommit: async (msg: string) => {
        state.message = msg;
        return "newcommit";
      },
      updateRef: async () => {},
      createIssue: async () => ({ url: "", number: 0 }),
      getPagesUrl: async () => ({ url: null, enabled: false }),
    };
    return { gh, state };
  }

  it("creates a new technique memory at guidance/cooking_techniques/<slug>.md", async () => {
    const { gh, state } = recordingGh();
    const res = await saveGuidance(
      gh,
      "cooking_techniques",
      "browning-meat",
      "---\ndescription: brown not gray\n---\n\n# Browning meat\nEven layer, don't disturb.",
    );
    expect(res).toEqual({
      domain: "cooking_techniques",
      slug: "browning-meat",
      path: "guidance/cooking_techniques/browning-meat.md",
      commit_sha: "newcommit",
    });
    expect(state.path).toBe("guidance/cooking_techniques/browning-meat.md");
    expect(state.content).toContain("# Browning meat");
  });

  it("creates a new purchasing entry at guidance/purchasing/<slug>.md (writable domain)", async () => {
    const { gh, state } = recordingGh();
    const res = await saveGuidance(
      gh,
      "purchasing",
      "olive-oil",
      "---\ndescription: which supermarket olive oil is actually good\n---\n\n# Olive oil\nRecent harvest date, dark glass.",
      "https://www.americastestkitchen.com/taste_tests/olive-oil",
    );
    expect(res).toEqual({
      domain: "purchasing",
      slug: "olive-oil",
      path: "guidance/purchasing/olive-oil.md",
      commit_sha: "newcommit",
    });
    expect(state.path).toBe("guidance/purchasing/olive-oil.md");
    expect(state.content).toContain("# Olive oil");
  });

  it("records the source into frontmatter when provided", async () => {
    const { gh, state } = recordingGh();
    await saveGuidance(
      gh,
      "cooking_techniques",
      "searing",
      "---\ndescription: a hot dry pan\n---\n\n# Searing\nGet the pan ripping hot.",
      "https://www.seriouseats.com/searing",
    );
    expect(state.content).toContain("source: https://www.seriouseats.com/searing");
    // injected into the existing frontmatter block, not a second fence
    expect((state.content!.match(/^---$/gm) ?? []).length).toBe(2);
  });

  it("prepends frontmatter with source when the content has none", async () => {
    const { gh, state } = recordingGh();
    await saveGuidance(gh, "cooking_techniques", "resting-meat", "Rest it before slicing.", "ATK");
    expect(state.content).toBe("---\nsource: ATK\n---\n\nRest it before slicing.");
  });

  it("refines (overwrites) the single file for an existing slug — no append", async () => {
    const { gh, state } = recordingGh();
    await saveGuidance(gh, "cooking_techniques", "browning-meat", "# Browning meat\nRefined advice.");
    // one path, full-content write — there is exactly one file per slug
    expect(state.path).toBe("guidance/cooking_techniques/browning-meat.md");
    expect(state.content).toBe("# Browning meat\nRefined advice.");
  });

  it("rejects a write to the read-only ingredient_storage domain", async () => {
    const { gh, state } = recordingGh();
    const err = await saveGuidance(gh, "ingredient_storage", "tender-herbs", "x").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
    expect(err.context).toEqual({ domain: "ingredient_storage" });
    expect(state.path).toBeUndefined(); // nothing committed
  });

  it("rejects a write to an unknown domain", async () => {
    const { gh, state } = recordingGh();
    const err = await saveGuidance(gh, "nonsense", "x", "y").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
    expect(state.path).toBeUndefined();
  });

  it("rejects a malformed slug without committing", async () => {
    const { gh, state } = recordingGh();
    const err = await saveGuidance(gh, "cooking_techniques", "../escape", "x").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
    expect(state.path).toBeUndefined();
  });
});
