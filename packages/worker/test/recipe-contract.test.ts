import { describe, it, expect } from "vitest";
import { validateRecipeContract, REQUIRED_FIELDS } from "../src/recipe-contract.js";

// A fully compliant frontmatter object — every authored gate/identity field present, plus
// every derived facet present in a valid form (so the "classifier output" path, which sets
// every key, is exercised too). Tests clone + mutate one axis at a time.
function compliant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // Required AUTHORED fields (gates + identity).
    title: "X",
    time_total: null,
    source: null,
    dietary: [],
    pairs_with: [],
    requires_equipment: [],
    // Optional DERIVED facets (present here; validated when present).
    description: "A simple test dish.",
    protein: null,
    cuisine: null,
    course: ["main"],
    season: [],
    tags: [],
    ingredients_key: ["x"],
    ingredients_full: ["x", "salt"],
    perishable_ingredients: [],
    side_search_terms: ["a crisp green salad"],
    meal_preppable: false,
    ...overrides,
  };
}

const REQUIRED_AUTHORED = ["title", "time_total", "source", "dietary", "pairs_with", "requires_equipment"];
const DERIVED_FACETS = [
  "protein",
  "cuisine",
  "course",
  "season",
  "tags",
  "ingredients_key",
  "ingredients_full",
  "perishable_ingredients",
  "side_search_terms",
  "meal_preppable",
];

describe("validateRecipeContract", () => {
  it("accepts a fully compliant recipe", () => {
    expect(validateRecipeContract(compliant())).toEqual([]);
  });

  it("accepts a body-only authored recipe (every derived facet omitted)", () => {
    const fm = compliant();
    for (const f of [...DERIVED_FACETS, "description"]) delete fm[f];
    expect(validateRecipeContract(fm)).toEqual([]);
  });

  it("REQUIRED_FIELDS enumerates the authored gates + identity (not the derived facets)", () => {
    for (const f of REQUIRED_AUTHORED) expect(REQUIRED_FIELDS).toContain(f);
    for (const f of DERIVED_FACETS) expect(REQUIRED_FIELDS).not.toContain(f);
  });

  describe("required authored fields", () => {
    it("rejects a missing or empty title", () => {
      const fm = compliant();
      delete fm.title;
      expect(validateRecipeContract(fm).some((e) => e.includes("title"))).toBe(true);
      expect(validateRecipeContract(compliant({ title: "  " })).some((e) => e.includes("title"))).toBe(true);
    });

    for (const f of REQUIRED_AUTHORED.filter((x) => x !== "title")) {
      it(`rejects a missing ${f}`, () => {
        const fm = compliant();
        delete fm[f];
        expect(validateRecipeContract(fm).some((e) => e.includes(f))).toBe(true);
      });
    }

    it("accepts explicit null time_total/source and empty gate arrays", () => {
      expect(validateRecipeContract(compliant({ time_total: null, source: null }))).toEqual([]);
    });

    it("rejects a non-number time_total", () => {
      expect(validateRecipeContract(compliant({ time_total: "30" })).some((e) => /time_total/.test(e))).toBe(true);
    });

    it("rejects an off-vocab requires_equipment slug", () => {
      expect(
        validateRecipeContract(compliant({ requires_equipment: ["air-fryer"] })).some((e) => /air-fryer/.test(e)),
      ).toBe(true);
    });

    it("rejects a non-array dietary / pairs_with", () => {
      expect(validateRecipeContract(compliant({ dietary: "vegan" })).some((e) => /dietary/.test(e))).toBe(true);
      expect(validateRecipeContract(compliant({ pairs_with: "rice" })).some((e) => /pairs_with/.test(e))).toBe(true);
    });
  });

  describe("optional derived facets — accepted when absent, validated when present", () => {
    for (const f of DERIVED_FACETS) {
      it(`accepts an omitted ${f} (derived, not authored-required)`, () => {
        const fm = compliant();
        delete fm[f];
        // Omitting side_search_terms while a `main` course is present is fine — the term is derived.
        expect(validateRecipeContract(fm)).toEqual([]);
      });
    }

    it("accepts in-vocab protein/cuisine and a numeric time_total", () => {
      expect(validateRecipeContract(compliant({ protein: "fish", cuisine: "japanese", time_total: 30 }))).toEqual([]);
    });

    it("rejects an off-vocab protein override (validated when present)", () => {
      expect(validateRecipeContract(compliant({ protein: "shrimp" })).some((e) => /protein/.test(e))).toBe(true);
    });

    it('rejects a "none" protein override (must be null)', () => {
      expect(validateRecipeContract(compliant({ protein: "none" })).some((e) => /protein/.test(e))).toBe(true);
    });

    it("rejects an off-vocab cuisine override", () => {
      expect(validateRecipeContract(compliant({ cuisine: "martian" })).some((e) => /cuisine/.test(e))).toBe(true);
    });

    it("accepts course authored as a bare string", () => {
      expect(validateRecipeContract(compliant({ course: "Main" }))).toEqual([]);
    });

    it("rejects an empty course when present", () => {
      expect(validateRecipeContract(compliant({ course: [] })).some((e) => /course/.test(e))).toBe(true);
    });

    it("rejects an empty ingredients_key when present", () => {
      expect(validateRecipeContract(compliant({ ingredients_key: [] })).some((e) => /ingredients_key/.test(e))).toBe(
        true,
      );
    });

    it("rejects an empty or non-string-array ingredients_full when present", () => {
      // The classifier sets every key, so this is the required-on-classify backstop; an
      // authored file simply omits it (accepted — the omitted-facet loop above covers that).
      expect(
        validateRecipeContract(compliant({ ingredients_full: [] })).some((e) => /ingredients_full/.test(e)),
      ).toBe(true);
      expect(
        validateRecipeContract(compliant({ ingredients_full: [1] })).some((e) => /ingredients_full/.test(e)),
      ).toBe(true);
    });

    it("accepts canonical season tokens; rejects off-vocab / autumn / casing", () => {
      expect(validateRecipeContract(compliant({ season: ["spring", "fall"] }))).toEqual([]);
      expect(validateRecipeContract(compliant({ season: ["monsoon"] })).some((e) => /season/.test(e))).toBe(true);
      expect(validateRecipeContract(compliant({ season: ["autumn"] })).some((e) => /season/.test(e))).toBe(true);
      expect(validateRecipeContract(compliant({ season: ["Summer"] })).some((e) => /season/.test(e))).toBe(true);
    });

    it("rejects a non-boolean meal_preppable when present", () => {
      expect(validateRecipeContract(compliant({ meal_preppable: "yes" })).some((e) => /meal_preppable/.test(e))).toBe(
        true,
      );
    });
  });

  describe("conditional side_search_terms (when present)", () => {
    it("requires a non-empty value for a main", () => {
      expect(
        validateRecipeContract(compliant({ course: ["main"], side_search_terms: [] })).some((e) =>
          /side_search_terms/.test(e),
        ),
      ).toBe(true);
    });
    it("accepts [] for a non-main", () => {
      expect(validateRecipeContract(compliant({ course: ["side"], side_search_terms: [] }))).toEqual([]);
    });
    it("accepts an omitted side_search_terms even for a main (it is derived)", () => {
      const fm = compliant({ course: ["main"] });
      delete fm.side_search_terms;
      expect(validateRecipeContract(fm)).toEqual([]);
    });
  });

  it("reports every missing authored field at once", () => {
    const errs = validateRecipeContract({ title: "only a title" });
    // missing: time_total, source, dietary, pairs_with, requires_equipment
    expect(errs.length).toBeGreaterThanOrEqual(5);
  });
});
