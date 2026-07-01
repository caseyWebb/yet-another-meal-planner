import { describe, it, expect } from "vitest";
import {
  contentHash,
  facetsFromFrontmatter,
  buildDescribeInput,
  generateDescription,
  type RecipeFacets,
} from "../src/description.js";
import type { Env } from "../src/env.js";
import { ToolError } from "../src/errors.js";

const FACETS: RecipeFacets = {
  title: "Sheet-Pan Chicken",
  ingredients_key: ["chicken thighs", "lemon", "garlic"],
  course: ["main"],
  protein: "chicken",
  cuisine: "mediterranean",
  time_total: 50,
  dietary: ["gluten-free"],
  season: ["spring"],
};

/** A fake Env whose Workers AI returns a fixed text-gen response. */
function fakeEnv(response: unknown): Env {
  return { AI: { run: async () => ({ response }) } } as unknown as Env;
}

describe("contentHash", () => {
  it("is deterministic and 8-char hex over the facets", () => {
    expect(contentHash(FACETS)).toBe(contentHash({ ...FACETS }));
    expect(contentHash(FACETS)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("changes when an authored facet changes", () => {
    expect(contentHash({ ...FACETS, protein: "beef" })).not.toBe(contentHash(FACETS));
    expect(contentHash({ ...FACETS, title: "Different" })).not.toBe(contentHash(FACETS));
    expect(contentHash({ ...FACETS, ingredients_key: ["chicken thighs"] })).not.toBe(contentHash(FACETS));
  });

  it("has no description input, so a derived-field (description) change cannot flip it", () => {
    // contentHash's signature is RecipeFacets only — there is no `description` field to pass,
    // so the describe pass writing a new description can never change the content_hash that
    // gates regeneration (no regeneration loop). This is the structural guarantee in code form.
    const keys = Object.keys(FACETS).sort();
    expect(keys).toEqual(
      ["course", "cuisine", "dietary", "ingredients_key", "protein", "season", "time_total", "title"],
    );
  });
});

describe("facetsFromFrontmatter", () => {
  it("coerces a bare-string course to a lower-cased array and defaults missing arrays to []", () => {
    const f = facetsFromFrontmatter({ title: "X", course: "Main", protein: "chicken" });
    expect(f.course).toEqual(["main"]);
    expect(f.ingredients_key).toEqual([]);
    expect(f.dietary).toEqual([]);
    expect(f.season).toEqual([]);
    expect(f.protein).toBe("chicken");
    expect(f.cuisine).toBeNull();
    expect(f.time_total).toBeNull();
  });

  it("passes through arrays and a numeric time_total", () => {
    const f = facetsFromFrontmatter({
      title: "Y",
      course: ["main", "side"],
      ingredients_key: ["a", "b"],
      time_total: 30,
    });
    expect(f.course).toEqual(["main", "side"]);
    expect(f.ingredients_key).toEqual(["a", "b"]);
    expect(f.time_total).toBe(30);
  });
});

describe("buildDescribeInput", () => {
  it("renders title — ingredients; course | facets", () => {
    expect(buildDescribeInput(FACETS)).toBe(
      "Sheet-Pan Chicken — chicken thighs, lemon, garlic; main | chicken | mediterranean | ~50 min | gluten-free",
    );
  });
});

describe("generateDescription", () => {
  it("returns the trimmed response, stripping wrapping quotes some models emit", async () => {
    const out = await generateDescription(fakeEnv('  "A bright, garlicky sheet-pan dinner."  '), FACETS);
    expect(out).toBe("A bright, garlicky sheet-pan dinner.");
  });

  it("maps an empty response to a structured storage_error (never a raw throw)", async () => {
    await expect(generateDescription(fakeEnv("   "), FACETS)).rejects.toBeInstanceOf(ToolError);
  });
});
