// Migration 0052 (meal-dimension-foundations) — the F1–F4 acceptance fixtures. Each
// fixture seeds the VERBATIM production pre-state (the 2026-07-10 read-only spike,
// re-read 2026-07-11), applies 0052, and asserts the design's post-state exactly, so
// the local run is the same shape as the post-deploy `--remote` acceptance queries:
//   F1 meal_plan mint      — 3 rows, distinct ^[0-9a-f]{32}$ ids, meal='dinner',
//                            sides byte-identical, planned_for/from_vibe still NULL.
//   F2 vibe meal           — 7 vibes meal='dinner', members NULL; night_vibe_derived
//                            untouched (unchanged updated_at — ZERO re-embeds).
//   F3 cadence backfill    — the COLUMN wins over the custom-bag shadow (precedence,
//                            not merge); NULL column → NULL cadence; absent profile
//                            rows untouched; `custom` byte-identical.
//   F4 log meal NULL       — 4 rows keep meal NULL (never fabricated).
// (F5 — the pref-retirement convergence — is a cron pass, not migration SQL; it is
// covered in test/pref-retirement.test.ts.)

import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1");
const MEAL_DIMENSION = "0052_meal_dimension.sql";

/** Apply every migration whose filename sorts before `stop`, in order. */
function applyBefore(raw: DatabaseSync, stop: string): void {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f < stop)
    .sort();
  for (const f of files) raw.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
}

function applyMealDimension(raw: DatabaseSync): void {
  raw.exec(readFileSync(join(MIGRATIONS_DIR, MEAL_DIMENSION), "utf8"));
}

/** Seed the verbatim production pre-state (spike, design §1 fixtures table). */
function seedProduction(raw: DatabaseSync): void {
  // F1 — the 3 meal_plan rows (all planned_for/from_vibe NULL; one carries sides).
  const plan = raw.prepare("INSERT INTO meal_plan (tenant, recipe, planned_for, sides, from_vibe) VALUES (?, ?, NULL, ?, NULL)");
  plan.run("casey", "chicken-and-black-bean-stew", null);
  plan.run("casey", "honey-mustard-salmon", '["steamed rice","green salad"]');
  plan.run("everett", "chicken-chile-verde", null);

  // F2 — the 7 night_vibes rows (all casey, all dinner-shaped; weather/pinned/season unset)
  // and their 7 night_vibe_derived rows (embedded — updated_at must NOT move).
  const vibe = raw.prepare(
    "INSERT INTO night_vibes (tenant, id, vibe, facets, cadence_days, pinned, base_weight, weather_affinity, weather_antipathy, season, created_at, updated_at) " +
      "VALUES ('casey', ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?, ?)",
  );
  const vibes: [string, string, string | null, number | null, string, string][] = [
    ["a-cheesy-pizza-night", "a cheesy pizza night", null, null, "2026-07-08T21:22:59.777Z", "2026-07-08T21:22:59.777Z"],
    ["a-comforting-southern-meal", "A comforting Southern meal", "{}", 14, "2026-07-08T19:31:25.422Z", "2026-07-08T19:33:13.381Z"],
    ["a-flavorful-seafood-dinner", "A flavorful seafood dinner", "{}", 14, "2026-07-08T19:31:54.136Z", "2026-07-08T19:33:02.357Z"],
    ["a-hearty-bean-and-cornbread-meal", "A hearty bean and cornbread meal", null, null, "2026-07-08T19:31:45.041Z", "2026-07-08T19:31:45.041Z"],
    ["a-quick-veggie-forward-meal", "A quick veggie-forward meal", null, null, "2026-07-08T19:31:33.081Z", "2026-07-08T19:31:33.081Z"],
    ["a-simple-weeknight-pasta", "A simple weeknight pasta", null, null, "2026-07-08T19:32:09.805Z", "2026-07-08T19:32:09.805Z"],
    ["a-spicy-heat-packed-dish", "A spicy heat-packed dish", "{}", 14, "2026-07-08T19:31:29.566Z", "2026-07-08T19:32:41.328Z"],
  ];
  for (const [id, text, facets, cadence, created, updated] of vibes) vibe.run(id, text, facets, cadence, created, updated);
  const derived = raw.prepare(
    "INSERT INTO night_vibe_derived (tenant, id, vibe_hash, embedding, updated_at) VALUES ('casey', ?, ?, '[0.1,0.2]', ?)",
  );
  const derivedRows: [string, string, string][] = [
    ["a-cheesy-pizza-night", "2d73e0fd", "2026-07-08T21:23:09.726Z"],
    ["a-comforting-southern-meal", "c5090447", "2026-07-08T19:33:15.758Z"],
    ["a-flavorful-seafood-dinner", "804a3c18", "2026-07-08T19:33:16.946Z"],
    ["a-hearty-bean-and-cornbread-meal", "cea1688d", "2026-07-08T19:33:17.441Z"],
    ["a-quick-veggie-forward-meal", "5ed56c97", "2026-07-08T19:33:18.257Z"],
    ["a-simple-weeknight-pasta", "898ee767", "2026-07-08T19:33:21.980Z"],
    ["a-spicy-heat-packed-dish", "9f530a2d", "2026-07-08T19:33:23.130Z"],
  ];
  for (const [id, hash, updated] of derivedRows) derived.run(id, hash, updated);

  // F3/F5 pre-state — the 3 profile rows (austin/jack have NONE). casey's `custom`
  // carries the live divergent shadow (defaults.default_cooking_nights = 3) plus the
  // free-text lunch_strategy and no_cook_days the value migration must never touch.
  const CASEY_CUSTOM =
    '{"defaults":{"default_cooking_nights":3,"lunch_strategy":"leftovers when available; instant ramen and buldak as fallback","no_cook_days":["Sunday"]}}';
  const EVERETT_CUSTOM =
    '{"cooking":{"default":"cook","notes":"Prefers cooking dinner most days over heat-and-eat; will flag specific heat-and-eat exceptions as they come up."}}';
  const prof = raw.prepare(
    "INSERT INTO profile (tenant, default_cooking_nights, planning_cadence_days, lunch_strategy, ready_to_eat_default_action, custom) VALUES (?, ?, ?, ?, ?, ?)",
  );
  prof.run("caitie", 4, 7, null, null, null);
  prof.run("casey", 5, null, "mixed", "auto-add", CASEY_CUSTOM);
  prof.run("everett", null, null, null, null, EVERETT_CUSTOM);

  // F4 — the 4 cooking_log rows (all type='recipe', satisfied_vibe NULL).
  const log = raw.prepare("INSERT INTO cooking_log (tenant, date, type, recipe) VALUES (?, ?, 'recipe', ?)");
  log.run("casey", "2026-06-26", "american-goulash");
  log.run("everett", "2026-07-01", "sheet-pan-salmon-and-kale");
  log.run("everett", "2026-07-08", "shrimp-with-cilantro-sauce");
  log.run("casey", "2026-07-09", "bucatini-with-butter-roasted-tomato-sauce");
}

