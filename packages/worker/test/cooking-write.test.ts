import { describe, it, expect } from "vitest";
import { registerCookingWriteTools, logCooked } from "../src/cooking-write.js";
import type { Env } from "../src/env.js";
import { fakeD1, type FakeD1 } from "./fake-d1.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { readVibeLastSatisfied } from "../src/night-vibe-db.js";

function collect(env: Env, username: string) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerCookingWriteTools(
    server as unknown as Parameters<typeof registerCookingWriteTools>[0],
    env,
    username,
  );
  return handlers;
}

function parse(res: { content: { text: string }[] }) {
  return JSON.parse(res.content[0].text);
}

describe("log_cooked (D1, transactional meal-plan clear)", () => {
  it("inserts a recipe entry and clears it from the meal plan in ONE batch", async () => {
    const d1: FakeD1 = fakeD1({
      recipes: ["miso-salmon"],
      tables: {
        meal_plan: [
          { tenant: "everett", id: "mp-miso-00001", recipe: "miso-salmon", meal: "dinner", planned_for: null, sides: null },
          { tenant: "everett", id: "mp-tacos-0001", recipe: "tacos", meal: "dinner", planned_for: null, sides: null },
        ],
      },
    });
    const handlers = collect(d1.env, "everett");

    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "miso-salmon", date: "2026-06-20" }));
    expect(out.logged).toMatchObject({ type: "recipe", recipe: "miso-salmon", date: "2026-06-20" });
    expect(out.commit_sha).toBeUndefined();

    // The INSERT and the meal_plan DELETE ran in ONE batch (transactional clear).
    expect(d1.batches).toHaveLength(1);
    const batch = d1.batches[0];
    expect(batch).toHaveLength(2);
    expect(batch[0].sql).toMatch(/INSERT INTO cooking_log/);
    // Trailing null is satisfied_vibe (this planned row carried no from_vibe).
    expect(batch[0].binds).toEqual(["everett", "2026-06-20", "recipe", "miso-salmon", null, null, null, null, null]);
    expect(batch[1].sql).toMatch(/DELETE FROM meal_plan/);
    // The clear deletes by the row's id — the deterministic clear order selected it.
    expect(batch[1].binds).toEqual(["everett", "mp-miso-00001"]);

    // The cooked recipe was removed; the other remains.
    expect(d1.tables.meal_plan.map((r) => r.recipe)).toEqual(["tacos"]);
  });

  it("copies the planned row's from_vibe onto the cooking-log satisfied_vibe (shape in → shape out)", async () => {
    const d1: FakeD1 = fakeD1({
      recipes: ["miso-salmon"],
      tables: {
        meal_plan: [{ tenant: "everett", id: "mp-miso-00001", recipe: "miso-salmon", meal: "dinner", planned_for: null, sides: null, from_vibe: "weeknight-fish" }],
      },
    });
    const handlers = collect(d1.env, "everett");
    await handlers.get("log_cooked")!({ type: "recipe", recipe: "miso-salmon", date: "2026-06-22" });
    // satisfied_vibe (8th bind) carries the planned row's from_vibe.
    expect(d1.batches[0][0].binds).toEqual(["everett", "2026-06-22", "recipe", "miso-salmon", null, null, null, null, "weeknight-fish"]);
  });

  it("defaults date to today when omitted", async () => {
    const d1 = fakeD1({ recipes: ["tacos"] });
    const handlers = collect(d1.env, "everett");
    const today = new Date().toISOString().slice(0, 10);
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "tacos" }));
    expect(out.logged.date).toBe(today);
    expect(d1.batches[0][0].binds[1]).toBe(today);
  });

  it("rejects a recipe entry whose slug does not resolve (not_found), writing nothing", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "not-a-recipe" }));
    expect(out.error).toBe("not_found");
    expect(d1.batches).toHaveLength(0);
  });

  it("inserts an ad_hoc entry (no meal-plan delete in the batch)", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(
      await handlers.get("log_cooked")!({ type: "ad_hoc", name: "fridge pasta", protein: "beef", date: "2026-06-21" }),
    );
    expect(out.logged).toMatchObject({ type: "ad_hoc", name: "fridge pasta" });
    const batch = d1.batches[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].binds).toEqual(["everett", "2026-06-21", "ad_hoc", null, "fridge pasta", "beef", null, null, null]);
  });

  it("rejects a non-recipe entry with no name (validation_failed)", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "ad_hoc" }));
    expect(out.error).toBe("validation_failed");
    expect(d1.batches).toHaveLength(0);
  });

  it("rejects a bad date (validation_failed)", async () => {
    const d1 = fakeD1({ recipes: ["tacos"] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "recipe", recipe: "tacos", date: "June 21" }));
    expect(out.error).toBe("validation_failed");
    expect(d1.batches).toHaveLength(0);
  });

  it("rejects an unknown type (validation_failed) — only ready_to_eat gets the accept-and-convert shim", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(await handlers.get("log_cooked")!({ type: "snack", name: "mystery" }));
    expect(out.error).toBe("validation_failed");
    expect(d1.batches).toHaveLength(0);
  });
});

