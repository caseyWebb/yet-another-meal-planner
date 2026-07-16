import { describe, it, expect } from "vitest";
import { retrospective, periodDays, seasonOf, normalizeSeason } from "../src/retrospective.js";
import type { CookingLogEntry } from "../src/cooking-log.js";
import type { RecipeIndex } from "../src/recipes.js";

const NOW = new Date("2026-06-30T12:00:00Z"); // summer (Northern hemisphere)

const index: RecipeIndex = {
  salmon: { slug: "salmon", title: "Salmon", protein: "fish", cuisine: "american", last_cooked: "2026-06-20" },
  tacos: { slug: "tacos", title: "Tacos", protein: "beef", cuisine: "mexican", last_cooked: "2026-06-10" },
  stew: { slug: "stew", title: "Stew", protein: "beef", cuisine: "french", last_cooked: null },
  hidden: { slug: "hidden", title: "Hidden", protein: "pork", cuisine: "american", reject: true, last_cooked: null },
};

// protein/cuisine are pre-resolved on each entry by the caller (the D1
// `cooking_log LEFT JOIN recipes` + COALESCE): recipe entries carry their recipe's
// dims, non-recipe entries their inline dims.
const entries: CookingLogEntry[] = [
  { date: "2026-06-20", type: "recipe", recipe: "salmon", protein: "fish", cuisine: "american" },
  { date: "2026-06-10", type: "recipe", recipe: "tacos", protein: "beef", cuisine: "mexican" },
  { date: "2026-06-12", type: "recipe", recipe: "tacos", protein: "beef", cuisine: "mexican" },
  { date: "2026-06-15", type: "ready_to_eat", name: "frozen lasagna", protein: "beef", cuisine: "italian" },
  { date: "2026-06-18", type: "ad_hoc", name: "fried rice", protein: "mixed" },
  { date: "2026-01-01", type: "recipe", recipe: "salmon", protein: "fish", cuisine: "american" }, // outside a 30d window
];

describe("periodDays", () => {
  it("parses Nd, named windows, and all", () => {
    expect(periodDays("30d")).toBe(30);
    expect(periodDays("week")).toBe(7);
    expect(periodDays("quarter")).toBe(90);
    expect(periodDays("all")).toBeNull();
    expect(periodDays("nonsense")).toBe(30);
  });
});

describe("seasonOf", () => {
  it("maps UTC months to Northern-hemisphere meteorological seasons", () => {
    expect(seasonOf(new Date("2026-01-15T00:00:00Z"))).toBe("winter");
    expect(seasonOf(new Date("2026-02-28T00:00:00Z"))).toBe("winter");
    expect(seasonOf(new Date("2026-03-01T00:00:00Z"))).toBe("spring");
    expect(seasonOf(new Date("2026-05-31T00:00:00Z"))).toBe("spring");
    expect(seasonOf(new Date("2026-06-01T00:00:00Z"))).toBe("summer");
    expect(seasonOf(new Date("2026-08-31T00:00:00Z"))).toBe("summer");
    expect(seasonOf(new Date("2026-09-01T00:00:00Z"))).toBe("fall");
    expect(seasonOf(new Date("2026-11-30T00:00:00Z"))).toBe("fall");
    expect(seasonOf(new Date("2026-12-01T00:00:00Z"))).toBe("winter");
  });
});

describe("normalizeSeason", () => {
  it("case-folds and maps autumn to fall", () => {
    expect(normalizeSeason("Autumn")).toBe("fall");
    expect(normalizeSeason("FALL")).toBe("fall");
    expect(normalizeSeason("  Summer ")).toBe("summer");
    expect(normalizeSeason("winter")).toBe("winter");
  });
});

