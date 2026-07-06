import { describe, it, expect } from "vitest";
import { summarizeLocalRejects, type LocalDrop } from "../src/local-rejects.js";

// The local-reject summarizer (satellite-source-audit): a run's per-item drops roll up PER CATEGORY
// into the compact wire summary — one { category, count, sample } per category (never per body), with
// `sample` the first reason seen for it (truncated). A clean run yields an empty array (the caller
// then omits the additive field entirely).

describe("summarizeLocalRejects", () => {
  it("aggregates per category (not per body), counting each drop and keeping the FIRST reason as sample", () => {
    const drops: LocalDrop[] = [
      { category: "contract_invalid", reason: "invalid sale observation: productId Required" },
      { category: "judgment_smuggled", reason: "sensor-not-judge violation: savings" },
      { category: "contract_invalid", reason: "invalid sale observation: regular must be positive" },
      { category: "contract_invalid", reason: "invalid sale observation: promo Required" },
    ];
    const summary = summarizeLocalRejects(drops);
    // One entry per category, in first-seen order.
    expect(summary).toEqual([
      { category: "contract_invalid", count: 3, sample: "invalid sale observation: productId Required" },
      { category: "judgment_smuggled", count: 1, sample: "sensor-not-judge violation: savings" },
    ]);
  });

  it("truncates a long sample and never ships the whole set", () => {
    const long = "x".repeat(500);
    const summary = summarizeLocalRejects([{ category: "contract_invalid", reason: long }]);
    expect(summary).toHaveLength(1);
    expect(summary[0].sample!.length).toBeLessThanOrEqual(201); // bounded (+ ellipsis)
    expect(summary[0].sample).not.toBe(long);
  });

  it("returns an empty array for no drops (a clean run omits the field)", () => {
    expect(summarizeLocalRejects([])).toEqual([]);
  });
});