// The remove-ready-to-eat one-window shim: a stale plugin's type: "ready_to_eat" write is
// accepted and CONVERTED to ad_hoc — name/date/meal/inline dims carried over unchanged —
// with a `warnings` entry on the success return, per the repo's deprecation convention.
describe("log_cooked — ready_to_eat accept-and-convert shim", () => {
  it("converts a stale ready_to_eat write to ad_hoc and returns the deprecation warning", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(
      await handlers.get("log_cooked")!({ type: "ready_to_eat", name: "frozen lasagna", protein: "beef", date: "2026-06-21" }),
    );
    expect(out.logged).toMatchObject({ type: "ad_hoc", name: "frozen lasagna", protein: "beef" });
    expect(out.warnings).toEqual([{ key: "type", reason: "retired", superseded_by: "ad_hoc" }]);
    const batch = d1.batches[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].sql).toMatch(/INSERT INTO cooking_log/);
    expect(batch[0].binds).toEqual(["everett", "2026-06-21", "ad_hoc", null, "frozen lasagna", "beef", null, null, null]);
  });

  it("carries meal through the conversion and never clears a plan row (ad_hoc behavior)", async () => {
    const d1 = fakeD1({
      recipes: [],
      tables: { meal_plan: [{ tenant: "everett", id: "mp-tacos-0001", recipe: "tacos", meal: "dinner", planned_for: null, sides: null }] },
    });
    const handlers = collect(d1.env, "everett");
    const out = parse(
      await handlers.get("log_cooked")!({ type: "ready_to_eat", name: "frozen lasagna", meal: "dinner", date: "2026-06-21" }),
    );
    expect(out.logged).toMatchObject({ type: "ad_hoc", name: "frozen lasagna", meal: "dinner" });
    expect(out.cleared_plan_row).toBeUndefined(); // only recipe entries report cleared_plan_row
    expect(d1.batches[0]).toHaveLength(1); // no meal_plan DELETE — the tacos row survives untouched
    expect(d1.tables.meal_plan).toHaveLength(1);
  });

  it("a replayed ready_to_eat write dedupes against the CONVERTED (date, meal, ad_hoc, name) identity", async () => {
    const d1 = fakeD1({ recipes: [], tables: { cooking_log: [] } });
    const first = await logCooked(
      d1.env,
      "everett",
      { type: "ready_to_eat", name: "frozen lasagna", date: "2026-06-20" },
      { dedupe: true },
    );
    expect(first.deduped).toBeUndefined();
    expect(first.logged.type).toBe("ad_hoc");
    expect(first.warnings).toEqual([{ key: "type", reason: "retired", superseded_by: "ad_hoc" }]);

    // A replay of the SAME stale ready_to_eat call converts to the same identity and dedupes.
    const replay = await logCooked(
      d1.env,
      "everett",
      { type: "ready_to_eat", name: "frozen lasagna", date: "2026-06-20" },
      { dedupe: true },
    );
    expect(replay.deduped).toBe(true);

    // An ad_hoc write with the identical (date, meal, name) identity dedupes against the
    // SAME row — the converted form and a direct ad_hoc write converge on one identity.
    const viaAdHoc = await logCooked(
      d1.env,
      "everett",
      { type: "ad_hoc", name: "frozen lasagna", date: "2026-06-20" },
      { dedupe: true },
    );
    expect(viaAdHoc.deduped).toBe(true);
    expect(d1.tables.cooking_log).toHaveLength(1);
  });
});

