// The pure meal-plan op layer (meal-planning capability, D26-final): the full add /
// remove / set resolution matrix over id-keyed rows — id replay in every branch,
// `duplicate: true` as the one duplication spelling, slug-global coalesce (a
// cross-meal coalescing add is a MOVE), >1-match `candidates` conflicts, remove's
// split idempotency, project-row constraints, the shared earliest-due selector, and
// the read ordering guarantee.

import { describe, it, expect } from "vitest";
import {
  applyMealPlanOps,
  dueAndFuture,
  earliestDue,
  orderPlanned,
  type MealPlanOp,
  type PlannedRow,
} from "../src/meal-plan.js";
import { ulid, isRowId, ROW_ID_RE } from "../src/ids.js";

/** A deterministic mint for the tests: minted-0001, minted-0002, … (valid row ids). */
function minter(): () => string {
  let n = 0;
  return () => `minted-000${++n}`;
}

function row(id: string, recipe: string, over: Partial<PlannedRow> = {}): PlannedRow {
  return { id, recipe, meal: "dinner", planned_for: null, ...over };
}

const apply = (rows: PlannedRow[], ops: MealPlanOp[]) => applyMealPlanOps(rows, ops, minter());

describe("ids", () => {
  it("mints ULIDs that satisfy the row-id regex, alongside 32-hex migration ids", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isRowId(id)).toBe(true);
    expect(isRowId("95d0ec9e60f24545a34f92b6b7a2c8a1")).toBe(true); // the migration's mint
    expect(isRowId("shrt")).toBe(false);
    expect(isRowId("has spaces in it")).toBe(false);
    expect(ROW_ID_RE.test(ulid(1))).toBe(true);
  });
});

