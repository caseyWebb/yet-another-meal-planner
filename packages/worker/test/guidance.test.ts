import { describe, it, expect } from "vitest";
import {
  listGuidance,
  readGuidance,
  saveGuidance,
  slugFromFile,
  GUIDANCE_DOMAINS,
  WRITABLE_DOMAINS,
} from "../src/guidance.js";
import { createR2CorpusStore } from "../src/corpus-store.js";
import { fakeR2 } from "./fake-r2.js";
import { ToolError } from "../src/errors.js";
import { buildServer } from "../src/tools.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Tenant } from "../src/tenant.js";
import type { Env } from "../src/env.js";

/** A corpus store backed by an in-memory R2 fake; `objects` exposes what was written. */
function makeStore(files: Record<string, string> = {}) {
  const r2 = fakeR2(files);
  return { store: createR2CorpusStore(r2.bucket), objects: r2.objects };
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
    const { store } = makeStore({
      "guidance/ingredient_storage/tender-herbs.md":
        "---\ndescription: cilantro & parsley — stems in water, in the fridge\n---\n\n# Tender herbs\nbody",
      "guidance/ingredient_storage/_ethylene.md": "# Ethylene\nno frontmatter here",
      // a nested subdir (listed as a dir, filtered out) and a non-md file (slug null, filtered out)
      "guidance/ingredient_storage/nested/deep.md": "# nested\nignored",
      "guidance/ingredient_storage/notes.txt": "ignored",
    });
    const res = await listGuidance(store, "ingredient_storage");
    expect(res).toEqual({
      domain: "ingredient_storage",
      entries: [
        { slug: "_ethylene" },
        { slug: "tender-herbs", description: "cilantro & parsley — stems in water, in the fridge" },
      ],
    });
  });

  it("returns empty entries when the tree does not exist", async () => {
    const { store } = makeStore();
    expect(await listGuidance(store, "cooking_techniques")).toEqual({
      domain: "cooking_techniques",
      entries: [],
    });
  });

  it("rejects an unknown domain with validation_failed", async () => {
    const { store } = makeStore();
    const err = await listGuidance(store, "nonsense").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
  });
});

