import { describe, it, expect } from "vitest";
import {
  parseSubstitutionRules,
  findRule,
  proposeInventory,
  proposeSale,
  type SubRule,
} from "../src/substitutions.js";

const RULES: SubRule[] = [
  { ingredient: "salmon", acceptable: ["trout", "cod"], unacceptable: ["tilapia"] },
];

describe("parseSubstitutionRules", () => {
  it("extracts rules from a parsed substitutions.toml", () => {
    const parsed = {
      rules: [
        { ingredient: "salmon", acceptable_substitutes: ["trout"], unacceptable_substitutes: ["tilapia"], notes: "wild" },
      ],
    };
    expect(parseSubstitutionRules(parsed)).toEqual([
      { ingredient: "salmon", acceptable: ["trout"], unacceptable: ["tilapia"], notes: "wild" },
    ]);
  });

  it("returns [] for an empty (comment-only) file", () => {
    expect(parseSubstitutionRules({})).toEqual([]);
  });
});

describe("proposeInventory", () => {
  it("returns rule-acceptable substitutes present in the pantry, plus the unacceptable list", () => {
    const rule = findRule(RULES, "salmon", {});
    expect(proposeInventory(rule, ["trout", "rice"], {})).toEqual({
      substitutes: ["trout"],
      unacceptable: ["tilapia"],
    });
  });

  it("excludes acceptable substitutes that are not in the pantry", () => {
    const rule = findRule(RULES, "salmon", {});
    expect(proposeInventory(rule, ["rice"], {}).substitutes).toEqual([]);
  });

  it("dormant: no matching rule yields an empty, non-error result", () => {
    expect(proposeInventory(findRule(RULES, "olive oil", {}), ["anything"], {})).toEqual({
      substitutes: [],
      unacceptable: [],
    });
  });
});

describe("proposeSale", () => {
  it("keeps rule-acceptable substitutes that are on sale, without a caller pre-pass", async () => {
    const rule = findRule(RULES, "salmon", {});
    const onSale = new Set(["cod"]);
    const res = await proposeSale(rule, async (s) => onSale.has(s));
    expect(res).toEqual({ substitutes: ["cod"], unacceptable: ["tilapia"] });
  });

  it("dormant: no rule → empty result and the Kroger lookup is never called", async () => {
    let called = false;
    const res = await proposeSale(null, async () => {
      called = true;
      return true;
    });
    expect(res).toEqual({ substitutes: [], unacceptable: [] });
    expect(called).toBe(false);
  });

  it("propagates a Kroger failure (distinct from an empty no-rules result)", async () => {
    const rule = findRule(RULES, "salmon", {});
    await expect(
      proposeSale(rule, async () => {
        throw new Error("kroger unavailable");
      }),
    ).rejects.toThrow(/kroger unavailable/);
  });
});
