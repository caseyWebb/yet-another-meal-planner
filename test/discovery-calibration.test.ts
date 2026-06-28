import { describe, it, expect } from "vitest";
import {
  computeAnalysis,
  buildDryRunDeps,
  validateDiscoveryConfig,
  loadDiscoveryConfig,
  FLOOR_TASTE,
  FLOOR_DEDUP,
  CEILING_RATE_CAP,
} from "../src/discovery-calibration.js";
import {
  DEFAULT_CONFIG,
  runDiscoverySweep,
  type DiscoveryConfig,
  type DiscoveryDeps,
  type SweepCandidate,
  type SweepMember,
  type LogEntry,
  type RecipeContent,
} from "../src/discovery-sweep.js";
import type { Env } from "../src/env.js";

// Unit basis vectors — cos(A,A)=1, cos(A,B)=0, cos(A,C)=0, cos(B,C)=0.
const A = [1, 0, 0];
const B = [0, 1, 0];
const C = [0, 0, 1];
const ZERO = [0, 0, 0];

const CONFIG: DiscoveryConfig = { ...DEFAULT_CONFIG };

// --- 3.2: computeAnalysis (the pure core of analyzeThresholds) ---------------

describe("computeAnalysis (δ pair counting)", () => {
  it("counts zero pairs when all vectors are orthogonal (cosine=0 < δ=0.9)", () => {
    const corpus: Array<[string, number[]]> = [
      ["r-a", A],
      ["r-b", B],
      ["r-c", C],
    ];
    const result = computeAnalysis(corpus, [], CONFIG);
    expect(result.deltaPairCount).toBe(0);
    expect(result.deltaBounded).toBe(false);
    expect(result.deltaCorpusSize).toBe(3);
  });

  it("counts a pair when two vectors are identical (cosine=1 ≥ δ)", () => {
    const corpus: Array<[string, number[]]> = [
      ["r-a", A],
      ["r-a2", A],
      ["r-b", B],
    ];
    const result = computeAnalysis(corpus, [], CONFIG);
    // A and A2 are identical → 1 pair
    expect(result.deltaPairCount).toBe(1);
  });

  it("surfaces the highest-cosine pair first in deltaTopPairs", () => {
    const corpus: Array<[string, number[]]> = [
      ["r-a", A],
      ["r-a2", A], // identical → cosine 1.0
      ["r-b", B],
    ];
    const result = computeAnalysis(corpus, [], CONFIG);
    expect(result.deltaTopPairs[0].cosine).toBeCloseTo(1.0);
    expect([result.deltaTopPairs[0].slugA, result.deltaTopPairs[0].slugB].sort()).toEqual(["r-a", "r-a2"]);
  });

  it("reports bounded=true when corpus exceeds DELTA_MAX_CORPUS (500)", () => {
    // Build 501 orthonormal basis vectors (padded with zeros in a 501-D space).
    const big: Array<[string, number[]]> = Array.from({ length: 501 }, (_, i) => {
      const v = new Array<number>(501).fill(0);
      v[i] = 1;
      return [`r${i}`, v];
    });
    const result = computeAnalysis(big, [], CONFIG);
    expect(result.deltaBounded).toBe(true);
    expect(result.deltaCorpusSize).toBe(500);
  });
});

