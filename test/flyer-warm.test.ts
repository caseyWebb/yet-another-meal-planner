import { describe, it, expect } from "vitest";
import {
  buildPlan,
  filterByMinSavings,
  mergeFlyerItems,
  normalizeTerms,
  readFlyerRollup,
  rollupKey,
  runWarmJob,
  runWarmTick,
  type FlyerRollup,
  type WarmDeps,
} from "../src/flyer-warm.js";
import { readJobHealth } from "../src/health.js";
import { fakeD1 } from "./fake-d1.js";
import type { KvStore } from "../src/kroger-user.js";
import type { KrogerCandidate } from "../src/kroger.js";
import type { FlyerItem } from "../src/matching.js";

/** In-memory KvStore. */
function fakeKv(): KvStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

/** An on-sale (promo < regular), curbside-fulfillable candidate. */
function candidate(id: string, regular: number, promo: number): KrogerCandidate {
  return {
    productId: id,
    brand: "B",
    description: id,
    categories: [],
    size: null,
    price: { regular, promo },
    fulfillment: { curbside: true, delivery: false, inStore: true },
    aisleLocation: null,
  };
}

function flyerItem(sku: string, regular: number, promo: number, terms: string[]): FlyerItem {
  return {
    sku,
    brand: "B",
    description: sku,
    size: null,
    price: { regular, promo },
    savings: Math.round((regular - promo) * 100) / 100,
    categories: [],
    matched_terms: terms,
  };
}

interface Harness {
  deps: WarmDeps;
  kv: ReturnType<typeof fakeKv>;
  scanCalls: { locationId: string; term: string }[];
  setNow: (n: number) => void;
}

function harness(over: Partial<WarmDeps> = {}): Harness {
  const kv = fakeKv();
  const scanCalls: { locationId: string; term: string }[] = [];
  let now = 1_000_000;
  const deps: WarmDeps = {
    kv,
    listTenantIds: async () => ["alice", "bob", "carol"],
    // Default: alice & bob share locA, carol is at locB.
    readPreferredLocationLabel: async (id) => ({ alice: "locA", bob: "locA", carol: "locB" })[id] ?? null,
    readBroadTerms: async () => ["milk", "eggs"],
    resolveLocationId: async (label) => label, // labels are already locationIds in tests
    scan: async (locationId, term) => {
      scanCalls.push({ locationId, term });
      // one on-sale, fulfillable product per (loc,term)
      return [candidate(`${locationId}:${term}`, 4, 3)];
    },
    now: () => now,
    ...over,
  };
  return { deps, kv, scanCalls, setNow: (n) => (now = n) };
}

describe("normalizeTerms", () => {
  it("trims, lowercases, and dedupes case-variants", () => {
    expect(normalizeTerms(["Milk", " milk ", "Eggs", "EGGS", ""])).toEqual(["milk", "eggs"]);
  });
});

describe("buildPlan", () => {
  it("crosses distinct locations (same store shared) with normalized terms, grouped by location", async () => {
    const { deps } = harness();
    const plan = await buildPlan(deps, "s1");
    // alice+bob share locA, carol at locB → 2 locations × 2 terms = 4 units
    expect(plan.units).toEqual([
      { locationId: "locA", term: "milk" },
      { locationId: "locA", term: "eggs" },
      { locationId: "locB", term: "milk" },
      { locationId: "locB", term: "eggs" },
    ]);
  });

  it("skips tenants with no preferred_location", async () => {
    const { deps } = harness({
      readPreferredLocationLabel: async (id) => (id === "bob" ? "locA" : null),
    });
    const plan = await buildPlan(deps, "s1");
    expect(new Set(plan.units.map((u) => u.locationId))).toEqual(new Set(["locA"]));
  });

  it("empty flyer_terms yields an empty plan (graceful degradation)", async () => {
    const { deps } = harness({ readBroadTerms: async () => [] });
    const plan = await buildPlan(deps, "s1");
    expect(plan.units).toEqual([]);
  });

  it("skips a label that cannot be resolved", async () => {
    const { deps } = harness({
      readPreferredLocationLabel: async (id) => (id === "carol" ? "bad" : "locA"),
      resolveLocationId: async (label) => {
        if (label === "bad") throw new Error("unresolvable");
        return label;
      },
    });
    const plan = await buildPlan(deps, "s1");
    expect(new Set(plan.units.map((u) => u.locationId))).toEqual(new Set(["locA"]));
  });
});

