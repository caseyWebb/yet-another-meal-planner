import { describe, it, expect } from "vitest";
import {
  convertLegacyBrandRanks,
  mergePatch,
  rejectUnknownPatchKeys,
  validatePreferences,
  applyRetiredKeyShim,
  effectiveCadenceCount,
  exportPreferences,
} from "../src/preferences.js";

describe("mergePatch (RFC 7396)", () => {
  it("sets a present key", () => {
    expect(mergePatch({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("deletes on null", () => {
    expect(mergePatch({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  it("merges nested objects to arbitrary depth (the non-clobber guarantee)", () => {
    expect(
      mergePatch({ stores: { primary: "kroger", location_zip: "76104" } }, { stores: { preferred_location: "Kroger - 76137" } }),
    ).toEqual({ stores: { primary: "kroger", location_zip: "76104", preferred_location: "Kroger - 76137" } });
  });

  it("replaces arrays wholesale", () => {
    expect(
      mergePatch({ brands: { oil: { tiers: [["A"], ["B"]] } } }, { brands: { oil: { tiers: [["C"]] } } }),
    ).toEqual({
      brands: { oil: { tiers: [["C"]] } },
    });
  });

  it("a null leaf inside a nested merge deletes that leaf", () => {
    expect(
      mergePatch({ brands: { a: { tiers: [["x"]] }, b: { tiers: [["y"]] } } }, { brands: { b: null } }),
    ).toEqual({
      brands: { a: { tiers: [["x"]] } },
    });
  });

  it("a partial brands family patch merges into the stored family (sibling field preserved)", () => {
    expect(
      mergePatch(
        { brands: { butter: { tiers: [["Challenge"], ["Kerrygold"]], any_brand: false } } },
        { brands: { butter: { any_brand: true } } },
      ),
    ).toEqual({
      brands: { butter: { tiers: [["Challenge"], ["Kerrygold"]], any_brand: true } },
    });
  });

  it("does not mutate the input", () => {
    const target = { a: { b: 1 } };
    mergePatch(target, { a: { c: 2 } });
    expect(target).toEqual({ a: { b: 1 } });
  });
});

describe("rejectUnknownPatchKeys", () => {
  it("accepts the defined surface", () => {
    expect(() =>
      rejectUnknownPatchKeys({
        cadence: { dinner: 3 },
        planning_cadence_days: 7,
        stores: {},
        brands: {},
        dietary: {},
        rotation: {},
        custom: {},
      }),
    ).not.toThrow();
  });

  it("rejects an unknown top-level key toward custom", () => {
    expect(() => rejectUnknownPatchKeys({ spice_tolerance: "high" })).toThrowError(/custom/);
  });

  it("the retired keys and the nights alias are NOT defined keys (the shim intercepts them first)", () => {
    expect(() => rejectUnknownPatchKeys({ lunch_strategy: "mixed" })).toThrowError(/custom/);
    expect(() => rejectUnknownPatchKeys({ default_cooking_nights: 3 })).toThrowError(/custom/);
  });
});

describe("applyRetiredKeyShim (D21, one deprecation window)", () => {
  it("accepts-and-drops the retired keys with a warnings entry — never validated, never written", () => {
    const { patch, warnings } = applyRetiredKeyShim({ lunch_strategy: "whatever, even off-enum", ready_to_eat_default_action: "auto-add", stores: {} });
    expect(patch).toEqual({ stores: {} });
    expect(warnings).toEqual([
      { key: "lunch_strategy", reason: "retired", superseded_by: "meal vibes" },
      { key: "ready_to_eat_default_action", reason: "retired", superseded_by: "meal vibes" },
    ]);
  });

  it("aliases default_cooking_nights onto cadence.dinner, preserving a patch-supplied breakfast/lunch", () => {
    const { patch, warnings } = applyRetiredKeyShim({ default_cooking_nights: 4, cadence: { lunch: 2 } });
    expect(patch).toEqual({ cadence: { dinner: 4, lunch: 2 } });
    expect(warnings).toEqual([{ key: "default_cooking_nights", reason: "aliased", superseded_by: "cadence.dinner" }]);
  });

  it("an explicit patch cadence.dinner wins over the alias", () => {
    const { patch } = applyRetiredKeyShim({ default_cooking_nights: 4, cadence: { dinner: 2 } });
    expect(patch).toEqual({ cadence: { dinner: 2 } });
  });

  it("validates the alias value as an int 0-7", () => {
    expect(() => applyRetiredKeyShim({ default_cooking_nights: "three" })).toThrowError(/cadence.dinner/);
    expect(() => applyRetiredKeyShim({ default_cooking_nights: 9 })).toThrow();
  });

  it("a clean patch passes through untouched with no warnings", () => {
    const { patch, warnings } = applyRetiredKeyShim({ cadence: { dinner: 5 } });
    expect(patch).toEqual({ cadence: { dinner: 5 } });
    expect(warnings).toEqual([]);
  });
});

describe("effectiveCadenceCount / exportPreferences (the read-side chain)", () => {
  it("stored cadence[meal] wins; else dinner derives from the frozen scalar ?? 5; breakfast/lunch derive 0", () => {
    expect(effectiveCadenceCount({ cadence: { dinner: 3 }, default_cooking_nights: 5 }, "dinner")).toBe(3);
    expect(effectiveCadenceCount({ default_cooking_nights: 4 }, "dinner")).toBe(4);
    expect(effectiveCadenceCount({}, "dinner")).toBe(5);
    expect(effectiveCadenceCount(null, "dinner")).toBe(5);
    expect(effectiveCadenceCount({ default_cooking_nights: 4 }, "lunch")).toBe(0);
    expect(effectiveCadenceCount({ cadence: { lunch: 2 } }, "lunch")).toBe(2);
  });

  it("exportPreferences: cadence = stored map else derivation; default_cooking_nights mirrored; retired keys dropped NOW", () => {
    expect(exportPreferences(null)).toBeNull();
    const stored = exportPreferences({
      cadence: { breakfast: 0, lunch: 2, dinner: 5 },
      default_cooking_nights: 5,
      lunch_strategy: "mixed",
      ready_to_eat_default_action: "auto-add",
      stores: { primary: "kroger" },
    })!;
    expect(stored.cadence).toEqual({ breakfast: 0, lunch: 2, dinner: 5 });
    expect(stored.default_cooking_nights).toBe(5);
    expect(stored).not.toHaveProperty("lunch_strategy");
    expect(stored).not.toHaveProperty("ready_to_eat_default_action");
    expect(stored.stores).toEqual({ primary: "kroger" });

    const derived = exportPreferences({ default_cooking_nights: 4 })!;
    expect(derived.cadence).toEqual({ breakfast: 0, lunch: 0, dinner: 4 });
    expect(derived.default_cooking_nights).toBe(4);

    const bare = exportPreferences({ stores: {} })!;
    expect(bare.cadence).toEqual({ breakfast: 0, lunch: 0, dinner: 5 });
    expect(bare.default_cooking_nights).toBe(5);
  });
});

describe("validatePreferences", () => {
  it("accepts household Offline nicknames while rejecting non-string values", () => {
    expect(() => validatePreferences({ stores: { primary: "market", nicknames: { market: "The close store" } } })).not.toThrow();
    expect(() => validatePreferences({ stores: { nicknames: { market: 42 } } })).toThrow(/stores.nicknames/);
  });
  it("accepts a fully-typed object", () => {
    expect(() =>
      validatePreferences({
        cadence: { breakfast: 0, lunch: 2, dinner: 3 },
        stores: { primary: "kroger", preferred_location: "Kroger - 76104" },
        brands: {
          olive_oil: { tiers: [["Cobram", "California Olive Ranch"], ["Cento"]], any_brand: false },
          yellow_onion: { tiers: [], any_brand: true },
          butter: { tiers: [["Challenge"]] }, // any_brand may be absent on a patch value
        },
        dietary: { avoid: [], limit: ["cilantro"] },
        custom: { spice: "high" },
      }),
    ).not.toThrow();
  });

  it("rejects a bad cadence value / key (malformed_data)", () => {
    expect(() => validatePreferences({ cadence: { dinner: 9 } })).toThrowError(/cadence.dinner/);
    expect(() => validatePreferences({ cadence: { dinner: 2.5 } })).toThrowError(/cadence.dinner/);
    expect(() => validatePreferences({ cadence: { brunch: 2 } })).toThrowError(/cadence.brunch/);
    expect(() => validatePreferences({ cadence: 3 })).toThrowError(/cadence/);
  });

  it("accepts a well-formed rotation and rejects non-positive / non-numeric knobs", () => {
    expect(() =>
      validatePreferences({ rotation: { resurface_after_days: 21, novelty_boost: 0.2 } }),
    ).not.toThrow();
    expect(() => validatePreferences({ rotation: { resurface_after_days: 0 } })).toThrowError(/rotation/);
    expect(() => validatePreferences({ rotation: { novelty_boost: "lots" } })).toThrowError(/rotation/);
    expect(() => validatePreferences({ rotation: 30 })).toThrowError(/rotation/);
  });

  it("rejects a non-integer cadence count", () => {
    expect(() => validatePreferences({ cadence: { dinner: "three" } })).toThrow();
  });

  it("accepts a positive planning_cadence_days and rejects non-positive/non-numeric", () => {
    expect(() => validatePreferences({ planning_cadence_days: 14 })).not.toThrow();
    expect(() => validatePreferences({ planning_cadence_days: 0 })).toThrowError(/planning_cadence_days/);
    expect(() => validatePreferences({ planning_cadence_days: -3 })).toThrowError(/planning_cadence_days/);
    expect(() => validatePreferences({ planning_cadence_days: "weekly" })).toThrowError(/planning_cadence_days/);
  });

  it("rejects a brands family that isn't a tier object", () => {
    expect(() => validatePreferences({ brands: { oil: "Cobram" } })).toThrowError(/tier object/);
    // Post-window, a legacy flat rank list is a plain type error (the write path's
    // one-window shim converts it BEFORE the merged result reaches validation).
    expect(() => validatePreferences({ brands: { oil: ["Cobram"] } })).toThrowError(/tier object/);
  });

  it("rejects a brand appearing in more than one tier (case-insensitive), naming it", () => {
    expect(() =>
      validatePreferences({ brands: { butter: { tiers: [["Kerrygold"], ["kerrygold", "Plugra"]] } } }),
    ).toThrowError(/kerrygold/i);
  });

  it("rejects an empty tier and empty/non-string brand names", () => {
    expect(() => validatePreferences({ brands: { butter: { tiers: [[]] } } })).toThrowError(/non-empty/);
    expect(() => validatePreferences({ brands: { butter: { tiers: [[""]] } } })).toThrowError(/non-empty/);
    expect(() => validatePreferences({ brands: { butter: { tiers: [[42]] } } })).toThrow();
  });

  it("rejects the all-empty family value toward null", () => {
    expect(() =>
      validatePreferences({ brands: { butter: { tiers: [], any_brand: false } } }),
    ).toThrowError(/null/);
    expect(() => validatePreferences({ brands: { butter: {} } })).toThrowError(/null/);
  });

  it("rejects a non-boolean any_brand and an unknown family field", () => {
    expect(() =>
      validatePreferences({ brands: { butter: { tiers: [["Challenge"]], any_brand: "yes" } } }),
    ).toThrowError(/any_brand/);
    expect(() =>
      validatePreferences({ brands: { butter: { tires: [["Challenge"]] } } }),
    ).toThrowError(/tires/);
  });

  it("rejects a non-object custom", () => {
    expect(() => validatePreferences({ custom: "stuff" })).toThrow();
  });
});

describe("convertLegacyBrandRanks (the one-window deprecated-shape mapping)", () => {
  it("maps [] to the don't-care state", () => {
    expect(convertLegacyBrandRanks([])).toEqual({ tiers: [], any_brand: true });
  });

  it("maps each rank to its own singleton tier, in order (the migration fixtures)", () => {
    // The production brand_prefs population at migration time (design.md D2).
    expect(convertLegacyBrandRanks(["Challenge", "Tillamook", "Kerrygold"])).toEqual({
      tiers: [["Challenge"], ["Tillamook"], ["Kerrygold"]],
      any_brand: false,
    });
    expect(convertLegacyBrandRanks(["DeLallo", "Muir Glen", "Cento"])).toEqual({
      tiers: [["DeLallo"], ["Muir Glen"], ["Cento"]],
      any_brand: false,
    });
    expect(convertLegacyBrandRanks(["Viva"])).toEqual({ tiers: [["Viva"]], any_brand: false });
  });
});

describe("validatePreferences — weekly_budget", () => {
  it("accepts a finite number >= 0 (0 = no budget line)", () => {
    expect(() => validatePreferences({ weekly_budget: 95 })).not.toThrow();
    expect(() => validatePreferences({ weekly_budget: 0 })).not.toThrow();
  });

  it("rejects negative, non-numeric, and non-finite values with malformed_data", () => {
    for (const bad of [-5, "95", NaN, Infinity, null, { amount: 95 }]) {
      expect(() => validatePreferences({ weekly_budget: bad })).toThrowError(/weekly_budget/);
    }
  });
});
