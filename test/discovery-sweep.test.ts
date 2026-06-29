import { describe, it, expect } from "vitest";
import {
  runDiscoverySweep,
  matchMembers,
  findDuplicate,
  dietaryOk,
  nearAnyMember,
  isLikelyNonRecipeLink,
  selectFeedBatch,
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
  acquireNull?: Set<string>; // urls whose content can't be acquired (parks as `unreachable`)
  acquireFail?: Record<string, { reason: "unreachable" | "no_jsonld" | "not_a_recipe" | "incomplete"; status?: number }>; // urls that fail acquisition with a SPECIFIC reason
  confirm?: (members: SweepMember[]) => string[]; // default: confirm all
  embedThrow?: Set<string>; // embed input texts that throw (a transient env.AI failure)
}

function makeDeps(opts: FakeOpts) {
  const calls = {
    classify: 0,
    embedMany: 0,
    acquire: 0,
    imported: [] as string[],
    logs: [] as LogEntry[],
    matches: {} as Record<string, unknown>,
  };
  const vec = (t: string) => opts.vectors[t] ?? ZERO;
  const deps: DiscoveryDeps = {
    loadCandidates: async () => opts.candidates,
    loadMembers: async () => opts.members,
    loadCorpusVectors: async () => opts.corpus ?? [],
    embed: async (text) => {
      if (opts.embedThrow?.has(text)) throw new Error(`AI down: ${text}`);
      return vec(text);
    },
    embedMany: async (texts) => {
      calls.embedMany++;
      for (const t of texts) if (opts.embedThrow?.has(t)) throw new Error(`AI down: ${t}`);
      return texts.map(vec);
    },
    acquireContent: async (c) => {
      calls.acquire++;
      const fail = opts.acquireFail?.[c.url];
      if (fail) return { ok: false as const, ...fail };
      if (opts.acquireNull?.has(c.url)) return { ok: false as const, reason: "unreachable" as const };
      return {
        ok: true as const,
        content: { title: c.title, ingredients: ["1 a", "2 b"], instructions: ["do it"] } as RecipeContent,
      };
    },
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
    loadRetries: async () => [],
    resolveRow: async () => {},
    bumpRetry: async () => {},
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
  it("isLikelyNonRecipeLink drops social/transactional links, keeps recipe URLs", () => {
    expect(isLikelyNonRecipeLink("https://facebook.com/share/123")).toBe(true);
    expect(isLikelyNonRecipeLink("https://www.instagram.com/p/abc")).toBe(true);
    expect(isLikelyNonRecipeLink("https://list.example.com/unsubscribe/xyz")).toBe(true);
    expect(isLikelyNonRecipeLink("https://example.com/account")).toBe(true);
    expect(isLikelyNonRecipeLink("not a url")).toBe(true);
    expect(isLikelyNonRecipeLink("https://smittenkitchen.com/2026/06/ragu")).toBe(false);
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

  it("parks with the SPECIFIC acquisition reason, not a catch-all unreachable", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Roundup")],
      members: [member("casey")],
      vectors: { "Roundup — s": A },
      acquireFail: { u1: { reason: "not_a_recipe" } },
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.parked).toBe(1);
    expect(calls.classify).toBe(0);
    expect(calls.logs[0]).toMatchObject({ outcome: "error", detail: { reason: "not_a_recipe" } });
  });

  it("records the HTTP status when a fetch is non-2xx (walled)", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Walled")],
      members: [member("casey")],
      vectors: { "Walled — s": A },
      acquireFail: { u1: { reason: "unreachable", status: 403 } },
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.parked).toBe(1);
    expect(calls.logs[0]).toMatchObject({ outcome: "error", detail: { reason: "unreachable", status: 403 } });
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

  it("records an INFRA failure (not a content park) on a transient AI error, without crashing the tick", async () => {
    // A candidate's DESCRIPTION embed throws (an env.AI hiccup mid-pipeline, after the batched
    // triage); the sweep must drop just that candidate and keep going. It is a `failed` (infra)
    // outcome, distinct from a content `error` park — so it can flip the job's health.
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "Boom"), cand("u2", "Ok")],
      members: [member("casey")],
      vectors: { "Boom — s": A, "Ok — s": A, "DESC:Ok": A },
      embedThrow: new Set(["DESC:Boom"]),
    });
    const res = await runDiscoverySweep(deps, CONFIG); // must NOT reject
    expect(res.failed).toBe(1);
    expect(res.parked).toBe(0);
    expect(res.imported).toBe(1);
    expect(calls.imported).toEqual(["ok"]);
    expect(calls.logs.some((l) => l.title === "Boom" && l.outcome === "failed")).toBe(true);
  });

  it("triages a small pool in one chunked embed call", async () => {
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "One"), cand("u2", "Two"), cand("u3", "Three")],
      members: [member("casey")],
      vectors: {
        "One — s": A, "DESC:One": A,
        "Two — s": A, "DESC:Two": A,
        "Three — s": A, "DESC:Three": A,
      },
    });
    await runDiscoverySweep(deps, CONFIG);
    expect(calls.embedMany).toBe(1); // 3 ≤ EMBED_INPUT_BATCH → one chunk, not one call per candidate
  });

  it("chunks triage embeds at the input-batch size for a large pool", async () => {
    // > EMBED_INPUT_BATCH (25): must take ceil(N/25) chunks, NOT one oversized call (which
    // would exceed the model input limit and — since a batch failure fails the tick — wedge it).
    const N = 30;
    const candidates = Array.from({ length: N }, (_, i) => cand(`u${i}`, `R${i}`));
    const vectors: Record<string, number[]> = {};
    for (const c of candidates) vectors[`${c.title} — s`] = B; // orthogonal → all fail triage cheaply
    const { deps, calls } = makeDeps({ candidates, members: [member("casey")], vectors });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(calls.embedMany).toBe(2); // ceil(30 / 25)
    expect(res.noMatch).toBe(N);
  });

  it("clamps the per-tick pool, deferring the overflow to later ticks", async () => {
    const N = 5;
    const candidates = Array.from({ length: N }, (_, i) => cand(`u${i}`, `R${i}`));
    const vectors: Record<string, number[]> = {};
    for (const c of candidates) vectors[`${c.title} — s`] = B; // all fail triage (kept cheap)
    const { deps } = makeDeps({ candidates, members: [member("casey")], vectors });
    const res = await runDiscoverySweep(deps, { ...CONFIG, maxCandidatesPerTick: 2 });
    expect(res.processed).toBe(2); // only the clamped pool is considered
    expect(res.deferred).toBe(3); // the overflow defers, un-evaluated, for a later tick
  });

  it("propagates a batch triage-embed failure so the whole tick retries next run", async () => {
    // A transient env.AI outage fails the batched embed; the sweep must reject WITHOUT logging
    // any candidate, so the pool stays un-evaluated and re-gathers next tick (never mislabeled).
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "X"), cand("u2", "Y")],
      members: [member("casey")],
      vectors: {},
      embedThrow: new Set(["X — s"]),
    });
    await expect(runDiscoverySweep(deps, CONFIG)).rejects.toThrow();
    expect(calls.logs).toEqual([]);
  });

  it("bounds external fetches by fetchMaxPerTick, deferring survivors it can't fetch", async () => {
    // Both clear triage and would be fetched, but the fetch budget is 1 — so only one is
    // fetched (parks as unreachable); the other defers without ever spending a fetch. Proves
    // the governor counts FETCHES (the scarce subrequest), not just successful classifies.
    const { deps, calls } = makeDeps({
      candidates: [cand("u1", "P1"), cand("u2", "P2")],
      members: [member("casey")],
      vectors: { "P1 — s": A, "P2 — s": A },
      acquireNull: new Set(["u1", "u2"]),
    });
    const res = await runDiscoverySweep(deps, { ...CONFIG, fetchMaxPerTick: 1 });
    expect(calls.acquire).toBe(1);
    expect(res.parked).toBe(1);
    expect(res.deferred).toBe(1);
  });
});