describe("logCooked (shared op) — dedupe", () => {
  it("dedupe OFF (the tool's default) appends even an identical entry — parity with today", async () => {
    const d1 = fakeD1({ recipes: ["tacos"], tables: { cooking_log: [] } });
    const first = await logCooked(d1.env, "everett", { type: "recipe", recipe: "tacos", date: "2026-06-20" });
    const second = await logCooked(d1.env, "everett", { type: "recipe", recipe: "tacos", date: "2026-06-20" });
    expect(first.deduped).toBeUndefined();
    expect(second.deduped).toBeUndefined();
    expect(d1.batches).toHaveLength(2);
    expect(d1.tables.cooking_log).toHaveLength(2);
  });

  it("dedupe ON short-circuits an identical (date, type, recipe) replay with { deduped: true }", async () => {
    const d1 = fakeD1({ recipes: ["tacos"], tables: { cooking_log: [] } });
    const first = await logCooked(d1.env, "everett", { type: "recipe", recipe: "tacos", date: "2026-06-20" }, { dedupe: true });
    expect(first.deduped).toBeUndefined();
    const replay = await logCooked(d1.env, "everett", { type: "recipe", recipe: "tacos", date: "2026-06-20" }, { dedupe: true });
    expect(replay.deduped).toBe(true);
    expect(d1.batches).toHaveLength(1); // exactly one insert
    expect(d1.tables.cooking_log).toHaveLength(1);
  });

  it("dedupe ON keys non-recipe entries on name, and a different name still logs", async () => {
    const d1 = fakeD1({ recipes: [], tables: { cooking_log: [] } });
    await logCooked(d1.env, "everett", { type: "ad_hoc", name: "fridge pasta", date: "2026-06-20" }, { dedupe: true });
    const replay = await logCooked(d1.env, "everett", { type: "ad_hoc", name: "fridge pasta", date: "2026-06-20" }, { dedupe: true });
    expect(replay.deduped).toBe(true);
    const other = await logCooked(d1.env, "everett", { type: "ad_hoc", name: "grilled cheese", date: "2026-06-20" }, { dedupe: true });
    expect(other.deduped).toBeUndefined();
    expect(d1.tables.cooking_log).toHaveLength(2);
  });
});