describe("computeAnalysis (per-member τ counts)", () => {
  const memberWithTaste: SweepMember = {
    tenant: "alice",
    tasteVector: A, // matches anything near A
    favoriteVectors: [],
    rejectVectors: [],
    dietary: [],
  };

  const memberWithFav: SweepMember = {
    tenant: "bob",
    tasteVector: null,
    favoriteVectors: [B], // matches anything near B
    rejectVectors: [],
    dietary: [],
  };

  const coldMember: SweepMember = {
    tenant: "carol",
    tasteVector: null,
    favoriteVectors: [],
    rejectVectors: [],
    dietary: [],
  };

  it("counts corpus recipes matching a member at τ via tasteVector", () => {
    const corpus: Array<[string, number[]]> = [
      ["r-a", A], // near alice's taste vector
      ["r-b", B], // not near alice's taste vector
    ];
    const result = computeAnalysis(corpus, [memberWithTaste], CONFIG);
    const alice = result.memberTau.find((m) => m.tenant === "alice")!;
    // A • A = 1.0 ≥ τ=0.55 → match; B • A = 0.0 < τ → no match
    expect(alice.matchCount).toBe(1);
    expect(alice.coldStart).toBe(false);
  });

  it("counts corpus recipes matching a member at τ via favoriteVectors", () => {
    const corpus: Array<[string, number[]]> = [
      ["r-a", A],
      ["r-b", B], // bob has B as a favorite → fav affinity with B-like recipes
    ];
    const result = computeAnalysis(corpus, [memberWithFav], CONFIG);
    const bob = result.memberTau.find((m) => m.tenant === "bob")!;
    expect(bob.matchCount).toBe(1);
    expect(bob.coldStart).toBe(false);
  });

  it("flags a cold-start member (no favorites, no taste vector) with matchCount=0 and coldStart=true", () => {
    const corpus: Array<[string, number[]]> = [["r-a", A]];
    const result = computeAnalysis(corpus, [coldMember], CONFIG);
    const carol = result.memberTau.find((m) => m.tenant === "carol")!;
    expect(carol.coldStart).toBe(true);
    // No taste signal → bestTasteCosine uses 0-vector → no match
    expect(carol.matchCount).toBe(0);
  });

  it("no AI dep is invoked (the function is pure arithmetic over provided vectors)", () => {
    // computeAnalysis takes no env and has no async calls — calling it with only
    // in-memory data is the proof (it would not compile without an env argument if it
    // needed AI). Verified structurally: no env parameter, synchronous result.
    const result = computeAnalysis([], [], CONFIG);
    expect(result).toBeDefined();
  });
});

// --- 4.2: buildDryRunDeps (no writes) ----------------------------------------

function makeFakeDeps(opts: {
  candidates: SweepCandidate[];
  members: SweepMember[];
  corpus?: Array<{ slug: string; vector: number[] }>;
  vectors: Record<string, number[]>;
}): DiscoveryDeps {
  const vec = (t: string) => opts.vectors[t] ?? ZERO;
  return {
    loadCandidates: async () => opts.candidates,
    loadMembers: async () => opts.members,
    loadCorpusVectors: async () => opts.corpus ?? [],
    embed: async (text) => vec(text),
    embedMany: async (texts) => texts.map(vec),
    acquireContent: async (c) => ({
      ok: true as const,
      content: {
        title: c.title,
        ingredients: ["1 thing"],
        instructions: ["do it"],
      } as RecipeContent,
    }),
    classify: async (content) => ({
      title: content.title,
      source: "https://example.com/r",
      pairs_with: [],
      protein: "chicken",
      cuisine: "italian",
      course: ["main"],
      time_total: 30,
      ingredients_key: ["thing"],
      dietary: [],
      season: [],
      tags: [],
      perishable_ingredients: [],
      requires_equipment: [],
      side_search_terms: [],
    }),
    describe: async (fm) => `DESC:${String(fm.title)}`,
    confirmMatches: async (_t, _d, members) => members.map((m) => m.tenant),
    importRecipe: async () => "real-import-slug",
    recordMatches: async () => {},
    recordLog: async () => {},
  };
}

