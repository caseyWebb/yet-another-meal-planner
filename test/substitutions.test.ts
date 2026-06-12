import { describe, it, expect } from "vitest";
import {
  parseSubstitutionRules,
  mergeSubstitutionRules,
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

describe("mergeSubstitutionRules (per-tenant override, §7.2)", () => {
  const shared: SubRule[] = [
    { ingredient: "salmon", acceptable: ["trout", "cod"], unacceptable: ["tilapia"] },
    { ingredient: "butter", acceptable: ["margarine"], unacceptable: [] },
  ];

  it("a tenant override replaces the shared rule for that ingredient", () => {
    const override: SubRule[] = [{ ingredient: "salmon", acceptable: ["arctic char"], unacceptable: [] }];
    const merged = mergeSubstitutionRules(shared, override, {});
    expect(findRule(merged, "salmon", {})).toEqual({
      ingredient: "salmon",
      acceptable: ["arctic char"],
      unacceptable: [],
    });
    // The non-overridden shared rule is untouched.
    expect(findRule(merged, "butter", {})?.acceptable).toEqual(["margarine"]);
  });

  it("matches the overridden ingredient through aliases", () => {
    const aliases = { "wild salmon": "salmon" };
    const override: SubRule[] = [{ ingredient: "wild salmon", acceptable: ["char"], unacceptable: [] }];
    const merged = mergeSubstitutionRules(shared, override, aliases);
    // Only one salmon rule survives (the override), reachable by either name.
    expect(findRule(merged, "salmon", aliases)?.acceptable).toEqual(["char"]);
    expect(merged.filter((r) => r.ingredient === "salmon" || r.ingredient === "wild salmon")).toHaveLength(1);
  });

  it("adds an override-only rule and leaves shared rules intact", () => {
    const override: SubRule[] = [{ ingredient: "honey", acceptable: ["maple syrup"], unacceptable: [] }];
    const merged = mergeSubstitutionRules(shared, override, {});
    expect(merged).toHaveLength(3);
    expect(findRule(merged, "honey", {})?.acceptable).toEqual(["maple syrup"]);
    expect(findRule(merged, "salmon", {})?.acceptable).toEqual(["trout", "cod"]);
  });

  it("no override → shared rules unchanged", () => {
    expect(mergeSubstitutionRules(shared, [], {})).toEqual(shared);
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

  it("preserves acceptable-list order when several substitutes are on sale", async () => {
    const rule = findRule(RULES, "salmon", {});
    const onSale = new Set(["trout", "cod"]);
    const res = await proposeSale(rule, async (s) => onSale.has(s));
    expect(res.substitutes).toEqual(["trout", "cod"]);
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
