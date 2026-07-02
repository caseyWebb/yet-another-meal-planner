import { describe, it, expect } from "vitest";
import { intakeObservations } from "../src/ingest.js";
import { validateSale, SALE_MAX_MARKDOWN } from "../src/sale-intake.js";
import { readStoreFlyer } from "../src/flyer-warm.js";
import { dedupeFlyerHits } from "../src/matching.js";
import { fakeD1 } from "./fake-d1.js";
import type { KvStore } from "../src/kroger-user.js";
import type { Env } from "../src/env.js";
import type { KrogerCandidate } from "../src/kroger.js";
import type { SaleObservation } from "@grocery-agent/contract";

// The `sale` arm of the shared raw-observation intake (satellite-sale-scan): Worker-side
// plausibility (validateSale), re-derivation, per-item dispatch, arrival dedup, and the
// store-rollup REPLACE — plus the invariant that a satellite sale and a Kroger scan of the same
// product derive an IDENTICAL rollup item (indistinguishable except by provenance/matched_terms).

const NOW = 1_800_000_000_000;

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

function saleEnv(): { env: Env; kv: ReturnType<typeof fakeKv> } {
  const f = fakeD1({ tables: { ingest_keys: [], ingest_candidates: [], ingest_pushes: [] } });
  const kv = fakeKv();
  return { env: { ...(f.env as object), KROGER_KV: kv } as unknown as Env, kv };
}

const sale = (over: Partial<SaleObservation> = {}): SaleObservation => ({
  kind: "sale",
  store: "target",
  locationId: "T-1",
  productId: "p1",
  description: "Organic 2% Milk",
  regular: 4,
  promo: 3,
  ...over,
});

const recipe = (n: number) => ({
  kind: "recipe" as const,
  title: `Recipe ${n}`,
  ingredients: ["a", "b"],
  instructions: ["x", "y"],
  source: `https://cooking.example.com/r${n}`,
});

