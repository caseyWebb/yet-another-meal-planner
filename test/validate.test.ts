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

  it("accepts a well-formed pairs_with array and a boolean standalone", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\npairs_with: [steamed-rice]\nstandalone: true\n---\nbody\n"),
    ).not.toThrow();
  });

  it("rejects a non-array pairs_with", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\npairs_with: steamed-rice\n---\nbody\n"),
    ).toThrowError(/pairs_with/);
  });

  it("rejects a non-boolean standalone", () => {
    expect(() =>
      validateFile("recipes/x.md", "---\nstatus: active\nstandalone: yes-please\n---\nbody\n"),
    ).toThrowError(/standalone/);
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
  });

  it("validates cooking_log entries: date, type enum, required recipe/name", () => {
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "2026-06-09"\ntype = "recipe"\nrecipe = "x"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "2026-06-09"\ntype = "ready_to_eat"\nname = "lasagna"\n'),
    ).not.toThrow();
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "June"\ntype = "recipe"\nrecipe = "x"\n'),
    ).toThrowError(/date/);
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "2026-06-09"\ntype = "ate_out"\nname = "diner"\n'),
    ).toThrowError(/not one of/);
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "2026-06-09"\ntype = "recipe"\n'),
    ).toThrowError(/recipe/);
    expect(() =>
      validateFile("cooking_log.toml", '[[entries]]\ndate = "2026-06-09"\ntype = "ad_hoc"\n'),
    ).toThrowError(/name/);
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
});
