import { describe, it, expect } from "vitest";
import { validateFile, validateStoreInput, validateDiscoveryCandidate } from "../src/validate.js";

// A minimal CONTRACT-COMPLIANT recipe frontmatter (every system-consumed field present
// in its explicit empty form). Tests override one axis at a time; pass a key as
// `undefined` to OMIT it (to exercise the missing-required-field rejection).
const BASE: Record<string, string | undefined> = {
  title: "X",
  description: "A simple test dish.",
  ingredients_key: "[x]",
  course: "[main]",
  protein: "null",
  cuisine: "null",
  time_total: "null",
  source: "null",
  dietary: "[]",
  season: "[]",
  tags: "[]",
  pairs_with: "[]",
  perishable_ingredients: "[]",
  requires_equipment: "[]",
  side_search_terms: '["a crisp green salad"]',
};
function recipe(overrides: Record<string, string | undefined> = {}): string {
  const merged = { ...BASE, ...overrides };
  const fm = Object.entries(merged)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${fm}\n---\nbody\n`;
}

describe("validateFile", () => {
  it("accepts a well-formed (contract-compliant) recipe", () => {
    expect(() => validateFile("recipes/x.md", recipe())).not.toThrow();
  });

  it("tolerates a lingering frontmatter status (the lifecycle is retired, not validated)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ status: "bogus" }))).not.toThrow();
  });

  it("rejects a recipe with no frontmatter fence", () => {
    expect(() => validateFile("recipes/x.md", "no frontmatter here")).toThrowError(/fence/);
  });

  // --- required-field contract ----------------------------------------------

  it("rejects a recipe missing a required field (ingredients_key)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ ingredients_key: undefined }))).toThrowError(
      /ingredients_key/,
    );
  });

  it("does not require description (a Worker-derived field, not authored)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ description: undefined }))).not.toThrow();
  });

  it("rejects an omitted explicit-null scalar (protein)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ protein: undefined }))).toThrowError(/protein/);
  });

  it("accepts explicit null protein/cuisine/time_total/source", () => {
    expect(() => validateFile("recipes/x.md", recipe())).not.toThrow();
  });

  it("rejects a `none` protein (must be explicit null)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ protein: "none" }))).toThrowError(/protein.*none/);
  });

  it("rejects a main with empty side_search_terms; accepts a non-main with []", () => {
    expect(() => validateFile("recipes/x.md", recipe({ side_search_terms: "[]" }))).toThrowError(
      /side_search_terms/,
    );
    expect(() =>
      validateFile("recipes/x.md", recipe({ course: "[side]", side_search_terms: "[]" })),
    ).not.toThrow();
  });

  // --- shapes ---------------------------------------------------------------

  it("accepts a well-formed pairs_with array and a course (scalar or array)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ pairs_with: "[steamed-rice]", course: "main" }))).not.toThrow();
    expect(() => validateFile("recipes/x.md", recipe({ course: "[main, side]" }))).not.toThrow();
  });

  it("rejects a non-array pairs_with", () => {
    expect(() => validateFile("recipes/x.md", recipe({ pairs_with: "steamed-rice" }))).toThrowError(/pairs_with/);
  });

  it("rejects a course that is neither a string nor an array of strings", () => {
    expect(() => validateFile("recipes/x.md", recipe({ course: "3" }))).toThrowError(/course/);
  });

  it("accepts an off-convention course value (open vocabulary)", () => {
    expect(() =>
      validateFile("recipes/x.md", recipe({ course: "[sauce]", side_search_terms: "[]" })),
    ).not.toThrow();
  });

  it("ignores a lingering retired standalone field", () => {
    expect(() => validateFile("recipes/x.md", recipe({ standalone: "yes-please" }))).not.toThrow();
  });

  it("accepts a well-formed perishable_ingredients array", () => {
    expect(() => validateFile("recipes/x.md", recipe({ perishable_ingredients: "[cilantro, lime]" }))).not.toThrow();
  });

  it("rejects a non-array perishable_ingredients", () => {
    expect(() => validateFile("recipes/x.md", recipe({ perishable_ingredients: "cilantro" }))).toThrowError(
      /perishable_ingredients/,
    );
  });

  it("accepts in-vocabulary protein, cuisine, and requires_equipment", () => {
    expect(() =>
      validateFile(
        "recipes/x.md",
        recipe({ protein: "shellfish", cuisine: "thai", requires_equipment: "[blender, pressure-cooker]" }),
      ),
    ).not.toThrow();
  });

  it("rejects an off-vocabulary protein at write time (no longer build-only)", () => {
    expect(() => validateFile("recipes/x.md", recipe({ protein: "shrimp" }))).toThrowError(/protein.*shrimp/);
  });

  it("rejects an off-vocabulary cuisine at write time", () => {
    expect(() => validateFile("recipes/x.md", recipe({ cuisine: "martian" }))).toThrowError(/cuisine.*martian/);
  });

  it("rejects an off-vocabulary requires_equipment slug at write time", () => {
    expect(() =>
      validateFile("recipes/x.md", recipe({ requires_equipment: "[blender, panini-press]" })),
    ).toThrowError(/requires_equipment.*panini-press/);
  });

  it("rejects a non-array requires_equipment", () => {
    expect(() => validateFile("recipes/x.md", recipe({ requires_equipment: "blender" }))).toThrowError(
      /requires_equipment/,
    );
  });

  // After d1-shared-corpus (slice 6), recipes/*.md are the ONLY files the commit
  // engine writes — every other artifact (profile, session, cooking log, and the whole
  // shared corpus) is a D1 table validated at its own write tool, NOT committed to
  // GitHub. So validateFile no longer structurally validates non-recipe paths; they
  // pass through untouched (no TOML parse, no per-type checks). The former
  // store/discovery checks moved to validateStoreInput / validateDiscoveryCandidate.
  it("does not validate non-recipe files (moved to D1 write tools)", () => {
    expect(() => validateFile("pantry.toml", "not = = valid toml")).not.toThrow();
    expect(() => validateFile("grocery_list.toml", '[[items]]\nstatus = "queued"\n')).not.toThrow();
    expect(() => validateFile("meal_plan.toml", "[[planned]]\nplanned_for = 5\n")).not.toThrow();
    expect(() => validateFile("ready_to_eat.toml", '[[items]]\nmeal = "brunch"\n')).not.toThrow();
    expect(() => validateFile("users/alice/kitchen.toml", 'owned = ["air-fryer"]\n')).not.toThrow();
    expect(() => validateFile("stores/x.toml", "name = \"X\"\n")).not.toThrow();
    expect(() => validateFile("preferences.toml", "= = broken")).not.toThrow();
    expect(() => validateFile("cooking_log.toml", '[[entries]]\ntype = "ate_out"\n')).not.toThrow();
  });

  it("does not constrain freeform markdown", () => {
    expect(() => validateFile("taste.md", "anything goes here")).not.toThrow();
  });
});

describe("validateStoreInput (write-time, slice 6)", () => {
  it("accepts a kebab-case slug + name, optional string domain", () => {
    expect(() =>
      validateStoreInput({ slug: "west-7th-tom-thumb", name: "Tom Thumb", domain: "grocery" }),
    ).not.toThrow();
    expect(() => validateStoreInput({ slug: "x", name: "X" })).not.toThrow();
  });

  it("rejects a bad slug, empty name, or non-string domain", () => {
    expect(() => validateStoreInput({ slug: "Not Kebab", name: "X" })).toThrowError(/slug/);
    expect(() => validateStoreInput({ slug: "../escape", name: "X" })).toThrowError(/slug/);
    expect(() => validateStoreInput({ slug: "x", name: "  " })).toThrowError(/name/);
    expect(() =>
      validateStoreInput({ slug: "x", name: "X", domain: 3 as unknown as string }),
    ).toThrowError(/domain/);
  });
});

describe("validateDiscoveryCandidate (write-time, slice 6)", () => {
  it("requires a non-empty url", () => {
    expect(() => validateDiscoveryCandidate({ url: "https://example.com/recipe" })).not.toThrow();
    expect(() => validateDiscoveryCandidate({ url: "" })).toThrowError(/url/);
  });
});