describe("buildDryRunDeps (no-write dry run)", () => {
  const member: SweepMember = {
    tenant: "alice",
    tasteVector: A,
    favoriteVectors: [],
    rejectVectors: [],
    dietary: [],
  };
  const candidate: SweepCandidate = {
    url: "https://example.com/pasta",
    title: "Pasta",
    summary: "tasty",
    source: "feed",
  };
  const triageText = "Pasta — tasty";
  const descText = "DESC:Pasta";

  it("dry-run produces the same outcome as the real run would (imported)", async () => {
    const realDeps = makeFakeDeps({
      candidates: [candidate],
      members: [member],
      vectors: {
        [triageText]: A, // triage passes (near alice's taste)
        [descText]: A,   // description near alice's taste
      },
    });
    const { deps, capturedOutcomes } = buildDryRunDeps(realDeps);
    const result = await runDiscoverySweep(deps, CONFIG);
    const outcomes = capturedOutcomes();
    // The real run would import this → dry run records it as "imported" too.
    expect(result.imported).toBe(1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("imported");
    expect(outcomes[0].url).toBe("https://example.com/pasta");
  });

  it("dry-run records no_match for a candidate that doesn't pass triage", async () => {
    const realDeps = makeFakeDeps({
      candidates: [candidate],
      members: [member],
      vectors: {
        [triageText]: B, // triage fails (B is orthogonal to alice's taste A)
        [descText]: A,
      },
    });
    const { deps, capturedOutcomes } = buildDryRunDeps(realDeps);
    await runDiscoverySweep(deps, CONFIG);
    const outcomes = capturedOutcomes();
    expect(outcomes[0].outcome).toBe("no_match");
  });

  it("importRecipe in dry-run does NOT call the real importRecipe (write is stubbed)", async () => {
    let realImportCalled = false;
    const realDeps = makeFakeDeps({
      candidates: [candidate],
      members: [member],
      vectors: { [triageText]: A, [descText]: A },
    });
    // Override importRecipe to track if it was called.
    const trackingDeps: DiscoveryDeps = {
      ...realDeps,
      importRecipe: async (...args) => {
        realImportCalled = true;
        return realDeps.importRecipe(...args);
      },
    };
    const { deps, capturedOutcomes } = buildDryRunDeps(trackingDeps);
    await runDiscoverySweep(deps, CONFIG);
    const outcomes = capturedOutcomes();
    // The dry-run's importRecipe stub ran (outcome = imported), but the real importRecipe was NOT called.
    expect(outcomes[0].outcome).toBe("imported");
    expect(realImportCalled).toBe(false);
  });

  it("recordMatches in dry-run does NOT propagate to real deps (no D1 write)", async () => {
    let realMatchesCalled = false;
    const realDeps = makeFakeDeps({
      candidates: [candidate],
      members: [member],
      vectors: { [triageText]: A, [descText]: A },
    });
    const trackingDeps: DiscoveryDeps = {
      ...realDeps,
      recordMatches: async (...args) => {
        realMatchesCalled = true;
        return realDeps.recordMatches(...args);
      },
    };
    const { deps } = buildDryRunDeps(trackingDeps);
    await runDiscoverySweep(deps, CONFIG);
    expect(realMatchesCalled).toBe(false);
  });

  it("recordLog in dry-run does NOT propagate to real deps (no D1 write)", async () => {
    const realLogs: LogEntry[] = [];
    const realDeps = makeFakeDeps({
      candidates: [candidate],
      members: [member],
      vectors: { [triageText]: A, [descText]: A },
    });
    const trackingDeps: DiscoveryDeps = {
      ...realDeps,
      recordLog: async (entry) => { realLogs.push(entry); },
    };
    const { deps, capturedOutcomes } = buildDryRunDeps(trackingDeps);
    await runDiscoverySweep(deps, CONFIG);
    // Real log NOT written; outcomes captured in memory.
    expect(realLogs).toHaveLength(0);
    expect(capturedOutcomes()).toHaveLength(1);
  });
});

// --- 5.1: validateDiscoveryConfig (footgun guard) ----------------------------

describe("validateDiscoveryConfig (range checks)", () => {
  it("accepts valid values", () => {
    expect(validateDiscoveryConfig({ tasteThreshold: 0.6, dedupThreshold: 0.85, rateCap: 10 }).error).toBeNull();
  });

  it("rejects tasteThreshold <= 0", () => {
    const r = validateDiscoveryConfig({ tasteThreshold: 0 });
    expect(r.error?.code).toBe("validation_failed");
    expect(r.error?.context.field).toBe("tasteThreshold");
  });

  it("rejects tasteThreshold > 1", () => {
    expect(validateDiscoveryConfig({ tasteThreshold: 1.1 }).error).not.toBeNull();
  });

  it("rejects triageThreshold out of range", () => {
    expect(validateDiscoveryConfig({ triageThreshold: 1.5 }).error).not.toBeNull();
  });

  it("rejects dedupThreshold out of range", () => {
    expect(validateDiscoveryConfig({ dedupThreshold: -0.1 }).error).not.toBeNull();
  });

  it("rejects classifyMaxPerTick = 0 (non-positive)", () => {
    expect(validateDiscoveryConfig({ classifyMaxPerTick: 0 }).error).not.toBeNull();
  });

  it("rejects classifyMaxPerTick as non-integer", () => {
    expect(validateDiscoveryConfig({ classifyMaxPerTick: 1.5 }).error).not.toBeNull();
  });

  it("rejects rateCap = 0", () => {
    expect(validateDiscoveryConfig({ rateCap: 0 }).error).not.toBeNull();
  });
});

describe("validateDiscoveryConfig (floor/ceiling guards)", () => {
  it("rejects tasteThreshold at/below FLOOR without confirm", () => {
    const r = validateDiscoveryConfig({ tasteThreshold: FLOOR_TASTE });
    expect(r.error?.code).toBe("validation_failed");
    expect(r.error?.context.needsConfirm).toBe(true);
    expect(r.error?.context.floor).toBe(FLOOR_TASTE);
  });

  it("allows tasteThreshold at/below FLOOR with confirm=true", () => {
    const r = validateDiscoveryConfig({ tasteThreshold: FLOOR_TASTE }, { confirm: true });
    expect(r.error).toBeNull();
  });

  it("rejects dedupThreshold at/below FLOOR_DEDUP without confirm", () => {
    const r = validateDiscoveryConfig({ dedupThreshold: FLOOR_DEDUP });
    expect(r.error?.code).toBe("validation_failed");
    expect(r.error?.context.field).toBe("dedupThreshold");
    expect(r.error?.context.needsConfirm).toBe(true);
  });

  it("allows dedupThreshold at/below FLOOR_DEDUP with confirm=true", () => {
    expect(validateDiscoveryConfig({ dedupThreshold: FLOOR_DEDUP }, { confirm: true }).error).toBeNull();
  });

  it("rejects rateCap at/above CEILING_RATE_CAP without confirm", () => {
    const r = validateDiscoveryConfig({ rateCap: CEILING_RATE_CAP });
    expect(r.error?.code).toBe("validation_failed");
    expect(r.error?.context.field).toBe("rateCap");
    expect(r.error?.context.needsConfirm).toBe(true);
  });

  it("allows rateCap at/above CEILING_RATE_CAP with confirm=true", () => {
    expect(validateDiscoveryConfig({ rateCap: CEILING_RATE_CAP }, { confirm: true }).error).toBeNull();
  });

  it("always rejects range violations even with confirm=true", () => {
    expect(validateDiscoveryConfig({ tasteThreshold: 2.0 }, { confirm: true }).error).not.toBeNull();
    expect(validateDiscoveryConfig({ rateCap: -5 }, { confirm: true }).error).not.toBeNull();
  });
});

// --- 2.1/2.2: loadDiscoveryConfig (merge over defaults) ----------------------

function makeConfigD1(row: {
  taste_threshold?: number | null;
  triage_threshold?: number | null;
  dedup_threshold?: number | null;
  classify_max?: number | null;
  rate_cap?: number | null;
} | null): Env["DB"] {
  return {
    prepare: (sql: string) => {
      const stmt = {
        bind: (..._args: unknown[]) => stmt,
        async first<T>() {
          if (/FROM discovery_config/.test(sql)) return (row ?? null) as T | null;
          return null as T | null;
        },
        async all<T>() {
          return { results: [] as T[], success: true as const, meta: { changes: 0 } };
        },
        async run() {
          return { success: true as const, meta: { changes: 0 } };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
    async batch() { return []; },
  } as unknown as Env["DB"];
}

describe("loadDiscoveryConfig (sparse merge over DEFAULT_CONFIG)", () => {
  it("returns DEFAULT_CONFIG when no row exists", async () => {
    const env = { DB: makeConfigD1(null) } as unknown as Env;
    const config = await loadDiscoveryConfig(env);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns DEFAULT_CONFIG when row is all nulls", async () => {
    const env = { DB: makeConfigD1({ taste_threshold: null, triage_threshold: null, dedup_threshold: null, classify_max: null, rate_cap: null }) } as unknown as Env;
    const config = await loadDiscoveryConfig(env);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("applies a sparse override (only set knobs change)", async () => {
    const env = { DB: makeConfigD1({ taste_threshold: 0.7, triage_threshold: null, dedup_threshold: null, classify_max: null, rate_cap: 5 }) } as unknown as Env;
    const config = await loadDiscoveryConfig(env);
    expect(config.tasteThreshold).toBe(0.7);
    expect(config.rateCap).toBe(5);
    // Unset knobs fall back to defaults.
    expect(config.triageThreshold).toBe(DEFAULT_CONFIG.triageThreshold);
    expect(config.dedupThreshold).toBe(DEFAULT_CONFIG.dedupThreshold);
    expect(config.classifyMaxPerTick).toBe(DEFAULT_CONFIG.classifyMaxPerTick);
  });

  it("ignores an out-of-range row value and falls back to the default (defensive read)", async () => {
    const env = { DB: makeConfigD1({ taste_threshold: 2.5 }) } as unknown as Env; // out of (0,1]
    const config = await loadDiscoveryConfig(env);
    expect(config.tasteThreshold).toBe(DEFAULT_CONFIG.tasteThreshold);
  });
});