describe("listGuidance — all domains", () => {
  it("returns every domain grouped when no domain is given", async () => {
    const { store } = makeStore({
      "guidance/ingredient_storage/alliums.md": "# Alliums\nbody",
      "guidance/cooking_techniques/browning-meat.md":
        "---\ndescription: brown not gray\n---\n\n# Browning meat\nbody",
      "guidance/purchasing/canned-tomatoes.md":
        "---\ndescription: no calcium chloride for sauce\n---\n\n# Canned tomatoes\nbody",
    });
    const res = await listGuidance(store);
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
    const { store } = makeStore({
      "guidance/cooking_techniques/browning-meat.md": "# Browning meat\neven layer, don't disturb",
      "guidance/ingredient_storage/basil.md": "# Basil\ncounter, in water",
    });
    const res = await readGuidance(store, "cooking_techniques", ["browning-meat"]);
    expect(res).toEqual({
      domain: "cooking_techniques",
      entries: [{ slug: "browning-meat", content: "# Browning meat\neven layer, don't disturb" }],
    });
  });

  it("yields a structured not_found for an unknown slug", async () => {
    const { store } = makeStore();
    await expect(readGuidance(store, "cooking_techniques", ["nope"])).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("rejects a malformed slug (path traversal) without fetching", async () => {
    const { store } = makeStore();
    const err = await readGuidance(store, "ingredient_storage", ["../secrets"]).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("not_found");
    expect(err.context).toEqual({ slug: "../secrets" });
  });

  it("rejects an unknown domain with validation_failed", async () => {
    const { store } = makeStore();
    const err = await readGuidance(store, "nonsense", ["x"]).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
  });
});

describe("saveGuidance", () => {
  it("creates a new technique memory at guidance/cooking_techniques/<slug>.md", async () => {
    const { store, objects } = makeStore();
    const res = await saveGuidance(
      store,
      "cooking_techniques",
      "browning-meat",
      "---\ndescription: brown not gray\n---\n\n# Browning meat\nEven layer, don't disturb.",
    );
    expect(res).toEqual({
      domain: "cooking_techniques",
      slug: "browning-meat",
      path: "guidance/cooking_techniques/browning-meat.md",
    });
    expect(objects.get("guidance/cooking_techniques/browning-meat.md")).toContain("# Browning meat");
  });

  it("creates a new purchasing entry at guidance/purchasing/<slug>.md (writable domain)", async () => {
    const { store, objects } = makeStore();
    const res = await saveGuidance(
      store,
      "purchasing",
      "olive-oil",
      "---\ndescription: which supermarket olive oil is actually good\n---\n\n# Olive oil\nRecent harvest date, dark glass.",
      "https://www.americastestkitchen.com/taste_tests/olive-oil",
    );
    expect(res).toEqual({
      domain: "purchasing",
      slug: "olive-oil",
      path: "guidance/purchasing/olive-oil.md",
    });
    expect(objects.get("guidance/purchasing/olive-oil.md")).toContain("# Olive oil");
  });

  it("records the source into frontmatter when provided", async () => {
    const { store, objects } = makeStore();
    await saveGuidance(
      store,
      "cooking_techniques",
      "searing",
      "---\ndescription: a hot dry pan\n---\n\n# Searing\nGet the pan ripping hot.",
      "https://www.seriouseats.com/searing",
    );
    const content = objects.get("guidance/cooking_techniques/searing.md")!;
    expect(content).toContain("source: https://www.seriouseats.com/searing");
    // injected into the existing frontmatter block, not a second fence
    expect((content.match(/^---$/gm) ?? []).length).toBe(2);
  });

  it("prepends frontmatter with source when the content has none", async () => {
    const { store, objects } = makeStore();
    await saveGuidance(store, "cooking_techniques", "resting-meat", "Rest it before slicing.", "ATK");
    expect(objects.get("guidance/cooking_techniques/resting-meat.md")).toBe(
      "---\nsource: ATK\n---\n\nRest it before slicing.",
    );
  });

  it("refines (overwrites) the single file for an existing slug — no append", async () => {
    const { store, objects } = makeStore();
    await saveGuidance(store, "cooking_techniques", "browning-meat", "# Browning meat\nRefined advice.");
    // one path, full-content write — there is exactly one file per slug
    expect(objects.get("guidance/cooking_techniques/browning-meat.md")).toBe(
      "# Browning meat\nRefined advice.",
    );
  });

  it("rejects a write to the read-only ingredient_storage domain", async () => {
    const { store, objects } = makeStore();
    const err = await saveGuidance(store, "ingredient_storage", "tender-herbs", "x").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
    expect(err.context).toEqual({ domain: "ingredient_storage" });
    expect(objects.size).toBe(0); // nothing written
  });

  it("rejects a write to an unknown domain", async () => {
    const { store, objects } = makeStore();
    const err = await saveGuidance(store, "nonsense", "x", "y").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
    expect(objects.size).toBe(0);
  });

  it("rejects a malformed slug without writing", async () => {
    const { store, objects } = makeStore();
    const err = await saveGuidance(store, "cooking_techniques", "../escape", "x").catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.code).toBe("validation_failed");
    expect(objects.size).toBe(0);
  });
});

// The fused MCP `read_guidance` tool (cooking-techniques capability, narrow-mcp-surface): a
// thin dispatch over the SAME listGuidance/readGuidance functions already unit-tested above —
// slugs absent -> list mode (one domain or all domains grouped), slugs present -> content read
// (domain required). Covers what the op-level tests above cannot: the tool's own branching, and
// the list_guidance one-window dispatch alias's parity with read_guidance's list mode.
describe("read_guidance tool — fused list/read dispatch", () => {
  const CALLER: Tenant = { id: "casey", member: "casey" };
  const FILES = {
    "guidance/ingredient_storage/tender-herbs.md":
      "---\ndescription: cilantro & parsley — stems in water, in the fridge\n---\n\nStems in water.",
    "guidance/cooking_techniques/browning-meat.md":
      "---\ndescription: even layer, don't crowd the pan\n---\n\nDon't disturb it.",
    "guidance/purchasing/olive-oil.md": "---\ndescription: buy what you'll use in 2 months\n---\n\nExtra virgin.",
  };

  function guidanceServer() {
    const h = sqliteEnv(["casey"]);
    const env = { ...h.env, CORPUS: fakeR2(FILES).bucket } as unknown as Env;
    return buildServer(env, CALLER, "https://yamp.example.com", {
      profile: "self-hosted",
      operator: false,
      kroger: false,
      instacart: false,
    });
  }

  it("with slugs absent and a domain, lists that domain's slugs with descriptions", async () => {
    const server = guidanceServer();
    const out = await withServer(server, (c) => invokeTool(c, "read_guidance", { domain: "cooking_techniques" }));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({
      domain: "cooking_techniques",
      entries: [{ slug: "browning-meat", description: "even layer, don't crowd the pan" }],
    });
  });

  it("with both slugs and domain absent, lists every domain grouped", async () => {
    const server = guidanceServer();
    const out = await withServer(server, (c) => invokeTool(c, "read_guidance", {}));
    expect(out.isError).toBe(false);
    const domains = (out.result as { domains: Array<{ domain: string }> }).domains;
    expect(domains.map((d) => d.domain)).toEqual(["ingredient_storage", "cooking_techniques", "purchasing"]);
  });

  it("with slugs present, returns the content of exactly the named entries", async () => {
    const server = guidanceServer();
    const out = await withServer(server, (c) =>
      invokeTool(c, "read_guidance", { domain: "purchasing", slugs: ["olive-oil"] }),
    );
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({
      domain: "purchasing",
      entries: [{ slug: "olive-oil", content: expect.stringContaining("Extra virgin") }],
    });
  });

  it("slugs present without a domain is a structured validation_failed", async () => {
    const server = guidanceServer();
    const out = await withServer(server, (c) => invokeTool(c, "read_guidance", { slugs: ["olive-oil"] }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "validation_failed" });
  });

  it("an unknown slug on read is a structured not_found", async () => {
    const server = guidanceServer();
    const out = await withServer(server, (c) =>
      invokeTool(c, "read_guidance", { domain: "cooking_techniques", slugs: ["no-such-technique"] }),
    );
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "not_found" });
  });

  it("list_guidance(domain?) is a dispatch alias returning the identical listing read_guidance's list mode does", async () => {
    // Two separate server instances — an McpServer connects to one transport for its
    // lifetime (withServer closes it on teardown), so a shared instance can't serve two
    // concurrent connections.
    const [viaReadGuidance, viaAlias] = await Promise.all([
      withServer(guidanceServer(), (c) => invokeTool(c, "read_guidance", { domain: "ingredient_storage" })),
      withServer(guidanceServer(), (c) => invokeTool(c, "list_guidance", { domain: "ingredient_storage" })),
    ]);
    expect(viaAlias.isError).toBe(false);
    expect(viaAlias.result).toEqual(viaReadGuidance.result);
  });

  it("list_guidance with no domain also lists every domain grouped, identically to read_guidance()", async () => {
    const [viaReadGuidance, viaAlias] = await Promise.all([
      withServer(guidanceServer(), (c) => invokeTool(c, "read_guidance", {})),
      withServer(guidanceServer(), (c) => invokeTool(c, "list_guidance", {})),
    ]);
    expect(viaAlias.result).toEqual(viaReadGuidance.result);
  });
});
