// import_recipe (recipe-import capability): the member-initiated fusion of the retired
// parse_recipe/create_recipe pair. Covers what's Node-runnable without HTMLRewriter (the
// URL path's JSON-LD extraction success is exercised by jsonld.test.ts and the live smoke
// test, mirroring recipe-acquire.test.ts's precedent) — url/text exclusivity, the URL
// path's reachability taxonomy (stubbed global fetch), dedup-to-grant (the pre-fetch fast
// path, so no network stub is needed), the text-path classify pipeline (mocked env.AI),
// attribution, facet-seed invocation, slug_exists, and unclassifiable text.

import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { fakeR2 } from "./fake-r2.js";
import { createR2CorpusStore } from "../src/corpus-store.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { registerDiscoveryTools } from "../src/discovery-tools.js";
import { parseMarkdown } from "../src/parse.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";

const CALLER: Tenant = { id: "casey", member: "casey-kid" };

/** A valid classify response for "Miso Salmon" — every required authored field present. */
const VALID_FACETS = {
  title: "Miso Salmon",
  protein: "fish",
  cuisine: "japanese",
  course: ["main"],
  time_total: 25,
  ingredients_key: ["salmon", "miso"],
  ingredients_full: ["salmon", "miso", "soy sauce"],
  dietary: [],
  season: [],
  tags: ["quick"],
  perishable_ingredients: ["salmon"],
  requires_equipment: [],
  side_search_terms: ["steamed rice", "a crisp slaw"],
  meal_preppable: false,
};

const PASTED =
  "Miso Salmon\n\nIngredients\n- 4 salmon fillets\n- 2 tbsp miso\n- 1 tbsp soy sauce\n\nInstructions\n1. Whisk miso and soy sauce.\n2. Broil salmon 8 minutes, basting with the glaze.\n";

/** Wire a discovery server whose env.AI.run returns the given classifier responses in
 *  order (the last one repeats for any call beyond the array — mirrors discovery-classify
 *  .test.ts's fakeEnv). `files` seeds the fake R2 bucket (pre-existing recipes). */
function discoveryServer(h: SqliteEnv, aiResponses: unknown[], files: Record<string, string> = {}) {
  const r2 = fakeR2(files);
  const store = createR2CorpusStore(r2.bucket);
  let i = 0;
  const env = {
    ...h.env,
    AI: {
      run: async () => {
        const r = aiResponses[Math.min(i, aiResponses.length - 1)];
        i++;
        return { response: r };
      },
    },
  } as unknown as Env;
  const server = new McpServer({ name: "import-recipe-test", version: "0.0.0" });
  registerDiscoveryTools(server, store, env, CALLER);
  return { server, objects: r2.objects };
}

describe("import_recipe — url/text exclusivity", () => {
  it("rejects when neither url nor text is given", async () => {
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", {}));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "validation_failed" });
    expect(h.rows("recipe_imports")).toHaveLength(0);
  });

  it("rejects when both url and text are given", async () => {
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { url: "https://ex.com/r", text: PASTED }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "validation_failed" });
  });

  it("blank/whitespace-only strings count as absent on both sides", async () => {
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { url: "   ", text: "   " }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "validation_failed" });
  });
});

describe("import_recipe — url path reachability taxonomy (the parse_recipe structured errors, verbatim)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns unreachable (no status) when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { url: "https://down.example/r" }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "unreachable" });
    expect(h.rows("recipe_imports")).toHaveLength(0);
  });

  it("returns unreachable WITH the HTTP status on a non-2xx (a bot wall)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403 })));
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { url: "https://walled.example/r" }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "unreachable", status: 403 });
    expect(h.rows("recipe_imports")).toHaveLength(0);
  });
});

describe("import_recipe — dedup-to-grant (the pre-fetch fast path; no network needed)", () => {
  it("a duplicate source is a SUCCESS: mints the caller's grant and returns { slug, already_existed: true }, no second copy", async () => {
    const h = sqliteEnv(["casey"]);
    h.raw.exec("INSERT INTO recipes (slug, title, source_url) VALUES ('miso-salmon', 'Miso Salmon', 'https://ex.com/miso-salmon')");
    h.raw.exec(
      "INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('miso-salmon', 'pat', 'pat', 'agent', '2026-01-01')",
    );
    const { server, objects } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { url: "https://ex.com/miso-salmon" }));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ slug: "miso-salmon", already_existed: true });
    // No second R2 object written.
    expect(objects.has("recipes/miso-salmon.md")).toBe(false);
    const grants = h.rows<{ tenant: string; member: string; via: string }>("recipe_imports");
    expect(grants).toHaveLength(2);
    expect(grants.find((g) => g.tenant === "casey")).toMatchObject({ member: "casey-kid", via: "agent" });
  });

  it("is idempotent for the same household (grant row unchanged)", async () => {
    const h = sqliteEnv(["casey"]);
    h.raw.exec("INSERT INTO recipes (slug, title, source_url) VALUES ('miso-salmon', 'Miso Salmon', 'https://ex.com/miso-salmon')");
    h.raw.exec(
      "INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('miso-salmon', 'casey', 'casey-kid', 'agent', '2026-01-01')",
    );
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { url: "https://ex.com/miso-salmon" }));
    expect(out.result).toEqual({ slug: "miso-salmon", already_existed: true });
    expect(h.rows("recipe_imports")).toEqual([
      { recipe: "miso-salmon", tenant: "casey", member: "casey-kid", via: "agent", imported_at: "2026-01-01" },
    ]);
  });

  it("a tracker-wrapped / differently-cased duplicate URL still dedups (canonicalized)", async () => {
    const h = sqliteEnv(["casey"]);
    h.raw.exec("INSERT INTO recipes (slug, title, source_url) VALUES ('miso-salmon', 'Miso Salmon', 'https://ex.com/miso-salmon')");
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) =>
      invokeTool(c, "import_recipe", { url: "https://ex.com/miso-salmon?utm_source=newsletter" }),
    );
    expect(out.result).toMatchObject({ slug: "miso-salmon", already_existed: true });
  });
});

