import { describe, it, expect } from "vitest";
import { validateFile, validateStoreInput, validateDiscoveryCandidate } from "../src/validate.js";

describe("validateFile", () => {
  it("accepts a well-formed recipe", () => {
    expect(() => validateFile("recipes/x.md", "---\nstatus: active\n---\nbody\n")).not.toThrow();
  });

  it("rejects an out-of-enum recipe status", () => {
    expect(() => validateFile("recipes/x.md", "---\nstatus: bogus\n---\nbody\n")).toThrowError(
      /not one of/,
    );
  });

  it("rejects a recipe with no frontmatter fence", () => {
    expect(() => validateFile("recipes/x.md", "no frontmatter here")).toThrowError(/fence/);
  });

  it("accepts a well-formed pairs_with array and a course (scalar or array)", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\npairs_with: [steamed-rice]\ncourse: main\n---\nbody\n"),
    ).not.toThrow();
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\ncourse: [main, side]\n---\nbody\n"),
    ).not.toThrow();
  });

  it("rejects a non-array pairs_with", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\npairs_with: steamed-rice\n---\nbody\n"),
    ).toThrowError(/pairs_with/);
  });

  it("rejects a course that is neither a string nor an array of strings", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\ncourse: 3\n---\nbody\n"),
    ).toThrowError(/course/);
  });

  it("accepts an off-convention course value (open vocabulary)", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\ncourse: [sauce]\n---\nbody\n"),
    ).not.toThrow();
  });

  it("ignores a lingering retired standalone field", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nstandalone: yes-please\n---\nbody\n"),
    ).not.toThrow();
  });

  it("accepts a well-formed perishable_ingredients array", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nperishable_ingredients: [cilantro, lime]\n---\nbody\n"),
    ).not.toThrow();
  });

  it("rejects a non-array perishable_ingredients", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nperishable_ingredients: cilantro\n---\nbody\n"),
    ).toThrowError(/perishable_ingredients/);
  });

  it("accepts in-vocabulary protein, cuisine, and requires_equipment", () => {
    expect(() =>
      validateFile(
        "recipes/x.md",
        "---\nstatus: active\nprotein: shellfish\ncuisine: thai\nrequires_equipment: [blender, pressure-cooker]\n---\nbody\n",
      ),
    ).not.toThrow();
  });

  it("rejects an off-vocabulary protein at write time (no longer build-only)", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nprotein: shrimp\n---\nbody\n"),
    ).toThrowError(/protein.*shrimp.*controlled vocabulary/);
  });

  it("rejects an off-vocabulary cuisine at write time", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\ncuisine: martian\n---\nbody\n"),
    ).toThrowError(/cuisine.*martian.*controlled vocabulary/);
  });

  it("rejects an off-vocabulary requires_equipment slug at write time", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nrequires_equipment: [blender, panini-press]\n---\nbody\n"),
    ).toThrowError(/requires_equipment.*panini-press.*controlled vocabulary/);
  });

  it("rejects a non-array requires_equipment", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nrequires_equipment: blender\n---\nbody\n"),
    ).toThrowError(/requires_equipment/);
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
