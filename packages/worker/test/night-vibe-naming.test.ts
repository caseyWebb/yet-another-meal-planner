import { describe, it, expect } from "vitest";
import { nameCluster, parseMealLabel, starterVibesFromTaste } from "../src/night-vibe-naming.js";
import type { Env } from "../src/env.js";

function fakeEnv(response: string): Env {
  return { AI: { run: async () => ({ response }) } } as unknown as Env;
}
const throwEnv = { AI: { run: async () => { throw new Error("quota exhausted"); } } } as unknown as Env;

describe("nameCluster", () => {
  it("names a cluster from its descriptions and carries the cadence through (no bucket/meal lines → bucketless, meal fails closed to dinner)", async () => {
    const r = await nameCluster(fakeEnv('"a simple weeknight italian pasta"'), {
      descriptions: ["baked ziti", "penne pomodoro"],
      cadence_days: 7,
    });
    expect(r).toEqual({ vibe: "a simple weeknight italian pasta", cadence_days: 7, meal: "dinner" });
  });

  it("returns null on empty descriptions or a model failure (fail soft)", async () => {
    expect(await nameCluster(fakeEnv("x"), { descriptions: [], cadence_days: null })).toBeNull();
    expect(await nameCluster(throwEnv, { descriptions: ["a"], cadence_days: null })).toBeNull();
  });

  it("rejects a degenerate one-word phrase", async () => {
    expect(await nameCluster(fakeEnv("pasta"), { descriptions: ["x"], cadence_days: null })).toBeNull();
  });

  it("parses a three-line reply into the vibe phrase + discrete weather bucket + meal", async () => {
    const r = await nameCluster(fakeEnv("a slow weekend braise\ncold-comfort\ndinner"), {
      descriptions: ["short rib braise"],
      cadence_days: 30,
    });
    expect(r).toEqual({ vibe: "a slow weekend braise", cadence_days: 30, meal: "dinner", weather_affinity: ["cold-comfort"] });
  });

  it("classifies a non-dinner meal and DISCARDS its weather bucket (weather is dinner-only)", async () => {
    const lunch = await nameCluster(fakeEnv("a bright grab-and-go grain bowl\ngrill\nlunch"), {
      descriptions: ["grain bowl"],
      cadence_days: null,
    });
    expect(lunch).toEqual({ vibe: "a bright grab-and-go grain bowl", cadence_days: null, meal: "lunch" });
    expect(lunch?.weather_affinity).toBeUndefined();
    const breakfast = await nameCluster(fakeEnv("a lazy weekend pancake stack\nneutral\nBreakfast."), {
      descriptions: ["pancakes"],
      cadence_days: null,
    });
    expect(breakfast?.meal).toBe("breakfast");
  });

  it("an unparseable meal line fails CLOSED to dinner — the suggestion is neither dropped nor an error", async () => {
    const garbage = await nameCluster(fakeEnv("a bright grain bowl\nneutral\nbrunch, probably"), {
      descriptions: ["bowl"],
      cadence_days: null,
    });
    expect(garbage?.meal).toBe("dinner");
    const missing = await nameCluster(fakeEnv("a bright grain bowl\nneutral"), { descriptions: ["bowl"], cadence_days: null });
    expect(missing?.meal).toBe("dinner");
  });

  it("recognizes every bucket label, case/punctuation-insensitively", async () => {
    const grill = await nameCluster(fakeEnv("a smoky backyard cookout\nGrill."), {
      descriptions: ["ribs"],
      cadence_days: null,
    });
    expect(grill?.weather_affinity).toEqual(["grill"]);
    const wet = await nameCluster(fakeEnv("a rainy-day stew\n\"wet\""), { descriptions: ["stew"], cadence_days: null });
    expect(wet?.weather_affinity).toEqual(["wet"]);
  });

  it("defaults to bucketless when the classification line is neutral, missing, or unrecognized", async () => {
    const neutral = await nameCluster(fakeEnv("a bright grain bowl\nneutral"), { descriptions: ["bowl"], cadence_days: null });
    expect(neutral).toEqual({ vibe: "a bright grain bowl", cadence_days: null, meal: "dinner" });
    expect(neutral?.weather_affinity).toBeUndefined();

    const missing = await nameCluster(fakeEnv("a bright grain bowl"), { descriptions: ["bowl"], cadence_days: null });
    expect(missing?.weather_affinity).toBeUndefined();

    const garbage = await nameCluster(fakeEnv("a bright grain bowl\nwho knows"), { descriptions: ["bowl"], cadence_days: null });
    expect(garbage?.weather_affinity).toBeUndefined();
  });

  it("a failed generation call still fails soft to null even though it would have classified a bucket", async () => {
    expect(await nameCluster(throwEnv, { descriptions: ["ribs"], cadence_days: null })).toBeNull();
  });
});

describe("parseMealLabel", () => {
  it("matches the closed set strictly (case/punctuation-insensitive) and fails closed to dinner", () => {
    expect(parseMealLabel("lunch")).toBe("lunch");
    expect(parseMealLabel('"Breakfast."')).toBe("breakfast");
    expect(parseMealLabel("dinner")).toBe("dinner");
    expect(parseMealLabel(undefined)).toBe("dinner");
    expect(parseMealLabel("project")).toBe("dinner"); // never a project vibe
    expect(parseMealLabel("midnight snack")).toBe("dinner");
  });
});

describe("starterVibesFromTaste", () => {
  it("parses one phrase per line into deduped candidates", async () => {
    const env = fakeEnv("- a cozy comforting soup\n2. a simple weeknight pasta\na cozy comforting soup\na bright grain bowl");
    const out = await starterVibesFromTaste(env, "I love soups and quick pastas");
    expect(out.map((v) => v.vibe)).toEqual(["a cozy comforting soup", "a simple weeknight pasta", "a bright grain bowl"]);
    expect(out.every((v) => v.id.length > 0)).toBe(true);
  });

  it("returns [] on blank taste or a model failure", async () => {
    expect(await starterVibesFromTaste(fakeEnv("x y z"), "")).toEqual([]);
    expect(await starterVibesFromTaste(fakeEnv("x y z"), null)).toEqual([]);
    expect(await starterVibesFromTaste(throwEnv, "some taste")).toEqual([]);
  });
});
