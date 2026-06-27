import { describe, it, expect } from "vitest";
import { validateRecipeContract, REQUIRED_FIELDS } from "../src/recipe-contract.js";

// A fully contract-compliant frontmatter object (every system-consumed field present in
// its explicit empty form). Tests clone + mutate one axis at a time.
function compliant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "X",
    description: "A simple test dish.",
    ingredients_key: ["x"],
    course: ["main"],
    protein: null,
    cuisine: null,
    time_total: null,
    source: null,
    dietary: [],
    season: [],
    tags: [],
    pairs_with: [],
    perishable_ingredients: [],
    requires_equipment: [],
    side_search_terms: ["a crisp green salad"],
    ...overrides,
  };
}

describe("validateRecipeContract", () => {
  it("accepts a fully compliant recipe", () => {
    expect(validateRecipeContract(compliant())).toEqual([]);
  });

  it("REQUIRED_FIELDS enumerates the full system-consumed set", () => {
    for (const f of [
      "title",
      "description",
      "ingredients_key",
      "course",
      "protein",
      "cuisine",
      "time_total",
      "source",
      "dietary",
      "season",
      "tags",
      "pairs_with",
      "perishable_ingredients",
      "requires_equipment",
      "side_search_terms",
    ]) {
      expect(REQUIRED_FIELDS).toContain(f);
    }
  });

  describe("non-empty fields", () => {
    for (const f of ["title", "description"]) {
      it(`rejects a missing ${f}`, () => {
        const fm = compliant();
        delete fm[f];
        expect(validateRecipeContract(fm).some((e) => e.includes(f))).toBe(true);
      });
      it(`rejects an empty ${f}`, () => {
        expect(validateRecipeContract(compliant({ [f]: "  " })).some((e) => e.includes(f))).toBe(true);
      });
    }
    for (const f of ["ingredients_key", "course"]) {
      it(`rejects a missing ${f}`, () => {
        const fm = compliant();
        delete fm[f];
        expect(validateRecipeContract(fm).some((e) => e.includes(f))).toBe(true);
      });
      it(`rejects an empty ${f}`, () => {
        expect(validateRecipeContract(compliant({ [f]: [] })).some((e) => e.includes(f))).toBe(true);
      });
    }
    it("accepts course authored as a bare string", () => {
      expect(validateRecipeContract(compliant({ course: "Main" }))).toEqual([]);
    });
  });

  describe("explicit-null scalars", () => {
    for (const f of ["protein", "cuisine", "time_total", "source"]) {
      it(`rejects an omitted ${f} (must be present, value or null)`, () => {
        const fm = compliant();
        delete fm[f];
        expect(validateRecipeContract(fm).some((e) => e.includes(f))).toBe(true);
      });
    }
    it("accepts explicit null for all scalars", () => {
      expect(validateRecipeContract(compliant())).toEqual([]);
    });
    it("accepts in-vocab protein/cuisine and a numeric time_total", () => {
      expect(validateRecipeContract(compliant({ protein: "fish", cuisine: "japanese", time_total: 30 }))).toEqual([]);
    });
    it("rejects an off-vocab protein", () => {
      expect(validateRecipeContract(compliant({ protein: "shrimp" })).some((e) => /protein/.test(e))).toBe(true);
    });
    it('rejects a "none" protein (must be null)', () => {
      expect(validateRecipeContract(compliant({ protein: "none" })).some((e) => /protein/.test(e))).toBe(true);
    });
    it("rejects a non-number time_total", () => {
      expect(validateRecipeContract(compliant({ time_total: "30" })).some((e) => /time_total/.test(e))).toBe(true);
    });
  });

  describe("may-be-empty arrays", () => {
    for (const f of ["dietary", "season", "tags", "pairs_with", "perishable_ingredients", "requires_equipment"]) {
      it(`rejects an omitted ${f} (present, may be [])`, () => {
        const fm = compliant();
        delete fm[f];
        expect(validateRecipeContract(fm).some((e) => e.includes(f))).toBe(true);
      });
      it(`accepts ${f}: []`, () => {
        expect(validateRecipeContract(compliant({ [f]: [] }))).toEqual([]);
      });
    }
    it("rejects an off-vocab requires_equipment slug", () => {
      expect(
        validateRecipeContract(compliant({ requires_equipment: ["air-fryer"] })).some((e) => /air-fryer/.test(e)),
      ).toBe(true);
    });
  });

  describe("conditional side_search_terms", () => {
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
    it("rejects an omitted side_search_terms even for a non-main", () => {
      const fm = compliant({ course: ["side"] });
      delete fm.side_search_terms;
      expect(validateRecipeContract(fm).some((e) => /side_search_terms/.test(e))).toBe(true);
    });
  });

  it("reports multiple violations at once", () => {
    const errs = validateRecipeContract({ title: "only a title" });
    expect(errs.length).toBeGreaterThan(5);
  });
});