describe("retrospective aggregates", () => {
  it("counts every cook event in protein_mix, not one per recipe", () => {
    const r = retrospective(entries, index, "30d", NOW);
    // tacos cooked twice (beef x2) + lasagna beef = 3 beef; salmon fish = 1; ad_hoc mixed = 1
    expect(r.protein_mix.beef).toBe(3);
    expect(r.protein_mix.fish).toBe(1);
    expect(r.protein_mix.mixed).toBe(1);
  });

  it("excludes the out-of-window entry", () => {
    const r = retrospective(entries, index, "30d", NOW);
    const salmon = r.recipes_cooked.find((x) => x.recipe === "salmon")!;
    expect(salmon.count).toBe(1); // the Jan entry is excluded
  });

  it("cadence counts recipe+ad_hoc only; the historical ready_to_eat row is excluded", () => {
    const r = retrospective(entries, index, "30d", NOW);
    // in-window cooking events: salmon(1) + tacos(2) + ad_hoc(1) = 4; the ready_to_eat
    // row (frozen lasagna) stays excluded, exactly as before that type's retirement.
    expect(r.cadence.cooks).toBe(4);
  });

  it("does not return cook_vs_convenience or ready_to_eat_favorites — both left the contract with the ready-to-eat concept", () => {
    const r = retrospective(entries, index, "30d", NOW);
    expect(r).not.toHaveProperty("cook_vs_convenience");
    expect(r).not.toHaveProperty("ready_to_eat_favorites");
  });

  it("historical ready_to_eat rows aggregate without error: excluded from cadence, counted in the mixes", () => {
    // No new type='ready_to_eat' row can be written anymore (log_cooked's shim converts
    // it to ad_hoc) — this fixture represents rows already stored before the retirement.
    const log: CookingLogEntry[] = [
      { date: "2026-06-10", type: "recipe", recipe: "tacos", protein: "beef", cuisine: "mexican" },
      { date: "2026-06-12", type: "ad_hoc", name: "fried rice", protein: "mixed" },
      { date: "2026-06-15", type: "ready_to_eat", name: "frozen lasagna", protein: "beef", cuisine: "italian" },
      { date: "2026-06-16", type: "ready_to_eat", name: "frozen burrito", protein: "beef", cuisine: "mexican" },
    ];
    const r = retrospective(log, index, "30d", NOW);
    // Cadence counts only the recipe + ad_hoc rows — the two ready_to_eat rows stay
    // excluded, exactly as before the type's retirement.
    expect(r.cadence.cooks).toBe(2);
    // Their inline protein/cuisine still feed the mixes.
    expect(r.protein_mix.beef).toBe(3); // tacos + frozen lasagna + frozen burrito
    expect(r.cuisine_mix.italian).toBe(1);
    expect(r.cuisine_mix.mexican).toBe(2); // tacos + frozen burrito
    expect(r).not.toHaveProperty("cook_vs_convenience");
    expect(r).not.toHaveProperty("ready_to_eat_favorites");
  });

  it("buckets missing dimensions under unknown", () => {
    const r = retrospective(
      [{ date: "2026-06-15", type: "ad_hoc", name: "leftovers" }],
      index,
      "30d",
      NOW,
    );
    expect(r.protein_mix.unknown).toBe(1);
    expect(r.cuisine_mix.unknown).toBe(1);
  });
});