describe("runWarmTick sweep", () => {
  it("builds the plan on the first tick without scanning", async () => {
    const { deps, kv, scanCalls } = harness();
    const r = await runWarmTick(deps);
    expect(r.action).toBe("built");
    expect(scanCalls).toHaveLength(0); // plan-build never shares a tick with scans
    expect(kv.store.has("flyer:plan")).toBe(true);
    expect(kv.store.has("flyer:cursor")).toBe(true);
  });

  it("scans in bounded batches, advances the cursor, and completes", async () => {
    // 2 locations × 2 terms = 4 units; batch of 2 → build, scan, scan(complete).
    const { deps, scanCalls } = harness();
    expect((await runWarmTick(deps, { batchUnits: 2 })).action).toBe("built");

    const t2 = await runWarmTick(deps, { batchUnits: 2 });
    expect(t2.action).toBe("scanned");
    expect(t2.units).toBe(2);
    expect(scanCalls).toHaveLength(2); // batch capped at 2

    const t3 = await runWarmTick(deps, { batchUnits: 2 });
    expect(t3.action).toBe("completed");
    expect(scanCalls).toHaveLength(4); // all units scanned exactly once
  });

  it("writes a per-location rollup readable via readFlyerRollup", async () => {
    const { deps, kv } = harness();
    await runWarmTick(deps, { batchUnits: 99 }); // build
    await runWarmTick(deps, { batchUnits: 99 }); // scan all + complete

    const a = await readFlyerRollup(kv, "locA");
    expect(a).not.toBeNull();
    expect(a!.items.map((i) => i.sku).sort()).toEqual(["locA:eggs", "locA:milk"]);
    expect(typeof a!.as_of).toBe("string");
    // different store gets an independent rollup
    const b = await readFlyerRollup(kv, "locB");
    expect(b!.items.map((i) => i.sku).sort()).toEqual(["locB:eggs", "locB:milk"]);
  });

  it("idles cheaply once complete and does not scan", async () => {
    const { deps, scanCalls } = harness();
    await runWarmTick(deps, { batchUnits: 99 }); // build
    await runWarmTick(deps, { batchUnits: 99 }); // complete
    const callsAfterComplete = scanCalls.length;

    const idle = await runWarmTick(deps, { batchUnits: 99, refreshMs: 1_000_000 });
    expect(idle.action).toBe("idle");
    expect(scanCalls).toHaveLength(callsAfterComplete); // no new scans
  });

  it("re-arms a fresh sweep after the refresh window elapses", async () => {
    const h = harness();
    h.setNow(1_000_000);
    await runWarmTick(h.deps, { batchUnits: 99, refreshMs: 1000 }); // build
    await runWarmTick(h.deps, { batchUnits: 99, refreshMs: 1000 }); // complete

    h.setNow(1_000_500); // within the window
    expect((await runWarmTick(h.deps, { batchUnits: 99, refreshMs: 1000 })).action).toBe("idle");

    h.setNow(1_001_000); // window elapsed
    expect((await runWarmTick(h.deps, { batchUnits: 99, refreshMs: 1000 })).action).toBe("built");
  });

  it("a failing unit is counted but does not wedge the sweep", async () => {
    const { deps } = harness({
      scan: async (_loc, term) => {
        if (term === "eggs") throw new Error("kroger down");
        return [candidate("p", 4, 3)];
      },
    });
    await runWarmTick(deps, { batchUnits: 99 }); // build
    const done = await runWarmTick(deps, { batchUnits: 99 }); // scan all
    expect(done.action).toBe("completed");
    expect(done.errors).toBeGreaterThan(0);
  });
});

describe("read-path helpers", () => {
  it("readFlyerRollup returns null for a cold cache", async () => {
    const kv = fakeKv();
    expect(await readFlyerRollup(kv, "locX")).toBeNull();
  });

  it("readFlyerRollup surfaces as_of as an ISO string", async () => {
    const kv = fakeKv();
    const rollup: FlyerRollup = { sweep_id: "s1", as_of: 1_700_000_000_000, items: [] };
    await kv.put(rollupKey("locA"), JSON.stringify(rollup));
    const read = await readFlyerRollup(kv, "locA");
    expect(read!.as_of).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("filterByMinSavings applies the deal floor at read", () => {
    const items = [
      flyerItem("a", 10, 9.5, ["x"]), // 5% off
      flyerItem("b", 10, 9.0, ["x"]), // 10% off
      flyerItem("c", 10, 9.9, ["x"]), // 1% off
    ];
    expect(filterByMinSavings(items, 0.05).map((i) => i.sku)).toEqual(["a", "b"]);
    expect(filterByMinSavings(items, 0.1).map((i) => i.sku)).toEqual(["b"]);
  });
});

describe("mergeFlyerItems", () => {
  it("dedupes by sku, unions matched_terms, and is idempotent (safe to re-run a batch)", () => {
    const base = [flyerItem("a", 4, 3, ["milk"])];
    const incoming = [flyerItem("a", 4, 3, ["dairy"]), flyerItem("b", 5, 4, ["eggs"])];
    const merged = mergeFlyerItems(base, incoming);
    expect(merged.map((i) => i.sku)).toEqual(["a", "b"]);
    expect(merged.find((i) => i.sku === "a")!.matched_terms.sort()).toEqual(["dairy", "milk"]);
    // re-merging the same incoming adds nothing (idempotent → a retried tick is safe)
    const again = mergeFlyerItems(merged, incoming);
    expect(again).toEqual(merged);
  });
});

describe("runWarmJob (health + rethrow)", () => {
  // Health now lives in D1 (job_health); env carries the fake D1 and no NTFY_URL (notify no-ops).
  it("writes a healthy record carrying the freshness summary", async () => {
    const { env } = fakeD1();
    const h = harness();
    await runWarmJob(env, h.deps); // build tick
    await runWarmJob(env, h.deps); // scan all → complete (single batch, default 12 units > 4)
    const rec = await readJobHealth(env, "flyer-warm");
    expect(rec).not.toBeNull();
    expect(rec!.ok).toBe(true);
    expect(rec!.summary.action).toBe("completed");
    expect(typeof rec!.summary.sweep_completed_at).toBe("number"); // freshness signal stamped
  });

  it("on a thrown tick: writes ok:false and rethrows (so the platform sees a failure)", async () => {
    const { env } = fakeD1();
    const h = harness({
      listTenantIds: async () => {
        throw new Error("github down");
      },
    });
    await expect(runWarmJob(env, h.deps)).rejects.toThrow("github down");
    const rec = await readJobHealth(env, "flyer-warm");
    expect(rec!.ok).toBe(false);
    expect(rec!.summary.error).toContain("github down");
  });
});