describe("applyMealPlanOps — add", () => {
  it("inserts a fresh recipe with a minted id, defaulting meal to dinner", () => {
    const res = apply([], [{ op: "add", recipe: "tacos", planned_for: "2026-07-14" }]);
    expect(res.conflicts).toHaveLength(0);
    expect(res.rows).toEqual([{ id: "minted-0001", recipe: "tacos", meal: "dinner", planned_for: "2026-07-14" }]);
    expect(res.applied).toEqual([{ op: "add", id: "minted-0001", recipe: "tacos", meal: "dinner" }]);
    expect(res.upserts.map((r) => r.id)).toEqual(["minted-0001"]);
  });

  it("keeps a client-supplied id on insert (the class (b) idempotency key)", () => {
    const res = apply([], [{ op: "add", id: "client-mint-01", recipe: "tacos", meal: "lunch" }]);
    expect(res.rows[0]).toMatchObject({ id: "client-mint-01", recipe: "tacos", meal: "lunch" });
  });

  it("replays an id-keyed add as an update — no duplicate row, in every branch (step 1)", () => {
    const first = apply([], [{ op: "add", id: "client-mint-01", recipe: "tacos", sides: ["slaw"] }]);
    const replay = applyMealPlanOps(first.rows, [{ op: "add", id: "client-mint-01", recipe: "tacos", sides: ["slaw"] }], minter());
    expect(replay.rows).toHaveLength(1);
    expect(replay.conflicts).toHaveLength(0);
    expect(replay.applied[0]).toMatchObject({ op: "add", id: "client-mint-01" });
    expect(replay.rows[0].sides).toEqual(["slaw"]); // union, not double
  });

  it("refuses an id addressing a different recipe, writing nothing", () => {
    const res = apply([row("r1-abcdefgh", "salmon")], [{ op: "add", id: "r1-abcdefgh", recipe: "tacos" }]);
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts[0]).toMatchObject({ op: "add", id: "r1-abcdefgh", reason: "id addresses a different recipe" });
    expect(res.rows).toEqual([row("r1-abcdefgh", "salmon")]);
  });

  it("duplicate: true inserts a second row — the ONE spelling of explicit duplication (step 2)", () => {
    const res = apply([row("r1-abcdefgh", "salmon")], [{ op: "add", recipe: "salmon", duplicate: true }]);
    expect(res.rows).toHaveLength(2);
    expect(res.conflicts).toHaveLength(0);
  });

  it("a replayed explicit duplication never creates a second duplicate (id exists → step-1 update)", () => {
    const first = apply([row("r1-abcdefgh", "salmon")], [{ op: "add", id: "dup-mint-001", recipe: "salmon", duplicate: true }]);
    expect(first.rows).toHaveLength(2);
    const replay = applyMealPlanOps(first.rows, [{ op: "add", id: "dup-mint-001", recipe: "salmon", duplicate: true }], minter());
    expect(replay.rows).toHaveLength(2);
    expect(replay.conflicts).toHaveLength(0);
  });

  it("coalesces slug-globally onto the one existing row, reporting the SURVIVOR's id (step 3)", () => {
    const res = apply(
      [row("r1-abcdefgh", "salmon", { sides: ["rice"] })],
      [{ op: "add", id: "client-mint-99", recipe: "Salmon", planned_for: "2026-07-15", sides: ["salad"], from_vibe: "v1" }],
    );
    expect(res.rows).toHaveLength(1);
    expect(res.applied[0]).toEqual({ op: "add", id: "r1-abcdefgh", recipe: "salmon", meal: "dinner", coalesced: true });
    expect(res.rows[0]).toMatchObject({ planned_for: "2026-07-15", sides: ["rice", "salad"], from_vibe: "v1" });
  });

  it("a coalescing add with a meal MOVES the row between meals — no cross-meal duplication hole", () => {
    const res = apply([row("r1-abcdefgh", "salmon")], [{ op: "add", recipe: "salmon", meal: "lunch" }]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].meal).toBe("lunch");
    expect(res.applied[0]).toMatchObject({ coalesced: true, meal: "lunch" });
  });

  it(">1 matching rows → per-op conflict with candidates, never an earliest-due auto-pick", () => {
    const res = apply(
      [row("r1-abcdefgh", "salmon", { planned_for: "2026-07-14" }), row("r2-abcdefgh", "salmon")],
      [{ op: "add", recipe: "salmon" }],
    );
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts[0].candidates).toEqual([
      { id: "r1-abcdefgh", meal: "dinner", planned_for: "2026-07-14" },
      { id: "r2-abcdefgh", meal: "dinner", planned_for: null },
    ]);
    expect(res.rows).toHaveLength(2);
  });

  it("requires a recipe", () => {
    const res = apply([], [{ op: "add" }]);
    expect(res.conflicts[0].reason).toBe("add requires a recipe slug");
  });

  it("rejects a dated or sided project row at the op layer (insert)", () => {
    const dated = apply([], [{ op: "add", recipe: "sourdough", meal: "project", planned_for: "2026-07-20" }]);
    expect(dated.conflicts[0].reason).toBe("project rows carry no date or sides");
    expect(dated.rows).toHaveLength(0);
    const sided = apply([], [{ op: "add", recipe: "sourdough", meal: "project", sides: ["butter"] }]);
    expect(sided.conflicts[0].reason).toBe("project rows carry no date or sides");
  });

  it("accepts a clean project row", () => {
    const res = apply([], [{ op: "add", recipe: "sourdough", meal: "project" }]);
    expect(res.rows[0]).toMatchObject({ recipe: "sourdough", meal: "project", planned_for: null });
  });

  it("rejects a coalescing move to project that would carry a date or sides", () => {
    const res = apply(
      [row("r1-abcdefgh", "sourdough", { planned_for: "2026-07-14" })],
      [{ op: "add", recipe: "sourdough", meal: "project" }],
    );
    expect(res.conflicts[0].reason).toBe("project rows carry no date or sides");
    expect(res.rows[0].meal).toBe("dinner"); // untouched
  });

  it("rejects an invalid id and an invalid planned_for as per-op conflicts", () => {
    const res = apply([], [
      { op: "add", id: "bad id!", recipe: "tacos" },
      { op: "add", recipe: "tacos", planned_for: "July 4" },
    ]);
    expect(res.conflicts).toHaveLength(2);
    expect(res.conflicts[0].reason).toContain("invalid row id");
    expect(res.conflicts[1].reason).toContain("invalid planned_for");
  });
});