describe("import_recipe — text path (paste-and-classify, no fetch)", () => {
  it("classifies pasted text, persists it, attributes it, and seeds the derived facets synchronously", async () => {
    const h = sqliteEnv(["casey"]);
    const { server, objects } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { text: PASTED }));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ slug: "miso-salmon" });

    // The R2-persisted file carries the authored gates + identity, source null (no URL),
    // pairs_with [], and NONE of the DERIVED facets (they live in recipe_facets, not R2).
    const stored = objects.get("recipes/miso-salmon.md");
    expect(stored).toBeDefined();
    const { frontmatter, body } = parseMarkdown(stored!);
    expect(frontmatter).toMatchObject({
      title: "Miso Salmon",
      source: null,
      time_total: 25,
      dietary: [],
      requires_equipment: [],
      pairs_with: [],
    });
    for (const derived of ["protein", "cuisine", "course", "ingredients_key", "ingredients_full", "side_search_terms", "meal_preppable"]) {
      expect(derived in frontmatter, `${derived} should not be authored/persisted to R2`).toBe(false);
    }
    expect(body).toContain("## Ingredients");
    expect(body).toContain("## Instructions");
    expect(body).toContain("salmon fillets");

    // Attribution beside the write (recipe-import): via 'agent', the resolved member.
    expect(h.rows("recipe_imports")).toEqual([
      {
        recipe: "miso-salmon",
        tenant: "casey",
        member: "casey-kid",
        via: "agent",
        imported_at: new Date().toISOString().slice(0, 10),
      },
    ]);

    // The synchronous facet seed (recipe-facet-derivation): recipe_facets carries the
    // DERIVED fields the R2 file omits, keyed by slug — seedClassifiedFacets, no re-classify.
    const facets = h.rows<{ slug: string; protein: string; ingredients_key: string }>("recipe_facets");
    expect(facets).toHaveLength(1);
    expect(facets[0].slug).toBe("miso-salmon");
    expect(facets[0].protein).toBe("fish");
    expect(JSON.parse(facets[0].ingredients_key)).toEqual(["salmon", "miso"]);
  });

  it("an explicit title hint is honored as the classify prompt's title basis", async () => {
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS]);
    const out = await withServer(server, (c) =>
      invokeTool(c, "import_recipe", { text: PASTED, title: "Miso Salmon" }),
    );
    expect(out.result).toMatchObject({ slug: "miso-salmon" });
  });

  it("slug_exists (name collision) is a refusal — no grant minted, no facet row seeded", async () => {
    const h = sqliteEnv(["casey"]);
    const { server } = discoveryServer(h, [VALID_FACETS], {
      "recipes/miso-salmon.md": "---\ntitle: Unrelated Other Dish\nsource: null\ntime_total: 10\ndietary: []\nrequires_equipment: []\npairs_with: []\n---\n\n## Ingredients\n\n## Instructions\n",
    });
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { text: PASTED }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "slug_exists" });
    expect(h.rows("recipe_imports")).toHaveLength(0);
    expect(h.rows("recipe_facets")).toHaveLength(0);
  });

  it("a pasted text with no discernible ingredients/instructions structure fails validation, writing nothing", async () => {
    const h = sqliteEnv(["casey"]);
    const { server, objects } = discoveryServer(h, [VALID_FACETS]);
    const noStructure = "This is just some notes about a meal I had once, no real structure here.";
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { text: noStructure, title: "Untitled Meal" }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "validation_failed" });
    expect(objects.size).toBe(0);
    expect(h.rows("recipe_imports")).toHaveLength(0);
  });

  it("a classifier that never produces contract-valid facets parks as validation_failed, writing nothing", async () => {
    const h = sqliteEnv(["casey"]);
    const offVocab = { ...VALID_FACETS, protein: "poultry" }; // not in PROTEIN_VOCAB
    // classifyRecipe retries CLASSIFY_MAX_RETRIES (2) times beyond the first attempt.
    const { server, objects } = discoveryServer(h, [offVocab, offVocab, offVocab]);
    const out = await withServer(server, (c) => invokeTool(c, "import_recipe", { text: PASTED }));
    expect(out.isError).toBe(true);
    expect(out.result).toMatchObject({ error: "validation_failed" });
    expect(objects.size).toBe(0);
    expect(h.rows("recipe_imports")).toHaveLength(0);
  });
});
