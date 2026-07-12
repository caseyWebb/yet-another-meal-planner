import { describe, expect, it } from "vitest";
import { parseLayoutNote, readAisleMap, reconcileAisleMap, routeOfflineLines } from "../src/aisle-map.js";
import { sqliteEnv } from "./sqlite-d1.js";
import type { GroceryLine } from "@yamp/contract";

describe("aisle map projection and owned reconcile", () => {
  it("parses legacy notes, resolves per-aisle recency, protects private rows, and reveals the prior author", async () => {
    const h = sqliteEnv(["alice", "bob"]);
    h.raw.prepare("INSERT INTO stores (slug,name,domain) VALUES ('market','Market','grocery')").run();
    h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("a1", "market", "alice", "Aisle 4: baking, spices", '["layout"]', 0, "2025-01-01T00:00:00Z", null);
    h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("b1", "market", "bob", "4: bakery", '["layout"]', 0, "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z");
    h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("b2", "market", "bob", "Aisle 9: secret", '["layout"]', 1, "2026-01-01T00:00:01Z", null);
    expect(parseLayoutNote("Aisle 7: baking, spices")).toMatchObject({ aisle_id: "7", order: 7, sections: ["baking", "spices"] });
    const alice = await readAisleMap(h.env, "market", "alice", new Date("2026-07-12T00:00:00Z"));
    expect(alice.effective.map((entry) => [entry.aisle_id, entry.sections])).toEqual([["4", ["bakery"]]]);
    expect(alice.summary.state).toBe("mapped");
    expect(alice.effective.some((entry) => entry.aisle_id === "9")).toBe(false);
    const saved = await reconcileAisleMap(h.env, "market", "alice", alice.etag, { entries: [{ aisle_id: "4", label: "4", sections: ["baking"], visibility: "shared" }] });
    expect(saved.status).toBe("ok");
    expect(saved.map.effective[0]?.sections).toEqual(["baking"]);
    const conflict = await reconcileAisleMap(h.env, "market", "alice", alice.etag, { entries: [] });
    expect(conflict.status).toBe("conflict");
    const removed = await reconcileAisleMap(h.env, "market", "alice", saved.map.etag, { entries: [] });
    expect(removed.map.effective[0]?.sections).toEqual(["bakery"]);
  });

  it("routes exact location then section, keeps cold last, and trails unmapped without guessing", async () => {
    const h = sqliteEnv(["alice"]);
    h.raw.prepare("INSERT INTO stores (slug,name,domain) VALUES ('market','Market','grocery')").run();
    h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES ('m','market','alice','Aisle 2: produce','[\"layout\"]',0,'2026-07-01','2026-07-01')").run();
    h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES ('l','market','alice','Aisle 2: bananas','[\"location\"]',0,'2026-07-01','2026-07-01')").run();
    const line = (key: string, section?: string): GroceryLine => ({ key, name: key, quantity: "1", kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 1, updated_at: null, for_recipes: [], placement: section ? { section } : null });
    const map = await readAisleMap(h.env, "market", "alice", new Date("2026-07-12"));
    const groups = await routeOfflineLines(h.env, "alice", "market", [line("bananas"), line("apples", "produce"), line("ice cream", "frozen"), line("soap", "pro")], map);
    expect(groups.map((group) => [group.id, group.line_keys])).toEqual([["aisle:2", ["bananas", "apples"]], ["cold-last", ["ice cream"]], ["unmapped", ["soap"]]]);
  });

  it("rejects a layout race atomically and recovers an abandoned claim lease", async () => {
    const h = sqliteEnv(["alice", "bob"]);
    h.raw.prepare("INSERT INTO stores (slug,name,domain) VALUES ('market','Market','grocery')").run();
    const initial = await readAisleMap(h.env, "market", "alice");
    const originalBatch = h.env.DB.batch.bind(h.env.DB);
    let raced = false;
    h.env.DB.batch = async (statements) => {
      if (!raced) {
        raced = true;
        h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES ('race','market','bob','Aisle 8: dairy','[\"layout\"]',0,'2026-07-12','2026-07-12')").run();
      }
      return originalBatch(statements);
    };
    const conflict = await reconcileAisleMap(h.env, "market", "alice", initial.etag, { entries: [{ aisle_id: "2", label: "2", sections: ["produce"], visibility: "shared" }] });
    expect(conflict.status).toBe("conflict");
    expect(h.rows<{ author: string }>("store_notes").map((row) => row.author)).toEqual(["bob"]);

    h.env.DB.batch = originalBatch;
    h.raw.prepare("INSERT INTO aisle_map_reconcile_claims (tenant,store_slug,token,created_at) VALUES ('alice','market','active',?)").run(new Date().toISOString());
    const fresh = await readAisleMap(h.env, "market", "alice");
    const blocked = await reconcileAisleMap(h.env, "market", "alice", fresh.etag, { entries: [{ aisle_id: "2", label: "2", sections: ["produce"], visibility: "shared" }] });
    expect(blocked.status).toBe("conflict");
    expect(h.rows<{ token: string }>("aisle_map_reconcile_claims")[0]?.token).toBe("active");
    h.raw.prepare("UPDATE aisle_map_reconcile_claims SET token='abandoned',created_at='2020-01-01'").run();
    const recovered = await reconcileAisleMap(h.env, "market", "alice", fresh.etag, { entries: [{ aisle_id: "2", label: "2", sections: ["produce"], visibility: "shared" }] });
    expect(recovered.status).toBe("ok");
    expect(h.rows("aisle_map_reconcile_claims")).toHaveLength(0);
  });

  it("updates the same newest duplicate it preserves and uses newest visible location corrections", async () => {
    const h = sqliteEnv(["alice", "bob"]);
    h.raw.prepare("INSERT INTO stores (slug,name,domain) VALUES ('market','Market','grocery')").run();
    const insert = h.raw.prepare("INSERT INTO store_notes (id,store,author,body,tags,private,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)");
    insert.run("z-old-id", "market", "alice", "Aisle 2: old", '["layout"]', 0, "2025-01-01", "2025-01-01");
    insert.run("a-new-id", "market", "alice", "Aisle 2: newer", '["layout"]', 0, "2026-01-01", "2026-01-01");
    insert.run("loc-old", "market", "alice", "bananas: Aisle 2", '["location"]', 0, "2025-01-01", "2025-01-01");
    insert.run("loc-new", "market", "bob", "bananas: Aisle 9", '["location"]', 0, "2026-01-01", "2026-01-01");
    insert.run("loc-private", "market", "bob", "bananas: Aisle 7", '["location"]', 1, "2027-01-01", "2027-01-01");
    const before = await readAisleMap(h.env, "market", "alice");
    await reconcileAisleMap(h.env, "market", "alice", before.etag, { entries: [{ aisle_id: "2", label: "2", sections: ["updated"], visibility: "shared" }, { aisle_id: "9", label: "9", sections: ["bulk"], visibility: "shared" }] });
    const layouts = h.rows<{ id: string; body: string }>("store_notes").filter((row) => row.id === "z-old-id" || row.id === "a-new-id");
    expect(layouts).toEqual([expect.objectContaining({ id: "a-new-id", body: "Aisle 2: updated" })]);
    const line: GroceryLine = { key: "bananas", name: "bananas", quantity: "1", kind: "grocery", domain: "grocery", origin: "list", checked_at: null, row_version: 1, updated_at: null, for_recipes: [], placement: null };
    const map = await readAisleMap(h.env, "market", "alice");
    expect((await routeOfflineLines(h.env, "alice", "market", [line], map))[0]).toMatchObject({ id: "aisle:9", placement_source: "location_note" });
  });
});
