import { describe, it, expect } from "vitest";
import { rekeySkuCache, planSkuRekey, planAliasRetarget, type SkuCacheRekeyRow } from "../src/sku-cache-rekey.js";
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
  aisle_number: null,
  aisle_description: null,
  aisle_side: null,
  aisle_captured_at: null,
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
    expect(s).toEqual({ rekeyed: 1, merged: 0, alias_retargeted: 0, truncated: false });
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
    expect(s).toEqual({ rekeyed: 0, merged: 0, alias_retargeted: 0, truncated: false });
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
    await expect(rekeySkuCache(env)).resolves.toEqual({ rekeyed: 0, merged: 0, alias_retargeted: 0, truncated: false });
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
    expect(again).toEqual({ rekeyed: 0, merged: 0, alias_retargeted: 0, truncated: false });
    expect(tables.sku_cache).toHaveLength(1);
  });

  it("re-points an alias at a 3-segment loser through the chain, preserving its metadata", async () => {
    // The pre-segment-guard backfill's shape: a 3-segment mint since re-rooted by segment
    // repair. The alias still stores the loser; convergence chases the chain to the survivor
    // and writes ONLY the id — source/confidence/decided_at/audited_at ride untouched.
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "granulated sugar::source-cane::source-organic", base: "granulated sugar", representative: "granulated sugar::source-cane" },
          { id: "granulated sugar::source-cane", base: "granulated sugar", representative: "granulated sugar" },
          { id: "granulated sugar", base: "granulated sugar", representative: null },
        ],
        ingredient_alias: [
          {
            variant: "organic cane sugar",
            id: "granulated sugar::source-cane::source-organic",
            source: "auto",
            confidence: 0.91,
            decided_at: 111,
            audited_at: 222,
          },
        ],
        sku_cache: [],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toEqual({ rekeyed: 0, merged: 0, alias_retargeted: 1, truncated: false });
    expect(tables.ingredient_alias).toEqual([
      { variant: "organic cane sugar", id: "granulated sugar", source: "auto", confidence: 0.91, decided_at: 111, audited_at: 222 },
    ]);
  });

  it("a self-alias of a merged-away node becomes a real variant → survivor mapping", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: "zucchini" },
          { id: "zucchini", base: "zucchini", representative: null },
        ],
        ingredient_alias: [{ variant: "courgette", id: "courgette", source: "auto", audited_at: 500 }],
        sku_cache: [],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toMatchObject({ alias_retargeted: 1 });
    expect(tables.ingredient_alias).toEqual([{ variant: "courgette", id: "zucchini", source: "auto", audited_at: 500 }]);
  });

  it("alias retargeting is idempotent and leaves converged or registry-less targets alone", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: "zucchini" },
          { id: "zucchini", base: "zucchini", representative: null },
        ],
        ingredient_alias: [
          { variant: "courgette", id: "courgette", source: "auto", audited_at: 500 }, // loser target → retargets once
          { variant: "zuke", id: "zucchini", source: "auto", audited_at: 500 }, // already converged
          { variant: "evoo", id: "olive oil", source: "auto", audited_at: 500 }, // id has no identity row → untouched
        ],
        sku_cache: [],
      },
    });
    expect((await rekeySkuCache(env)).alias_retargeted).toBe(1);
    const again = await rekeySkuCache(env);
    expect(again).toEqual({ rekeyed: 0, merged: 0, alias_retargeted: 0, truncated: false });
    expect(tables.ingredient_alias).toEqual([
      { variant: "courgette", id: "zucchini", source: "auto", audited_at: 500 },
      { variant: "zuke", id: "zucchini", source: "auto", audited_at: 500 },
      { variant: "evoo", id: "olive oil", source: "auto", audited_at: 500 },
    ]);
  });

  it("leaves un-audited auto rows to the alias re-audit; audited and human rows retarget", async () => {
    // The ownership rule: an un-audited auto row is the re-audit's to re-point (racing it could
    // clobber a same-tick re-decision with a stale chase — both rows end stamped, so nothing
    // would ever revisit). Human rows are never audited; their targets are pure key maintenance.
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "courgette", base: "courgette", representative: "zucchini" },
          { id: "zucchini", base: "zucchini", representative: null },
        ],
        ingredient_alias: [
          { variant: "baby marrow", id: "courgette", source: "auto", audited_at: null }, // audit-owned → untouched
          { variant: "summer squash", id: "courgette", source: "auto", audited_at: 500 }, // audited → retargets
          { variant: "zucchine", id: "courgette", source: "human", audited_at: null }, // human → retargets
        ],
        sku_cache: [],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s).toMatchObject({ alias_retargeted: 2 });
    expect(tables.ingredient_alias).toEqual([
      { variant: "baby marrow", id: "courgette", source: "auto", audited_at: null },
      { variant: "summer squash", id: "zucchini", source: "auto", audited_at: 500 },
      { variant: "zucchine", id: "zucchini", source: "human", audited_at: null },
    ]);
  });
});

describe("planAliasRetarget", () => {
  it("plans updates only for non-fixpoint targets on retarget-eligible rows", () => {
    const chase = (id: string) => (id === "courgette" ? "zucchini" : id);
    expect(
      planAliasRetarget(
        [
          { variant: "courgette", id: "courgette", source: "auto", audited_at: 500 },
          { variant: "zuke", id: "zucchini", source: "auto", audited_at: 500 },
          { variant: "baby marrow", id: "courgette", source: "auto", audited_at: null }, // audit-owned
          { variant: "zucchine", id: "courgette", source: "human", audited_at: null }, // human, never audited
        ],
        chase,
      ),
    ).toEqual([
      { variant: "courgette", id: "zucchini" },
      { variant: "zucchine", id: "zucchini" },
    ]);
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

describe("rekeySkuCache — aisle column carry (member-app-differentiators D5)", () => {
  it("a re-keyed row travels WHOLE with its aisle placement columns", async () => {
    const { env, tables } = fakeD1({
      tables: {
        ingredient_identity: [{ id: "milk::whole", base: "milk", representative: null }],
        ingredient_alias: [{ variant: "whole milk", id: "milk::whole" }],
        sku_cache: [
          sku({
            ingredient: "whole milk",
            sku: "123",
            brand: "Kroger",
            size: "1 gal",
            last_used: "2026-06-01",
            aisle_number: "7",
            aisle_description: "Dairy",
            aisle_side: "R",
            aisle_captured_at: "2026-06-01",
          }),
        ],
      },
    });
    const s = await rekeySkuCache(env);
    expect(s.rekeyed).toBe(1);
    // Without the column carry the delete+reinsert would silently erase the placement.
    expect(tables.sku_cache).toEqual([
      expect.objectContaining({
        ingredient: "milk::whole",
        sku: "123",
        aisle_number: "7",
        aisle_description: "Dairy",
        aisle_side: "R",
        aisle_captured_at: "2026-06-01",
      }),
    ]);
  });
});
