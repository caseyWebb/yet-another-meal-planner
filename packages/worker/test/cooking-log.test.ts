import { describe, it, expect } from "vitest";
import { validateNewEntry } from "../src/cooking-log.js";

describe("validateNewEntry", () => {
  it("accepts a valid recipe entry", () => {
    expect(validateNewEntry({ date: "2026-06-09", type: "recipe", recipe: "x" })).toBeNull();
  });
  it("rejects a bad date", () => {
    expect(validateNewEntry({ date: "June 9", type: "recipe", recipe: "x" })).toMatch(/date/);
  });
  it("rejects an unknown type", () => {
    expect(validateNewEntry({ date: "2026-06-09", type: "ate_out" as never })).toMatch(/type/);
  });
  it("rejects the retired ready_to_eat type — the accept-and-convert shim runs BEFORE this check (cooking-write.ts), so an entry reaching here still carrying it is just another invalid type", () => {
    expect(validateNewEntry({ date: "2026-06-09", type: "ready_to_eat" as never, name: "frozen lasagna" })).toMatch(/type/);
  });
  it("requires recipe on a recipe entry", () => {
    expect(validateNewEntry({ date: "2026-06-09", type: "recipe" })).toMatch(/recipe/);
  });
  it("requires name on a non-recipe entry", () => {
    expect(validateNewEntry({ date: "2026-06-09", type: "ad_hoc" })).toMatch(/name/);
  });
});
