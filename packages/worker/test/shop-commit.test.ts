import { describe, expect, it } from "vitest";
import { commitCheckedShop, purchaseCount, shopRequestHash } from "../src/shop-commit.js";
import { readGrocerySnapshot } from "../src/grocery-snapshot.js";
import { sqliteEnv } from "./sqlite-d1.js";

const T = "shopper";
const SESSION = "01J00000000000000000000000";

describe("receipt-backed shop commit", () => {
  it("hashes sorted requests, atomically consumes the exact checked set, receives pantry, writes estimated spend, and replays", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,checked_at,row_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(T, "Milk", "milk", "2 cartons", "grocery", "grocery", "active", "menu", '["pasta"]', null, "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,note,added_at,checked_at,row_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(T, "Foil", "foil", "one", "household", "grocery", "active", "ad_hoc", "[]", null, "2026-07-01", "2026-07-12T10:01:00Z", 1, "2026-07-12T10:01:00Z");
    h.raw.prepare("INSERT INTO spend_events (send_id,line_key,tenant,occurred_on,name,quantity,unit_price,amount,estimated,provenance,store,fulfillment) VALUES ('old','milk',?,'2026-07-01','Milk',1,3.25,3.25,0,'planned','kroger','kroger_online')").run(T);
    const snapshot = await readGrocerySnapshot(h.env, T, new Date("2026-07-12T11:00:00Z"));
    const request = { session_id: SESSION, mode: "manual_shop" as const, store_slug: null, expected_checked_keys: ["foil", "milk"], snapshot_version: snapshot.snapshot_version, occurred_at: "2026-07-12T11:00:00Z" };
    expect(await shopRequestHash(request)).toMatch(/^sha256:/);
    const result = await commitCheckedShop(h.env, T, request);
    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("expected commit");
    expect(result.receipt.lines).toEqual(expect.arrayContaining([expect.objectContaining({ key: "milk", pantry_received: true, price_source: "last_paid", purchase_count: 2, amount: 6.5 }), expect.objectContaining({ key: "foil", pantry_received: false, price_source: "unpriced" })]));
    expect(h.rows("grocery_list")).toHaveLength(0);
    expect(h.rows<{ normalized_name: string }>("pantry").map((row) => row.normalized_name)).toEqual(["milk"]);
    expect(h.rows("shop_commit_lines")).toHaveLength(2);
    expect(h.rows("spend_events")).toHaveLength(3);
    const replay = await commitCheckedShop(h.env, T, request);
    expect(replay.outcome).toBe("replayed");
    expect(h.rows("spend_events")).toHaveLength(3);
    const changed = await commitCheckedShop(h.env, T, { ...request, expected_checked_keys: ["milk"] });
    expect(changed.outcome).toBe("idempotency_conflict");
  });

  it("returns checked_set_changed without effects for a stale or overlapping claim", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,added_at,checked_at,row_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(T, "Milk", "milk", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1);
    const result = await commitCheckedShop(h.env, T, { session_id: SESSION, mode: "manual_shop", store_slug: null, expected_checked_keys: ["milk"], snapshot_version: `sha256:${"0".repeat(64)}`, occurred_at: "2026-07-12T11:00:00Z" });
    expect(result.outcome).toBe("checked_set_changed");
    expect(h.rows("shop_commits")).toHaveLength(0);
    expect(h.rows("grocery_list")).toHaveLength(1);
    expect(purchaseCount("some")).toEqual({ count: 1, assumed: true });
  });
});
