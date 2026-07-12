import { describe, expect, it } from "vitest";
import { markGrocerySendPlaced, relistGrocerySendLine } from "../src/grocery-operations.js";
import { readGrocerySnapshot } from "../src/grocery-snapshot.js";
import { addGroceryRow, updateGroceryRow } from "../src/session-db.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";

const T = "casey";
async function sent(h: SqliteEnv, keys: string[] = ["milk", "eggs"]): Promise<void> {
  h.raw.prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('s1',?,'kroger','kroger_online','2026-07-12T10:00:00Z')").run(T);
  for (const key of keys) {
    await addGroceryRow(h.env, T, { name: key }, "2026-07-12");
    await updateGroceryRow(h.env, T, key, { status: "in_cart" });
    h.raw.prepare("UPDATE grocery_list SET sent_in='s1' WHERE tenant=? AND normalized_name=?").run(T, key);
    h.raw.prepare("INSERT INTO order_send_lines (send_id,line_key,name,quantity,unit_price,savings,provenance) VALUES ('s1',?,?,1,4,1,'planned')").run(key, key);
  }
}

describe("send-scoped grocery lifecycle", () => {
  it("Back to list is guarded, keeps quote history, and writes no spend", async () => {
    const h = sqliteEnv([T]); await sent(h, ["milk"]);
    const before = await readGrocerySnapshot(h.env, T);
    const line = before.in_cart_groups[0].lines[0];
    const result = await relistGrocerySendLine(h.env, T, { send_id: "s1", line_key: "milk", expected_row_version: line.row_version });
    expect(result.snapshot.to_buy).toContain("milk");
    expect(h.rows("order_send_lines")).toHaveLength(1);
    expect(h.rows("spend_events")).toHaveLength(0);
    const replay = await relistGrocerySendLine(h.env, T, { send_id: "s1", line_key: "milk", expected_row_version: line.row_version });
    expect(replay.outcome).toBe("already relisted");
  });

  it("places exactly one send atomically, copies D16 quotes, and replay is inert", async () => {
    const h = sqliteEnv([T]); await sent(h);
    const before = await readGrocerySnapshot(h.env, T);
    const placed = await markGrocerySendPlaced(h.env, T, { send_id: "s1", expected_line_keys: ["eggs", "milk"], snapshot_version: before.snapshot_version, occurred_at: "2026-07-12T12:00:00Z" });
    expect(placed.snapshot.in_cart_groups).toHaveLength(0);
    expect(h.rows("grocery_list").every((row) => row.status === "ordered")).toBe(true);
    expect(h.rows("spend_events")).toHaveLength(2);
    expect(h.rows("order_sends")[0].placed_at).toBe("2026-07-12T12:00:00Z");
    h.raw.prepare("UPDATE grocery_list SET status='active', sent_in=NULL WHERE tenant=? AND normalized_name='milk'").run(T);
    await markGrocerySendPlaced(h.env, T, { send_id: "s1", expected_line_keys: ["eggs", "milk"], snapshot_version: before.snapshot_version });
    expect(h.raw.prepare("SELECT status FROM grocery_list WHERE normalized_name='milk'").get()).toEqual({ status: "active" });
    expect(h.rows("spend_events")).toHaveLength(2);
  });

  it("rejects mismatch, cross-tenant send, and zero-line send without partial writes", async () => {
    const h = sqliteEnv([T, "everett"]); await sent(h);
    const before = await readGrocerySnapshot(h.env, T);
    await expect(markGrocerySendPlaced(h.env, T, { send_id: "s1", expected_line_keys: ["milk"], snapshot_version: before.snapshot_version })).rejects.toMatchObject({ code: "conflict" });
    expect(h.rows("grocery_list").every((row) => row.status === "in_cart")).toBe(true);
    expect(h.rows("spend_events")).toHaveLength(0);
    await expect(markGrocerySendPlaced(h.env, "everett", { send_id: "s1", expected_line_keys: [], snapshot_version: "x" })).rejects.toMatchObject({ code: "not_found" });
    h.raw.prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at) VALUES ('empty',?,'kroger','kroger_online','2026-07-12')").run(T);
    const fresh = await readGrocerySnapshot(h.env, T);
    await expect(markGrocerySendPlaced(h.env, T, { send_id: "empty", expected_line_keys: [], snapshot_version: fresh.snapshot_version })).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("returns the authoritative post-race snapshot for a membership conflict", async () => {
    const h = sqliteEnv([T]); await sent(h);
    const before = await readGrocerySnapshot(h.env, T);
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB); let raced = false;
    h.env.DB.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!raced && sql.includes("SELECT normalized_name FROM grocery_list WHERE tenant=?1 AND status='in_cart' AND sent_in=?2")) {
        const originalAll = statement.all.bind(statement);
        statement.all = (async <R>() => {
          const rows = await originalAll<R>();
          raced = true;
          h.raw.prepare("UPDATE grocery_list SET sent_in=NULL WHERE tenant=? AND normalized_name='milk'").run(T);
          return rows;
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof h.env.DB.prepare;
    await expect(markGrocerySendPlaced(h.env, T, {
      send_id: "s1",
      expected_line_keys: ["milk"],
      snapshot_version: before.snapshot_version,
    })).rejects.toMatchObject({
      code: "conflict",
      context: {
        snapshot: {
          in_cart_groups: expect.arrayContaining([
            expect.objectContaining({ send_id: null, lines: [expect.objectContaining({ key: "milk" })] }),
          ]),
        },
      },
    });
  });

  it("conflicts with a fresh snapshot when the final member is relisted before validation", async () => {
    const h = sqliteEnv([T]); await sent(h, ["milk"]);
    const before = await readGrocerySnapshot(h.env, T);
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB); let raced = false;
    h.env.DB.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!raced && sql.includes("SELECT normalized_name FROM grocery_list WHERE tenant=?1 AND status='in_cart' AND sent_in=?2")) {
        const originalAll = statement.all.bind(statement);
        statement.all = (async <R>() => {
          raced = true;
          h.raw.prepare("UPDATE grocery_list SET status='active',sent_in=NULL,row_version=row_version+1 WHERE tenant=? AND normalized_name='milk'").run(T);
          return originalAll<R>();
        }) as typeof statement.all;
      }
      return statement;
    }) as typeof h.env.DB.prepare;
    await expect(markGrocerySendPlaced(h.env, T, {
      send_id: "s1",
      expected_line_keys: ["milk"],
      snapshot_version: before.snapshot_version,
    })).rejects.toMatchObject({
      code: "conflict",
      context: { snapshot: { to_buy: expect.arrayContaining(["milk"]), in_cart_groups: [] } },
    });
  });

  it("re-reads after an open-link check races send placement", async () => {
    const h = sqliteEnv([T]); await sent(h, ["milk"]);
    const before = await readGrocerySnapshot(h.env, T);
    const line = before.in_cart_groups[0].lines[0];
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB); let raced = false;
    h.env.DB.prepare = ((sql: string) => {
      const statement = originalPrepare(sql);
      if (!raced && sql.includes("SELECT s.id FROM order_sends s JOIN order_send_lines")) {
        const originalFirst = statement.first.bind(statement);
        statement.first = (async <R>() => {
          raced = true;
          h.raw.prepare("UPDATE order_sends SET placed_at='2026-07-12T12:00:00Z' WHERE tenant=? AND id='s1'").run(T);
          h.raw.prepare("UPDATE grocery_list SET status='ordered',ordered_at='2026-07-12',row_version=row_version+1 WHERE tenant=? AND normalized_name='milk'").run(T);
          return originalFirst<R>();
        }) as typeof statement.first;
      }
      return statement;
    }) as typeof h.env.DB.prepare;
    await expect(relistGrocerySendLine(h.env, T, {
      send_id: "s1",
      line_key: "milk",
      expected_row_version: line.row_version,
    })).rejects.toMatchObject({
      code: "conflict",
      context: { snapshot: { in_cart_groups: [], lines: [] } },
    });
  });

  it("serializes a concurrent relist against the exact placement claim", async () => {
    const h = sqliteEnv([T]); await sent(h, ["milk"]);
    const before = await readGrocerySnapshot(h.env, T); const line = before.in_cart_groups[0].lines[0];
    const results = await Promise.allSettled([
      markGrocerySendPlaced(h.env, T, { send_id: "s1", expected_line_keys: ["milk"], snapshot_version: before.snapshot_version }),
      relistGrocerySendLine(h.env, T, { send_id: "s1", line_key: "milk", expected_row_version: line.row_version }),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const row = h.rows("grocery_list")[0]; const send = h.rows("order_sends")[0];
    if (send.placed_at) { expect(row.status).toBe("ordered"); expect(h.rows("spend_events")).toHaveLength(1); }
    else { expect(row.status).toBe("active"); expect(h.rows("spend_events")).toHaveLength(0); }
  });

  it("returns conflict when its conditional claim loses and the send is still unplaced", async () => {
    const h = sqliteEnv([T]); await sent(h, ["milk"]); const before = await readGrocerySnapshot(h.env, T);
    const originalBatch = h.env.DB.batch.bind(h.env.DB); let intercepted = false;
    h.env.DB.batch = (async (statements) => {
      if (!intercepted) { intercepted = true; h.raw.prepare("UPDATE grocery_list SET sent_in=NULL WHERE tenant=? AND normalized_name='milk'").run(T); }
      return originalBatch(statements);
    }) as typeof h.env.DB.batch;
    await expect(markGrocerySendPlaced(h.env, T, { send_id: "s1", expected_line_keys: ["milk"], snapshot_version: before.snapshot_version })).rejects.toMatchObject({ code: "conflict" });
    expect(h.rows<{ placed_at: string | null }>("order_sends")[0].placed_at).toBeNull();
    expect(h.rows("spend_events")).toHaveLength(0);
  });

  it("verifies only keys claimed by this batch when the send has a prior legal ordered row", async () => {
    const h = sqliteEnv([T]); await sent(h);
    h.raw.prepare("UPDATE grocery_list SET status='ordered', ordered_at='2026-07-11' WHERE tenant=? AND normalized_name='eggs'").run(T);
    const before = await readGrocerySnapshot(h.env, T);
    const result = await markGrocerySendPlaced(h.env, T, { send_id: "s1", expected_line_keys: ["milk"], snapshot_version: before.snapshot_version });
    expect(result.outcome).toContain("1 lines");
    expect(h.rows<{ status: string }>("grocery_list").every((row) => row.status === "ordered")).toBe(true);
  });

  it("re-lists an unlinked in-cart row without a send assertion", async () => {
    const h = sqliteEnv([T]); await addGroceryRow(h.env, T, { name: "manual", quantity: "3" }, "2026-07-12"); await updateGroceryRow(h.env, T, "manual", { status: "in_cart" });
    const before = await readGrocerySnapshot(h.env, T); const line = before.in_cart_groups.find((group) => group.send_id === null)!.lines[0];
    expect(line.quantity).toBe("3");
    const result = await relistGrocerySendLine(h.env, T, { send_id: null, line_key: "manual", expected_row_version: line.row_version });
    expect(result.snapshot.to_buy).toContain("manual"); expect(h.rows("spend_events")).toHaveLength(0);
  });

  it.each(["dangling", "placed", "open_missing_line"] as const)("re-lists a %s non-open send membership from the unlinked group", async (kind) => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "manual" }, "2026-07-12");
    await updateGroceryRow(h.env, T, "manual", { status: "in_cart" });
    if (kind !== "dangling") {
      h.raw.prepare("INSERT INTO order_sends (id,tenant,store,fulfillment,created_at,placed_at) VALUES (?,?, 'kroger','kroger_online','2026-07-11',?)").run(kind === "placed" ? "closed" : "open", T, kind === "placed" ? "2026-07-12" : null);
    }
    const sentIn = kind === "placed" ? "closed" : kind === "open_missing_line" ? "open" : "missing";
    h.raw.prepare("UPDATE grocery_list SET sent_in=? WHERE tenant=? AND normalized_name='manual'").run(sentIn, T);
    const before = await readGrocerySnapshot(h.env, T);
    const group = before.in_cart_groups.find((candidate) => candidate.send_id === null)!;
    expect(group.lines.map((line) => line.key)).toContain("manual");
    const line = group.lines.find((candidate) => candidate.key === "manual")!;
    const result = await relistGrocerySendLine(h.env, T, { send_id: null, line_key: "manual", expected_row_version: line.row_version });
    expect(result.snapshot.to_buy).toContain("manual");
    expect(h.rows<{ sent_in: string | null }>("grocery_list")[0].sent_in).toBeNull();
  });
});
