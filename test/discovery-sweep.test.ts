import { describe, it, expect } from "vitest";
import {
  runDiscoverySweep,
  matchMembers,
  findDuplicate,
  dietaryOk,
  nearAnyMember,
  DEFAULT_CONFIG,
  type DiscoveryDeps,
  type DiscoveryConfig,
  type SweepCandidate,
  type SweepMember,
  type LogEntry,
  type RecipeContent,
} from "../src/discovery-sweep.js";

// Unit basis vectors → exact cosines (cos(A,A)=1, cos(A,B)=0).
const A = [1, 0, 0];
const B = [0, 1, 0];
const ZERO = [0, 0, 0];

const CONFIG: DiscoveryConfig = { ...DEFAULT_CONFIG, rateCap: 10, classifyMaxPerTick: 25 };

/** A valid main frontmatter the fake classifier returns (dietary overridable for gate tests). */
function validFm(title: string, url: string, dietary: string[] = []): Record<string, unknown> {
  return {
    title,
    source: url,
    pairs_with: [],
    protein: "chicken",
    cuisine: "italian",
    course: ["main"],
    time_total: 30,
    ingredients_key: ["a", "b", "c"],
    dietary,
    season: [],
    tags: [],
    perishable_ingredients: [],
    requires_equipment: [],
    side_search_terms: ["a salad"],
  };
}

interface FakeOpts {
  candidates: SweepCandidate[];
  members: SweepMember[];
  corpus?: Array<{ slug: string; vector: number[] }>;
  /** embed input text → vector (triage text "title — summary" and the description string). */
  vectors: Record<string, number[]>;
  classifyDietary?: Record<string, string[]>; // per-title dietary on the classified recipe
  classifyThrow?: Set<string>; // titles whose classify throws (park)
  acquireNull?: Set<string>; // urls whose content is unreachable
  confirm?: (members: SweepMember[]) => string[]; // default: confirm all
  embedThrow?: Set<string>; // embed input texts that throw (a transient env.AI failure)
}

function makeDeps(opts: FakeOpts) {
  const calls = { classify: 0, imported: [] as string[], logs: [] as LogEntry[], matches: {} as Record<string, unknown> };
  const vec = (t: string) => opts.vectors[t] ?? ZERO;
  const deps: DiscoveryDeps = {
    loadCandidates: async () => opts.candidates,
    loadMembers: async () => opts.members,
    loadCorpusVectors: async () => opts.corpus ?? [],
    embed: async (text) => {
      if (opts.embedThrow?.has(text)) throw new Error(`AI down: ${text}`);
      return vec(text);
    },
    acquireContent: async (c) =>
      opts.acquireNull?.has(c.url)
        ? null
        : ({ title: c.title, ingredients: ["1 a", "2 b"], instructions: ["do it"] } as RecipeContent),
    classify: async (content, source) => {
      calls.classify++;
      if (opts.classifyThrow?.has(content.title)) throw new Error("validation_failed: off-vocab");
      return validFm(content.title, source, opts.classifyDietary?.[content.title] ?? []);
    },
    describe: async (fm) => `DESC:${String(fm.title)}`,
    confirmMatches: async (_t, _d, members) => (opts.confirm ? opts.confirm(members) : members.map((m) => m.tenant)),
    importRecipe: async (fm) => {
      const slug = String(fm.title).toLowerCase().replace(/\s+/g, "-");
      calls.imported.push(slug);
      return slug;
    },
    recordMatches: async (slug, attrs) => {
      calls.matches[slug] = attrs;
    },
    recordLog: async (e) => {
      calls.logs.push(e);
    },
  };
  return { deps, calls };
}

const cand = (url: string, title: string, summary = "s"): SweepCandidate => ({ url, title, summary, source: "feed" });
const member = (tenant: string, over: Partial<SweepMember> = {}): SweepMember => ({
  tenant,
  tasteVector: A,
  favoriteVectors: [],
  rejectVectors: [],
  dietary: [],
  ...over,
});