// Cook-time vibe-satisfaction attribution (D4) against REAL SQLite: the migration DDL + backfill
// apply, the log_cooked batch runs in a true transaction, and the (SELECT MAX(id) FROM cooking_log)
// subquery resolves to the just-inserted row. sqliteEnv has NO `AI` binding, so a passing run also
// proves no env.AI call is made at cook time (it reuses the cron-captured embeddings only).
describe("logCooked — cook-time vibe satisfaction (D4, real SQLite)", () => {
  const TENANT = "casey";
  const RECIPE = "miso-salmon";

  /** Seed a recipe (+ optional embedding), a palette (each vibe with an optional vector), and an
   *  optional plan row carrying `from_vibe`. Returns the migrated env + a `sat()` reader. */
  function seed(opts: {
    recipeVec?: number[] | null;
    vibes: { id: string; vec?: number[] }[];
    fromVibe?: string;
  }): {
    s: SqliteEnv;
    sat: () => { cooking_log_id: number; vibe_id: string; date: string; score: number | null }[];
  } {
    const s = sqliteEnv([TENANT]);
    const run = (sql: string, ...b: unknown[]) => s.raw.prepare(sql).run(...(b as never[]));
    run("INSERT INTO recipes (slug, title) VALUES (?, ?)", RECIPE, "Miso Salmon");
    if (opts.recipeVec) run("INSERT INTO recipe_derived (slug, embedding) VALUES (?, ?)", RECIPE, JSON.stringify(opts.recipeVec));
    for (const v of opts.vibes) {
      run("INSERT INTO night_vibes (tenant, id, vibe) VALUES (?, ?, ?)", TENANT, v.id, v.id.replace(/-/g, " "));
      if (v.vec) run("INSERT INTO night_vibe_derived (tenant, id, embedding) VALUES (?, ?, ?)", TENANT, v.id, JSON.stringify(v.vec));
    }
    if (opts.fromVibe) run("INSERT INTO meal_plan (tenant, id, recipe, from_vibe) VALUES (?, lower(hex(randomblob(16))), ?, ?)", TENANT, RECIPE, opts.fromVibe);
    return {
      s,
      sat: () =>
        s.rows<{ cooking_log_id: number; vibe_id: string; date: string; score: number | null }>("vibe_satisfaction"),
    };
  }

  const cook = (s: SqliteEnv, date = "2026-06-20") =>
    logCooked(s.env, TENANT, { type: "recipe", recipe: RECIPE, date });

  it("an on-plan cook records the aimed vibe AND every other vibe it matches (multi-vibe reset)", async () => {
    // recipe [1,1,0] matches aimed [1,0,0] and other [0,1,0] (both cosine ~0.707 ≥ gate); unrelated
    // [0,0,1] misses. All three write in the SAME batch as the log insert + plan clear.
    const { s, sat } = seed({
      recipeVec: [1, 1, 0],
      vibes: [
        { id: "aimed", vec: [1, 0, 0] },
        { id: "other", vec: [0, 1, 0] },
        { id: "unrelated", vec: [0, 0, 1] },
      ],
      fromVibe: "aimed",
    });
    await cook(s);

    const rows = sat();
    expect(rows.map((r) => r.vibe_id).sort()).toEqual(["aimed", "other"]);
    expect(rows.every((r) => r.cooking_log_id === 1 && r.date === "2026-06-20")).toBe(true);
    expect(rows.find((r) => r.vibe_id === "aimed")!.score).toBeCloseTo(0.707, 2);

    // last_satisfied advances for both satisfied vibes and not for the missed one.
    const last = await readVibeLastSatisfied(s.env, TENANT);
    expect(last.get("aimed")).toBe("2026-06-20");
    expect(last.get("other")).toBe("2026-06-20");
    expect(last.has("unrelated")).toBe(false);

    // The on-plan cook still cleared the meal plan (unchanged behavior).
    expect(s.rows("meal_plan")).toHaveLength(0);
  });

  it("an off-plan cook (no plan row) resets every vibe its recipe cosine-matches", async () => {
    const { s, sat } = seed({
      recipeVec: [1, 0, 0],
      vibes: [
        { id: "match", vec: [1, 0, 0] },
        { id: "miss", vec: [0, 1, 0] },
      ],
    });
    await cook(s, "2026-07-01");

    expect(sat().map((r) => r.vibe_id)).toEqual(["match"]);
    const last = await readVibeLastSatisfied(s.env, TENANT);
    expect(last.get("match")).toBe("2026-07-01");
    expect(last.has("miss")).toBe(false);
  });

  it("bounds over-reset: only the top match resets; weaker near-threshold matches do not", async () => {
    const { s, sat } = seed({
      recipeVec: [1, 0.875, 0.875], // strong ≈ 0.629 (top, ≥ gate); weak1/weak2 ≈ 0.550 (< gate)
      vibes: [
        { id: "strong", vec: [1, 0, 0] },
        { id: "weak1", vec: [0, 1, 0] },
        { id: "weak2", vec: [0, 0, 1] },
      ],
    });
    await cook(s);
    expect(sat().map((r) => r.vibe_id)).toEqual(["strong"]);
  });

  it("the from_vibe prior resets even at a borderline cosine, alongside genuine cosine matches", async () => {
    // aimed [0,0,1] is cosine 0 to recipe [1,0,0] (below floor) — still recorded as the prior;
    // strong [1,0,0] records on its own cosine.
    const { s, sat } = seed({
      recipeVec: [1, 0, 0],
      vibes: [
        { id: "aimed", vec: [0, 0, 1] },
        { id: "strong", vec: [1, 0, 0] },
      ],
      fromVibe: "aimed",
    });
    await cook(s);

    const rows = sat();
    expect(rows.map((r) => r.vibe_id).sort()).toEqual(["aimed", "strong"]);
    expect(rows.find((r) => r.vibe_id === "aimed")!.score).toBeCloseTo(0, 5);
    const last = await readVibeLastSatisfied(s.env, TENANT);
    expect(last.get("aimed")).toBe("2026-06-20");
  });

  it("an unembedded recipe fires ONLY the from_vibe prior (no cosine matches)", async () => {
    const { s, sat } = seed({
      recipeVec: null, // no recipe_derived row → recipe vector absent
      vibes: [
        { id: "aimed", vec: [1, 0, 0] },
        { id: "other", vec: [0, 1, 0] },
      ],
      fromVibe: "aimed",
    });
    await cook(s);
    expect(sat().map((r) => r.vibe_id)).toEqual(["aimed"]);
    expect(sat()[0].score).toBe(0);
  });

  it("an off-plan cook with an unembedded recipe records nothing", async () => {
    const { s, sat } = seed({ recipeVec: null, vibes: [{ id: "aimed", vec: [1, 0, 0] }] });
    await cook(s);
    expect(sat()).toHaveLength(0);
  });
});