describe("retrospective underused", () => {
  // NOW = 2026-06-30 (summer). Fixed staleness cutoff = 2026-05-31; trailing-12mo
  // revealed window starts 2025-06-30.

  it("surfaces a stale favorite, tagged why=favorite", () => {
    const idx: RecipeIndex = {
      miso: { slug: "miso", title: "Miso Salmon", favorite: true, last_cooked: "2026-04-01" },
    };
    const log: CookingLogEntry[] = [{ date: "2026-04-01", type: "recipe", recipe: "miso" }];
    const r = retrospective(log, idx, "month", NOW);
    expect(r.underused).toEqual([
      { slug: "miso", title: "Miso Salmon", last_cooked: "2026-04-01", why: "favorite", cook_count: 1 },
    ]);
  });

  it("includes a favorited-but-never-cooked recipe and sorts it ahead of cooked ones", () => {
    const idx: RecipeIndex = {
      miso: { slug: "miso", title: "Miso", favorite: true, last_cooked: "2026-04-01" },
      dandan: { slug: "dandan", title: "Dan Dan", favorite: true, last_cooked: null },
    };
    const log: CookingLogEntry[] = [{ date: "2026-04-01", type: "recipe", recipe: "miso" }];
    const r = retrospective(log, idx, "month", NOW);
    expect(r.underused.map((u) => u.slug)).toEqual(["dandan", "miso"]); // never-cooked first
    expect(r.underused[0]).toMatchObject({ slug: "dandan", last_cooked: null, why: "favorite", cook_count: 0 });
  });

  it("surfaces a revealed favorite (>=3 cooks in trailing 12mo) with all-time cook_count", () => {
    const idx: RecipeIndex = {
      arroz: { slug: "arroz", title: "Arroz Caldo", favorite: false, last_cooked: "2026-04-01" },
    };
    const log: CookingLogEntry[] = [
      { date: "2024-01-01", type: "recipe", recipe: "arroz" }, // all-time only (outside trailing 12mo)
      { date: "2025-08-01", type: "recipe", recipe: "arroz" },
      { date: "2025-10-01", type: "recipe", recipe: "arroz" },
      { date: "2026-01-01", type: "recipe", recipe: "arroz" },
      { date: "2026-04-01", type: "recipe", recipe: "arroz" },
    ];
    const r = retrospective(log, idx, "month", NOW);
    expect(r.underused).toEqual([
      { slug: "arroz", title: "Arroz Caldo", last_cooked: "2026-04-01", why: "revealed", cook_count: 5 },
    ]);
  });

  it("does not surface a one-off cook (not a revealed favorite)", () => {
    const idx: RecipeIndex = {
      oneoff: { slug: "oneoff", title: "One Off", favorite: false, last_cooked: "2025-09-01" },
    };
    const log: CookingLogEntry[] = [{ date: "2025-09-01", type: "recipe", recipe: "oneoff" }];
    const r = retrospective(log, idx, "month", NOW);
    expect(r.underused).toEqual([]);
    expect(r.underused_count).toBe(0);
  });

  it("excludes a rejected recipe even when revealed and stale", () => {
    const idx: RecipeIndex = {
      padsee: { slug: "padsee", title: "Pad See Ew", reject: true, favorite: false, last_cooked: "2026-03-01" },
    };
    const log: CookingLogEntry[] = [
      { date: "2025-09-01", type: "recipe", recipe: "padsee" },
      { date: "2025-12-01", type: "recipe", recipe: "padsee" },
      { date: "2026-03-01", type: "recipe", recipe: "padsee" },
    ];
    const r = retrospective(log, idx, "month", NOW);
    expect(r.underused).toEqual([]);
  });

  it("drops out-of-season favorites but keeps year-round ones", () => {
    const idx: RecipeIndex = {
      braise: { slug: "braise", title: "Winter Braise", favorite: true, last_cooked: null, season: ["winter"] },
      gazpacho: { slug: "gazpacho", title: "Gazpacho", favorite: true, last_cooked: null, season: [] },
    };
    const r = retrospective([], idx, "month", NOW); // NOW is summer
    expect(r.underused.map((u) => u.slug)).toEqual(["gazpacho"]);
  });

  it("matches season case-insensitively with autumn === fall", () => {
    const FALL = new Date("2026-10-15T12:00:00Z");
    const idx: RecipeIndex = {
      apple: { slug: "apple", title: "Apple Crisp", favorite: true, last_cooked: null, season: ["Autumn"] },
    };
    const r = retrospective([], idx, "month", FALL);
    expect(r.underused.map((u) => u.slug)).toEqual(["apple"]);
  });

  it("uses a fixed 30-day staleness window independent of period", () => {
    const idx: RecipeIndex = {
      fresh: { slug: "fresh", title: "Fresh Fav", favorite: true, last_cooked: "2026-06-10" }, // 20 days ago
    };
    const log: CookingLogEntry[] = [{ date: "2026-06-10", type: "recipe", recipe: "fresh" }];
    const r = retrospective(log, idx, "year", NOW); // long period must NOT widen staleness
    expect(r.underused).toEqual([]);
  });

  it("caps at 15 items and reports the full total in underused_count", () => {
    const many: RecipeIndex = {};
    for (let i = 0; i < 20; i++) {
      const slug = `fav-${String(i).padStart(2, "0")}`;
      many[slug] = { slug, title: slug, favorite: true, last_cooked: null };
    }
    const r = retrospective([], many, "month", NOW);
    expect(r.underused).toHaveLength(15);
    expect(r.underused_count).toBe(20);
  });
});
