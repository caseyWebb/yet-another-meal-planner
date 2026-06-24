import { describe, it, expect } from "vitest";
import { validateFile } from "../src/validate.js";

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

  it("accepts legal pantry categories and rejects illegal ones", () => {
    expect(() =>
      validateFile("pantry.toml", '[[items]]\nname = "milk"\ncategory = "fridge"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("pantry.toml", '[[items]]\nname = "milk"\ncategory = "garage"\n'),
    ).toThrowError(/category/);
  });

  it("requires grocery name and status, validates enums", () => {
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "active"\nkind = "grocery"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nstatus = "active"\n'),
    ).toThrowError(/name/);
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "queued"\n'),
    ).toThrowError(/status/);
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "active"\nkind = "snacks"\n'),
    ).toThrowError(/kind/);
    // domain is a free string: a home-improvement item passes; a non-string fails.
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "2x4"\nstatus = "active"\ndomain = "home-improvement"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("grocery_list.toml", '[[items]]\nname = "oil"\nstatus = "active"\ndomain = 3\n'),
    ).toThrowError(/domain/);
  });

  it("validates a store: requires slug+name, domain a string; layout is notes now", () => {
    expect(() =>
      validateFile("stores/west-7th-tom-thumb.toml", 'slug = "west-7th-tom-thumb"\nname = "Tom Thumb"\ndomain = "grocery"\n'),
    ).not.toThrow();
    expect(() => validateFile("stores/x.toml", 'name = "X"\n')).toThrowError(/missing required field `slug`/);
    expect(() => validateFile("stores/x.toml", 'slug = "x"\n')).toThrowError(/missing required field `name`/);
    expect(() =>
      validateFile("stores/x.toml", 'slug = "x"\nname = "X"\ndomain = 3\n'),
    ).toThrowError(/`domain` must be a string/);
    // Legacy layout keys (written before layout moved to notes) are tolerated, not validated.
    expect(() =>
      validateFile(
        "stores/x.toml",
        'slug = "x"\nname = "X"\n[[aisles]]\nsections = ["a"]\n[[item_locations]]\naisle = "1"\ndoesnt_carry = []\n',
      ),
    ).not.toThrow();
  });

  // cooking_log left GitHub for the D1 `cooking_log` table (d1-cooking-log): no
  // GitHub-commit path writes it, so validateFile no longer has a cooking_log.toml
  // branch. Write-time validation moved to the log_cooked tool
  // (test/cooking-write.test.ts); the parse-only fallthrough still accepts it as
  // generic TOML, so it does not throw.
  it("does not special-case cooking_log.toml (parse-only fallthrough, no throw)", () => {
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "June"\ntype = "ate_out"\n'),
    ).not.toThrow();
  });

  it("validates meal_plan rows: required recipe, ISO planned_for", () => {
    expect(() =>
      validateFile("meal_plan.toml", '[[planned]]\nrecipe = "x"\nplanned_for = "2026-06-10"\n'),
    ).not.toThrow();
    expect(() => validateFile("meal_plan.toml", '[[planned]]\nrecipe = "x"\n')).not.toThrow();
    expect(() => validateFile("meal_plan.toml", "[[planned]]\nplanned_for = 5\n")).toThrowError(/recipe/);
    expect(() =>
      validateFile("meal_plan.toml", '[[planned]]\nrecipe = "x"\nplanned_for = "soon"\n'),
    ).toThrowError(/planned_for/);
  });

  it("validates open-world sides on a planned row: array of strings only", () => {
    expect(() =>
      validateFile("meal_plan.toml", '[[planned]]\nrecipe = "x"\nsides = ["roasted broccoli", "white rice"]\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("meal_plan.toml", '[[planned]]\nrecipe = "x"\nsides = "roasted broccoli"\n'),
    ).toThrowError(/sides/);
  });

  it("validates the per-tenant ready_to_eat catalog: name, slug, meal, status, rating", () => {
    const ok =
      '[[items]]\nname = "Frozen Lasagna"\nslug = "frozen-lasagna"\nmeal = "dinner"\nstatus = "active"\nrating = 4\n';
    expect(() => validateFile("ready_to_eat.toml", ok)).not.toThrow();
    expect(() => validateFile("users/alice/ready_to_eat.toml", ok)).not.toThrow(); // prefixed too
    // bad meal
    expect(() =>
      validateFile("ready_to_eat.toml", '[[items]]\nname = "x"\nslug = "x"\nmeal = "brunch"\n'),
    ).toThrowError(/meal/);
    // missing slug
    expect(() =>
      validateFile("ready_to_eat.toml", '[[items]]\nname = "x"\nmeal = "dinner"\n'),
    ).toThrowError(/slug/);
    // duplicate slug
    expect(() =>
      validateFile(
        "ready_to_eat.toml",
        '[[items]]\nname = "a"\nslug = "dup"\nmeal = "dinner"\n[[items]]\nname = "b"\nslug = "dup"\nmeal = "lunch"\n',
      ),
    ).toThrowError(/duplicate slug/);
    // bad rating
    expect(() =>
      validateFile("ready_to_eat.toml", '[[items]]\nname = "x"\nslug = "x"\nmeal = "dinner"\nrating = 9\n'),
    ).toThrowError(/rating/);
  });

  it("parse-only validates other config TOML", () => {
    expect(() => validateFile("preferences.toml", "default_cooking_nights = 3\n")).not.toThrow();
    expect(() => validateFile("preferences.toml", "= = broken")).toThrowError(/does not parse/);
  });

  it("does not constrain freeform markdown", () => {
    expect(() => validateFile("taste.md", "anything goes here")).not.toThrow();
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
    // The Worker now enforces the recipe vocab too (not shape-only) — an off-vocab
    // slug is a fixable error here instead of a post-push build failure on main.
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nrequires_equipment: [blender, panini-press]\n---\nbody\n"),
    ).toThrowError(/requires_equipment.*panini-press.*controlled vocabulary/);
  });

  it("rejects a non-array requires_equipment", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nrequires_equipment: blender\n---\nbody\n"),
    ).toThrowError(/requires_equipment/);
  });

  it("accepts a kitchen.toml with vocab-clean owned and freeform notes", () => {
    expect(() =>
      validateFile("users/alice/kitchen.toml", 'owned = ["blender", "pressure-cooker"]\n[notes]\novens = 2\n'),
    ).not.toThrow();
    // absent owned is valid (unknown inventory)
    expect(() => validateFile("kitchen.toml", "[notes]\nfree_text = \"cast iron\"\n")).not.toThrow();
  });

  it("rejects an off-vocabulary owned slug in kitchen.toml", () => {
    expect(() =>
      validateFile("users/alice/kitchen.toml", 'owned = ["air-fryer"]\n'),
    ).toThrowError(/owned.*air-fryer.*is not one of/);
  });
});
