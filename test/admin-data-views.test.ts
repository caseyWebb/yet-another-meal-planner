import { describe, it, expect } from "vitest";
import { RecipesListPage, RecipeDetailPage, StoresListPage, StoreDetailPage, GuidancePage, pipelineHalt } from "../src/admin/pages/data.js";
import type { RecipeDetail, RecipeSearchHit, RecipeSearchResult, StoreListEntry, StoreDetail, GuidanceListing } from "../src/admin-data.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

describe("Recipes list SSR view", () => {
  const rows = new Map([
    ["miso-soup", { slug: "miso-soup", title: "Miso Soup", status: "indexed" as const, protein: "vegan", cuisine: "japanese", time_total: 20 }],
    ["orphan", { slug: "orphan", title: null, status: "orphaned" as const, protein: null, cuisine: null, time_total: null }],
  ]);

  it("renders rows with slug links, status badges, and facet chips", () => {
    const hits: RecipeSearchHit[] = [
      { slug: "miso-soup", score: null, semantic: false },
      { slug: "orphan", score: null, semantic: false },
    ];
    const search: RecipeSearchResult = { mode: "keyword", results: hits };
    const html = render(RecipesListPage({ rows, search, query: "", mode: "keyword", page: 0 }));
    expect(html).toContain("/admin/data/recipes/miso-soup");
    expect(html).toContain("tier indexed");
    expect(html).toContain("indexed");
    expect(html).toContain("orphaned");
    expect(html).toContain("vegan");
    expect(html).toContain("japanese");
    expect(html).toContain("20 min");
  });

  it("shows a relevance bar and the semantic badge for a hybrid hit", () => {
    const hits: RecipeSearchHit[] = [{ slug: "miso-soup", score: 0.62, semantic: true }];
    const search: RecipeSearchResult = { mode: "hybrid", results: hits };
    const html = render(RecipesListPage({ rows, search, query: "cozy", mode: "hybrid", page: 0 }));
    expect(html).toContain("relbar");
    expect(html).toContain("semantic");
    expect(html).toContain("ranked by relevance");
  });

  it("filters out a hit whose slug isn't in the joined row map", () => {
    const hits: RecipeSearchHit[] = [{ slug: "ghost", score: null, semantic: false }];
    const search: RecipeSearchResult = { mode: "keyword", results: hits };
    const html = render(RecipesListPage({ rows, search, query: "x", mode: "keyword", page: 0 }));
    expect(html).toContain("No recipes match");
  });

  it("paginates beyond one page", () => {
    const many = new Map(
      Array.from({ length: 8 }, (_, i) => [`r${i}`, { slug: `r${i}`, title: `R${i}`, status: "indexed" as const, protein: null, cuisine: null, time_total: null }]),
    );
    const hits: RecipeSearchHit[] = Array.from({ length: 8 }, (_, i) => ({ slug: `r${i}`, score: null, semantic: false }));
    const search: RecipeSearchResult = { mode: "keyword", results: hits };
    const html = render(RecipesListPage({ rows: many, search, query: "", mode: "keyword", page: 0, pageSize: 6 }));
    expect(html).toContain("Page 1 of 2");
  });

  it("defaults the page size to 50 and offers a 25/50/100 selector, deep-linkable via ?size=", () => {
    const rowsOf = (n: number) =>
      new Map(
        Array.from({ length: n }, (_, i) => [`r${i}`, { slug: `r${i}`, title: `R${i}`, status: "indexed" as const, protein: null, cuisine: null, time_total: null }]),
      );
    const hitsOf = (n: number): RecipeSearchHit[] => Array.from({ length: n }, (_, i) => ({ slug: `r${i}`, score: null, semantic: false }));

    // Default (no explicit pageSize prop) is 50 — 60 rows still paginate at 50/page.
    const many = rowsOf(60);
    const search: RecipeSearchResult = { mode: "keyword", results: hitsOf(60) };
    const html = render(RecipesListPage({ rows: many, search, query: "", mode: "keyword", page: 0 }));
    expect(html).toContain("Page 1 of 2");
    expect(html).toContain("of 60");

    // The selector offers 25/50/100, with the active size highlighted and size preserved
    // (deep-linkable + carried across a search/pagination href).
    expect(html).toContain('href="/admin/data/recipes?size=25"');
    expect(html).toContain('href="/admin/data/recipes?size=100"');
    expect(html).toMatch(/seg-btn active" href="\/admin\/data\/recipes">50</);

    const html25 = render(RecipesListPage({ rows: many, search, query: "", mode: "keyword", page: 0, pageSize: 25 }));
    expect(html25).toContain("Page 1 of 3");
    expect(html25).toContain('seg-btn active" href="/admin/data/recipes?size=25"');
    // Prev/Next preserve the chosen size.
    expect(html25).toContain('href="/admin/data/recipes?page=2&amp;size=25"');
  });

  it("renders a degraded-search banner and still shows the keyword results, with the mode toggle left on Hybrid", () => {
    const hits: RecipeSearchHit[] = [{ slug: "miso-soup", score: null, semantic: false }];
    const search: RecipeSearchResult = { mode: "hybrid-degraded", results: hits };
    const html = render(RecipesListPage({ rows, search, query: "miso", mode: "hybrid", page: 0 }));
    expect(html).toContain("Semantic ranking unavailable");
    expect(html).toContain("/admin/data/recipes/miso-soup");
    expect(html).toContain('seg-btn active" href="/admin/data/recipes?q=miso&amp;mode=hybrid"');
  });
});

describe("Recipe detail SSR view", () => {
  const base: RecipeDetail = {
    slug: "miso-soup",
    status: "indexed",
    reconcile_message: null,
    source: "---\ntitle: Miso Soup\ncuisine: japanese\n---\n## Ingredients\n- miso\n",
    body: "## Ingredients\n- miso\n",
    projection: { slug: "miso-soup", title: "Miso Soup" },
    derived: { description: "A warm soup", has_embedding: true, state: "described" },
    dispositions: [{ tenant: "casey", favorite: true, reject: false }],
    notes: [],
  };

  it("renders title, status, description, rendered body, frontmatter, and projection", () => {
    const html = render(RecipeDetailPage({ detail: base }));
    expect(html).toContain("All recipes");
    expect(html).toContain("A warm soup");
    expect(html).toContain("Miso Soup");
    expect(html).toContain("miso-soup");
    expect(html).toContain("japanese"); // frontmatter pretty-kv
  });

  it("shows the pipeline strip with description+embedding complete", () => {
    const html = render(RecipeDetailPage({ detail: base }));
    expect(html).toContain("pl-track");
  });

  it("shows a pending-generation notice when no description is present", () => {
    const detail: RecipeDetail = { ...base, derived: null };
    const html = render(RecipeDetailPage({ detail }));
    expect(html).toContain("Not yet generated");
  });

  it("renders the reconcile-reason alert for a skipped recipe", () => {
    const detail: RecipeDetail = { ...base, status: "skipped", reconcile_message: "bad yaml", projection: null, derived: null };
    const html = render(RecipeDetailPage({ detail }));
    expect(html).toContain("bad yaml");
    expect(html).toContain("Skipped at reconcile");
  });

  it("shows the raw-markdown panel, collapsible, for a non-orphaned recipe", () => {
    const html = render(RecipeDetailPage({ detail: base }));
    expect(html).toContain("rd-raw");
    expect(html).toContain("View raw R2 markdown");
    expect(html).toContain("<details");
  });

  it("omits the raw-markdown panel entirely for an orphaned recipe", () => {
    const detail: RecipeDetail = { ...base, status: "orphaned", source: null, body: null, projection: { slug: "miso-soup" }, derived: null };
    const html = render(RecipeDetailPage({ detail }));
    expect(html).not.toContain("rd-raw");
    expect(html).not.toContain("View raw R2 markdown");
    expect(html).toContain("stale projection");
  });

  it("renders D1 index-row list columns (already inflated to arrays by recipeDetail) as pv-chip pills, not raw JSON text", () => {
    const detail: RecipeDetail = {
      ...base,
      projection: { slug: "miso-soup", title: "Miso Soup", tags: ["quick", "weeknight"], dietary: ["vegetarian"] },
    };
    const html = render(RecipeDetailPage({ detail }));
    expect(html).toContain("pv-chips");
    expect(html).toContain('<span class="pv-chip">quick</span>');
    expect(html).toContain('<span class="pv-chip">weeknight</span>');
    expect(html).toContain('<span class="pv-chip">vegetarian</span>');
    // Not rendered as a raw JSON string anywhere in the D1 index row panel.
    expect(html).not.toContain('["quick","weeknight"]');
  });

  it("renders attributed notes with author/tags/private badge", () => {
    const detail: RecipeDetail = {
      ...base,
      notes: [{ author: "casey", body: "great dish", tags: ["tip"], private: true, created_at: "2026-06-01" }],
    };
    const html = render(RecipeDetailPage({ detail }));
    expect(html).toContain("@casey");
    expect(html).toContain("great dish");
    expect(html).toContain("private");
  });
});

describe("pipelineHalt", () => {
  const base: RecipeDetail = {
    slug: "x",
    status: "indexed",
    reconcile_message: null,
    source: "x",
    body: "x",
    projection: {},
    derived: null,
    dispositions: [],
    notes: [],
  };

  it("halts before index for pending/skipped", () => {
    expect(pipelineHalt({ ...base, status: "pending" })).toBe(-1);
    expect(pipelineHalt({ ...base, status: "skipped" })).toBe(-1);
  });

  it("halts at description when indexed but not described", () => {
    expect(pipelineHalt({ ...base, status: "indexed", derived: null })).toBe(0);
  });

  it("halts at embedding when described but not embedded", () => {
    expect(pipelineHalt({ ...base, derived: { description: "d", has_embedding: false, state: "described" } })).toBe(1);
  });

  it("is fully through the pipeline when described and embedded", () => {
    expect(pipelineHalt({ ...base, derived: { description: "d", has_embedding: true, state: "described" } })).toBe(2);
  });
});

describe("Stores list + detail SSR views", () => {
  const stores: StoreListEntry[] = [
    { slug: "kroger-hp", name: "Kroger HP", domain: "grocery", chain: "kroger", notes_count: 2, skus_count: 5 },
    { slug: "tjs", name: "Trader Joe's", domain: "grocery", chain: "trader-joes", notes_count: 1, skus_count: 0 },
  ];

  it("renders the store list with name, slug, chain badge", () => {
    const html = render(StoresListPage({ stores }));
    expect(html).toContain("/admin/data/stores/kroger-hp");
    expect(html).toContain("Kroger HP");
    expect(html).toContain("kroger");
    expect(html).toContain("5 SKUs");
  });

  it("renders store detail identity, SKU table, and grouped notes", () => {
    const detail: StoreDetail = {
      slug: "kroger-hp",
      name: "Kroger HP",
      domain: "grocery",
      chain: "kroger",
      label: "the big one",
      address: "123 Main St",
      location_id: "L1",
      skus: [{ ingredient: "salmon", sku: "0001", brand: "Kroger", size: "1 lb", last_used: "2026-06-01" }],
      notes: {
        layout: [{ id: "n1", author: "casey", body: "aisle 7", tags: ["layout"], private: false, created_at: "2026-06-01" }],
        location: [],
        stock: [],
        general: [],
      },
    };
    const html = render(StoreDetailPage({ detail }));
    expect(html).toContain("All stores");
    expect(html).toContain("123 Main St");
    expect(html).toContain("L1");
    expect(html).toContain("salmon");
    expect(html).toContain("0001");
    expect(html).toContain("aisle 7");
    expect(html).toContain("Layout");
  });

  it("shows a non-Kroger empty-SKU state instead of an empty table", () => {
    const detail: StoreDetail = {
      slug: "tjs",
      name: "Trader Joe's",
      domain: "grocery",
      chain: "trader-joes",
      label: null,
      address: null,
      location_id: null,
      skus: [],
      notes: { layout: [], location: [], stock: [], general: [] },
    };
    const html = render(StoreDetailPage({ detail }));
    expect(html).toContain("not a Kroger location");
    expect(html).not.toContain("<table");
  });
});

describe("Guidance browser SSR view", () => {
  it("renders a folder listing with a breadcrumb", () => {
    const listing: GuidanceListing = {
      prefix: "guidance/",
      entries: [
        { name: "cooking_techniques", type: "dir" },
        { name: "substitutions.md", type: "file" },
      ] as GuidanceListing["entries"],
    };
    const html = render(GuidancePage({ view: { kind: "listing", prefix: "guidance/", listing } }));
    expect(html).toContain("cooking_techniques");
    expect(html).toContain("substitutions.md");
    expect(html).toContain("g-crumbs");
  });

  it("descends into a subfolder, growing the breadcrumb", () => {
    const listing: GuidanceListing = {
      prefix: "guidance/cooking_techniques/",
      entries: [{ name: "braising.md", type: "file" }] as GuidanceListing["entries"],
    };
    const html = render(GuidancePage({ view: { kind: "listing", prefix: "guidance/cooking_techniques/", listing } }));
    expect(html).toContain("cooking_techniques");
    expect(html).toContain("braising.md");
  });

  it("renders a file's rendered markdown with the full-path breadcrumb", () => {
    const html = render(
      GuidancePage({ view: { kind: "object", path: "guidance/cooking_techniques/braising.md", markdown: "# Braising\n\nSear first." } }),
    );
    expect(html).toContain("Braising");
    expect(html).toContain("Sear first");
    expect(html).toContain("braising.md");
  });

  it("strips a leading YAML frontmatter fence and renders it as a pretty key/value panel above the body, with no leading <hr>", () => {
    const markdown = "---\ntitle: Searing\ntags:\n  - technique\n---\n# Searing\n\nGet the pan hot first.\n";
    const html = render(
      GuidancePage({ view: { kind: "object", path: "guidance/cooking_techniques/sear.md", markdown } }),
    );
    // The frontmatter panel renders as a pretty key/value block (PrettyKV's pkv markup).
    expect(html).toContain("pkv-row");
    expect(html).toContain("Searing");
    expect(html).toContain("technique");
    // The body renders clean — no stray leading <hr> from an un-stripped fence.
    expect(html).not.toContain("<hr");
    expect(html).toContain("Get the pan hot first.");
  });

  it("renders just the body, no frontmatter panel, for a guidance file with no frontmatter fence", () => {
    const html = render(
      GuidancePage({ view: { kind: "object", path: "guidance/cooking_techniques/plain.md", markdown: "# Plain\n\nNo frontmatter here." } }),
    );
    expect(html).not.toContain("pkv-row");
    expect(html).not.toContain("<hr");
    expect(html).toContain("No frontmatter here.");
  });
});
