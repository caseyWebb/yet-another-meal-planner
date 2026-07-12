import { describe, expect, it } from "vitest";
import {
  acceptGrocerySubstitution,
  setGroceryBuyAnyway,
  setGroceryChecked,
  undoGrocerySubstitution,
  verifyGroceryPantry,
} from "../src/grocery-operations.js";
import { readGrocerySnapshot } from "../src/grocery-snapshot.js";
import { addGroceryRow, updateGroceryRow } from "../src/session-db.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";

const T = "casey";
function plan(h: SqliteEnv, ingredient: string): void {
  h.raw.prepare("INSERT INTO recipes (slug,title,ingredients_full) VALUES ('soup','Soup',?)").run(JSON.stringify([ingredient]));
  h.raw.prepare("INSERT INTO meal_plan (tenant,id,recipe,meal,planned_for) VALUES (?,'p1','soup','dinner','2026-07-13')").run(T);
}

describe("grocery checked operation", () => {
  it("atomically materializes a virtual line and duplicate delivery is idempotent", async () => {
    const h = sqliteEnv([T]); plan(h, "onion");
    const before = await readGrocerySnapshot(h.env, T);
    const first = await setGroceryChecked(h.env, T, { key: "onion", checked: true, expected_row_version: 0, snapshot_version: before.snapshot_version, occurred_at: "2026-07-12T12:00:00Z" });
    expect(first.snapshot.lines.find((l) => l.key === "onion")).toMatchObject({ checked_at: "2026-07-12T12:00:00Z", origin: "both" });
    const replay = await setGroceryChecked(h.env, T, { key: "onion", checked: true, expected_row_version: 0, snapshot_version: before.snapshot_version, occurred_at: "2026-07-12T12:00:00Z" });
    expect(replay.status).toBe("ok");
    expect(h.rows("grocery_list")).toHaveLength(1);
    expect(h.rows("grocery_list")[0].status).toBe("active");
  });

  it("merges identical state but conflicts an opposing stale version", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    let snap = await readGrocerySnapshot(h.env, T);
    await setGroceryChecked(h.env, T, { key: "milk", checked: true, expected_row_version: 1, snapshot_version: snap.snapshot_version });
    await expect(setGroceryChecked(h.env, T, { key: "milk", checked: false, expected_row_version: 1, snapshot_version: snap.snapshot_version })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("grocery decisions", () => {
  it("persists substitution suppression and Undo preserves an edited replacement", async () => {
    const h = sqliteEnv([T]); plan(h, "milk");
    const before = await readGrocerySnapshot(h.env, T);
    const swapped = await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: before.snapshot_version });
    expect(swapped.snapshot.to_buy).toContain("oat milk");
    expect(swapped.snapshot.to_buy).not.toContain("milk");
    await updateGroceryRow(h.env, T, "Oat milk", { note: "barista" });
    const current = await readGrocerySnapshot(h.env, T);
    const undone = await undoGrocerySubstitution(h.env, T, { original_key: "milk", snapshot_version: current.snapshot_version });
    expect(undone.snapshot.to_buy).toContain("milk");
    expect(h.rows("grocery_list").some((r) => r.normalized_name === "oat milk")).toBe(true);
  });

  it("converges response-lost decision replays before stale snapshot checks", async () => {
    const h = sqliteEnv([T]); plan(h, "milk");
    const before = await readGrocerySnapshot(h.env, T);
    await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: before.snapshot_version });
    const replay = await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: before.snapshot_version });
    expect(replay.outcome).toBe("already substituted");
    expect(h.rows("grocery_substitution_decisions")[0]).toMatchObject({ created_replacement: 1, row_version: 1 });
    await undoGrocerySubstitution(h.env, T, { original_key: "milk", snapshot_version: replay.snapshot.snapshot_version });
    h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,category,added_at,last_verified_at) VALUES (?,'Milk','milk','dairy','2026-07-01','2026-07-12')").run(T);
    const coveredSnapshot = await readGrocerySnapshot(h.env, T);
    const covered = coveredSnapshot.pantry_covered[0];
    const bought = await setGroceryBuyAnyway(h.env, T, { key: covered.key, enabled: true, snapshot_version: coveredSnapshot.snapshot_version });
    const coverageReplay = await setGroceryBuyAnyway(h.env, T, { key: covered.key, enabled: true, snapshot_version: coveredSnapshot.snapshot_version });
    expect(coverageReplay.outcome).toBe("already buy anyway");
    expect(h.rows("grocery_coverage_decisions")[0]).toMatchObject({ created_row: 1, row_version: 1 });
    await setGroceryBuyAnyway(h.env, T, { key: covered.key, enabled: false, snapshot_version: bought.snapshot.snapshot_version });
    const undoReplay = await setGroceryBuyAnyway(h.env, T, { key: covered.key, enabled: false, snapshot_version: bought.snapshot.snapshot_version });
    expect(undoReplay.outcome).toBe("already undone");
  });

  it("Buy anyway overrides coverage; Still good refreshes freshness", async () => {
    const h = sqliteEnv([T]); plan(h, "milk");
    h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,category,added_at,last_verified_at) VALUES (?,'Milk','milk','dairy','2026-06-01','2026-06-01')").run(T);
    const before = await readGrocerySnapshot(h.env, T);
    expect(before.pantry_covered[0].freshness).toBe("worth_a_look");
    const verified = await verifyGroceryPantry(h.env, T, { key: "milk", snapshot_version: before.snapshot_version });
    expect(verified.snapshot.pantry_covered[0].freshness).toBe("covered");
    const bought = await setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: true, snapshot_version: verified.snapshot.snapshot_version });
    expect(bought.snapshot.to_buy).toContain("milk");
    const undone = await setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: false, snapshot_version: bought.snapshot.snapshot_version });
    expect(undone.snapshot.pantry_covered.map((x) => x.key)).toContain("milk");
  });
});
