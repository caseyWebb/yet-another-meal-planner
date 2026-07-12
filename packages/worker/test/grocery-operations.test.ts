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
function replacements(h: SqliteEnv): void {
  for (const [id, label] of [["oat milk", "Oat milk"], ["soy milk", "Soy milk"]]) h.raw.prepare("INSERT INTO ingredient_identity (id,base,display_name,concrete,source) VALUES (?,?,?,1,'auto')").run(id, id, label);
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

  it("generic grocery upserts preserve checked_at", async () => {
    const h = sqliteEnv([T]); await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12"); const snap = await readGrocerySnapshot(h.env, T);
    await setGroceryChecked(h.env, T, { key: "milk", checked: true, expected_row_version: 1, snapshot_version: snap.snapshot_version });
    await updateGroceryRow(h.env, T, "milk", { note: "keep cold" });
    expect(h.rows<{ checked_at: string | null }>("grocery_list")[0].checked_at).not.toBeNull();
  });

  it("merges identical state but conflicts an opposing stale version", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    let snap = await readGrocerySnapshot(h.env, T);
    await setGroceryChecked(h.env, T, { key: "milk", checked: true, expected_row_version: 1, snapshot_version: snap.snapshot_version });
    await expect(setGroceryChecked(h.env, T, { key: "milk", checked: false, expected_row_version: 1, snapshot_version: snap.snapshot_version })).rejects.toMatchObject({ code: "conflict" });
  });

  it("re-reads authoritative truth when a concurrent writer reaches the requested checked state", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB); let raced = false;
    h.env.DB.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!raced && sql.includes("SELECT name, perishable FROM staples")) {
        const originalAll = statement.all.bind(statement);
        statement.all = (async <R>() => {
          raced = true;
          h.raw.prepare("UPDATE grocery_list SET checked_at='2026-07-12T12:00:00Z',row_version=row_version+1 WHERE tenant=? AND normalized_name='milk'").run(T);
          return originalAll<R>();
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof h.env.DB.prepare;
    const result = await setGroceryChecked(h.env, T, { key: "milk", checked: true, expected_row_version: 1, snapshot_version: "sha256:" + "0".repeat(64) });
    expect(raced).toBe(true);
    expect(result.snapshot.lines.find((line) => line.key === "milk")).toMatchObject({ checked_at: "2026-07-12T12:00:00Z", row_version: 2 });
  });

  it("returns the authoritative post-race snapshot for a checked row-version conflict", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "milk" }, "2026-07-12");
    h.raw.prepare("UPDATE grocery_list SET note='first newer note',row_version=2 WHERE tenant=? AND normalized_name='milk'").run(T);
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB); let listReads = 0;
    h.env.DB.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes("FROM grocery_list WHERE tenant = ?1")) {
        const originalAll = statement.all.bind(statement);
        statement.all = (async <R>() => {
          listReads += 1;
          if (listReads === 2) {
            h.raw.prepare("UPDATE grocery_list SET note='newest note',row_version=3 WHERE tenant=? AND normalized_name='milk'").run(T);
          }
          return originalAll<R>();
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof h.env.DB.prepare;
    await expect(setGroceryChecked(h.env, T, { key: "milk", checked: true, expected_row_version: 1, snapshot_version: "sha256:" + "0".repeat(64) })).rejects.toMatchObject({
      code: "conflict",
      context: { snapshot: { lines: [expect.objectContaining({ key: "milk", note: "newest note", row_version: 3 })] } },
    });
  });
});

