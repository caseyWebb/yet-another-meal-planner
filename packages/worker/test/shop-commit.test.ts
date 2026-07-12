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
    expect(result.receipt.lines).toEqual(expect.arrayContaining([expect.objectContaining({ key: "milk", pantry_received: true, price_source: "last_paid", purchase_count: 2, amount: 6.5 }), expect.objectContaining({ key: "foil", pantry_received: false, price_source: "unpriced", department: "household" })]));
    expect(h.rows("grocery_list")).toHaveLength(0);
    expect(h.rows<{ normalized_name: string }>("pantry").map((row) => row.normalized_name)).toEqual(["milk"]);
    expect(h.rows("shop_commit_lines")).toHaveLength(2);
    expect(h.rows("spend_events")).toHaveLength(3);
    expect(h.rows<{ send_id: string; line_key: string; price_source: string | null }>("spend_events").find((row) => row.send_id.startsWith("shop:") && row.line_key === "milk")?.price_source).toBe("last_paid");
    const replay = await commitCheckedShop(h.env, T, request);
    expect(replay.outcome).toBe("replayed");
    const responseLossReplay = await commitCheckedShop(h.env, T, { ...request, snapshot_version: `sha256:${"f".repeat(64)}` });
    expect(responseLossReplay.outcome).toBe("replayed");
    expect(h.rows("spend_events")).toHaveLength(3);
    const changed = await commitCheckedShop(h.env, T, { ...request, expected_checked_keys: ["milk"] });
    expect(changed.outcome).toBe("idempotency_conflict");
  });

  it("consumes only eligible active checked rows and remains tenant isolated", async () => {
    const other = "other-shopper";
    const h = sqliteEnv([T, other]);
    const add = h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,added_at,checked_at,row_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    add.run(T, "Milk", "milk", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    add.run(T, "Bread", "bread", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", null, 1, "2026-07-12T10:00:00Z");
    add.run(T, "Eggs", "eggs", "1", "grocery", "grocery", "in_cart", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    add.run(T, "Oil", "oil", "1", "grocery", "grocery", "ordered", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    add.run(T, "Lumber", "lumber", "1", "other", "hardware", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    add.run(other, "Milk", "milk", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    const snapshot = await readGrocerySnapshot(h.env, T);
    const result = await commitCheckedShop(h.env, T, { session_id: SESSION, mode: "manual_shop", store_slug: null, expected_checked_keys: ["milk"], snapshot_version: snapshot.snapshot_version, occurred_at: "2026-07-12T11:00:00Z" });
    expect(result.outcome).toBe("committed");
    const remaining = h.rows<{ tenant: string; normalized_name: string; status: string }>("grocery_list").map((row) => [row.tenant, row.normalized_name, row.status]);
    expect(remaining).toHaveLength(5);
    expect(remaining).toEqual(expect.arrayContaining([
      [T, "bread", "active"], [T, "eggs", "in_cart"], [T, "lumber", "active"], [T, "oil", "ordered"], [other, "milk", "active"],
    ]));
    expect(h.rows<{ tenant: string }>("shop_commits")).toEqual([expect.objectContaining({ tenant: T })]);
  });

  it("concurrent identical deliveries converge on one durable receipt and one effect set", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,added_at,checked_at,row_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(T, "Milk", "milk", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    const snapshot = await readGrocerySnapshot(h.env, T);
    const request = { session_id: SESSION, mode: "manual_shop" as const, store_slug: null, expected_checked_keys: ["milk"], snapshot_version: snapshot.snapshot_version, occurred_at: "2026-07-12T11:00:00Z" };
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let arrivals = 0;
    let releaseFirst!: () => void;
    const secondArrived = new Promise<void>((resolve) => { releaseFirst = resolve; });
    h.env.DB.batch = async (statements) => {
      arrivals++;
      if (arrivals === 1) await secondArrived;
      else releaseFirst();
      return originalBatch(statements);
    };
    const [a, b] = await Promise.all([commitCheckedShop(h.env, T, request), commitCheckedShop(h.env, T, request)]);
    expect([a.outcome, b.outcome].sort()).toEqual(["committed", "replayed"]);
    if ((a.outcome !== "committed" && a.outcome !== "replayed") || (b.outcome !== "committed" && b.outcome !== "replayed")) throw new Error("expected converged commits");
    expect(a.receipt).toEqual(b.receipt);
    expect(h.rows("shop_commits")).toHaveLength(1);
    expect(h.rows("shop_commit_lines")).toHaveLength(1);
    expect(h.rows("spend_events")).toHaveLength(1);
    expect(h.rows<{ normalized_name: string }>("pantry").map((row) => row.normalized_name)).toEqual(["milk"]);
  });

  it.each([
    ["unchecked row", (h: ReturnType<typeof sqliteEnv>) => h.raw.prepare("UPDATE grocery_list SET quantity='2',row_version=row_version+1 WHERE tenant=? AND normalized_name='bread'").run(T)],
    ["pantry", (h: ReturnType<typeof sqliteEnv>) => h.raw.prepare("INSERT INTO pantry (tenant,name,normalized_name,quantity,added_at) VALUES (?,'Bread','bread','1','2026-07-12')").run(T)],
    ["coverage decision", (h: ReturnType<typeof sqliteEnv>) => h.raw.prepare("INSERT INTO grocery_coverage_decisions (tenant,line_key,created_row,row_version,created_at,updated_at) VALUES (?,'bread',0,1,'2026-07-12','2026-07-12')").run(T)],
    ["requested-store note", (h: ReturnType<typeof sqliteEnv>) => h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES ('walk-race','market',?,'Aisle 2: produce','[\"layout\"]',0,'2026-07-12','2026-07-12')").run(T)],
  ])("transactionally rejects a concurrent %s dependency change with zero effects", async (_label, race) => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO stores (slug,name,domain) VALUES ('market','Market','grocery')").run();
    const add = h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,added_at,checked_at,row_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    add.run(T, "Milk", "milk", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    add.run(T, "Bread", "bread", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", null, 1, "2026-07-12T10:00:00Z");
    const snapshot = await readGrocerySnapshot(h.env, T);
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    h.env.DB.batch = async (statements) => {
      race(h);
      return originalBatch(statements);
    };
    const result = await commitCheckedShop(h.env, T, { session_id: SESSION, mode: "store_walk", store_slug: "market", expected_checked_keys: ["milk"], snapshot_version: snapshot.snapshot_version, occurred_at: "2026-07-12T11:00:00Z" });
    expect(result.outcome).toBe("checked_set_changed");
    expect(h.rows("shop_commits")).toHaveLength(0);
    expect(h.rows<{ normalized_name: string }>("pantry").some((row) => row.normalized_name === "milk")).toBe(false);
    expect(h.rows("spend_events")).toHaveLength(0);
    expect(h.rows("grocery_list")).toHaveLength(2);
  });

  it("binds the exact requested-store row read before the first dependency snapshot", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO stores (slug,name,domain) VALUES ('market','Market','grocery')").run();
    h.raw.prepare("INSERT INTO grocery_list (tenant,name,normalized_name,quantity,kind,domain,status,source,for_recipes,added_at,checked_at,row_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(T, "Milk", "milk", "1", "grocery", "grocery", "active", "ad_hoc", "[]", "2026-07-01", "2026-07-12T10:00:00Z", 1, "2026-07-12T10:00:00Z");
    const snapshot = await readGrocerySnapshot(h.env, T);
    const originalPrepare = h.env.DB.prepare.bind(h.env.DB);
    let raced = false;
    h.env.DB.prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (!sql.startsWith("SELECT slug, name, domain, extra FROM stores WHERE slug")) return stmt;
      let bound = stmt;
      const wrapped = {
        bind: (...values: unknown[]) => { bound = stmt.bind(...values); return wrapped; },
        first: async <R>() => { const row = await bound.first<R>(); if (!raced) { raced = true; h.raw.prepare("UPDATE stores SET domain='hardware' WHERE slug='market'").run(); } return row; },
      };
      return wrapped as unknown as D1PreparedStatement;
    }) as D1Database["prepare"];
    const result = await commitCheckedShop(h.env, T, { session_id: SESSION, mode: "store_walk", store_slug: "market", expected_checked_keys: ["milk"], snapshot_version: snapshot.snapshot_version, occurred_at: "2026-07-12T11:00:00Z" });
    expect(result.outcome).toBe("checked_set_changed");
    expect(h.rows("shop_commits")).toHaveLength(0);
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("response-loss replay ignores a rebased delivery snapshot but not logical request changes", async () => {
    const a = { session_id: SESSION, mode: "manual_shop" as const, store_slug: null, expected_checked_keys: ["milk"], snapshot_version: `sha256:${"1".repeat(64)}`, occurred_at: "2026-07-12T11:00:00Z" };
    expect(await shopRequestHash(a)).toBe(await shopRequestHash({ ...a, snapshot_version: `sha256:${"2".repeat(64)}` }));
    expect(await shopRequestHash(a)).not.toBe(await shopRequestHash({ ...a, expected_checked_keys: ["bread"] }));
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
