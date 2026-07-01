import { describe, it, expect } from "vitest";
import {
  runDiscoverySweep,
  DEFAULT_CONFIG,
  type DiscoveryDeps,
  type SweepCandidate,
  type SweepMember,
  type LogEntry,
  type RecipeContent,
} from "../src/discovery-sweep.js";

// The walled-source PUSH ARM of the sweep (recipe-ingestion / discovery-sweep): a pushed
// candidate arrives with pre-parsed content, so it skips the acquire fetch, is taste-matched
// like any feed candidate, and its inbox row is deleted on a terminal outcome / kept on a
// transient failure. In-memory deps mirror test/discovery-sweep.ts.

const A = [1, 0, 0];
const B = [0, 1, 0];
const ZERO = [0, 0, 0];
const CONFIG = { ...DEFAULT_CONFIG };

function validFm(title: string, source: string, dietary: string[] = []): Record<string, unknown> {
  return {
    title,
    source,
    time_total: 30,
    dietary,
    requires_equipment: [],
    pairs_with: [],
    protein: null,
    cuisine: "american",
    course: ["main"],
    ingredients_key: ["a"],
    perishable_ingredients: [],
    side_search_terms: ["a salad"],
  };
}

interface FakeOpts {
  candidates: SweepCandidate[];
  members: SweepMember[];
  vectors: Record<string, number[]>;
  throwOn?: Set<string>; // description strings whose embed throws (a transient env.AI failure)
}

function makeDeps(opts: FakeOpts) {
  const calls = {
    fetches: 0, // real network acquisitions (a pushed candidate must NOT increment this)
    deleted: [] as string[],
    imported: [] as string[],
    logs: [] as LogEntry[],
  };
  const vec = (t: string) => opts.vectors[t] ?? ZERO;
  const deps: DiscoveryDeps = {
    loadCandidates: async () => opts.candidates,
    loadMembers: async () => opts.members,
    loadCorpusVectors: async () => [],
    embed: async (text) => {
      if (opts.throwOn?.has(text)) throw new Error(`AI down: ${text}`);
      return vec(text);
    },
    embedMany: async (texts) => texts.map(vec),
    acquireContent: async (c) => {
      // Mirror the real dep: a pushed candidate returns its attached content WITHOUT a fetch.
      if (c.content) return { ok: true as const, content: c.content };
      calls.fetches++;
      return {
        ok: true as const,
        content: { title: c.title, ingredients: ["1 a"], instructions: ["do it"] } as RecipeContent,
      };
    },
    classify: async (content, source) => validFm(content.title, source),
    describe: async (fm) => `DESC:${String(fm.title)}`,
    confirmMatches: async (_t, _d, members) => members.map((m) => m.tenant),
    importRecipe: async (fm) => {
      const slug = String(fm.title).toLowerCase().replace(/\s+/g, "-");
      calls.imported.push(slug);
      return slug;
    },
    recordMatches: async () => {},
    recordLog: async (e) => {
      calls.logs.push(e);
    },
    loadRetries: async () => [],
    resolveRow: async () => {},
    bumpRetry: async () => {},
    deletePushed: async (url) => {
      calls.deleted.push(url);
    },
  };
  return { deps, calls };
}

const pushed = (url: string, title: string): SweepCandidate => ({
  url,
  title,
  summary: title,
  source: "NYT Cooking",
  pushed: true,
  origin: "NYT Cooking",
  content: { title, ingredients: ["4 lb short ribs"], instructions: ["braise"] },
});
const member = (tenant: string, over: Partial<SweepMember> = {}): SweepMember => ({
  tenant,
  tasteVector: A,
  favoriteVectors: [],
  rejectVectors: [],
  dietary: [],
  ...over,
});

describe("sweep push arm", () => {
  it("imports a pushed candidate from attached content WITHOUT a fetch, badged pushed/origin", async () => {
    const { deps, calls } = makeDeps({
      candidates: [pushed("https://cooking.nytimes.com/ribs", "Short Ribs")],
      members: [member("casey")],
      vectors: { "Short Ribs — Short Ribs": A, "DESC:Short Ribs": A },
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.imported).toBe(1);
    expect(calls.fetches).toBe(0); // acquire was satisfied from attached content
    const log = calls.logs.find((l) => l.outcome === "imported");
    expect(log?.pushed).toBe(true);
    expect(log?.origin).toBe("NYT Cooking");
    expect(calls.deleted).toEqual(["https://cooking.nytimes.com/ribs"]); // terminal → inbox row removed
  });

  it("taste-matches a pushed candidate like a feed candidate (no match → no_match, row deleted)", async () => {
    const { deps, calls } = makeDeps({
      candidates: [pushed("https://cooking.nytimes.com/duck", "Whole Duck")],
      members: [member("casey")],
      vectors: { "Whole Duck — Whole Duck": B, "DESC:Whole Duck": B }, // orthogonal to taste A
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.imported).toBe(0);
    expect(res.noMatch).toBe(1);
    expect(calls.deleted).toEqual(["https://cooking.nytimes.com/duck"]); // terminal → removed
  });

  it("is not gated by the fetch cap (it spends no fetch)", async () => {
    const { deps } = makeDeps({
      candidates: [pushed("https://cooking.nytimes.com/ribs", "Short Ribs")],
      members: [member("casey")],
      vectors: { "Short Ribs — Short Ribs": A, "DESC:Short Ribs": A },
    });
    const res = await runDiscoverySweep(deps, { ...CONFIG, fetchMaxPerTick: 0 });
    expect(res.imported).toBe(1); // fetchMaxPerTick=0 would defer a feed candidate; a push is exempt
    expect(res.deferred).toBe(0);
  });

  it("keeps the inbox row and writes NO log on a transient failure (retries next tick from stored content)", async () => {
    const { deps, calls } = makeDeps({
      candidates: [pushed("https://cooking.nytimes.com/ribs", "Short Ribs")],
      members: [member("casey")],
      vectors: { "Short Ribs — Short Ribs": A }, // triage passes; the description embed throws
      throwOn: new Set(["DESC:Short Ribs"]),
    });
    const res = await runDiscoverySweep(deps, CONFIG);
    expect(res.failed).toBe(1);
    expect(calls.deleted).toEqual([]); // NOT deleted — the row is the retry state
    expect(calls.logs.length).toBe(0); // no discovery_log spam for a pushed transient failure
  });
});