describe("applyMealPlanOps — remove", () => {
  const base = [
    row("r1-abcdefgh", "salmon", { planned_for: "2026-07-14" }),
    row("r2-abcdefgh", "salmon", { meal: "lunch" }),
    row("r3-abcdefgh", "salmon"),
    row("r4-abcdefgh", "tacos"),
  ];

  it("by id is IDEMPOTENT: removed 1 then removed 0, never a conflict (replay safety)", () => {
    const first = apply(base, [{ op: "remove", id: "r4-abcdefgh" }]);
    expect(first.applied[0]).toMatchObject({ op: "remove", id: "r4-abcdefgh", removed: 1 });
    const replay = applyMealPlanOps(first.rows, [{ op: "remove", id: "r4-abcdefgh" }], minter());
    expect(replay.conflicts).toHaveLength(0);
    expect(replay.applied[0]).toMatchObject({ removed: 0, removed_ids: [] });
  });

  it("by slug FANS OUT across all matching rows, listing the removed ids", () => {
    const res = apply(base, [{ op: "remove", recipe: "salmon" }]);
    expect(res.applied[0]).toMatchObject({ op: "remove", recipe: "salmon", removed: 3 });
    expect(res.applied[0].removed_ids).toEqual(["r1-abcdefgh", "r2-abcdefgh", "r3-abcdefgh"]);
    expect(res.rows.map((r) => r.recipe)).toEqual(["tacos"]);
    expect(res.deletes.sort()).toEqual(["r1-abcdefgh", "r2-abcdefgh", "r3-abcdefgh"]);
  });

  it("by slug narrowed by meal removes only that meal's rows", () => {
    const res = apply(base, [{ op: "remove", recipe: "salmon", meal: "lunch" }]);
    expect(res.applied[0]).toMatchObject({ removed: 1, removed_ids: ["r2-abcdefgh"] });
  });

  it("zero slug matches stays a conflict (the conversational surface's signal)", () => {
    const res = apply(base, [{ op: "remove", recipe: "pizza" }]);
    expect(res.conflicts[0].reason).toBe("no planned row for that recipe");
  });

  it("requires exactly one addressing field", () => {
    const both = apply(base, [{ op: "remove", id: "r1-abcdefgh", recipe: "salmon" }]);
    expect(both.conflicts[0].reason).toContain("exactly one");
    const neither = apply(base, [{ op: "remove" }]);
    expect(neither.conflicts[0].reason).toContain("exactly one");
  });
});

describe("applyMealPlanOps — set", () => {
  const base = [
    row("r1-abcdefgh", "salmon", { planned_for: "2026-07-14", sides: ["rice"], from_vibe: "v1" }),
    row("r2-abcdefgh", "tacos"),
    row("r3-abcdefgh", "tacos", { meal: "lunch" }),
  ];

  it("by id may change ANY field including recipe (swap-in-slot) and meal", () => {
    const res = apply(base, [{ op: "set", id: "r1-abcdefgh", recipe: "trout", meal: "lunch" }]);
    expect(res.rows[0]).toMatchObject({ id: "r1-abcdefgh", recipe: "trout", meal: "lunch" });
    expect(res.applied[0]).toEqual({ op: "set", id: "r1-abcdefgh", recipe: "trout", meal: "lunch" });
  });

  it("by unknown id is a conflict", () => {
    const res = apply(base, [{ op: "set", id: "nope-000001", planned_for: "2026-07-15" }]);
    expect(res.conflicts[0].reason).toBe("no planned row with that id");
  });

  it("field semantics: planned_for null clears, sides replace wholesale ([] removes all), from_vibe null clears, absent preserves", () => {
    const res = apply(base, [{ op: "set", id: "r1-abcdefgh", planned_for: null, sides: [] }]);
    expect(res.rows[0].planned_for).toBeNull();
    expect(res.rows[0].sides).toBeUndefined();
    expect(res.rows[0].from_vibe).toBe("v1"); // absent preserves
    const cleared = apply(base, [{ op: "set", id: "r1-abcdefgh", from_vibe: null }]);
    expect(cleared.rows[0].from_vibe).toBeUndefined();
    expect(cleared.rows[0].sides).toEqual(["rice"]); // absent preserves
  });

  it("by slug requires a UNIQUE match — several matches return candidates", () => {
    const res = apply(base, [{ op: "set", recipe: "tacos", planned_for: "2026-07-16" }]);
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts[0].candidates).toHaveLength(2);
  });

  it("by slug narrowed by meal resolves the ambiguity (meal is the address, not a field write)", () => {
    const res = apply(base, [{ op: "set", recipe: "tacos", meal: "lunch", planned_for: "2026-07-16" }]);
    expect(res.applied[0]).toMatchObject({ op: "set", id: "r3-abcdefgh" });
    expect(res.rows[2].planned_for).toBe("2026-07-16");
    expect(res.rows[2].meal).toBe("lunch");
  });

  it("by slug with zero matches is a conflict, as today", () => {
    const res = apply(base, [{ op: "set", recipe: "pizza", planned_for: "2026-07-16" }]);
    expect(res.conflicts[0].reason).toBe("no planned row for that recipe");
  });

  it("a move to project may itself supply planned_for: null and sides: [] to satisfy the constraint", () => {
    const ok = apply(base, [{ op: "set", id: "r1-abcdefgh", meal: "project", planned_for: null, sides: [] }]);
    expect(ok.conflicts).toHaveLength(0);
    expect(ok.rows[0]).toMatchObject({ meal: "project", planned_for: null });
    const bad = apply(base, [{ op: "set", id: "r1-abcdefgh", meal: "project" }]);
    expect(bad.conflicts[0].reason).toBe("project rows carry no date or sides");
  });
});