function fresh(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  applyBefore(raw, MEAL_DIMENSION);
  seedProduction(raw);
  applyMealDimension(raw);
  return raw;
}

describe("migration 0052 — meal dimension", () => {
  it("F1: mints distinct 32-hex plan-row ids once, defaulting meal to dinner, byte-preserving the rest", () => {
    const raw = fresh();
    const rows = raw
      .prepare("SELECT tenant, id, recipe, meal, planned_for, sides, from_vibe FROM meal_plan ORDER BY tenant, recipe")
      .all() as { tenant: string; id: string; recipe: string; meal: string; planned_for: string | null; sides: string | null; from_vibe: string | null }[];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.tenant, r.recipe])).toEqual([
      ["casey", "chicken-and-black-bean-stew"],
      ["casey", "honey-mustard-salmon"],
      ["everett", "chicken-chile-verde"],
    ]);
    for (const r of rows) {
      expect(r.id).toMatch(/^[0-9a-f]{32}$/);
      expect(r.meal).toBe("dinner");
      expect(r.planned_for).toBeNull();
      expect(r.from_vibe).toBeNull();
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    // sides byte-identical: the one sided row keeps its exact JSON; the others stay NULL.
    expect(rows[0].sides).toBeNull();
    expect(rows[1].sides).toBe('["steamed rice","green salad"]');
    expect(rows[2].sides).toBeNull();
    // The rebuild adds no unique index on (tenant, recipe) — duplicates stay legal.
    const idx = raw
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'meal_plan'")
      .all() as { name: string; sql: string | null }[];
    expect(idx.some((i) => (i.sql ?? "").toUpperCase().includes("UNIQUE"))).toBe(false);
  });

  it("F1: the mint is once — a second insert path can hold explicit duplicates", () => {
    const raw = fresh();
    // The (tenant, id) PK admits a second row for the same recipe (explicit duplication).
    raw
      .prepare("INSERT INTO meal_plan (tenant, id, recipe, meal) VALUES ('casey', '01JZX5ZH7M0000000000000000', 'honey-mustard-salmon', 'dinner')")
      .run();
    const n = raw.prepare("SELECT COUNT(*) AS n FROM meal_plan WHERE tenant = 'casey' AND recipe = 'honey-mustard-salmon'").get() as { n: number };
    expect(n.n).toBe(2);
  });

  it("F2: every vibe stamps meal='dinner' with members NULL, and night_vibe_derived is untouched (no re-embed)", () => {
    const raw = fresh();
    const vibes = raw
      .prepare("SELECT id, meal, members FROM night_vibes WHERE tenant = 'casey' ORDER BY id")
      .all() as { id: string; meal: string; members: string | null }[];
    expect(vibes).toHaveLength(7);
    for (const v of vibes) {
      expect(v.meal).toBe("dinner");
      expect(v.members).toBeNull();
    }
    const derived = raw
      .prepare("SELECT id, vibe_hash, updated_at FROM night_vibe_derived WHERE tenant = 'casey' ORDER BY id")
      .all() as { id: string; vibe_hash: string; updated_at: string }[];
    expect(derived).toHaveLength(7);
    expect(derived.map((d) => d.updated_at)).toEqual([
      "2026-07-08T21:23:09.726Z",
      "2026-07-08T19:33:15.758Z",
      "2026-07-08T19:33:16.946Z",
      "2026-07-08T19:33:17.441Z",
      "2026-07-08T19:33:18.257Z",
      "2026-07-08T19:33:21.980Z",
      "2026-07-08T19:33:23.130Z",
    ]);
  });

  it("F3: cadence backfills from the COLUMN (which wins over the custom shadow), skips NULLs and absent rows, and leaves custom byte-identical", () => {
    const raw = fresh();
    const rows = raw
      .prepare("SELECT tenant, cadence, custom, default_cooking_nights FROM profile ORDER BY tenant")
      .all() as { tenant: string; cadence: string | null; custom: string | null; default_cooking_nights: number | null }[];
    expect(rows.map((r) => r.tenant)).toEqual(["caitie", "casey", "everett"]); // austin/jack: no row created
    const byTenant = new Map(rows.map((r) => [r.tenant, r]));
    // casey: the COLUMN (5) wins over custom.defaults.default_cooking_nights (3) — precedence, not merge.
    expect(JSON.parse(byTenant.get("casey")!.cadence!)).toEqual({ breakfast: 0, lunch: 0, dinner: 5 });
    expect(JSON.parse(byTenant.get("caitie")!.cadence!)).toEqual({ breakfast: 0, lunch: 0, dinner: 4 });
    expect(byTenant.get("everett")!.cadence).toBeNull();
    // The frozen scalar column is untouched (the cadence read-fallback still reads it).
    expect(byTenant.get("casey")!.default_cooking_nights).toBe(5);
    // custom byte-identical everywhere.
    expect(byTenant.get("casey")!.custom).toBe(
      '{"defaults":{"default_cooking_nights":3,"lunch_strategy":"leftovers when available; instant ramen and buldak as fallback","no_cook_days":["Sunday"]}}',
    );
    expect(byTenant.get("everett")!.custom).toBe(
      '{"cooking":{"default":"cook","notes":"Prefers cooking dinner most days over heat-and-eat; will flag specific heat-and-eat exceptions as they come up."}}',
    );
    expect(byTenant.get("caitie")!.custom).toBeNull();
  });

  it("F4: all four cooking_log rows keep meal NULL — never fabricated", () => {
    const raw = fresh();
    const rows = raw.prepare("SELECT id, meal FROM cooking_log ORDER BY id").all() as { id: number; meal: string | null }[];
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.meal).toBeNull();
  });

  it("the new CHECK sets hold: plan meals are the closed set incl. project; vibe meals exclude project; log meals nullable", () => {
    const raw = fresh();
    expect(() =>
      raw.prepare("INSERT INTO meal_plan (tenant, id, recipe, meal) VALUES ('casey', lower(hex(randomblob(16))), 'sourdough', 'project')").run(),
    ).not.toThrow();
    expect(() =>
      raw.prepare("INSERT INTO meal_plan (tenant, id, recipe, meal) VALUES ('casey', lower(hex(randomblob(16))), 'x', 'brunch')").run(),
    ).toThrow();
    expect(() => raw.prepare("UPDATE night_vibes SET meal = 'project' WHERE id = 'a-cheesy-pizza-night'").run()).toThrow();
    expect(() => raw.prepare("INSERT INTO cooking_log (tenant, date, type, recipe, meal) VALUES ('casey', '2026-07-11', 'recipe', 'x', 'lunch')").run()).not.toThrow();
    expect(() => raw.prepare("INSERT INTO cooking_log (tenant, date, type, recipe, meal) VALUES ('casey', '2026-07-11', 'recipe', 'x', 'snack')").run()).toThrow();
  });
});