describe("grocery decisions", () => {
  it("rejects a self-substitution without writing a decision", async () => {
    const h = sqliteEnv([T]); plan(h, "milk");
    const before = await readGrocerySnapshot(h.env, T);
    await expect(acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "milk", replacement_name: "Milk", snapshot_version: before.snapshot_version })).rejects.toMatchObject({ code: "validation_failed" });
    expect(h.rows("grocery_substitution_decisions")).toHaveLength(0);
  });

  it.each(["active", "in_cart"] as const)("merges attribution into an existing %s replacement without clobbering independent fields", async (status) => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h);
    await addGroceryRow(h.env, T, { name: "Oat milk", for_recipes: ["latte"], quantity: "2", note: "barista" }, "2026-07-12");
    if (status === "in_cart") await updateGroceryRow(h.env, T, "Oat milk", { status: "in_cart" });
    h.raw.prepare("UPDATE grocery_list SET checked_at='2026-07-12T10:00:00Z' WHERE tenant=? AND normalized_name='oat milk'").run(T);
    const prior = h.rows<{ row_version: number }>("grocery_list")[0].row_version;
    const before = await readGrocerySnapshot(h.env, T);
    await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: before.snapshot_version });
    const row = h.rows<{ status: string; quantity: string; note: string; checked_at: string; for_recipes: string; row_version: number }>("grocery_list")[0];
    expect(row).toMatchObject({ status: "active", quantity: "2", note: "barista", checked_at: "2026-07-12T10:00:00Z" });
    expect(JSON.parse(row.for_recipes)).toEqual(["latte", "soup"]);
    expect(row.row_version).toBe(prior + 1);
    expect(h.rows("grocery_substitution_decisions")[0]).toMatchObject({ created_replacement: 0, ownership_token: null });
  });

  it("persists substitution suppression and Undo preserves an edited replacement", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h);
    const before = await readGrocerySnapshot(h.env, T);
    const swapped = await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: before.snapshot_version });
    expect(swapped.snapshot.to_buy).toContain("oat milk");
    expect(swapped.snapshot.to_buy).not.toContain("milk");
    const reopened = await readGrocerySnapshot(h.env, T);
    expect(reopened.substitution_decisions).toEqual([
      expect.objectContaining({ original_key: "milk", replacement_key: "oat milk" }),
    ]);
    await updateGroceryRow(h.env, T, "Oat milk", { note: "barista" });
    const current = await readGrocerySnapshot(h.env, T);
    const undone = await undoGrocerySubstitution(h.env, T, { original_key: "milk", snapshot_version: current.snapshot_version });
    expect(undone.snapshot.to_buy).toContain("milk");
    expect(h.rows("grocery_list").some((r) => r.normalized_name === "oat milk")).toBe(true);
  });

  it("converges response-lost decision replays before stale snapshot checks", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h);
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

  it("refreshes the same replacement when attribution changes", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h); let snap = await readGrocerySnapshot(h.env, T);
    await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: snap.snapshot_version });
    h.raw.prepare("INSERT INTO recipes (slug,title,ingredients_full) VALUES ('latte','Latte','[\"milk\"]')").run();
    h.raw.prepare("INSERT INTO meal_plan (tenant,id,recipe,meal,planned_for) VALUES (?,'p2','latte','breakfast','2026-07-14')").run(T);
    snap = await readGrocerySnapshot(h.env, T);
    expect(snap.substitution_decisions).toEqual([]);
    expect(snap.to_buy).toContain("milk");
    const before = h.rows<{ attribution_signature: string; row_version: number }>("grocery_substitution_decisions")[0];
    await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: snap.snapshot_version });
    const after = h.rows<{ attribution_signature: string; row_version: number }>("grocery_substitution_decisions")[0];
    expect(after.attribution_signature).not.toBe(before.attribution_signature); expect(after.row_version).toBeGreaterThan(before.row_version);
  });

  it("does not claim ownership when an ordinary add wins the substitution creation race", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h); const before = await readGrocerySnapshot(h.env, T);
    const originalBatch = h.env.DB.batch.bind(h.env.DB); let intercepted = false;
    h.env.DB.batch = (async (statements: D1PreparedStatement[]) => {
      if (!intercepted) {
        intercepted = true;
        h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,row_version) VALUES (?,'Oat milk','oat milk','4','grocery','grocery','active','ad_hoc','[]','mine','2026-07-12',1)").run(T);
      }
      return originalBatch(statements);
    }) as D1Database["batch"];
    const accepted = await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: before.snapshot_version });
    expect(h.rows("grocery_substitution_decisions")[0]).toMatchObject({ created_replacement: 0, ownership_token: null });
    await undoGrocerySubstitution(h.env, T, { original_key: "milk", snapshot_version: accepted.snapshot.snapshot_version });
    expect(h.rows<{ note: string }>("grocery_list")[0].note).toBe("mine");
  });

  it("CAS-protects substitution Undo from erasing a newer decision", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h); let snap = await readGrocerySnapshot(h.env, T);
    snap = (await acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: snap.snapshot_version })).snapshot;
    const originalBatch = h.env.DB.batch.bind(h.env.DB); let intercepted = false;
    h.env.DB.batch = (async (statements: D1PreparedStatement[]) => {
      if (!intercepted) { intercepted = true; h.raw.prepare("UPDATE grocery_substitution_decisions SET row_version=row_version+1,operation_token='newer' WHERE tenant=? AND original_key='milk'").run(T); }
      return originalBatch(statements);
    }) as D1Database["batch"];
    await expect(undoGrocerySubstitution(h.env, T, { original_key: "milk", snapshot_version: snap.snapshot_version })).rejects.toMatchObject({ code: "conflict" });
    expect(h.rows("grocery_substitution_decisions")).toHaveLength(1);
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("serializes identical and different concurrent substitution accepts without orphan rows", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); replacements(h); const snap = await readGrocerySnapshot(h.env, T);
    const same = await Promise.all([
      acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: snap.snapshot_version }),
      acceptGrocerySubstitution(h.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: snap.snapshot_version }),
    ]);
    expect(same).toHaveLength(2); expect(h.rows("grocery_substitution_decisions")).toHaveLength(1); expect(h.rows("grocery_list")).toHaveLength(1);
    const h2 = sqliteEnv([T]); plan(h2, "milk"); replacements(h2); const start = await readGrocerySnapshot(h2.env, T);
    const different = await Promise.allSettled([
      acceptGrocerySubstitution(h2.env, T, { original_key: "milk", replacement_key: "oat milk", replacement_name: "Oat milk", snapshot_version: start.snapshot_version }),
      acceptGrocerySubstitution(h2.env, T, { original_key: "milk", replacement_key: "soy milk", replacement_name: "Soy milk", snapshot_version: start.snapshot_version }),
    ]);
    expect(different.filter((result) => result.status === "rejected")).toHaveLength(1);
    const decision = h2.rows<{ replacement_key: string }>("grocery_substitution_decisions")[0];
    expect(h2.rows<{ normalized_name: string }>("grocery_list").map((row) => row.normalized_name)).toEqual([decision.replacement_key]);
  });

  it("uses the authoritative covered display and rejects missing Still-good rows", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,display_name,category,added_at,last_verified_at) VALUES (?,'milk','milk','Whole milk','dairy','2026-07-01','2026-07-01')").run(T);
    const before = await readGrocerySnapshot(h.env, T);
    await setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: true, name: "Client spoof", snapshot_version: before.snapshot_version });
    expect(h.rows<{ name: string }>("grocery_list")[0].name).toBe("Whole milk");
    const current = await readGrocerySnapshot(h.env, T); h.raw.prepare("DELETE FROM pantry WHERE tenant=? AND normalized_name='milk'").run(T);
    await expect(verifyGroceryPantry(h.env, T, { key: "milk", snapshot_version: current.snapshot_version })).rejects.toMatchObject({ code: "not_found" });
  });

  it("converges concurrent identical Buy-anyway deliveries without duplicate rows", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,category,added_at,last_verified_at) VALUES (?,'Milk','milk','dairy','2026-07-01','2026-07-12')").run(T);
    const before = await readGrocerySnapshot(h.env, T);
    const results = await Promise.all([
      setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: true, snapshot_version: before.snapshot_version }),
      setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: true, snapshot_version: before.snapshot_version }),
    ]);
    expect(results).toHaveLength(2); expect(h.rows("grocery_coverage_decisions")).toHaveLength(1); expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("does not claim ownership when an ordinary add wins the Buy-anyway creation race", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,category,added_at,last_verified_at) VALUES (?,'Milk','milk','dairy','2026-07-01','2026-07-12')").run(T);
    const before = await readGrocerySnapshot(h.env, T); const originalBatch = h.env.DB.batch.bind(h.env.DB); let intercepted = false;
    h.env.DB.batch = (async (statements: D1PreparedStatement[]) => {
      if (!intercepted) { intercepted = true; h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,row_version) VALUES (?,'Milk','milk','2','grocery','grocery','active','ad_hoc','[]','mine','2026-07-12',1)").run(T); }
      return originalBatch(statements);
    }) as D1Database["batch"];
    const bought = await setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: true, snapshot_version: before.snapshot_version });
    expect(h.rows("grocery_coverage_decisions")[0]).toMatchObject({ created_row: 0, ownership_token: null });
    await setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: false, snapshot_version: bought.snapshot.snapshot_version });
    expect(h.rows<{ note: string }>("grocery_list")[0].note).toBe("mine");
  });

  it("CAS-protects Buy-anyway Undo from erasing a newer decision", async () => {
    const h = sqliteEnv([T]); plan(h, "milk"); h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,category,added_at,last_verified_at) VALUES (?,'Milk','milk','dairy','2026-07-01','2026-07-12')").run(T);
    let snap = await readGrocerySnapshot(h.env, T); snap = (await setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: true, snapshot_version: snap.snapshot_version })).snapshot;
    const originalBatch = h.env.DB.batch.bind(h.env.DB); let intercepted = false;
    h.env.DB.batch = (async (statements: D1PreparedStatement[]) => {
      if (!intercepted) { intercepted = true; h.raw.prepare("UPDATE grocery_coverage_decisions SET row_version=row_version+1,operation_token='newer' WHERE tenant=? AND line_key='milk'").run(T); }
      return originalBatch(statements);
    }) as D1Database["batch"];
    await expect(setGroceryBuyAnyway(h.env, T, { key: "milk", enabled: false, snapshot_version: snap.snapshot_version })).rejects.toMatchObject({ code: "conflict" });
    expect(h.rows("grocery_coverage_decisions")).toHaveLength(1);
    expect(h.rows("grocery_list")).toHaveLength(1);
  });
});