describe("validateSale (plausibility bounds, equal-or-stricter)", () => {
  it("re-derives a FlyerItem with savings from the raw prices, retaining provenance", () => {
    const v = validateSale(sale({ productId: "sku-9", regular: 5, promo: 3.5, size: "1 gal", brand: "G&G", categories: ["Dairy"], url: "https://t.co/p" }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.item.sku).toBe("sku-9"); // productId → sku (provenance / dedup identity)
      expect(v.item.savings).toBe(1.5); // re-derived, not trusted from the wire
      expect(v.item.price).toEqual({ regular: 5, promo: 3.5 });
      expect(v.item.size).toBe("1 gal");
      expect(v.item.brand).toBe("G&G");
    }
  });

  it("rejects a non-sale (promo >= regular) per-item", () => {
    expect(validateSale(sale({ promo: 4 })).ok).toBe(false); // promo == regular is the Kroger echo
    expect(validateSale(sale({ promo: 5 })).ok).toBe(false);
  });

  it("rejects an implausible markdown (> 95%)", () => {
    const v = validateSale(sale({ regular: 100, promo: 1 })); // 99% off
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain("markdown");
    // Right at the ceiling is allowed.
    expect(validateSale(sale({ regular: 100, promo: 100 * (1 - SALE_MAX_MARKDOWN) })).ok).toBe(true);
  });

  it("rejects an out-of-range price", () => {
    expect(validateSale(sale({ regular: 99999, promo: 5 })).ok).toBe(false);
  });

  it("requires size to parse via the unit-price parser or be null/blank", () => {
    expect(validateSale(sale({ size: "12 oz" })).ok).toBe(true);
    expect(validateSale(sale({ size: "  " })).ok).toBe(true); // blank → null
    expect(validateSale(sale({ size: undefined })).ok).toBe(true); // absent → null
    const bad = validateSale(sale({ size: "family size" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain("size");
  });
});

// Sale intake is TASK-SCOPED: the rollup `(store, locationId)` is AUTHORITATIVE from the claimed
// sale-scan task, threaded in as `options.saleTask` — never taken from the observation. The `sale()`
// helper reports store "target"/"T-1", so the matching task context is `TARGET_TASK`.
const TARGET_TASK = { saleTask: { store: "target", locationId: "T-1" } } as const;

describe("intakeObservations — the sale arm (task-scoped)", () => {
  it("replaces the store rollup with the observed sale set", async () => {
    const { env, kv } = saleEnv();
    const res = await intakeObservations(
      env,
      [sale({ productId: "p1", regular: 4, promo: 3 }), sale({ productId: "p2", regular: 6, promo: 5 })],
      "satellite-pull:sale-scan",
      "ik_1",
      NOW,
      TARGET_TASK,
    );
    expect(res).toMatchObject({ received: 2, accepted: 2, deduped: 0, rejected: 0 });
    const rollup = await readStoreFlyer(kv, "target", "T-1");
    expect(rollup!.items.map((i) => i.sku).sort()).toEqual(["p1", "p2"]);
    expect(rollup!.store).toBe("target");
    expect(rollup!.as_of).toBe(NOW);
  });

  it("is idempotent — a late/double report replaces to the same rows", async () => {
    const { env, kv } = saleEnv();
    const items = [sale({ productId: "p1" }), sale({ productId: "p2", regular: 6, promo: 5 })];
    await intakeObservations(env, items, "o", "ik_1", NOW, TARGET_TASK);
    const first = (await readStoreFlyer(kv, "target", "T-1"))!.items.map((i) => i.sku).sort();
    await intakeObservations(env, items, "o", "ik_1", NOW + 5000, TARGET_TASK);
    const second = await readStoreFlyer(kv, "target", "T-1");
    expect(second!.items.map((i) => i.sku).sort()).toEqual(first);
    expect(second!.as_of).toBe(NOW + 5000); // a fresh as_of, same rows
  });

  it("dedups a double-reported productId within one batch", async () => {
    const { env, kv } = saleEnv();
    const res = await intakeObservations(env, [sale({ productId: "p1", promo: 3 }), sale({ productId: "p1", promo: 2 })], "o", "ik_1", NOW, TARGET_TASK);
    expect(res).toMatchObject({ accepted: 1, deduped: 1 });
    const rollup = await readStoreFlyer(kv, "target", "T-1");
    expect(rollup!.items.map((i) => i.sku)).toEqual(["p1"]); // first wins
    expect(rollup!.items[0].price.promo).toBe(3);
  });

  it("rejects an implausible item per-item but still lands the rest", async () => {
    const { env, kv } = saleEnv();
    const res = await intakeObservations(
      env,
      [sale({ productId: "ok", promo: 3 }), sale({ productId: "bad", promo: 4 })],
      "o",
      "ik_1",
      NOW,
      TARGET_TASK,
    );
    expect(res).toMatchObject({ accepted: 1, rejected: 1 });
    const rollup = await readStoreFlyer(kv, "target", "T-1");
    expect(rollup!.items.map((i) => i.sku)).toEqual(["ok"]);
  });

  it("replaces to an EMPTY rollup when a scan reports no surviving sales", async () => {
    const { env, kv } = saleEnv();
    // Seed a prior non-empty rollup, then report an all-non-sale scan for that store.
    await intakeObservations(env, [sale({ productId: "old", promo: 3 })], "o", "ik_1", NOW, TARGET_TASK);
    expect((await readStoreFlyer(kv, "target", "T-1"))!.items).toHaveLength(1);
    await intakeObservations(env, [sale({ productId: "x", promo: 4 })], "o", "ik_1", NOW + 1000, TARGET_TASK); // promo>=regular → dropped
    const rollup = await readStoreFlyer(kv, "target", "T-1");
    expect(rollup!.items).toHaveLength(0); // the store's current sale set is empty
    expect(rollup!.as_of).toBe(NOW + 1000);
  });

  it("converges the task's store to EMPTY on an empty observation set (a genuine no-sales scan)", async () => {
    const { env, kv } = saleEnv();
    // Seed a prior non-empty rollup, then report ZERO observations for that store's sale-scan.
    await intakeObservations(env, [sale({ productId: "old", promo: 3 })], "o", "ik_1", NOW, TARGET_TASK);
    expect((await readStoreFlyer(kv, "target", "T-1"))!.items).toHaveLength(1);
    const res = await intakeObservations(env, [], "o", "ik_1", NOW + 2000, TARGET_TASK);
    expect(res).toMatchObject({ received: 0, accepted: 0, rejected: 0 });
    const rollup = await readStoreFlyer(kv, "target", "T-1");
    expect(rollup!.items).toHaveLength(0); // stale sales cleared, not left behind
    expect(rollup!.as_of).toBe(NOW + 2000);
  });

  it("routes a mixed recipe+sale batch to each arm", async () => {
    const { env, kv } = saleEnv();
    const res = await intakeObservations(env, [recipe(1), sale({ productId: "p1", promo: 3 })], "o", "ik_1", NOW, TARGET_TASK);
    // The recipe lands a candidate; the sale lands the rollup.
    expect(res.accepted).toBe(2);
    const rollup = await readStoreFlyer(kv, "target", "T-1");
    expect(rollup!.items.map((i) => i.sku)).toEqual(["p1"]);
  });
});

describe("intakeObservations — the sale arm rejects untrusted / cross-namespace writes", () => {
  it("rejects a `sale` on the PUSH path (no claimed sale-scan task) and writes NO rollup", async () => {
    const { env, kv } = saleEnv();
    // No `options.saleTask` — the push path. Every sale item is rejected; nothing is written.
    const res = await intakeObservations(env, [sale({ productId: "p1", promo: 3 })], "push", "ik_1", NOW);
    expect(res).toMatchObject({ received: 1, accepted: 0, rejected: 1 });
    expect(res.results[0].disposition).toBe("rejected");
    expect(await readStoreFlyer(kv, "target", "T-1")).toBeNull(); // no rollup written at all
    expect([...kv.store.keys()]).toHaveLength(0);
  });

  it("rejects a `sale` whose store/location DISAGREE with the claimed task", async () => {
    const { env, kv } = saleEnv();
    // The task is target/T-1 but the observation claims a different store — it cannot redirect the write.
    const res = await intakeObservations(env, [sale({ productId: "p1", promo: 3, store: "costco", locationId: "C-9" })], "o", "ik_1", NOW, TARGET_TASK);
    expect(res).toMatchObject({ accepted: 0, rejected: 1 });
    expect(res.results[0].reason).toContain("does not match the claimed sale-scan task");
    // The task store's rollup converges empty; the disavowed store is never written.
    expect((await readStoreFlyer(kv, "target", "T-1"))!.items).toHaveLength(0);
    expect(await readStoreFlyer(kv, "costco", "C-9")).toBeNull();
  });

  it("rejects a `sale` claiming store `kroger`/`Kroger` under a non-Kroger task (never writes flyer:kroger:*)", async () => {
    for (const forgedStore of ["kroger", "Kroger"]) {
      const { env, kv } = saleEnv();
      const res = await intakeObservations(
        env,
        [sale({ productId: "p1", promo: 3, store: forgedStore, locationId: "03500493" })],
        "o",
        "ik_1",
        NOW,
        TARGET_TASK, // a legit non-Kroger (target) task
      );
      expect(res).toMatchObject({ accepted: 0, rejected: 1 });
      // The write key is the TASK's (flyer:target:T-1) — the first-party Kroger flyer is untouched.
      expect([...kv.store.keys()].some((k) => k.startsWith("flyer:kroger"))).toBe(false);
    }
  });

  it("never writes the kroger namespace even when the TASK store itself resolves to kroger (defense in depth)", async () => {
    for (const taskStore of ["kroger", "Kroger"]) {
      const { env, kv } = saleEnv();
      // A forged/buggy task naming the Worker-owned kroger namespace. The guard fires AFTER
      // lowercasing, so "Kroger" cannot slip it. Every sale is rejected; nothing is written.
      const res = await intakeObservations(
        env,
        [sale({ productId: "p1", promo: 3, store: taskStore, locationId: "03500493" })],
        "o",
        "ik_1",
        NOW,
        { saleTask: { store: taskStore, locationId: "03500493" } },
      );
      expect(res).toMatchObject({ accepted: 0, rejected: 1 });
      expect(res.results[0].reason).toContain("kroger namespace");
      expect(await readStoreFlyer(kv, "kroger", "03500493")).toBeNull(); // flyer:kroger:* + legacy both absent
      expect([...kv.store.keys()]).toHaveLength(0);
    }
  });
});

describe("Kroger parity — a satellite sale and a Kroger scan derive an identical rollup item", () => {
  it("matches on every field except matched_terms (provenance)", () => {
    const candidate: KrogerCandidate = {
      productId: "sku-77",
      brand: "Simple Truth",
      description: "Organic 2% Milk",
      categories: ["Dairy"],
      size: "1 gal",
      price: { regular: 5.99, promo: 4.49 },
      fulfillment: { curbside: true, delivery: false, inStore: true },
      aisleLocation: null,
    };
    const krogerItem = dedupeFlyerHits([{ term: "milk", candidates: [candidate] }])[0];

    const v = validateSale(
      sale({ productId: "sku-77", brand: "Simple Truth", description: "Organic 2% Milk", size: "1 gal", regular: 5.99, promo: 4.49, categories: ["Dairy"] }),
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;

    // Identical rollup item — the whole sensor-not-judge point — except matched_terms, which the
    // satellite doesn't observe (Kroger tracks the surfacing term; a satellite sale carries []).
    const { matched_terms: _k, ...krogerFields } = krogerItem;
    const { matched_terms: _s, ...saleFields } = v.item;
    expect(saleFields).toEqual(krogerFields);
    expect(v.item.savings).toBe(krogerItem.savings); // both re-derived by deriveSavings
  });
});