describe("pure helpers", () => {
  it("nearAnyMember gates on the looser triage threshold", () => {
    expect(nearAnyMember(A, [member("c")], 0.45)).toBe(true);
    expect(nearAnyMember(B, [member("c")], 0.45)).toBe(false); // orthogonal to taste A
  });
  it("findDuplicate returns the slug at/above δ, else null", () => {
    expect(findDuplicate(A, [{ slug: "dup", vector: A }], 0.9)).toBe("dup");
    expect(findDuplicate(A, [{ slug: "x", vector: B }], 0.9)).toBeNull();
  });
  it("dietaryOk requires every restriction to be satisfied", () => {
    expect(dietaryOk(["vegan", "vegetarian"], ["vegan"])).toBe(true);
    expect(dietaryOk(["vegetarian"], ["vegan"])).toBe(false);
    expect(dietaryOk([], [])).toBe(true);
  });
  it("matchMembers applies τ, repel, and the dietary gate", () => {
    const m = member("c", { dietary: ["vegan"] });
    // cosine matches (A·A=1) but the recipe isn't vegan → gated, and it's the only member
    const gated = matchMembers(A, ["gluten-free"], [m], CONFIG);
    expect(gated.matches).toEqual([]);
    expect(gated.gatedByDiet).toBe(true);
    // vegan recipe → matches
    const ok = matchMembers(A, ["vegan"], [m], CONFIG);
    expect(ok.matches.map((a) => a.tenant)).toEqual(["c"]);
  });
  it("matchMembers repels a near-duplicate of a member's reject", () => {
    const m = member("c", { rejectVectors: [A] }); // candidate A ≈ a rejected recipe
    expect(matchMembers(A, [], [m], CONFIG).matches).toEqual([]);
  });
});

