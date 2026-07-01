import { describe, it, expect } from "vitest";
import {
  debt,
  debtCurve,
  weatherMultiplier,
  sampleWeek,
  occurrenceCap,
  computeQuotas,
  histogramCategories,
  resolveBucketMembership,
  DEFAULT_CADENCE_PARAMS,
  type NightVibeSpec,
} from "../src/night-vibe-schedule.js";
import type { WeatherCategory } from "../src/weather.js";

const NOW = new Date("2026-07-01T00:00:00Z");

describe("debt", () => {
  it("treats a never-satisfied vibe as maximally overdue", () => {
    expect(debt(null, 7, NOW)).toBe(DEFAULT_CADENCE_PARAMS.neverDebt);
    expect(debt("not-a-date", 7, NOW)).toBe(DEFAULT_CADENCE_PARAMS.neverDebt);
  });

  it("is days-since over the period", () => {
    expect(debt("2026-06-24", 7, NOW)).toBeCloseTo(1, 5); // 7 days / 7-day period
    expect(debt("2026-06-01", 30, NOW)).toBeCloseTo(1, 5); // 30 days / 30-day period
    expect(debt("2026-06-30", 7, NOW)).toBeCloseTo(1 / 7, 5); // 1 day / 7
  });
});

describe("debtCurve", () => {
  it("is monotonic non-decreasing and capped", () => {
    expect(debtCurve(0)).toBeCloseTo(DEFAULT_CADENCE_PARAMS.debtFloor);
    expect(debtCurve(1)).toBeCloseTo(1);
    expect(debtCurve(1000)).toBeLessThanOrEqual(DEFAULT_CADENCE_PARAMS.debtCap);
    let prev = -Infinity;
    for (const d of [0, 0.25, 0.5, 1, 2, 5, 50, 500]) {
      const v = debtCurve(d);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("weatherMultiplier", () => {
  it("bumps on affinity, penalizes on antipathy, neutral otherwise", () => {
    const soup: NightVibeSpec = { id: "soup", weather_affinity: ["soup", "comfort"] };
    expect(weatherMultiplier(soup, ["soup", "comfort"])).toBeCloseTo(1 + 0.6 * 2);
    expect(weatherMultiplier(soup, [])).toBe(1);
    const grill: NightVibeSpec = { id: "grill", weather_affinity: ["grill-friendly"], weather_antipathy: ["no-grill"] };
    expect(weatherMultiplier(grill, ["no-grill"])).toBeCloseTo(DEFAULT_CADENCE_PARAMS.weatherPenalty);
  });
});

describe("sampleWeek", () => {
  it("force-places a pinned vibe", () => {
    const palette: NightVibeSpec[] = [{ id: "pasta", pinned: true }, { id: "a" }, { id: "b" }, { id: "c" }];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const wk = sampleWeek(palette, [], debts, 2, 1);
    const pasta = wk.slots.find((s) => s.id === "pasta");
    expect(pasta?.reason).toBe("pinned");
  });

  it("places overdue vibes by debt rank and rolls over the excess", () => {
    const palette: NightVibeSpec[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const debts = new Map([["a", 5], ["b", 4], ["c", 3], ["d", 2]]); // all ≥ forceDueAt
    const wk = sampleWeek(palette, [], debts, 2, 1);
    expect(wk.slots.length).toBe(2);
    expect(wk.rolledOver.length).toBe(2);
    expect(wk.slots.map((s) => s.id)).toContain("a"); // highest debt placed
  });

  it("reserves a slot for weighted sampling under an overdue backlog", () => {
    const palette: NightVibeSpec[] = [
      { id: "o1" },
      { id: "o2" },
      { id: "o3" },
      { id: "o4" },
      { id: "soup", weather_affinity: ["cold-comfort"] },
    ];
    const debts = new Map([["o1", 5], ["o2", 4], ["o3", 3], ["o4", 2], ["soup", 0.1]]);
    const wk = sampleWeek(palette, ["cold-comfort"], debts, 3, 1); // minSampledSlots default 1
    const reasons = wk.slots.map((s) => s.reason);
    expect(wk.slots.length).toBe(3);
    expect(reasons.filter((r) => r === "overdue").length).toBeLessThanOrEqual(2);
    expect(reasons).toContain("sampled");
    // the only non-forced vibe takes the reserved slot
    expect(wk.slots.find((s) => s.reason === "sampled")?.id).toBe("soup");
    expect(wk.rolledOver.length).toBeGreaterThanOrEqual(1);
  });

  it("samples without replacement, deterministically per seed, varying across seeds", () => {
    const palette: NightVibeSpec[] = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const debts = new Map(palette.map((v) => [v.id, 0])); // none forced → all sampled
    const w1 = sampleWeek(palette, [], debts, 3, 42).slots.map((s) => s.id);
    const w2 = sampleWeek(palette, [], debts, 3, 42).slots.map((s) => s.id);
    expect(w1).toEqual(w2);
    expect(new Set(w1).size).toBe(3); // no repeats
    const shapes = new Set<string>();
    for (let s = 1; s <= 20; s++) {
      shapes.add(sampleWeek(palette, [], debts, 3, s).slots.map((x) => x.id).sort().join(","));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe("occurrenceCap", () => {
  it("is max(1, floor(window / period))", () => {
    expect(occurrenceCap(7, 14)).toBe(2);
    expect(occurrenceCap(7, 21)).toBe(3);
    expect(occurrenceCap(30, 14)).toBe(1); // floored up to the minimum
    expect(occurrenceCap(14, 14)).toBe(1); // window == period → still 1
    expect(occurrenceCap(null, 14)).toBe(1);
    expect(occurrenceCap(undefined, 14)).toBe(1);
  });
});

describe("sampleWeek — period-aware bounded-multiplicity repeatability", () => {
  it("a weekly vibe (cadence_days: 7) may recur up to twice in a 14-day window", () => {
    // A single non-forced vibe filling many slots must hit its cap, not repeat unboundedly.
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const counts = new Map<string, number>();
    for (let seed = 1; seed <= 40; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 14);
      const pastaCount = wk.slots.filter((s) => s.id === "pasta").length;
      expect(pastaCount).toBeLessThanOrEqual(2); // cap = floor(14/7) = 2
      counts.set(seed.toString(), pastaCount);
    }
    // Over many seeds, pasta should actually reach 2 occurrences at least once (the cap is
    // reachable, not merely a theoretical ceiling nothing exercises).
    expect([...counts.values()].some((c) => c === 2)).toBe(true);
  });

  it("a monthly vibe (cadence_days: 30) stays capped at one occurrence in a 14-day window", () => {
    const palette: NightVibeSpec[] = [
      { id: "big-project", cadence_days: 30 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    for (let seed = 1; seed <= 20; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 14);
      expect(wk.slots.filter((s) => s.id === "big-project").length).toBeLessThanOrEqual(1);
    }
  });

  it("a window shorter than or equal to a vibe's period preserves at-most-once behavior", () => {
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    for (let seed = 1; seed <= 20; seed++) {
      // window (7) == period (7) → cap 1
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 7);
      expect(wk.slots.filter((s) => s.id === "pasta").length).toBeLessThanOrEqual(1);
    }
  });

  it("omitting window defaults it to n, reproducing today's at-most-once behavior", () => {
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "other-a" },
      { id: "other-b" },
      { id: "other-c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    for (let seed = 1; seed <= 20; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed); // no window arg
      expect(new Set(wk.slots.map((s) => s.id)).size).toBe(wk.slots.length); // no repeats
    }
  });

  it("is deterministic given the same seed, including which vibes recur and how many times", () => {
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "soup", cadence_days: 14 },
      { id: "other-a" },
      { id: "other-b" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const w1 = sampleWeek(palette, [], debts, 6, 7, DEFAULT_CADENCE_PARAMS, 14).slots.map((s) => s.id);
    const w2 = sampleWeek(palette, [], debts, 6, 7, DEFAULT_CADENCE_PARAMS, 14).slots.map((s) => s.id);
    expect(w1).toEqual(w2);
  });

  it("preserves pinned/overdue precedence over the bounded-multiplicity pool", () => {
    const palette: NightVibeSpec[] = [
      { id: "regular", pinned: true },
      { id: "overdue-one", cadence_days: 7 },
      { id: "weekly", cadence_days: 7 },
      { id: "other" },
    ];
    const debts = new Map([
      ["regular", 0],
      ["overdue-one", 5], // ≥ forceDueAt
      ["weekly", 0],
      ["other", 0],
    ]);
    const wk = sampleWeek(palette, [], debts, 4, 3, DEFAULT_CADENCE_PARAMS, 14);
    const regular = wk.slots.find((s) => s.id === "regular");
    const overdue = wk.slots.find((s) => s.id === "overdue-one");
    expect(regular?.reason).toBe("pinned");
    expect(overdue?.reason).toBe("overdue");
    // pinned/overdue are placed exactly once each, never repeated by the window.
    expect(wk.slots.filter((s) => s.id === "regular").length).toBe(1);
    expect(wk.slots.filter((s) => s.id === "overdue-one").length).toBe(1);
  });

  it("over-subscription still rolls over forced vibes that don't fit", () => {
    const palette: NightVibeSpec[] = [
      { id: "a", cadence_days: 7 },
      { id: "b", cadence_days: 7 },
      { id: "c", cadence_days: 7 },
      { id: "d", cadence_days: 7 },
    ];
    const debts = new Map([["a", 5], ["b", 4], ["c", 3], ["d", 2]]); // all overdue
    const wk = sampleWeek(palette, [], debts, 2, 1, DEFAULT_CADENCE_PARAMS, 14);
    expect(wk.slots.length).toBe(2);
    expect(wk.rolledOver.length).toBe(2);
  });

  it("spreads a recurring vibe's occurrences rather than always landing it adjacent", () => {
    // With a sparse-enough alternative pool, the cooldown should sometimes separate the two
    // pasta occurrences rather than forcing them onto consecutive slots every single seed.
    const palette: NightVibeSpec[] = [
      { id: "pasta", cadence_days: 7 },
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    let sawSeparated = false;
    for (let seed = 1; seed <= 60; seed++) {
      const wk = sampleWeek(palette, [], debts, 4, seed, DEFAULT_CADENCE_PARAMS, 14);
      const idxs = wk.slots.map((s, i) => (s.id === "pasta" ? i : -1)).filter((i) => i >= 0);
      if (idxs.length === 2 && idxs[1] - idxs[0] > 1) sawSeparated = true;
    }
    expect(sawSeparated).toBe(true);
  });
});

describe("resolveBucketMembership", () => {
  it("resolves new category names directly", () => {
    expect(resolveBucketMembership({ weather_affinity: ["grill"] })).toEqual(new Set(["grill"]));
    expect(resolveBucketMembership({ weather_affinity: ["cold-comfort", "wet"] })).toEqual(new Set(["cold-comfort", "wet"]));
  });

  it("resolves legacy weather-vibe tags through the same day→category map", () => {
    expect(resolveBucketMembership({ weather_affinity: ["grill-friendly"] })).toEqual(new Set(["grill"]));
    expect(resolveBucketMembership({ weather_affinity: ["soup"] })).toEqual(new Set(["cold-comfort"]));
    expect(resolveBucketMembership({ weather_affinity: ["no-grill"] })).toEqual(new Set(["wet"]));
  });

  it("defaults to bucketless (empty set) when absent, empty, or unrecognized", () => {
    expect(resolveBucketMembership({})).toEqual(new Set());
    expect(resolveBucketMembership({ weather_affinity: [] })).toEqual(new Set());
    expect(resolveBucketMembership({ weather_affinity: ["comfort"] })).toEqual(new Set()); // comfort alone → mild, not a bucket
  });
});

describe("histogramCategories / computeQuotas", () => {
  it("histograms day categories, capping at RELIABILITY_CAP and folding excess into mild", () => {
    const days: WeatherCategory[] = new Array(12).fill("grill");
    const hist = histogramCategories(days);
    expect(hist.grill).toBe(10); // capped
    expect(hist.mild).toBe(2); // the 2 excess days
  });

  it("computeQuotas sums to the requested slot count via largest-remainder rounding", () => {
    const hist = { grill: 1, "cold-comfort": 0, wet: 0, mild: 6 };
    const quotas = computeQuotas(hist, 7);
    expect(quotas.grill + quotas["cold-comfort"] + quotas.wet + quotas.mild).toBe(7);
    expect(quotas.grill).toBe(1); // 1/7 of 7 slots
    expect(quotas.mild).toBe(6);
  });

  it("computeQuotas puts everything on mild when the histogram is empty", () => {
    const quotas = computeQuotas({ grill: 0, "cold-comfort": 0, wet: 0, mild: 0 }, 5);
    expect(quotas).toEqual({ grill: 0, "cold-comfort": 0, wet: 0, mild: 5 });
  });

  it("computeQuotas returns all-zero quotas for zero slots", () => {
    expect(computeQuotas({ grill: 3, "cold-comfort": 2, wet: 1, mild: 1 }, 0)).toEqual({
      grill: 0,
      "cold-comfort": 0,
      wet: 0,
      mild: 0,
    });
  });
});

describe("sampleWeek — quota-based weather allocation", () => {
  it("a mostly-mild forecast with one grill day gives grill a small proportional quota, not full strength", () => {
    const palette: NightVibeSpec[] = [
      { id: "grill-night", weather_affinity: ["grill"] },
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    // 1 grill day out of 7 → quota should be ~1/7 of the slots, not every slot.
    const days: WeatherCategory[] = ["grill", "mild", "mild", "mild", "mild", "mild", "mild"];
    let grillCountAcrossSeeds = 0;
    const seeds = 30;
    for (let seed = 1; seed <= seeds; seed++) {
      const wk = sampleWeek(palette, days, debts, 5, seed);
      grillCountAcrossSeeds += wk.slots.filter((s) => s.id === "grill-night").length;
    }
    // grill-night should NOT be placed in every slot of every plan — its structural quota is tiny.
    expect(grillCountAcrossSeeds).toBeLessThan(seeds * 5 * 0.5);
  });

  it("an all-one-category forecast allocates the whole quota to that bucket's members", () => {
    // Enough grill-bucketed members (with high occurrence caps, via a short cadence over a long
    // window) to fully absorb the quota WITHOUT degrading to flex, so the exclusion is actually
    // exercised rather than masked by a flex-degrade fallback.
    const palette: NightVibeSpec[] = [
      { id: "grill-a", weather_affinity: ["grill"], cadence_days: 1 },
      { id: "grill-b", weather_affinity: ["grill"], cadence_days: 1 },
      { id: "grill-c", weather_affinity: ["grill"], cadence_days: 1 },
      { id: "soup-night", weather_affinity: ["cold-comfort"], cadence_days: 1 },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = new Array(7).fill("grill");
    const wk = sampleWeek(palette, days, debts, 3, 5, DEFAULT_CADENCE_PARAMS, 30);
    expect(wk.quotas.grill).toBe(3);
    // soup-night is structurally excluded from the grill quota, and the quota is fully absorbed
    // by the grill-bucketed members (no leftover degrades to flex), so it never appears.
    expect(wk.slots.every((s) => s.id !== "soup-night")).toBe(true);
    expect(wk.slots.every((s) => s.id.startsWith("grill-"))).toBe(true);
  });

  it("a bucketed vibe never fills a conflicting category's quota", () => {
    const palette: NightVibeSpec[] = [
      { id: "grill-only", weather_affinity: ["grill"], cadence_days: 1 },
      { id: "wet-a", weather_affinity: ["wet"], cadence_days: 1 },
      { id: "wet-b", weather_affinity: ["wet"], cadence_days: 1 },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = new Array(7).fill("wet"); // all wet, zero grill quota
    for (let seed = 1; seed <= 20; seed++) {
      const wk = sampleWeek(palette, days, debts, 2, seed, DEFAULT_CADENCE_PARAMS, 30);
      expect(wk.slots.some((s) => s.id === "grill-only")).toBe(false);
    }
  });

  it("a bucketless vibe fills any category's quota", () => {
    const palette: NightVibeSpec[] = [{ id: "flex-vibe" }];
    const debts = new Map([["flex-vibe", 0]]);
    const days: WeatherCategory[] = new Array(7).fill("wet");
    const wk = sampleWeek(palette, days, debts, 1, 1);
    expect(wk.slots.map((s) => s.id)).toEqual(["flex-vibe"]);
  });

  it("a quota with no eligible member degrades to flex instead of leaving a slot empty", () => {
    // Every vibe is bucketed to grill; the forecast is all wet → the wet quota has zero eligible
    // members (no bucketless, no wet members) and must degrade to flex rather than go unfilled.
    const palette: NightVibeSpec[] = [
      { id: "grill-a", weather_affinity: ["grill"] },
      { id: "grill-b", weather_affinity: ["grill"] },
      { id: "grill-c", weather_affinity: ["grill"] },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = new Array(7).fill("wet");
    const wk = sampleWeek(palette, days, debts, 3, 2);
    expect(wk.slots.length).toBe(3); // never an empty slot for lack of a weather match
  });

  it("a mild-day quota samples the whole palette, not restricted to any bucket", () => {
    const palette: NightVibeSpec[] = [
      { id: "grill-only", weather_affinity: ["grill"] },
      { id: "wet-only", weather_affinity: ["wet"] },
      { id: "flex" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = new Array(7).fill("mild");
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const wk = sampleWeek(palette, days, debts, 1, seed);
      for (const s of wk.slots) seen.add(s.id);
    }
    // Over many seeds, every vibe (bucketed or not) is eligible for a mild/flex slot.
    expect(seen.has("grill-only")).toBe(true);
    expect(seen.has("wet-only")).toBe(true);
    expect(seen.has("flex")).toBe(true);
  });

  it("threads occurrence caps and used state GLOBALLY across category fills", () => {
    // A single bucketless, weekly-cadence vibe (cap 2 in a 14-day window) sits alongside enough
    // OTHER filler that it should never be drawn more than its cap even though the window spans
    // both a grill quota and a wet quota fill.
    const palette: NightVibeSpec[] = [
      { id: "weekly-flex", cadence_days: 7 },
      { id: "a" },
      { id: "b" },
      { id: "c" },
      { id: "d" },
      { id: "e" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = ["grill", "grill", "grill", "wet", "wet", "wet", "mild"];
    for (let seed = 1; seed <= 40; seed++) {
      const wk = sampleWeek(palette, days, debts, 6, seed, DEFAULT_CADENCE_PARAMS, 14);
      const count = wk.slots.filter((s) => s.id === "weekly-flex").length;
      expect(count).toBeLessThanOrEqual(2); // occurrenceCap(7, 14) = 2, enforced across BOTH quota fills
    }
  });

  it("does NOT underfill flex: a multi-cap vibe drawn in a category still fills a flex slot it has room for", () => {
    // Regression: the flex pass must gate on the vibe's remaining occurrence cap, not on whether
    // it was already used. A single bucketless weekly vibe (cap 2 in a 14-day window) with a
    // grill+mild forecast must fill BOTH slots (grill quota 1 + mild/flex 1) — not get placed once
    // in grill and then excluded from flex, silently dropping the second slot with nothing rolled over.
    const palette: NightVibeSpec[] = [{ id: "pasta", cadence_days: 7 }];
    const debts = new Map([["pasta", 1.0]]); // below forceDueAt — sampled, not force-placed
    const days: WeatherCategory[] = ["grill", "mild"];
    for (let seed = 1; seed <= 20; seed++) {
      const wk = sampleWeek(palette, days, debts, 2, seed, DEFAULT_CADENCE_PARAMS, 14);
      expect(wk.slots.length).toBe(2); // both slots filled — no silent underfill
      expect(wk.slots.every((s) => s.id === "pasta")).toBe(true); // the only vibe, within its cap of 2
      expect(wk.rolledOver).toEqual([]);
    }
  });

  it("an overdue vibe whose bucket has a zero quota this window rolls over (below the escape hatch)", () => {
    const palette: NightVibeSpec[] = [
      { id: "grill-vibe", weather_affinity: ["grill"] }, // debt set below forceRegardlessAt
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const debts = new Map([
      ["grill-vibe", DEFAULT_CADENCE_PARAMS.forceDueAt + 0.1], // overdue, but not escape-hatch overdue
      ["a", 0],
      ["b", 0],
      ["c", 0],
    ]);
    const days: WeatherCategory[] = new Array(7).fill("wet"); // grill quota is zero this window
    const wk = sampleWeek(palette, days, debts, 3, 1);
    expect(wk.slots.some((s) => s.id === "grill-vibe" && s.reason === "overdue")).toBe(false);
    expect(wk.rolledOver).toContain("grill-vibe");
  });

  it("a sufficiently overdue vibe (past the escape hatch) still force-places despite a zero-quota bucket", () => {
    const palette: NightVibeSpec[] = [
      { id: "grill-vibe", weather_affinity: ["grill"] },
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ];
    const debts = new Map([
      ["grill-vibe", DEFAULT_CADENCE_PARAMS.forceRegardlessAt + 0.1], // past the escape hatch
      ["a", 0],
      ["b", 0],
      ["c", 0],
    ]);
    const days: WeatherCategory[] = new Array(7).fill("wet"); // grill quota is zero this window
    const wk = sampleWeek(palette, days, debts, 3, 1);
    expect(wk.slots.find((s) => s.id === "grill-vibe")?.reason).toBe("overdue");
    expect(wk.rolledOver).not.toContain("grill-vibe");
  });

  it("pinned vibes remain sticky regardless of weather category", () => {
    const palette: NightVibeSpec[] = [
      { id: "regular", pinned: true, weather_affinity: ["grill"] },
      { id: "a" },
      { id: "b" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = new Array(7).fill("wet");
    const wk = sampleWeek(palette, days, debts, 2, 1);
    expect(wk.slots.find((s) => s.id === "regular")?.reason).toBe("pinned");
  });

  it("is deterministic given a fixed seed under quota allocation", () => {
    const palette: NightVibeSpec[] = [
      { id: "grill-a", weather_affinity: ["grill"] },
      { id: "grill-b", weather_affinity: ["grill"] },
      { id: "wet-a", weather_affinity: ["wet"] },
      { id: "flex" },
    ];
    const debts = new Map(palette.map((v) => [v.id, 0]));
    const days: WeatherCategory[] = ["grill", "grill", "wet", "mild", "mild", "mild", "mild"];
    const w1 = sampleWeek(palette, days, debts, 4, 9).slots.map((s) => s.id);
    const w2 = sampleWeek(palette, days, debts, 4, 9).slots.map((s) => s.id);
    expect(w1).toEqual(w2);
  });
});
