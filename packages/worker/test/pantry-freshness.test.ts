import { describe, expect, it } from "vitest";
import { classifyPantryFreshness } from "../src/pantry-freshness.js";

const AS_OF = new Date("2026-07-12T12:00:00Z");
describe("pantry freshness", () => {
  it("uses category tiers from one classifier", () => {
    expect(classifyPantryFreshness("seafood", "2026-07-08", AS_OF).freshness).toBe("worth_a_look");
    expect(classifyPantryFreshness("produce", "2026-07-08", AS_OF).freshness).toBe("covered");
    expect(classifyPantryFreshness("frozen", "2026-05-01", AS_OF).freshness).toBe("covered");
  });

  it("verification converges a stale item", () => {
    expect(classifyPantryFreshness("dairy", "2026-06-01", AS_OF).freshness).toBe("worth_a_look");
    expect(classifyPantryFreshness("dairy", "2026-07-12", AS_OF).freshness).toBe("covered");
  });
});
