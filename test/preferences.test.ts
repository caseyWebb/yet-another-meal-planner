import { describe, it, expect } from "vitest";
import {
  mergePatch,
  rejectUnknownPatchKeys,
  validatePreferences,
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
    expect(mergePatch({ brands: { oil: ["A", "B"] } }, { brands: { oil: ["C"] } })).toEqual({
      brands: { oil: ["C"] },
    });
  });

  it("a null leaf inside a nested merge deletes that leaf", () => {
    expect(mergePatch({ brands: { a: ["x"], b: ["y"] } }, { brands: { b: null } })).toEqual({
      brands: { a: ["x"] },
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
      rejectUnknownPatchKeys({ default_cooking_nights: 3, stores: {}, brands: {}, dietary: {}, custom: {} }),
    ).not.toThrow();
  });

  it("rejects an unknown top-level key toward custom", () => {
    expect(() => rejectUnknownPatchKeys({ spice_tolerance: "high" })).toThrowError(/custom/);
  });
});

describe("validatePreferences", () => {
  it("accepts a fully-typed object", () => {
    expect(() =>
      validatePreferences({
        default_cooking_nights: 3,
        lunch_strategy: "leftovers",
        ready_to_eat_default_action: "opt-in",
        stores: { primary: "kroger", preferred_location: "Kroger - 76104" },
        brands: { olive_oil: ["Cobram"], yellow_onion: [] },
        dietary: { avoid: [], limit: ["cilantro"] },
        custom: { spice: "high" },
      }),
    ).not.toThrow();
  });

  it("rejects a bad enum (malformed_data)", () => {
    expect(() => validatePreferences({ lunch_strategy: "sometimes" })).toThrowError(/lunch_strategy/);
  });

  it("rejects a non-number cooking nights", () => {
    expect(() => validatePreferences({ default_cooking_nights: "three" })).toThrow();
  });

  it("rejects brands that aren't term → string[]", () => {
    expect(() => validatePreferences({ brands: { oil: "Cobram" } })).toThrow();
  });

  it("rejects a non-object custom", () => {
    expect(() => validatePreferences({ custom: "stuff" })).toThrow();
  });
});
