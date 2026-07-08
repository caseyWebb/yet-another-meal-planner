import { describe, it, expect } from "vitest";
import {
  auditTitles,
  groundingExcerpt,
  loadTitleAuditBacklog,
  stampTitleAudit,
  countTitleAuditRemaining,
  TITLE_AUDIT_MAX_PER_TICK,
  type TitleAuditDeps,
  type TitleAuditStamp,
} from "../src/title-audit.js";
import { parseMarkdown } from "../src/parse.js";
import { serializeMarkdown } from "../src/serialize.js";
import { contentHash, facetsFromFrontmatter } from "../src/description.js";
import { facetGateHash } from "../src/recipe-classify.js";
import { sqliteEnv } from "./sqlite-d1.js";

/** A contract-valid recipe file (the authored gates + identity only — facets are derived). */
function recipeFile(title: string, extra = ""): string {
  return [
    "---",
    `title: ${title}`,
    "source: https://ex.com/r",
    "time_total: 90",
    "dietary: []",
    "requires_equipment: []",
    "pairs_with: []",
    extra ? extra : null,
    "---",
    "## Ingredients",
    "",
    "- 1 whole chicken",
    "- 1 can lager",
    "",
    "## Instructions",
    "",
    "1. Roast it.",
    "",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

interface HarnessOpts {
  /** slug → file content (the in-memory corpus). */
  files: Record<string, string>;
  /** The projected backlog rows (defaults to every file, slug ASC, title from frontmatter). */
  backlog?: Array<{ slug: string; title: string }>;
  /** The model's proposed title per CURRENT title; absent → echo (clean-in → same-out). */
  propose?: Record<string, unknown>;
  /** Current titles whose model call throws (a transient env.AI failure). */
  cleanThrow?: Set<string>;
  maxPerTick?: number;
}

function harness(opts: HarnessOpts) {
  const files = { ...opts.files };
  const stamps: Array<TitleAuditStamp & { at: number }> = [];
  const stamped = new Set<string>();
  const calls = { clean: 0, writes: [] as string[] };
  const backlogOf = () =>
    (
      opts.backlog ??
      Object.keys(files)
        .sort()
        .map((slug) => ({ slug, title: String(parseMarkdown(files[slug]).frontmatter.title ?? "") }))
    ).filter((r) => !stamped.has(r.slug));

  const deps: TitleAuditDeps = {
    loadBacklog: async (limit) => backlogOf().slice(0, limit),
    remaining: async () => backlogOf().length,
    readRecipe: async (slug) => files[slug] ?? null,
    writeRecipe: async (slug, content) => {
      files[slug] = content;
      calls.writes.push(slug);
    },
    cleanTitle: async (title) => {
      calls.clean++;
      if (opts.cleanThrow?.has(title)) throw new Error("AI down");
      return opts.propose && title in opts.propose ? opts.propose[title] : title;
    },
    stamp: async (row, at) => {
      stamps.push({ ...row, at });
      stamped.add(row.slug);
    },
    now: () => 1000,
    maxPerTick: opts.maxPerTick ?? TITLE_AUDIT_MAX_PER_TICK,
  };
  return { deps, files, stamps, calls };
}

describe("auditTitles", () => {
  it("rewrites a flowery title and stamps `cleaned` with the before/after trail", async () => {
    const { deps, files, stamps, calls } = harness({
      files: { "a-better-beer-can-chicken": recipeFile("A Better Beer Can Chicken") },
      propose: { "A Better Beer Can Chicken": "Beer Can Chicken" },
    });
    const s = await auditTitles(deps);
    expect(s).toMatchObject({ audited: 1, cleaned: 1, kept: 0, skipped: 0, remaining: 0 });
    expect(stamps).toEqual([
      {
        slug: "a-better-beer-can-chicken",
        outcome: "cleaned",
        before: "A Better Beer Can Chicken",
        after: "Beer Can Chicken",
        at: 1000,
      },
    ]);
    // Only the frontmatter title changed; body and the other authored fields round-tripped.
    expect(calls.writes).toEqual(["a-better-beer-can-chicken"]); // slug/path unchanged — never renamed
    const { frontmatter, body } = parseMarkdown(files["a-better-beer-can-chicken"]);
    expect(frontmatter.title).toBe("Beer Can Chicken");
    expect(frontmatter.source).toBe("https://ex.com/r");
    expect(frontmatter.time_total).toBe(90);
    expect(frontmatter.pairs_with).toEqual([]);
    expect(body).toContain("## Ingredients");
    expect(body).toContain("1 can lager");
  });

  it("stamps `kept` on an already-clean title, leaving the file byte-identical", async () => {
    const original = recipeFile("Vegan Meatballs");
    const { deps, files, stamps, calls } = harness({ files: { "vegan-meatballs": original } });
    const s = await auditTitles(deps);
    expect(s).toMatchObject({ audited: 1, cleaned: 0, kept: 1 });
    expect(stamps[0]).toMatchObject({ slug: "vegan-meatballs", outcome: "kept", before: "Vegan Meatballs" });
    expect(calls.writes).toEqual([]);
    expect(files["vegan-meatballs"]).toBe(original);
  });

  it("stamps `kept` (no loop) when the guard rejects a model output that invents words", async () => {
    const original = recipeFile("Jatjuk (Pine Nut Porridge)");
    const { deps, files, stamps } = harness({
      files: { "jatjuk-pine-nut-porridge": original },
      propose: { "Jatjuk (Pine Nut Porridge)": "Korean Pine Nut Soup" }, // inserted words → rejected
    });
    const s = await auditTitles(deps);
    expect(s).toMatchObject({ audited: 1, kept: 1, cleaned: 0 });
    expect(stamps[0]).toMatchObject({ slug: "jatjuk-pine-nut-porridge", outcome: "kept" });
    expect(files["jatjuk-pine-nut-porridge"]).toBe(original); // untouched
  });

  it("stamps `kept` on unparseable model output (a successful call always resolves to a stamp)", async () => {
    const { deps, stamps } = harness({
      files: { "cherry-cake-recipe": recipeFile("Cherry Cake Recipe") },
      propose: { "Cherry Cake Recipe": null }, // the lenient parse yielded nothing
    });
    const s = await auditTitles(deps);
    expect(s).toMatchObject({ audited: 1, kept: 1 });
    expect(stamps[0]).toMatchObject({ outcome: "kept" });
  });

  it("bounds one tick at the cap and defers the remainder", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`r-${i}`] = recipeFile(`Dish ${i}`);
    const { deps, calls } = harness({ files, maxPerTick: 2 });
    const s = await auditTitles(deps);
    expect(s).toMatchObject({ audited: 2, remaining: 3 });
    expect(calls.clean).toBe(2);
  });

  it("quiesces to zero model calls once the backlog is drained", async () => {
    const { deps, calls } = harness({ files: { "done-dish": recipeFile("Done Dish") } });
    await auditTitles(deps); // drains the one-row backlog
    const s = await auditTitles(deps); // the quiesced tick
    expect(s).toEqual({ audited: 0, cleaned: 0, kept: 0, skipped: 0, remaining: 0 });
    expect(calls.clean).toBe(1); // only the first tick spent a model call
  });

  it("leaves a transiently-failed row un-stamped so the next tick retries it", async () => {
    const { deps, stamps, calls } = harness({
      files: { "flaky-dish": recipeFile("Flaky Dish Recipe") },
      cleanThrow: new Set(["Flaky Dish Recipe"]),
      propose: { "Flaky Dish Recipe": "Flaky Dish" },
    });
    const first = await auditTitles(deps);
    expect(first).toMatchObject({ audited: 0, skipped: 1, remaining: 1 });
    expect(stamps).toEqual([]);
    // The outage clears; the same row is retried and resolves.
    deps.cleanTitle = async () => {
      calls.clean++;
      return "Flaky Dish";
    };
    const second = await auditTitles(deps);
    expect(second).toMatchObject({ audited: 1, cleaned: 1, remaining: 0 });
    expect(stamps[0]).toMatchObject({ slug: "flaky-dish", outcome: "cleaned", after: "Flaky Dish" });
  });

  it("skips a vanished file un-stamped without spending a model call", async () => {
    const { deps, stamps, calls } = harness({
      files: {},
      backlog: [{ slug: "ghost", title: "Ghost Dish" }], // projected but gone from R2
    });
    const s = await auditTitles(deps);
    expect(s.audited).toBe(0);
    expect(stamps).toEqual([]);
    expect(calls.clean).toBe(0);
  });

  it("keeps the file when a rewrite would fail the contract (stamped kept, not looped)", async () => {
    // A malformed-but-parseable file (missing required fields) can't validate after a rewrite:
    // the pass keeps the standing file and stamps `kept` rather than writing or looping.
    const malformed = "---\ntitle: Super Flowery Dish Recipe\n---\n## Ingredients\n- x\n\n## Instructions\n1. y\n";
    const { deps, files, stamps, calls } = harness({
      files: { "super-flowery-dish-recipe": malformed },
      propose: { "Super Flowery Dish Recipe": "Flowery Dish" },
    });
    const s = await auditTitles(deps);
    expect(s).toMatchObject({ audited: 1, kept: 1, cleaned: 0 });
    expect(stamps[0]).toMatchObject({ outcome: "kept" });
    expect(calls.writes).toEqual([]);
    expect(files["super-flowery-dish-recipe"]).toBe(malformed);
  });
});

