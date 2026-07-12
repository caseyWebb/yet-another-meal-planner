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
});