// ── The deterministic clear order + meal-scoped attribution, over REAL SQLite ─────────

describe("logCooked — the deterministic clear order (D26-final, real SQLite)", () => {
  const T = "casey";

  function harness() {
    const h = sqliteEnv();
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('miso-salmon', 'Miso Salmon')").run();
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('sourdough', 'Sourdough')").run();
    return h;
  }
  function seedRow(h: ReturnType<typeof sqliteEnv>, id: string, recipe: string, opts: { meal?: string; planned_for?: string | null; from_vibe?: string | null } = {}): void {
    h.raw
      .prepare("INSERT INTO meal_plan (tenant, id, recipe, meal, planned_for, from_vibe) VALUES (?, ?, ?, ?, ?, ?)")
      .run(T, id, recipe, opts.meal ?? "dinner", opts.planned_for ?? null, opts.from_vibe ?? null);
  }
  function planIds(h: ReturnType<typeof sqliteEnv>): string[] {
    return (h.raw.prepare("SELECT id FROM meal_plan ORDER BY id").all() as { id: string }[]).map((r) => r.id);
  }

  it("step 1: a supplied plan_row_id clears exactly that row, returned in cleared_plan_row", async () => {
    const h = harness();
    seedRow(h, "row-aaaaaaaaaa", "miso-salmon", { planned_for: "2026-07-15" });
    seedRow(h, "row-bbbbbbbbbb", "miso-salmon");
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", plan_row_id: "row-bbbbbbbbbb" });
    expect(r.cleared_plan_row).toEqual({ id: "row-bbbbbbbbbb", recipe: "miso-salmon", meal: "dinner", planned_for: null });
    expect(planIds(h)).toEqual(["row-aaaaaaaaaa"]);
  });

  it("step 1: a plan_row_id holding a DIFFERENT recipe is a structured conflict — NO log written", async () => {
    const h = harness();
    seedRow(h, "row-aaaaaaaaaa", "sourdough");
    await expect(logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", plan_row_id: "row-aaaaaaaaaa" })).rejects.toMatchObject({
      code: "conflict",
    });
    expect((h.raw.prepare("SELECT COUNT(*) AS n FROM cooking_log").get() as { n: number }).n).toBe(0);
    expect(planIds(h)).toEqual(["row-aaaaaaaaaa"]); // untouched
  });

  it("step 1: a STALE plan_row_id logs WITHOUT clearing and never falls through to a surviving duplicate", async () => {
    const h = harness();
    seedRow(h, "row-bbbbbbbbbb", "miso-salmon"); // the surviving explicit duplicate
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", plan_row_id: "row-gone-00000" });
    expect(r.cleared_plan_row).toBeNull();
    expect(r.note).toContain("row-gone-00000");
    expect((h.raw.prepare("SELECT COUNT(*) AS n FROM cooking_log").get() as { n: number }).n).toBe(1); // still logged
    expect(planIds(h)).toEqual(["row-bbbbbbbbbb"]); // the duplicate survives
  });

  it("step 2: the exact (recipe, meal, date) triple clears that slot; the other meal's row survives", async () => {
    const h = harness();
    seedRow(h, "row-tue-lunch", "miso-salmon", { meal: "lunch", planned_for: "2026-07-14" });
    seedRow(h, "row-thu-dinnr", "miso-salmon", { meal: "dinner", planned_for: "2026-07-16" });
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", meal: "lunch", date: "2026-07-14" });
    expect(r.cleared_plan_row?.id).toBe("row-tue-lunch");
    expect(planIds(h)).toEqual(["row-thu-dinnr"]);
  });

  it("step 3: the earliest-due fallback (planned_for ASC NULLS LAST, id ASC) never consumes a project row", async () => {
    const h = harness();
    seedRow(h, "row-undated-1", "sourdough");
    seedRow(h, "row-project-1", "sourdough", { meal: "project" });
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "sourdough" });
    expect(r.cleared_plan_row?.id).toBe("row-undated-1");
    expect(planIds(h)).toEqual(["row-project-1"]); // the project survives
    // Only an entry whose meal IS 'project' may clear the project row.
    const r2 = await logCooked(h.env, T, { type: "recipe", recipe: "sourdough", meal: "project" });
    expect(r2.cleared_plan_row?.id).toBe("row-project-1");
    expect(r2.logged.meal).toBe("project");
  });

  it("step 3: a 'project' cook clears the PROJECT row even when a same-slug dated dinner is due sooner", async () => {
    // The exact grill failure scenario: 'sourdough' planned as both an (undated, op-enforced)
    // project row AND a dated dinner row. earliest-due orders planned_for ASC NULLS LAST, so the
    // dated dinner sorts ahead of the undated project — the fallback must NOT admit it for a
    // project cook, or it silently deletes the future dinner and leaves the finished bake planned.
    const h = harness();
    seedRow(h, "row-project-1", "sourdough", { meal: "project" });
    seedRow(h, "row-dinner-01", "sourdough", { meal: "dinner", planned_for: "2026-07-15" });
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "sourdough", meal: "project", date: "2026-07-20" });
    expect(r.cleared_plan_row?.id).toBe("row-project-1"); // the project row, not the sooner-due dinner
    expect(planIds(h)).toEqual(["row-dinner-01"]); // the dated dinner slot survives
  });

  it("one cook clears ONE row — an explicit duplicate survives the first cook (earliest-due picked)", async () => {
    const h = harness();
    seedRow(h, "row-bbbbbbbbbb", "miso-salmon", { planned_for: "2026-07-16" });
    seedRow(h, "row-aaaaaaaaaa", "miso-salmon", { planned_for: "2026-07-14" });
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon" });
    expect(r.cleared_plan_row?.id).toBe("row-aaaaaaaaaa"); // earliest planned_for
    expect(planIds(h)).toEqual(["row-bbbbbbbbbb"]);
  });

  it("step 4: no match → no clear (an off-plan cook), cleared_plan_row: null", async () => {
    const h = harness();
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon" });
    expect(r.cleared_plan_row).toBeNull();
    expect((h.raw.prepare("SELECT meal FROM cooking_log").get() as { meal: string | null }).meal).toBeNull();
  });

  it("the from_vibe prior is read from THE ROW ACTUALLY CLEARED, never a slug-global pick", async () => {
    const h = harness();
    seedRow(h, "row-aaaaaaaaaa", "miso-salmon", { planned_for: "2026-07-14", from_vibe: "vibe-earliest" });
    seedRow(h, "row-bbbbbbbbbb", "miso-salmon", { planned_for: "2026-07-16", from_vibe: "vibe-later" });
    const r = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", plan_row_id: "row-bbbbbbbbbb" });
    expect(r.cleared_plan_row?.id).toBe("row-bbbbbbbbbb");
    const logged = h.raw.prepare("SELECT satisfied_vibe FROM cooking_log").get() as { satisfied_vibe: string | null };
    expect(logged.satisfied_vibe).toBe("vibe-later");
    // The other row's provenance is untouched for its own future cook.
    const rest = h.raw.prepare("SELECT from_vibe FROM meal_plan").get() as { from_vibe: string | null };
    expect(rest.from_vibe).toBe("vibe-earliest");
  });

  it("route dedupe identity is (date, meal, type, recipe|name): a NULL meal matches NULL only", async () => {
    const h = harness();
    const lunch = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", meal: "lunch", date: "2026-07-14" }, { dedupe: true });
    expect(lunch.deduped).toBeUndefined();
    // Same date + recipe, DIFFERENT meal → a distinct identity, not a replay.
    const dinner = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", meal: "dinner", date: "2026-07-14" }, { dedupe: true });
    expect(dinner.deduped).toBeUndefined();
    // The exact tuple replayed → deduped, nothing inserted.
    const replay = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", meal: "lunch", date: "2026-07-14" }, { dedupe: true });
    expect(replay.deduped).toBe(true);
    // A meal-less entry is its own identity too (NULL matches NULL only).
    const bare = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", date: "2026-07-14" }, { dedupe: true });
    expect(bare.deduped).toBeUndefined();
    const bareReplay = await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", date: "2026-07-14" }, { dedupe: true });
    expect(bareReplay.deduped).toBe(true);
    expect((h.raw.prepare("SELECT COUNT(*) AS n FROM cooking_log").get() as { n: number }).n).toBe(3);
  });

  it("vibe attribution is MEAL-SCOPED: a lunch cook cosine-matches lunch vibes only; a meal-less cook matches all", async () => {
    const h = harness();
    const vec = JSON.stringify([1, 0, 0]);
    h.raw.prepare("INSERT INTO recipe_derived (slug, embedding) VALUES ('miso-salmon', ?)").run(vec);
    h.raw.prepare("INSERT INTO night_vibes (tenant, id, vibe, meal) VALUES (?, 'lunch-vibe', 'a bright lunch', 'lunch')").run(T);
    h.raw.prepare("INSERT INTO night_vibes (tenant, id, vibe, meal) VALUES (?, 'dinner-vibe', 'a bright dinner', 'dinner')").run(T);
    h.raw.prepare("INSERT INTO night_vibe_derived (tenant, id, embedding) VALUES (?, 'lunch-vibe', ?)").run(T, vec);
    h.raw.prepare("INSERT INTO night_vibe_derived (tenant, id, embedding) VALUES (?, 'dinner-vibe', ?)").run(T, vec);

    await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", meal: "lunch", date: "2026-07-14" });
    const lunchSat = h.raw.prepare("SELECT vibe_id FROM vibe_satisfaction ORDER BY vibe_id").all() as { vibe_id: string }[];
    expect(lunchSat.map((r) => r.vibe_id)).toEqual(["lunch-vibe"]); // the dinner vibe is out of scope

    // A meal-less entry matches ALL vibes (fail-open — the pre-meal behavior).
    await logCooked(h.env, T, { type: "recipe", recipe: "miso-salmon", date: "2026-07-15" });
    const allSat = h.raw.prepare("SELECT vibe_id FROM vibe_satisfaction WHERE date = '2026-07-15' ORDER BY vibe_id").all() as { vibe_id: string }[];
    expect(allSat.map((r) => r.vibe_id)).toEqual(["dinner-vibe", "lunch-vibe"]);
  });
});