describe("selectFeedBatch — feed-poll rotation (#54)", () => {
  const feeds = ["a", "b", "c", "d", "e"]; // stand-ins for url-sorted feeds

  it("returns at most k and advances the cursor", () => {
    const { batch, nextCursor } = selectFeedBatch(feeds, 0, 2);
    expect(batch).toEqual(["a", "b"]);
    expect(nextCursor).toBe(2);
  });

  it("wraps around the end of the list", () => {
    const { batch, nextCursor } = selectFeedBatch(feeds, 4, 3);
    expect(batch).toEqual(["e", "a", "b"]);
    expect(nextCursor).toBe(2);
  });

  it("polls k >= n as the whole list, returning to the same start", () => {
    const { batch, nextCursor } = selectFeedBatch(feeds, 1, 10);
    expect(batch).toEqual(["b", "c", "d", "e", "a"]);
    expect(nextCursor).toBe(1);
  });

  it("covers every feed over successive ticks with no starvation", () => {
    const seen = new Set<string>();
    let cursor = 0;
    for (let tick = 0; tick < 3; tick++) {
      const r = selectFeedBatch(feeds, cursor, 2);
      r.batch.forEach((f) => seen.add(f));
      cursor = r.nextCursor;
    }
    expect(seen).toEqual(new Set(feeds)); // 3 ticks × 2 ≥ 5 feeds
  });

  it("reaches a newly added (add-only) feed within a bounded number of ticks", () => {
    const grown = [...feeds, "f", "g"]; // 7 feeds
    const seen = new Set<string>();
    let cursor = 0;
    for (let tick = 0; tick < Math.ceil(grown.length / 2); tick++) {
      const r = selectFeedBatch(grown, cursor, 2);
      r.batch.forEach((f) => seen.add(f));
      cursor = r.nextCursor;
    }
    expect(seen.has("g")).toBe(true);
  });

  it("normalizes a lost/garbage/negative/out-of-range cursor", () => {
    expect(selectFeedBatch(feeds, Number.NaN, 2).batch).toEqual(["a", "b"]); // cold start
    expect(selectFeedBatch(feeds, -1, 2).batch).toEqual(["e", "a"]); // -1 → index 4
    expect(selectFeedBatch(feeds, 12, 1).batch).toEqual(["c"]); // 12 mod 5 = 2
  });

  it("handles an empty feed set and a non-positive k", () => {
    expect(selectFeedBatch([], 3, 2)).toEqual({ batch: [], nextCursor: 0 });
    expect(selectFeedBatch(feeds, 0, 0)).toEqual({ batch: [], nextCursor: 0 });
  });
});
