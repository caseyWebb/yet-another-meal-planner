import { describe, it, expect } from "vitest";
import { reconcileNormalization, type NormalizeDeps } from "../src/ingredient-normalize.js";
import { validateConfirm, type IdentityConfirm } from "../src/ingredient-classify.js";
import type { Resolution, CoResolutionPair } from "../src/corpus-db.js";
import { ToolError } from "../src/errors.js";

type Harness = {
  deps: NormalizeDeps;
  committed: Resolution[];
  deferred: string[];
  merges: { loser: string; survivor: string }[];
  confirmCalls: number;
};

function harness(opts: {
  terms: string[];
  identities?: { id: string; embedding: number[] }[];
  embed?: (texts: string[]) => Promise<number[][]>;
  confirm?: (term: string, candidates: string[]) => Promise<IdentityConfirm>;
  coPairs?: CoResolutionPair[];
  coConfirm?: (term: string, candidates: string[]) => Promise<IdentityConfirm>;
}): Harness {
  const committed: Resolution[] = [];
  const deferred: string[] = [];
  const merges: { loser: string; survivor: string }[] = [];
  const h = { committed, deferred, merges, confirmCalls: 0 } as Harness;
  h.deps = {
    loadBatch: async () => opts.terms,
    identityEmbeddings: async () => (opts.identities ?? []).map((i) => ({ ...i })),
    embed: opts.embed ?? (async (texts) => texts.map(() => [1, 0, 0])),
    confirm: async (term, candidates) => {
      h.confirmCalls++;
      // The co-resolution pass reuses `confirm`; let a test route it separately when set.
      if (opts.coConfirm && candidates.length === 1 && (opts.coPairs ?? []).some((p) => p.b === candidates[0])) {
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
    now: () => 1000,
    maxPerTick: 25,
    floor: 0.5,
    topK: 10,
    coResolveMaxPerTick: 10,
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
});