describe("groundingExcerpt", () => {
  it("returns the ingredients section head, capped", () => {
    const body = "Intro prose\n\n## Ingredients\n\n- chicken\n- lager\n\n## Instructions\n\n1. Roast.";
    const excerpt = groundingExcerpt(body, 30);
    expect(excerpt.startsWith("- chicken")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(30);
  });
  it("falls back to the body head when there is no Ingredients heading", () => {
    expect(groundingExcerpt("just prose", 400)).toBe("just prose");
  });
});

describe("title_audit D1 accessors (real SQLite, migration 0044)", () => {
  function seedRecipes(raw: ReturnType<typeof sqliteEnv>["raw"], rows: Array<[string, string]>) {
    for (const [slug, title] of rows) {
      raw.prepare("INSERT INTO recipes (slug, title) VALUES (?, ?)").run(slug, title);
    }
  }

  it("backlog = projected recipes with no stamp, slug ASC, bounded; stamps drop rows out", async () => {
    const { env, raw } = sqliteEnv();
    seedRecipes(raw, [
      ["b-dish", "B Dish"],
      ["a-dish", "A Dish"],
      ["c-dish", "C Dish"],
    ]);
    expect(await loadTitleAuditBacklog(env, 10)).toEqual([
      { slug: "a-dish", title: "A Dish" },
      { slug: "b-dish", title: "B Dish" },
      { slug: "c-dish", title: "C Dish" },
    ]);
    expect(await loadTitleAuditBacklog(env, 2)).toHaveLength(2);
    expect(await countTitleAuditRemaining(env)).toBe(3);

    await stampTitleAudit(env, { slug: "a-dish", outcome: "kept", before: "A Dish" }, 111);
    await stampTitleAudit(env, { slug: "b-dish", outcome: "cleaned", before: "B Dish", after: "Dish" }, 222);
    expect(await loadTitleAuditBacklog(env, 10)).toEqual([{ slug: "c-dish", title: "C Dish" }]);
    expect(await countTitleAuditRemaining(env)).toBe(1);

    const rows = raw.prepare("SELECT * FROM title_audit ORDER BY slug").all() as Record<string, unknown>[];
    expect(rows).toEqual([
      { slug: "a-dish", audited_at: 111, outcome: "kept", before_title: "A Dish", after_title: null },
      { slug: "b-dish", audited_at: 222, outcome: "cleaned", before_title: "B Dish", after_title: "Dish" },
    ]);
  });

  it("a born-stamped slug never enters the backlog (the import paths' write)", async () => {
    const { env, raw } = sqliteEnv();
    // Born-stamp FIRST (import order: file write + stamp precede the next projection tick).
    await stampTitleAudit(env, { slug: "fresh-import", outcome: "kept", before: "Fresh Import" }, 333);
    seedRecipes(raw, [["fresh-import", "Fresh Import"]]);
    expect(await loadTitleAuditBacklog(env, 10)).toEqual([]);
    expect(await countTitleAuditRemaining(env)).toBe(0);
  });

  it("stamping is an upsert — a re-created slug refreshes its row", async () => {
    const { env, raw } = sqliteEnv();
    await stampTitleAudit(env, { slug: "x", outcome: "kept", before: "X" }, 1);
    await stampTitleAudit(env, { slug: "x", outcome: "cleaned", before: "X Recipe", after: "X" }, 2);
    const rows = raw.prepare("SELECT * FROM title_audit").all() as Record<string, unknown>[];
    expect(rows).toEqual([{ slug: "x", audited_at: 2, outcome: "cleaned", before_title: "X Recipe", after_title: "X" }]);
  });
});

describe("downstream propagation (task 5.1)", () => {
  it("a title rewrite flips the recipe-derived content_hash (describe/embed regenerate)", () => {
    const before = facetsFromFrontmatter({ ...baseFm(), title: "A Better Beer Can Chicken" });
    const after = facetsFromFrontmatter({ ...baseFm(), title: "Beer Can Chicken" });
    expect(contentHash(before)).not.toBe(contentHash(after));
  });

  it("the facet gate hash does NOT cover the title (no spurious reclassification)", () => {
    // The gate hashes the body + the authored Tier-B overrides — the title is not an input.
    // Prove it end to end: run a title-only rewrite through the same parse → serialize
    // funnel the audit uses and show the body (the gate's actual input) is byte-identical,
    // so the gate hash cannot flip. Overrides still flip it (the gate's other input).
    const file = serializeMarkdown({ ...baseFm(), title: "A Better Beer Can Chicken" }, "## Ingredients\n- chicken\n\n## Instructions\n1. Roast.\n");
    const before = parseMarkdown(file);
    const rewritten = serializeMarkdown({ ...before.frontmatter, title: "Beer Can Chicken" }, before.body);
    const after = parseMarkdown(rewritten);
    expect(after.body).toBe(before.body);
    expect(facetGateHash(after.body, {})).toBe(facetGateHash(before.body, {}));
    const withOverride = facetGateHash(before.body, { course: ["main"] });
    expect(withOverride).not.toBe(facetGateHash(before.body, {}));
  });

  function baseFm(): Record<string, unknown> {
    return {
      source: "https://ex.com/r",
      time_total: 90,
      dietary: [],
      requires_equipment: [],
      pairs_with: [],
      ingredients_key: ["chicken", "lager"],
      course: ["main"],
      protein: "chicken",
      cuisine: "american",
      season: [],
    };
  }
});
