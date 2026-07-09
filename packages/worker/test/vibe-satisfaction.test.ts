import { describe, it, expect } from "vitest";
import {
  matchCookedVibes,
  VIBE_SATISFY_FLOOR,
  VIBE_SATISFY_GATE,
  DEFAULT_VIBE_SATISFY_PARAMS,
} from "../src/vibe-satisfaction.js";

/** Palette map from id → vector, in a compact literal form. */
function palette(entries: Record<string, number[]>): Map<string, number[]> {
  return new Map(Object.entries(entries));
}

/** Just the satisfied vibe ids (order-independent set assertion). */
function ids(matches: { vibe_id: string }[]): string[] {
  return matches.map((m) => m.vibe_id).sort();
}

describe("matchCookedVibes (cook-time cosine attribution, D4)", () => {
  it("ships a floor strictly below the gate (top match easier than secondary)", () => {
    expect(VIBE_SATISFY_FLOOR).toBeLessThan(VIBE_SATISFY_GATE);
    expect(DEFAULT_VIBE_SATISFY_PARAMS).toEqual({ floor: VIBE_SATISFY_FLOOR, gate: VIBE_SATISFY_GATE });
  });

  it("records the aimed from_vibe PLUS every other vibe the cook also matches (multi-vibe)", () => {
    // recipe [1,1,0] is cosine 0.707 to both aimed [1,0,0] and other [0,1,0] (≥ gate 0.6),
    // and cosine 0 to unrelated [0,0,1].
    const matches = matchCookedVibes(
      [1, 1, 0],
      palette({ aimed: [1, 0, 0], other: [0, 1, 0], unrelated: [0, 0, 1] }),
      "aimed",
    );
    expect(ids(matches)).toEqual(["aimed", "other"]);
    expect(matches.find((m) => m.vibe_id === "aimed")!.score).toBeCloseTo(0.707, 2);
  });

  it("an off-plan cook (no from_vibe) still records the vibes it genuinely matches", () => {
    const matches = matchCookedVibes([1, 0, 0], palette({ match: [1, 0, 0], miss: [0, 1, 0] }), null);
    expect(ids(matches)).toEqual(["match"]);
    expect(matches[0].score).toBeCloseTo(1, 5);
  });

  it("bounds over-reset: the top match resets, weaker near-threshold matches do NOT", () => {
    // recipe [1, 0.875, 0.875]: strong [1,0,0] ≈ 0.629 (≥ gate, TOP → resets); weak1/weak2 ≈ 0.550
    // — above the 0.5 floor but below the 0.6 gate, and not the top → excluded, so one dish cannot
    // reset the whole palette.
    const matches = matchCookedVibes(
      [1, 0.875, 0.875],
      palette({ strong: [1, 0, 0], weak1: [0, 1, 0], weak2: [0, 0, 1] }),
      null,
    );
    expect(ids(matches)).toEqual(["strong"]);
    expect(matches[0].score).toBeCloseTo(0.629, 2);
  });

  it("guarantees the from_vibe prior even at a borderline (zero) cosine", () => {
    // aimed [0,0,1] is cosine 0 to recipe [1,0,0] (below the floor) — it still records because it
    // is the aimed vibe; strong [1,0,0] also records on its own cosine.
    const matches = matchCookedVibes([1, 0, 0], palette({ aimed: [0, 0, 1], strong: [1, 0, 0] }), "aimed");
    expect(ids(matches)).toEqual(["aimed", "strong"]);
    expect(matches.find((m) => m.vibe_id === "aimed")!.score).toBeCloseTo(0, 5);
  });

  it("an unembedded recipe (empty vector) fires ONLY the from_vibe prior", () => {
    const matches = matchCookedVibes([], palette({ aimed: [1, 0, 0], other: [0, 1, 0] }), "aimed");
    expect(ids(matches)).toEqual(["aimed"]);
    expect(matches[0].score).toBe(0);
  });

  it("a from_vibe with no embedding is skipped by cosine but still fires as the prior", () => {
    // ghost has no vector; it still records (score 0). match [1,0,0] records on cosine.
    const matches = matchCookedVibes([1, 0, 0], palette({ match: [1, 0, 0] }), "ghost");
    expect(ids(matches)).toEqual(["ghost", "match"]);
    expect(matches.find((m) => m.vibe_id === "ghost")!.score).toBe(0);
  });

  it("no palette and no from_vibe yields no records", () => {
    expect(matchCookedVibes([1, 0, 0], new Map(), null)).toEqual([]);
  });

  it("a lone top match below the floor records nothing (off-plan)", () => {
    // recipe [1,0,0] vs a single vibe [0,0,1] → cosine 0 < floor → no reset.
    expect(matchCookedVibes([1, 0, 0], palette({ far: [0, 0, 1] }), null)).toEqual([]);
  });
});
