import { describe, it, expect } from "vitest";
import { reconcileNormalization, validateCanonicalId, type NormalizeDeps } from "../src/ingredient-normalize.js";
import { validateConfirm, type IdentityConfirm, type ScoredCandidate } from "../src/ingredient-classify.js";
import type {
  Resolution,
  CoResolutionPair,
  CoResolutionRejection,
  IdentitySourceRow,
  AliasAuditRow,
  EdgeRow,
  NormalizationLog,
  DisjunctionRepairPlan,
} from "../src/corpus-db.js";
import { ToolError } from "../src/errors.js";

type RepairPlan = {
  overflow: string;
  prefix: string;
  shape: "reroot" | "mint";
  prefixNode?: { base: string; detail: string; search_term: string; concrete: boolean };
};

type Harness = {
  deps: NormalizeDeps;
  committed: Resolution[];
  deferred: string[];
  merges: { loser: string; survivor: string }[];
  /** Embeddings the backfill stored (id + vector). */
  stored: { id: string; embedding: number[] }[];
  /** Every text batch handed to `embed` (backfill readable forms + drained terms). */
  embedCalls: string[][];
  confirmCalls: number;
  /** Segment-overflow repair plans (the reroot / mint shapes). */
  repairs: RepairPlan[];
  /** Co-resolution rejections remembered this run. */
  remembered: { a: string; b: string; now: number }[];
  /** Born-stamped membership edges inserted by the disjunction reconcile. */
  insertedEdges: { from: string; to: string; kind: string }[];
  /** Disjunct terms enqueued for capture by the disjunction reconcile. */
  enqueued: string[];
  /** Standalone log rows appended (the membership-edge audit trail). */
  logged: NormalizationLog[];
  /** Disjunction family repair plans applied by the shape sweep. */
  disjunctionRepairs: DisjunctionRepairPlan[];
};

function harness(opts: {
  terms: string[];
  identities?: { id: string; embedding: number[] }[];
  /** Extra existing node ids beyond `identities` (merged losers, unembedded nodes). */
  knownIds?: string[];
  /** Surviving node ids with no stored embedding (the backfill batch). */
  embeddingless?: string[];
  embed?: (texts: string[]) => Promise<number[][]>;
  confirm?: (term: string, candidates: ScoredCandidate[]) => Promise<IdentityConfirm>;
  coPairs?: CoResolutionPair[];
  coConfirm?: (term: string, candidates: ScoredCandidate[]) => Promise<IdentityConfirm>;
  /** Identity rows for the lexical map + segment repair (defaults to `identities` as surviving auto). */
  identitySources?: IdentitySourceRow[];
  /** Alias variants for the lexical map. */
  aliasTargets?: AliasAuditRow[];
  /** Remembered co-resolution rejections. */
  rejections?: CoResolutionRejection[];
  rejectBackoffMs?: number;
  /** The full edge table for the disjunction reconcile's pair check. */
  allEdges?: EdgeRow[];
}): Harness {
  const committed: Resolution[] = [];
  const deferred: string[] = [];
  const merges: { loser: string; survivor: string }[] = [];
  const stored: { id: string; embedding: number[] }[] = [];
  const embedCalls: string[][] = [];
  const repairs: RepairPlan[] = [];
  const remembered: { a: string; b: string; now: number }[] = [];
  const insertedEdges: { from: string; to: string; kind: string }[] = [];
  const enqueued: string[] = [];
  const logged: NormalizationLog[] = [];
  const disjunctionRepairs: DisjunctionRepairPlan[] = [];
  const h = {
    committed,
    deferred,
    merges,
    stored,
    embedCalls,
    confirmCalls: 0,
    repairs,
    remembered,
    insertedEdges,
    enqueued,
    logged,
    disjunctionRepairs,
  } as Harness;
  const embed = opts.embed ?? (async (texts: string[]) => texts.map(() => [1, 0, 0]));
  h.deps = {
    loadBatch: async () => opts.terms,
    // Read-after-write like the real wiring: the backfill stores BEFORE this is read.
    identityEmbeddings: async () => [...(opts.identities ?? []), ...stored].map((i) => ({ ...i })),
    knownIds: async () => new Set([...(opts.identities ?? []).map((i) => i.id), ...(opts.knownIds ?? [])]),
    embeddingless: async (limit) => (opts.embeddingless ?? []).slice(0, limit),
    storeEmbedding: async (id, embedding) => {
      stored.push({ id, embedding });
    },
    embed: async (texts) => {
      embedCalls.push(texts);
      return embed(texts);
    },
    confirm: async (term, candidates) => {
      h.confirmCalls++;
      // The co-resolution pass reuses `confirm`; let a test route it separately when set.
      if (opts.coConfirm && candidates.length === 1 && (opts.coPairs ?? []).some((p) => p.b === candidates[0].id)) {
        return opts.coConfirm(term, candidates);
      }
      if (!opts.confirm) throw new Error("confirm not expected");
      return opts.confirm(term, candidates);
    },
    commit: async (r) => {
      committed.push(r);
    },
    defer: async (t) => {
      deferred.push(t);
    },
    coResolutionPairs: async (limit) => (opts.coPairs ?? []).slice(0, limit),
    merge: async (loser, survivor) => {
      merges.push({ loser, survivor });
    },
    identitySources: async () =>
      (
        opts.identitySources ??
        (opts.identities ?? []).map((i) => ({ id: i.id, representative: null, source: "auto" as const }))
      ).map((r) => ({ ...r })),
    aliasTargets: async () => (opts.aliasTargets ?? []).map((a) => ({ ...a })),
    repairOverflow: async (plan) => {
      repairs.push(plan);
    },
    mergeRejections: async () => (opts.rejections ?? []).map((r) => ({ ...r })),
    rememberRejection: async (a, b, now) => {
      remembered.push({ a, b, now });
    },
    allEdges: async () => (opts.allEdges ?? []).map((e) => ({ ...e })),
    insertEdge: async (from, to, kind) => {
      insertedEdges.push({ from, to, kind });
    },
    enqueue: async (terms) => {
      enqueued.push(...terms);
    },
    log: async (entry) => {
      logged.push(entry);
    },
    applyRepair: async (plan) => {
      disjunctionRepairs.push(plan);
    },
    disjunctionMaxPerTick: 10,
    now: () => 1000,
    maxPerTick: 25,
    floor: 0.5,
    confirmMin: 0.72,
    topK: 10,
    coResolveMaxPerTick: 10,
    embedBackfillMaxPerTick: 25,
    segmentRepairMaxPerTick: 5,
    rejectBackoffMs: opts.rejectBackoffMs ?? 30 * 24 * 60 * 60 * 1000,
  };
  return h;
}