describe("earliestDue", () => {
  it("orders planned_for ASC NULLS LAST with id ASC as the arbitrary-but-deterministic tiebreak", () => {
    const rows = [
      row("zz-abcdefgh", "a", { planned_for: "2026-07-15" }),
      row("aa-abcdefgh", "a"),
      row("mm-abcdefgh", "a", { planned_for: "2026-07-14" }),
    ];
    expect(earliestDue(rows)!.id).toBe("mm-abcdefgh");
    const tie = [row("bb-abcdefgh", "a", { planned_for: "2026-07-14" }), row("ab-abcdefgh", "a", { planned_for: "2026-07-14" })];
    expect(earliestDue(tie)!.id).toBe("ab-abcdefgh");
    expect(earliestDue([])).toBeNull();
  });
});

describe("orderPlanned — the read ordering guarantee", () => {
  it("dated by (date, meal order), then undated grouped by meal, then projects last, ties by id", () => {
    const rows: PlannedRow[] = [
      row("p1-abcdefgh", "sourdough", { meal: "project" }),
      row("u2-abcdefgh", "sandwich", { meal: "lunch" }),
      row("u1-abcdefgh", "oats", { meal: "breakfast" }),
      row("d2-abcdefgh", "pasta", { planned_for: "2026-07-15" }),
      row("d1-abcdefgh", "eggs", { meal: "breakfast", planned_for: "2026-07-15" }),
      row("d0-abcdefgh", "stew", { planned_for: "2026-07-14" }),
      row("u3-abcdefgh", "salmon"),
      row("u3a-bcdefgh", "chili"),
    ];
    expect(orderPlanned(rows).map((r) => r.id)).toEqual([
      "d0-abcdefgh", // earliest date
      "d1-abcdefgh", // same date, breakfast before dinner
      "d2-abcdefgh",
      "u1-abcdefgh", // undated breakfast
      "u2-abcdefgh", // undated lunch
      "u3-abcdefgh", // undated dinner, id ASC
      "u3a-bcdefgh",
      "p1-abcdefgh", // projects last
    ]);
  });
});

describe("dueAndFuture", () => {
  it("splits by planned_for vs today; unset (and projects) are due", () => {
    const rows = [
      row("a1-abcdefgh", "a", { planned_for: "2026-06-10" }),
      row("b1-abcdefgh", "b", { planned_for: "2026-06-13" }),
      row("c1-abcdefgh", "c"),
      row("p1-abcdefgh", "sourdough", { meal: "project" }),
    ];
    const { due, future } = dueAndFuture(rows, "2026-06-12");
    expect(due.map((i) => i.recipe)).toEqual(["a", "c", "sourdough"]);
    expect(future.map((i) => i.recipe)).toEqual(["b"]);
  });
});
