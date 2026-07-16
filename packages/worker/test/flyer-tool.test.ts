// The unified, Kroger-gated `flyer` tool (kroger-integration + satellite-sale-scan,
// narrow-mcp-surface): a pure read over the background-warmed `flyer:{store}:{locationId}`
// rollup the cron (src/flyer-warm.ts, covered by flyer-warm.test.ts) writes. This file covers
// the TOOL's own resolve + read-time deal-floor + satellite-staleness behavior — the former
// kroger_flyer/store_flyer contract, now one name. Seeds rollups directly via the exported
// writeStoreRollup (the same writer the warm job and the satellite sale intake use) so no cron
// tick or network stub is needed; a Kroger primary's location label is deliberately a no-space
// string so `resolveLocationId` bypasses the Locations API entirely (src/kroger.ts).

import { describe, it, expect } from "vitest";
import { buildServer } from "../src/tools.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { sqliteEnv } from "./sqlite-d1.js";
import { writeStoreRollup, KROGER_STORE } from "../src/flyer-warm.js";
import type { KvStore } from "../src/kroger-user.js";
import type { FlyerItem } from "../src/matching.js";
import type { Env } from "../src/env.js";
import type { Tenant } from "../src/tenant.js";

const CALLER: Tenant = { id: "casey", member: "casey" };

function item(sku: string, regular: number, promo: number): FlyerItem {
  return { sku, brand: "B", description: sku, size: null, price: { regular, promo }, savings: regular - promo, categories: [], matched_terms: ["milk"] };
}

function flyerServer(env: Env) {
  return buildServer(env, CALLER, "https://yamp.example.com", {
    profile: "self-hosted",
    operator: false,
    kroger: true,
    instacart: false,
  });
}

function seedStoresPref(h: ReturnType<typeof sqliteEnv>, stores: Record<string, unknown>): void {
  h.raw
    .prepare("INSERT INTO profile (tenant, stores) VALUES (?, ?)")
    .run("casey", JSON.stringify(stores));
}

describe("flyer — Kroger resolve", () => {
  it("resolves the Kroger primary store (no-space location label bypasses the Locations API) and returns its sale items", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "kroger", preferred_location: "01400943" });
    await writeStoreRollup(
      h.env.KROGER_KV as unknown as KvStore,
      KROGER_STORE,
      "01400943",
      [item("A", 10, 9), item("B", 10, 4)], // 10% off, 60% off — both clear 5%
      Date.now(),
    );
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect(out.isError).toBe(false);
    const { items, as_of } = out.result as { items: Array<{ sku: string }>; as_of: string };
    expect(items.map((i) => i.sku).sort()).toEqual(["A", "B"]);
    expect(as_of).toEqual(expect.any(String));
  });

  it("filters out a markdown below the deal floor by default, and widening min_savings_pct includes it", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "kroger", preferred_location: "01400943" });
    await writeStoreRollup(
      h.env.KROGER_KV as unknown as KvStore,
      KROGER_STORE,
      "01400943",
      [item("barely", 10, 9.7)], // 3% off — below the 5% default floor
      Date.now(),
    );
    const server = flyerServer(h.env);
    const belowFloor = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect((belowFloor.result as { items: unknown[] }).items).toEqual([]);

    const widened = await withServer(server, (c) => invokeTool(c, "flyer", { filter: { min_savings_pct: 2 } }));
    expect((widened.result as { items: Array<{ sku: string }> }).items.map((i) => i.sku)).toEqual(["barely"]);
  });

  it("defaults to the Kroger store when stores.primary is absent", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { preferred_location: "01400943" });
    await writeStoreRollup(h.env.KROGER_KV as unknown as KvStore, KROGER_STORE, "01400943", [item("A", 10, 8)], Date.now());
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect((out.result as { items: Array<{ sku: string }> }).items.map((i) => i.sku)).toEqual(["A"]);
  });
});

describe("flyer — satellite staleness", () => {
  it("reads a fresh satellite-scanned store's rollup identically to Kroger's shape", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "west-side-market", preferred_location: "loc-satellite" });
    await writeStoreRollup(
      h.env.KROGER_KV as unknown as KvStore,
      "west-side-market",
      "loc-satellite",
      [item("A", 10, 9)],
      Date.now() - 1 * 86_400_000, // one day old — well within the 7-day ceiling
    );
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect(out.isError).toBe(false);
    const { items, as_of } = out.result as { items: Array<{ sku: string }>; as_of: string };
    expect(items.map((i) => i.sku)).toEqual(["A"]);
    expect(as_of).toEqual(expect.any(String));
  });

  it("a satellite rollup older than the operator's staleness ceiling reads as empty, with as_of still surfaced", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "west-side-market", preferred_location: "loc-satellite" });
    await writeStoreRollup(
      h.env.KROGER_KV as unknown as KvStore,
      "west-side-market",
      "loc-satellite",
      [item("A", 10, 9)],
      Date.now() - 8 * 86_400_000, // 8 days old — past the default 7-day ceiling
    );
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect(out.isError).toBe(false);
    const { items, as_of } = out.result as { items: unknown[]; as_of: string | null };
    expect(items).toEqual([]);
    expect(as_of).toEqual(expect.any(String)); // staleness empties items, not as_of
  });

  it("a Kroger rollup of the same age is NOT subject to the satellite staleness ceiling", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "kroger", preferred_location: "01400943" });
    await writeStoreRollup(
      h.env.KROGER_KV as unknown as KvStore,
      KROGER_STORE,
      "01400943",
      [item("A", 10, 9)],
      Date.now() - 30 * 86_400_000, // far older than 7 days
    );
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect((out.result as { items: Array<{ sku: string }> }).items.map((i) => i.sku)).toEqual(["A"]);
  });
});

describe("flyer — cold cache / unresolvable store degrades gracefully, never errors", () => {
  it("no rollup written yet for the resolved store returns { items: [], as_of: null }", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "kroger", preferred_location: "01400943" });
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ items: [], as_of: null });
  });

  it("no preferences set up at all degrades to the same empty shape, not a thrown not_found", async () => {
    const h = sqliteEnv(["casey"]);
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ items: [], as_of: null });
  });

  it("no preferred_location set (primary present) also degrades to empty", async () => {
    const h = sqliteEnv(["casey"]);
    seedStoresPref(h, { primary: "kroger" });
    const server = flyerServer(h.env);
    const out = await withServer(server, (c) => invokeTool(c, "flyer", {}));
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ items: [], as_of: null });
  });
});