const coPair = (o: Partial<CoResolutionPair> & { a: string; b: string }): CoResolutionPair => ({
  sku: "SKU-1",
  aSource: "auto",
  bSource: "auto",
  aTerm: o.a,
  ...o,
});

const confirm = (o: Partial<IdentityConfirm>): IdentityConfirm => ({
  outcome: "novel",
  match: null,
  detail: null,
  canonical: null,
  concrete: true,
  edges: [],
  reason: "",
  ...o,
});

describe("reconcileNormalization", () => {
  it("mints a NOVEL node below the cosine floor with NO confirm call", async () => {
    const h = harness({
      terms: ["gochujang"],
      identities: [{ id: "olive oil", embedding: [0, 1, 0] }], // orthogonal → cosine 0
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(s).toMatchObject({ novel: 1, processed: 1 });
    expect(h.committed[0]).toMatchObject({ id: "gochujang", node: { base: "gochujang" } });
    expect(h.committed[0].log).toMatchObject({ outcome: "novel", model: null });
  });

  it("SAME merges a synonym to one join key (alias only, no new node)", async () => {
    const h = harness({
      terms: ["scallions"],
      identities: [{ id: "green onion", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "same", match: "green onion" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0]).toMatchObject({ term: "scallions", id: "green onion" });
    expect(h.committed[0].node).toBeUndefined();
  });

  it("SPECIALIZATION preserves the detail + records a general edge, search_term = the term", async () => {
    const h = harness({
      terms: ["80/20 ground beef"],
      identities: [{ id: "ground beef", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "specialization", match: "ground beef", detail: "fat-80-20" }),
    });
    await reconcileNormalization(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("ground beef::fat-80-20");
    expect(r.node).toMatchObject({ base: "ground beef", detail: "fat-80-20", search_term: "80/20 ground beef" });
    expect(r.edges).toContainEqual({ from: "ground beef::fat-80-20", to: "ground beef", kind: "general" });
  });

  it("does NOT merge a distinct-base near neighbor (confirm returns novel)", async () => {
    const h = harness({
      terms: ["baking powder"],
      identities: [{ id: "baking soda", embedding: [1, 0, 0] }], // high cosine, but a distinct product
      confirm: async () => confirm({ outcome: "novel" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0].id).toBe("baking powder"); // its own node, not merged into baking soda
  });

  it("keeps a directional containment edge (whole → thighs, not the reverse)", async () => {
    const h = harness({
      terms: ["chicken thighs"],
      identities: [
        { id: "chicken", embedding: [1, 0, 0] },
        { id: "chicken::whole", embedding: [1, 0, 0] },
      ],
      confirm: async () =>
        confirm({
          outcome: "specialization",
          match: "chicken",
          detail: "thighs",
          edges: [{ from: "chicken::whole", to: "NEW", kind: "containment" }],
        }),
    });
    await reconcileNormalization(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("chicken::thighs");
    expect(r.edges).toContainEqual({ from: "chicken::whole", to: "chicken::thighs", kind: "containment" });
  });

  it("back-links specific varieties to a newly-minted general base (kielbasa → sausage, directional)", async () => {
    const h = harness({
      terms: ["sausage"],
      identities: [
        { id: "kielbasa", embedding: [1, 0, 0] },
        { id: "andouille", embedding: [1, 0, 0] },
      ],
      confirm: async () =>
        confirm({
          outcome: "novel",
          edges: [
            { from: "kielbasa", to: "NEW", kind: "general" },
            { from: "andouille", to: "NEW", kind: "general" },
          ],
        }),
    });
    await reconcileNormalization(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("sausage"); // the general base is its own node, not merged into a variety
    // Each variety → the new base (a specific satisfies the general); never the reverse.
    expect(r.edges).toContainEqual({ from: "kielbasa", to: "sausage", kind: "general" });
    expect(r.edges).toContainEqual({ from: "andouille", to: "sausage", kind: "general" });
  });

  it("defers (re-queues) a term on a transient AI/D1 error, writing nothing", async () => {
    const h = harness({
      terms: ["mystery"],
      identities: [{ id: "olive oil", embedding: [1, 0, 0] }],
      confirm: async () => {
        throw new ToolError("storage_error", "AI down");
      },
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.deferred).toEqual(["mystery"]);
    expect(h.committed).toHaveLength(0);
    expect(s.deferred).toBe(1);
  });

  it("fails safe to NOVEL when the confirm can't satisfy the contract", async () => {
    const h = harness({
      terms: ["weird thing"],
      identities: [{ id: "olive oil", embedding: [1, 0, 0] }],
      confirm: async () => {
        throw new ToolError("validation_failed", "bad output");
      },
    });
    await reconcileNormalization(h.deps);
    expect(h.deferred).toHaveLength(0);
    expect(h.committed[0]).toMatchObject({ id: "weird thing" });
    expect(h.committed[0].log.detail).toMatchObject({ note: "confirm_failed_safe" });
  });

  it("lets a node minted earlier this tick match a later term", async () => {
    const h = harness({
      terms: ["ground beef", "90/10 ground beef"],
      identities: [], // empty: the first term mints the base, the second must see it
      confirm: async () => confirm({ outcome: "specialization", match: "ground beef", detail: "fat-90-10" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(1); // only the second term reaches the confirm
    expect(h.committed[0].id).toBe("ground beef"); // first: below floor (empty registry) → novel
    expect(h.committed[1].id).toBe("ground beef::fat-90-10"); // second matched the fresh node
  });
});

describe("reconcileNormalization — confirm-distance guard", () => {
  it("rejects a pick whose chosen candidate is below the confirm minimum → verbatim NOVEL, logged", async () => {
    const h = harness({
      terms: ["flaky sea salt"],
      identities: [
        { id: "sea salt", embedding: [1, 0, 0] }, // cosine 1 — clears the call floor
        { id: "fish sauce", embedding: [0.6, 0.8, 0] }, // cosine 0.6 — a distant top-K straggler
      ],
      // The classifier collapses onto the DISTANT candidate (the production disaster class).
      confirm: async () => confirm({ outcome: "specialization", match: "fish sauce", detail: "flaky" }),
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.committed[0]).toMatchObject({ term: "flaky sea salt", id: "flaky sea salt" });
    expect(h.committed[0].log.outcome).toBe("novel");
    expect(h.committed[0].log.detail).toMatchObject({
      note: "confirm_below_min",
      rejected: { outcome: "specialization", match: "fish sauce" },
    });
    expect(s).toMatchObject({ novel: 1, specialization: 0 });
  });

  it("applies a pick at or above the confirm minimum unchanged", async () => {
    const h = harness({
      terms: ["scallions"],
      identities: [{ id: "green onion", embedding: [0.8, 0.6, 0] }], // cosine 0.8 ≥ 0.72
      confirm: async () => confirm({ outcome: "same", match: "green onion" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0]).toMatchObject({ term: "scallions", id: "green onion" });
  });

  it("passes the candidates WITH their cosine scores to the confirm", async () => {
    let seen: ScoredCandidate[] = [];
    const h = harness({
      terms: ["scallions"],
      identities: [{ id: "green onion", embedding: [1, 0, 0] }],
      confirm: async (_t, candidates) => {
        seen = candidates;
        return confirm({ outcome: "same", match: "green onion" });
      },
    });
    await reconcileNormalization(h.deps);
    expect(seen).toEqual([{ id: "green onion", score: 1 }]);
  });
});

describe("reconcileNormalization — canonical id for confirmed-novel mints", () => {
  it("mints under the classifier's canonical (noise stripped), aliasing the surface term to it", async () => {
    const h = harness({
      terms: ["quick cooking oats (flavored)"],
      identities: [{ id: "rolled oats", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "quick cooking oats" }),
    });
    await reconcileNormalization(h.deps);
    const r = h.committed[0];
    expect(r).toMatchObject({ term: "quick cooking oats (flavored)", id: "quick cooking oats" });
    expect(r.node).toMatchObject({ base: "quick cooking oats", detail: null, search_term: "quick cooking oats" });
    expect(r.log.resolved_id).toBe("quick cooking oats");
  });

  it("derives base/detail/search term from a base::detail canonical", async () => {
    const h = harness({
      terms: ["steel cut oats (bulk bin)"],
      identities: [{ id: "rolled oats", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "oats::steel-cut" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0].id).toBe("oats::steel-cut");
    expect(h.committed[0].node).toMatchObject({ base: "oats", detail: "steel-cut", search_term: "oats steel-cut" });
  });

  it("falls back to the verbatim term on an invalid canonical (never fails the mint)", async () => {
    const h = harness({
      terms: ["quick cooking oats (flavored)"],
      identities: [{ id: "rolled oats", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "Quick Oats (bag)" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0].id).toBe("quick cooking oats (flavored)"); // pre-change behavior
    expect(h.committed[0].log.detail).toMatchObject({
      canonical_rejected: "Quick Oats (bag)",
      canonical_reason: "invalid",
    });
  });

  it("falls back to the verbatim term when the canonical collides with an existing node id", async () => {
    const h = harness({
      terms: ["fresh rolled oats (new bag)"],
      identities: [{ id: "rolled oats", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "novel", canonical: "rolled oats" }), // collides
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0].id).toBe("fresh rolled oats (new bag)"); // never silently alias via collision
    expect(h.committed[0].log.detail).toMatchObject({ canonical_rejected: "rolled oats", canonical_reason: "collision" });
  });

  it("checks collisions against merged/unembedded ids too (the full known-id set)", async () => {
    const h = harness({
      terms: ["baby courgette (2 pack)"],
      identities: [{ id: "zucchini", embedding: [1, 0, 0] }],
      knownIds: ["courgette"], // merged loser — not in the retrieval set, still an existing id
      confirm: async () => confirm({ outcome: "novel", canonical: "courgette" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0].id).toBe("baby courgette (2 pack)");
    expect(h.committed[0].log.detail).toMatchObject({ canonical_reason: "collision" });
  });

  it("keeps the verbatim mint (no LLM, no canonical) below the floor", async () => {
    const h = harness({
      terms: ["gochujang (family size)"],
      identities: [{ id: "olive oil", embedding: [0, 1, 0] }], // orthogonal → below floor
    });
    await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed[0]).toMatchObject({ id: "gochujang (family size)", node: { base: "gochujang (family size)" } });
  });
});

describe("reconcileNormalization — embedding backfill", () => {
  it("embeds embedding-less nodes before the drain, so they retrieve for this tick's terms", async () => {
    const h = harness({
      terms: ["spanish saffron"],
      identities: [], // "saffron" exists but has NO embedding — invisible without the backfill
      embeddingless: ["saffron"],
      confirm: async (_t, candidates) => {
        expect(candidates).toEqual([{ id: "saffron", score: 1 }]); // backfilled → retrievable
        return confirm({ outcome: "same", match: "saffron" });
      },
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.stored).toEqual([{ id: "saffron", embedding: [1, 0, 0] }]);
    expect(s.embedded).toBe(1);
    expect(h.committed[0]).toMatchObject({ term: "spanish saffron", id: "saffron" }); // no duplicate mint
  });

  it("embeds the readable form of a qualified id (base + detail flattened)", async () => {
    const h = harness({ terms: [], embeddingless: ["chicken::thighs"] });
    await reconcileNormalization(h.deps);
    expect(h.embedCalls[0]).toEqual(["chicken thighs"]);
    expect(h.stored.map((s) => s.id)).toEqual(["chicken::thighs"]);
  });

  it("a backfill embed failure never fails the tick (the drain still runs)", async () => {
    const h = harness({
      terms: ["gochujang"],
      identities: [{ id: "olive oil", embedding: [0, 1, 0] }],
      embeddingless: ["mystery"],
      embed: async (texts) => {
        if (texts.includes("mystery")) throw new Error("AI down");
        return texts.map(() => [1, 0, 0]);
      },
    });
    const s = await reconcileNormalization(h.deps);
    expect(s.embedded).toBe(0);
    expect(h.stored).toHaveLength(0); // rows stay NULL → retried next tick
    expect(s.processed).toBe(1); // gochujang still drained (below floor → novel)
  });

  it("runs even on an empty queue (a human mint becomes retrievable without traffic)", async () => {
    const h = harness({ terms: [], embeddingless: ["saffron"] });
    const s = await reconcileNormalization(h.deps);
    expect(s.embedded).toBe(1);
    expect(h.stored.map((s2) => s2.id)).toEqual(["saffron"]);
  });
});

describe("validateCanonicalId", () => {
  it("accepts a clean base, a base::detail, and trims", () => {
    expect(validateCanonicalId("medjool dates")).toBe("medjool dates");
    expect(validateCanonicalId("ground beef::fat-80-20")).toBe("ground beef::fat-80-20");
    expect(validateCanonicalId("  medjool dates ")).toBe("medjool dates");
  });

  it("rejects empties, noise characters, casing, bad segments, and overlength", () => {
    expect(validateCanonicalId(null)).toBeNull();
    expect(validateCanonicalId("")).toBeNull();
    expect(validateCanonicalId("   ")).toBeNull();
    expect(validateCanonicalId("Medjool Dates")).toBeNull(); // uppercase
    expect(validateCanonicalId("dates (pitted)")).toBeNull(); // parenthetical noise
    expect(validateCanonicalId("dates, pitted")).toBeNull(); // comma
    expect(validateCanonicalId("dates\npitted")).toBeNull(); // newline
    expect(validateCanonicalId("oats::")).toBeNull(); // empty detail segment
    expect(validateCanonicalId("oats:steel-cut")).toBeNull(); // stray single colon
    expect(validateCanonicalId("oats::steel-cut::organic")).toBeNull(); // deeper than base::detail
    expect(validateCanonicalId("a".repeat(65))).toBeNull(); // over the length bound
  });
});

describe("reconcileNormalization — SKU co-resolution merge", () => {
  it("merges two distinct ids sharing a SKU when the confirm says SAME (auto/auto → smaller id survives)", async () => {
    const h = harness({
      terms: [],
      coPairs: [coPair({ a: "courgette", b: "zucchini", aTerm: "courgette" })],
      coConfirm: async () => confirm({ outcome: "same", match: "zucchini" }),
    });
    const s = await reconcileNormalization(h.deps);
    // auto/auto: the lexicographically smaller id ("courgette") survives, "zucchini" merges into it.
    expect(h.merges).toEqual([{ loser: "zucchini", survivor: "courgette" }]);
    expect(s.merged).toBe(1);
  });

  it("makes the human-sourced node the survivor even when it is lexicographically larger", async () => {
    const h = harness({
      terms: [],
      coPairs: [coPair({ a: "courgette", b: "zucchini", aTerm: "courgette", bSource: "human" })],
      coConfirm: async () => confirm({ outcome: "same", match: "zucchini" }),
    });
    await reconcileNormalization(h.deps);
    // B is human → B survives, the auto A is merged away.
    expect(h.merges).toEqual([{ loser: "courgette", survivor: "zucchini" }]);
  });

  it("does NOT merge when the confirm returns novel/specialization (distinct products)", async () => {
    const h = harness({
      terms: [],
      coPairs: [coPair({ a: "chicken broth", b: "vegetable broth", aTerm: "chicken broth" })],
      coConfirm: async () => confirm({ outcome: "novel" }),
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.merges).toHaveLength(0);
    expect(s.merged).toBe(0);
    expect(s.mergeRejected).toBe(1);
  });

  it("does NOT merge when the confirm's match is not the paired id", async () => {
    const h = harness({
      terms: [],
      coPairs: [coPair({ a: "courgette", b: "zucchini", aTerm: "courgette" })],
      coConfirm: async () => confirm({ outcome: "same", match: "something else" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.merges).toHaveLength(0);
  });

  it("skips a both-human pair without confirming or merging (respects operator intent)", async () => {
    const h = harness({
      terms: [],
      coPairs: [coPair({ a: "courgette", b: "zucchini", aSource: "human", bSource: "human" })],
      coConfirm: async () => confirm({ outcome: "same", match: "zucchini" }),
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.merges).toHaveLength(0);
    expect(h.confirmCalls).toBe(0); // never even asked
    expect(s.mergeSkipped).toBe(1);
  });

  it("skips a pair on a transient confirm error but still processes the rest", async () => {
    let call = 0;
    const h = harness({
      terms: [],
      coPairs: [
        coPair({ a: "aaa", b: "bbb", aTerm: "aaa" }),
        coPair({ a: "ccc", b: "ddd", aTerm: "ccc" }),
      ],
      coConfirm: async () => {
        call++;
        if (call === 1) throw new ToolError("storage_error", "AI down");
        return confirm({ outcome: "same", match: "ddd" });
      },
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.merges).toEqual([{ loser: "ddd", survivor: "ccc" }]); // second pair still merged
    expect(s.mergeSkipped).toBe(1);
    expect(s.merged).toBe(1);
  });

  it("does nothing when there are no candidate pairs", async () => {
    const h = harness({ terms: [], coPairs: [] });
    const s = await reconcileNormalization(h.deps);
    expect(h.merges).toHaveLength(0);
    expect(s.merged).toBe(0);
  });
});

describe("reconcileNormalization — specialization segment guard", () => {
  const PREFIX = "salmon fillets, skin-on::species-atlantic-sockeye";

  it("demotes a specialization on an already-detailed match to SAME (the sockeye class)", async () => {
    const h = harness({
      terms: ["atlantic sockeye salmon fillets"],
      identities: [{ id: PREFIX, embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "specialization", match: PREFIX, detail: "species-atlantic-sockeye" }),
    });
    const s = await reconcileNormalization(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe(PREFIX); // never `${PREFIX}::species-atlantic-sockeye`
    expect(r.node).toBeUndefined();
    expect(r.log).toMatchObject({
      outcome: "same",
      resolved_id: PREFIX,
      detail: { note: "specialization_demoted", proposed_detail: "species-atlantic-sockeye" },
    });
    expect(s).toMatchObject({ same: 1, specialization: 0 });
  });

  it("still specializes a detail-less match unchanged (regression)", async () => {
    const h = harness({
      terms: ["80/20 ground beef"],
      identities: [{ id: "ground beef", embedding: [1, 0, 0] }],
      confirm: async () => confirm({ outcome: "specialization", match: "ground beef", detail: "fat-80-20" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.committed[0].id).toBe("ground beef::fat-80-20");
    expect(h.committed[0].node).toBeTruthy();
  });
});

describe("reconcileNormalization — lexical-identity fast path", () => {
  it("resolves a punctuation-only variant SAME with no confirm call", async () => {
    const h = harness({
      terms: ["salmon fillets skin-on"],
      identities: [{ id: "salmon fillets, skin-on", embedding: [1, 0, 0] }],
      // no confirm handler: a classifier call would throw "confirm not expected"
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed[0]).toMatchObject({ term: "salmon fillets skin-on", id: "salmon fillets, skin-on" });
    expect(h.committed[0].node).toBeUndefined();
    expect(h.committed[0].log).toMatchObject({ outcome: "same", model: null, detail: { note: "lexical_match" } });
    expect(s).toMatchObject({ same: 1, lexical: 1 });
  });

  it("matches through an alias variant to its survivor", async () => {
    const h = harness({
      terms: ["green onions."],
      identities: [{ id: "green onion", embedding: [1, 0, 0] }],
      aliasTargets: [{ variant: "green onions.", id: "green onion" }],
    });
    await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed[0].id).toBe("green onion");
  });

  it("skips an ambiguous lexical form (two distinct survivors) — the classifier decides", async () => {
    const h = harness({
      terms: ["skin-on salmon"],
      identities: [
        { id: "skin on salmon", embedding: [1, 0, 0] },
        { id: "skin-on, salmon", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "novel" }),
    });
    await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(1); // ambiguity falls through to the normal confirm flow
  });
});

describe("reconcileNormalization — segment-overflow repair", () => {
  const OV = "salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye";
  const PREFIX = "salmon fillets, skin-on::species-atlantic-sockeye";
  const src = (id: string, representative: string | null = null, source: "auto" | "human" = "auto"): IdentitySourceRow => ({
    id,
    representative,
    source,
    concrete: 1,
  });

  it("REROOTS when the prefix resolves TO the overflow (the live production shape)", async () => {
    const h = harness({
      terms: [],
      identitySources: [src(OV), src(PREFIX, OV), src("salmon fillets, skin-on")],
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.repairs).toEqual([{ overflow: OV, prefix: PREFIX, shape: "reroot" }]);
    expect(h.merges).toHaveLength(0);
    expect(s.segmentRepaired).toBe(1);
  });

  it("merges normally when the prefix survives elsewhere", async () => {
    const h = harness({ terms: [], identitySources: [src(OV), src(PREFIX)] });
    const s = await reconcileNormalization(h.deps);
    expect(h.repairs).toHaveLength(0);
    expect(h.merges).toEqual([{ loser: OV, survivor: PREFIX }]);
    expect(s.segmentRepaired).toBe(1);
  });

  it("mints a missing prefix and points the overflow at it", async () => {
    const h = harness({ terms: [], identitySources: [src(OV)] });
    const s = await reconcileNormalization(h.deps);
    expect(h.repairs).toEqual([
      {
        overflow: OV,
        prefix: PREFIX,
        shape: "mint",
        prefixNode: {
          base: "salmon fillets, skin-on",
          detail: "species-atlantic-sockeye",
          search_term: "salmon fillets, skin-on species-atlantic-sockeye",
          concrete: true,
        },
      },
    ]);
    expect(s.segmentRepaired).toBe(1);
  });

  it("skips human overflow nodes and quiesces on a converged registry", async () => {
    const human = harness({ terms: [], identitySources: [src(OV, null, "human"), src(PREFIX)] });
    const sHuman = await reconcileNormalization(human.deps);
    expect(human.repairs).toHaveLength(0);
    expect(human.merges).toHaveLength(0);
    expect(sHuman).toMatchObject({ segmentRepaired: 0, segmentSkipped: 1 });

    const converged = harness({ terms: [], identitySources: [src(PREFIX), src("olive oil")] });
    const sDone = await reconcileNormalization(converged.deps);
    expect(converged.repairs).toHaveLength(0);
    expect(sDone).toMatchObject({ segmentRepaired: 0, segmentSkipped: 0 });
  });
});

describe("reconcileNormalization — co-resolution rejection memory", () => {
  const pecorino = () => coPair({ a: "parmesan", b: "pecorino romano", aTerm: "parmesan" });

  it("records a rejection once, then suppresses the pair with no confirm call", async () => {
    const first = harness({
      terms: [],
      coPairs: [pecorino()],
      coConfirm: async () => confirm({ outcome: "novel" }),
    });
    const s1 = await reconcileNormalization(first.deps);
    expect(s1).toMatchObject({ mergeRejected: 1, mergeSuppressed: 0 });
    expect(first.remembered).toEqual([{ a: "parmesan", b: "pecorino romano", now: 1000 }]);

    const second = harness({
      terms: [],
      coPairs: [pecorino()],
      rejections: [{ a: "parmesan", b: "pecorino romano", decided_at: 900 }],
      coConfirm: async () => {
        throw new Error("no confirm expected — the pair is suppressed");
      },
    });
    const s2 = await reconcileNormalization(second.deps);
    expect(second.confirmCalls).toBe(0);
    expect(s2).toMatchObject({ mergeSuppressed: 1, mergeRejected: 0 });
    expect(second.remembered).toHaveLength(0);
  });

  it("re-proposes once after the backoff elapses (a re-rejection refreshes the memory)", async () => {
    const h = harness({
      terms: [],
      coPairs: [pecorino()],
      rejections: [{ a: "parmesan", b: "pecorino romano", decided_at: 800 }],
      rejectBackoffMs: 100, // now=1000 → 200 elapsed ≥ 100 → eligible again
      coConfirm: async () => confirm({ outcome: "novel" }),
    });
    const s = await reconcileNormalization(h.deps);
    expect(s).toMatchObject({ mergeRejected: 1, mergeSuppressed: 0 });
    expect(h.remembered).toEqual([{ a: "parmesan", b: "pecorino romano", now: 1000 }]);
  });

  it("a changed survivor re-opens the pair immediately (the memory keys on survivors)", async () => {
    const h = harness({
      terms: [],
      coPairs: [pecorino()],
      rejections: [{ a: "parmesan", b: "pecorino", decided_at: 999 }], // an OLD survivor id
      coConfirm: async () => confirm({ outcome: "novel" }),
    });
    const s = await reconcileNormalization(h.deps);
    expect(s.mergeRejected).toBe(1); // key mismatch → not suppressed
  });

  it("a transient confirm failure records no rejection", async () => {
    const h = harness({
      terms: [],
      coPairs: [pecorino()],
      coConfirm: async () => {
        throw new ToolError("storage_error", "AI down");
      },
    });
    const s = await reconcileNormalization(h.deps);
    expect(s.mergeSkipped).toBe(1);
    expect(h.remembered).toHaveLength(0);
  });
});

describe("validateConfirm", () => {
  const cands = ["ground beef", "green onion"];

  it("accepts a valid specialization", () => {
    const v = validateConfirm({ outcome: "specialization", match: "ground beef", detail: "fat-80-20" }, cands);
    expect(v.ok).toBe(true);
  });

  it("rejects a match that is not among the candidates", () => {
    const v = validateConfirm({ outcome: "same", match: "pork", detail: null }, cands);
    expect(v.ok).toBe(false);
  });

  it("drops an edge whose endpoint is an unknown id (conservative)", () => {
    const v = validateConfirm(
      {
        outcome: "novel",
        match: null,
        detail: null,
        edges: [
          { from: "NEW", to: "green onion", kind: "membership" }, // kept
          { from: "NEW", to: "mystery id", kind: "containment" }, // dropped (unknown endpoint)
        ],
      },
      cands,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.confirm.edges).toEqual([{ from: "NEW", to: "green onion", kind: "membership" }]);
  });

  it("passes canonical through (trimmed) and NEVER fails the contract on a malformed one", () => {
    const v = validateConfirm(
      { outcome: "novel", match: null, detail: null, canonical: "  medjool dates " },
      cands,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.confirm.canonical).toBe("medjool dates");
    // A non-string canonical coerces to null rather than burning a corrective retry.
    const v2 = validateConfirm({ outcome: "novel", match: null, detail: null, canonical: 42 }, cands);
    expect(v2.ok).toBe(true);
    if (v2.ok) expect(v2.confirm.canonical).toBeNull();
  });
});

describe("reconcileNormalization — disjunction gate (disjunctive-term-modeling)", () => {
  it("disposes a disjunctive term as an abstract concept with NO confirm call", async () => {
    const h = harness({
      terms: ["chicken or vegetable broth"],
      identities: [{ id: "chicken broth", embedding: [1, 0, 0] }], // score 1 would otherwise force a confirm
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed).toHaveLength(1);
    const r = h.committed[0];
    expect(r.id).toBe("chicken or vegetable broth");
    expect(r.node?.concrete).toBe(false);
    expect(r.node?.search_term).toBe("chicken broth"); // head-distributed first disjunct
    expect(r.edges).toEqual([]);
    expect(r.log.detail).toMatchObject({ note: "disjunction_concept", disjuncts: ["chicken broth", "vegetable broth"] });
    expect(s).toMatchObject({ novel: 1, disjunctionCaptured: 1 });
  });

  it("the lexical fast path wins BEFORE the gate (a punctuation variant re-uses the concept)", async () => {
    const h = harness({
      terms: ["white or yellow onion."],
      identities: [{ id: "white or yellow onion", embedding: [1, 0, 0] }],
      identitySources: [{ id: "white or yellow onion", representative: null, source: "auto", concrete: 0 }],
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.committed[0].id).toBe("white or yellow onion");
    expect(h.committed[0].node).toBeUndefined(); // resolved SAME, no second concept minted
    expect(s).toMatchObject({ lexical: 1, disjunctionCaptured: 0 });
  });

  it("rejects a classifier-proposed disjunctive canonical to the verbatim mint", async () => {
    const h = harness({
      terms: ["mystery broth"],
      identities: [{ id: "stock", embedding: [1, 0, 0] }],
      confirm: async () =>
        ({ outcome: "novel", match: null, detail: null, canonical: "chicken or vegetable broth", concrete: true, edges: [], reason: "" }),
    });
    await reconcileNormalization(h.deps);
    const r = h.committed[0];
    expect(r.id).toBe("mystery broth"); // verbatim fallback, never a concrete disjunctive id
    expect(r.log.detail).toMatchObject({ canonical_rejected: "chicken or vegetable broth", canonical_reason: "disjunctive" });
  });

  it("skips a mixed-concreteness co-resolution pair with no confirm call (concept–concrete guard)", async () => {
    const h = harness({
      terms: [],
      coPairs: [coPair({ a: "jalapenos", b: "serrano or jalapeño peppers", aConcrete: true, bConcrete: false })],
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.merges).toEqual([]);
    expect(s).toMatchObject({ mergeSkipped: 1, merged: 0 });
  });

  it("wires the disjunction shape sweep into the tick (flip-only family)", async () => {
    const h = harness({
      terms: [],
      identitySources: [{ id: "white or yellow onion", representative: null, source: "auto", concrete: 1 }],
    });
    const s = await reconcileNormalization(h.deps);
    expect(h.disjunctionRepairs).toEqual([
      { base: "white or yellow onion", searchTerm: "white onion", mintBase: false, reroot: false, flip: true, children: [] },
    ]);
    expect(s).toMatchObject({ disjunctionFlipped: 1, disjunctionFolded: 0 });
  });
});
