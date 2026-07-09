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
          { tenant: "everett", recipe: "miso-salmon", planned_for: null, sides: null },
          { tenant: "everett", recipe: "tacos", planned_for: null, sides: null },
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
    expect(batch[0].binds).toEqual(["everett", "2026-06-20", "recipe", "miso-salmon", null, null, null, null]);
    expect(batch[1].sql).toMatch(/DELETE FROM meal_plan/);
    expect(batch[1].binds).toEqual(["everett", "miso-salmon"]);

    // The cooked recipe was removed; the other remains.
    expect(d1.tables.meal_plan.map((r) => r.recipe)).toEqual(["tacos"]);
  });

  it("copies the planned row's from_vibe onto the cooking-log satisfied_vibe (shape in → shape out)", async () => {
    const d1: FakeD1 = fakeD1({
      recipes: ["miso-salmon"],
      tables: {
        meal_plan: [{ tenant: "everett", recipe: "miso-salmon", planned_for: null, sides: null, from_vibe: "weeknight-fish" }],
      },
    });
    const handlers = collect(d1.env, "everett");
    await handlers.get("log_cooked")!({ type: "recipe", recipe: "miso-salmon", date: "2026-06-22" });
    // satisfied_vibe (8th bind) carries the planned row's from_vibe.
    expect(d1.batches[0][0].binds).toEqual(["everett", "2026-06-22", "recipe", "miso-salmon", null, null, null, "weeknight-fish"]);
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

  it("inserts a ready_to_eat entry (no meal-plan delete in the batch)", async () => {
    const d1 = fakeD1({ recipes: [] });
    const handlers = collect(d1.env, "everett");
    const out = parse(
      await handlers.get("log_cooked")!({ type: "ready_to_eat", name: "frozen lasagna", protein: "beef", date: "2026-06-21" }),
    );
    expect(out.logged).toMatchObject({ type: "ready_to_eat", name: "frozen lasagna" });
    const batch = d1.batches[0];
    expect(batch).toHaveLength(1);
    expect(batch[0].binds).toEqual(["everett", "2026-06-21", "ready_to_eat", null, "frozen lasagna", "beef", null, null]);
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
    if (opts.fromVibe) run("INSERT INTO meal_plan (tenant, recipe, from_vibe) VALUES (?, ?, ?)", TENANT, RECIPE, opts.fromVibe);
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
