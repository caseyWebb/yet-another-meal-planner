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
});
