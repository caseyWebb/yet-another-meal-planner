import { describe, it, expect } from "vitest";
import { rekeySkuCache, planSkuRekey, type SkuCacheRekeyRow } from "../src/sku-cache-rekey.js";
import { fakeD1 } from "./fake-d1.js";
import type { Env } from "../src/env.js";

// Returns the fake-D1 row shape (index signature) that is also a SkuCacheRekeyRow.
const sku = (
  o: Partial<SkuCacheRekeyRow> & { ingredient: string; sku: string },
): SkuCacheRekeyRow & Record<string, unknown> => ({
  location_id: "loc1",
  brand: null,
  size: null,
  last_used: null,
  ...o,
});

describe("rekeySkuCache", () => {
  it("re-keys a legacy raw-term row once its term resolves in the identity graph", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [sku({ ingredient: "whole milk", sku: "123", brand: "Kroger", size: "1 gal", last_used: "2026-06-01" })],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toEqual({ rekeyed: 1, merged: 0, truncated: false });
    // The row moved whole — SKU, brand, size, last_used preserved under the canonical key.
    expect(tables.sku_cache).toEqual([
      expect.objectContaining({ ingredient: "milk::whole", location_id: "loc1", sku: "123", brand: "Kroger", size: "1 gal", last_used: "2026-06-01" }),
    ]);
  });

  it("keeps the NEWER last_used whole on a (canonical, location) collision — either direction", async () => {
    // Mover newer → it overwrites the standing canonical row.
    const a = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [
          sku({ ingredient: "milk::whole", sku: "old", last_used: "2026-05-01" }),
          sku({ ingredient: "whole milk", sku: "new", last_used: "2026-07-01" }),
        ],
      },
    });
    const sA = await rekeySkuCache(a.env);
    expect(sA).toMatchObject({ rekeyed: 1, merged: 1 });
    expect(a.tables.sku_cache).toEqual([
      expect.objectContaining({ ingredient: "milk::whole", sku: "new", last_used: "2026-07-01" }),
    ]);

    // Standing canonical row newer → the stale-keyed mover is simply dropped.
    const b = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [
          sku({ ingredient: "milk::whole", sku: "current", last_used: "2026-07-01" }),
          sku({ ingredient: "whole milk", sku: "stale", last_used: "2026-05-01" }),
        ],
      },
    });
    const sB = await rekeySkuCache(b.env);
    expect(sB).toMatchObject({ rekeyed: 1, merged: 1 });
    expect(b.tables.sku_cache).toEqual([
      expect.objectContaining({ ingredient: "milk::whole", sku: "current", last_used: "2026-07-01" }),
    ]);
  });

  it("a null last_used loses to a dated row", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [
          sku({ ingredient: "whole milk", sku: "undated", last_used: null }),
          sku({ ingredient: "milk::whole", sku: "dated", last_used: "2026-01-01" }),
        ],
      },
    });
    await rekeySkuCache(env);
    expect(tables.sku_cache).toEqual([expect.objectContaining({ ingredient: "milk::whole", sku: "dated" })]);
  });

  it("same-key rows at DIFFERENT locations never collide", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [
          sku({ ingredient: "whole milk", sku: "a", location_id: "loc1" }),
          sku({ ingredient: "whole milk", sku: "b", location_id: "loc2" }),
        ],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toMatchObject({ rekeyed: 2, merged: 0 });
    expect(tables.sku_cache).toHaveLength(2);
    expect(tables.sku_cache.every((r) => r.ingredient === "milk::whole")).toBe(true);
  });

  it("leaves non-resolving rows untouched and never enqueues them as novel terms", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [],
        ingredient_alias: [],
        novel_ingredient_terms: [],
        sku_cache: [sku({ ingredient: "paper towels", sku: "999" })],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toEqual({ rekeyed: 0, merged: 0, truncated: false });
    expect(tables.sku_cache).toEqual([expect.objectContaining({ ingredient: "paper towels", sku: "999" })]);
    expect(tables.novel_ingredient_terms).toHaveLength(0); // no capture side effect, by construction
  });

  it("follows the representative chain (a merged loser's key converges to the survivor)", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: "zucchini" },
          { id: "zucchini", base: "zucchini", representative: null },
        ],
        ingredient_alias: [{ variant: "courgette", id: "courgette" }],
        sku_cache: [sku({ ingredient: "courgette", sku: "42" })],
      },
    });
    await rekeySkuCache(env);
    expect(tables.sku_cache).toEqual([expect.objectContaining({ ingredient: "zucchini", sku: "42" })]);
  });

  it("re-keys a row keyed by a merged-away NODE id with no alias row (canonical mints, order-path keys)", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: "zucchini", source: "auto" },
          { id: "zucchini", base: "zucchini", representative: null, source: "auto" },
        ],
        ingredient_alias: [], // no alias front-door row — the key IS the node id
        sku_cache: [sku({ ingredient: "courgette", sku: "42" })],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toMatchObject({ rekeyed: 1 });
    expect(tables.sku_cache).toEqual([expect.objectContaining({ ingredient: "zucchini", sku: "42" })]);
  });

  it("returns a zero result and plans nothing when the resolver read fails (never partial state)", async () => {
    // A transient D1 blip must NOT run the pass with a degraded resolver — even an empty one
    // would still lowercase/quantity-strip keys and could delete collision losers.
    const env = {
      DB: {
        prepare: () => {
          throw new Error("D1 down");
        },
      },
    } as unknown as Env;
    await expect(rekeySkuCache(env)).resolves.toEqual({ rekeyed: 0, merged: 0, truncated: false });
  });

  it("is idempotent — a second pass over converged rows plans nothing", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [sku({ ingredient: "whole milk", sku: "123" })],
      },
    });
    expect((await rekeySkuCache(env)).rekeyed).toBe(1);
    const again = await rekeySkuCache(env);
    expect(again).toEqual({ rekeyed: 0, merged: 0, truncated: false });
    expect(tables.sku_cache).toHaveLength(1);
  });
});

describe("planSkuRekey", () => {
  it("keeps the already-canonical row on a last_used tie (no gratuitous upsert)", () => {
    const rows = [
      sku({ ingredient: "milk::whole", sku: "keep", last_used: "2026-01-01" }),
      sku({ ingredient: "whole milk", sku: "drop", last_used: "2026-01-01" }),
    ];
    const plans = planSkuRekey(rows, (t) => (t === "whole milk" ? "milk::whole" : t));
    expect(plans).toEqual([
      {
        deletes: [{ ingredient: "whole milk", location_id: "loc1" }],
        upsert: expect.objectContaining({ ingredient: "milk::whole", sku: "keep" }),
        merged: 1,
      },
    ]);
  });

  it("plans nothing for canonical singletons (pure and idempotent)", () => {
    const rows = [sku({ ingredient: "milk::whole", sku: "1" }), sku({ ingredient: "eggs", sku: "2" })];
    expect(planSkuRekey(rows, (t) => t)).toEqual([]);
  });
});