describe("runDiscoverySweep", () => {
  it("imports a candidate matching a member, with attribution + an imported log entry", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Ragu")],
      members: [member("casey")],
      vectors: { "Ragu — s": A, "DESC:Ragu": A },
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.imported).toBe(1);
    expect(calls.imported).toEqual(["ragu"]);
    expect(calls.matches["ragu"]).toEqual([{ tenant: "casey", score: 1 }]);
    expect(calls.logs.at(-1)).toMatchObject({ outcome: "imported", slug: "ragu" });
  });

  it("drops a near-nobody candidate at triage WITHOUT classifying", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Liver")],
      members: [member("casey")],
      vectors: { "Liver — s": B }, // orthogonal to taste → near nobody
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.noMatch).toBe(1);
    expect(calls.classify).toBe(0); // the whole point: no expensive work on non-matches
    expect(calls.logs[0]).toMatchObject({ outcome: "no_match", detail: { stage: "triage" } });
  });

  it("parks an unreachable candidate (no human to paste)", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Walled")],
      members: [member("casey")],
      vectors: { "Walled — s": A },
      acquireNull: new Set(["u1"]),
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.parked).toBe(1);
    expect(calls.classify).toBe(0);
    expect(calls.logs[0]).toMatchObject({ outcome: "error", detail: { reason: "unreachable" } });
  });

  it("parks a candidate whose classification never validates", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Messy")],
      members: [member("casey")],
      vectors: { "Messy — s": A },
      classifyThrow: new Set(["Messy"]),
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.parked).toBe(1);
    expect(calls.imported).toEqual([]);
    expect(calls.logs[0]).toMatchObject({ outcome: "error" });
  });

  it("skips a near-duplicate of an existing corpus recipe", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Ragu Two")],
      members: [member("casey")],
      corpus: [{ slug: "existing-ragu", vector: A }],
      vectors: { "Ragu Two — s": A, "DESC:Ragu Two": A },
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.duplicate).toBe(1);
    expect(calls.imported).toEqual([]);
    expect(calls.logs[0]).toMatchObject({ outcome: "duplicate", detail: { duplicate_of: "existing-ragu" } });
  });

  it("collapses two same-dish candidates in one tick (intra-sweep dedup)", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Ragu A"), cand("u2", "Ragu B")],
      members: [member("casey")],
      vectors: { "Ragu A — s": A, "DESC:Ragu A": A, "Ragu B — s": A, "DESC:Ragu B": A },
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.imported).toBe(1);
    expect(res.duplicate).toBe(1);
    expect(calls.imported).toEqual(["ragu-a"]);
  });

  it("records dietary_gated when diet removes the only match", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Pork Belly")],
      members: [member("casey", { dietary: ["vegan"] })],
      vectors: { "Pork Belly — s": A, "DESC:Pork Belly": A },
      classifyDietary: { "Pork Belly": [] }, // not vegan
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.dietaryGated).toBe(1);
    expect(calls.imported).toEqual([]);
    expect(calls.logs[0]).toMatchObject({ outcome: "dietary_gated" });
  });

  it("treats a confirm rejection as no_match (negation-aware)", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Cilantro Bomb")],
      members: [member("casey")],
      vectors: { "Cilantro Bomb — s": A, "DESC:Cilantro Bomb": A },
      confirm: () => [], // the LLM confirm refutes the cosine match
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.noMatch).toBe(1);
    expect(calls.imported).toEqual([]);
    expect(calls.logs[0]).toMatchObject({ outcome: "no_match", detail: { stage: "confirm" } });
  });

  it("attributes only the confirmed subset of matched members", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Spicy Stew")],
      members: [member("casey"), member("alex")],
      vectors: { "Spicy Stew — s": A, "DESC:Spicy Stew": A },
      confirm: (members) => members.filter((m) => m.tenant === "alex").map((m) => m.tenant),
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.imported).toBe(1);
    expect(calls.matches["spicy-stew"]).toEqual([{ tenant: "alex", score: 1 }]);
  });

  it("defers imports past the rate cap (no wasted classify on the deferred ones)", async () => {
    // Member taste [1,1,1]; three orthogonal candidate vectors each cos≈0.577 to it (> τ,
    // > triage) but cos 0 to EACH OTHER (< δ) — so all three match yet none dedup-collapse.
    const TT = [1, 1, 1];
    const e1 = [1, 0, 0], e2 = [0, 1, 0], e3 = [0, 0, 1];
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "One"), cand("u2", "Two"), cand("u3", "Three")],
      members: [member("casey", { tasteVector: TT })],
      vectors: {
        "One — s": e1, "DESC:One": e1,
        "Two — s": e2, "DESC:Two": e2,
        "Three — s": e3, "DESC:Three": e3,
      },
    });
    const res = await runDiscoverySweep(deps, { ...CONFIG, rateCap: 2 });
    expect(res.imported).toBe(2);
    expect(res.deferred).toBe(1);
    expect(calls.classify).toBe(2); // the deferred candidate was never classified
  });

  it("bounds classify calls by classifyMaxPerTick", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "One"), cand("u2", "Two")],
      members: [member("casey")],
      // both near-anybody at triage, but neither matches at the description stage (desc=ZERO)
      vectors: { "One — s": A, "Two — s": A },
    });
    const res = await runDiscoverySweep(deps, { ...CONFIG, classifyMaxPerTick: 1 });
    expect(calls.classify).toBe(1);
    expect(res.deferred).toBe(1);
  });

  it("parks a candidate on a transient AI failure without crashing the whole tick", async () => {
    // The first candidate's triage embed throws (an env.AI hiccup); the sweep must park it
    // and keep going, not abandon the rest of the batch.
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Boom"), cand("u2", "Ok")],
      members: [member("casey")],
      vectors: { "Ok — s": A, "DESC:Ok": A },
      embedThrow: new Set(["Boom — s"]),
    });
    const res = await runDiscoverySweep(deps, CONFIG); // must NOT reject
    expect(res.parked).toBe(1);
    expect(res.imported).toBe(1);
    expect(calls.imported).toEqual(["ok"]);
    expect(calls.logs.some((l) => l.title === "Boom" && l.outcome === "error")).toBe(true);
  });
});
