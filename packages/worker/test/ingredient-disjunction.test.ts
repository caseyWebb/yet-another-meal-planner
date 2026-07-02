import { describe, it, expect } from "vitest";
import {
  isDisjunctiveTerm,
  splitDisjuncts,
  firstDisjunct,
  disjunctionResolution,
  reconcileDisjunctions,
  type DisjunctionDeps,
  type DisjunctionCounters,
} from "../src/ingredient-disjunction.js";
import type {
  IdentitySourceRow,
  AliasAuditRow,
  EdgeRow,
  NormalizationLog,
  DisjunctionRepairPlan,
} from "../src/corpus-db.js";

describe("splitDisjuncts / isDisjunctiveTerm", () => {
  it("distributes the head noun onto shorter fragments (the production trio)", () => {
    expect(splitDisjuncts("white or yellow onion")).toEqual(["white onion", "yellow onion"]);
    expect(splitDisjuncts("serrano or jalapeño peppers")).toEqual(["serrano peppers", "jalapeño peppers"]);
    expect(splitDisjuncts("anaheim or cubanelle peppers")).toEqual(["anaheim peppers", "cubanelle peppers"]);
  });

  it("splits verbatim when no fragment is shorter than the final one", () => {
    expect(splitDisjuncts("olive oil or butter")).toEqual(["olive oil", "butter"]);
  });

  it("folds an Oxford comma list into the same separator", () => {
    expect(splitDisjuncts("serrano, jalapeño, or habanero peppers")).toEqual([
      "serrano peppers",
      "jalapeño peppers",
      "habanero peppers",
    ]);
  });

  it("a ::detail child matches through its disjunctive base", () => {
    expect(isDisjunctiveTerm("serrano or jalapeño peppers::form-diced")).toBe(true);
    expect(firstDisjunct("serrano or jalapeño peppers::form-diced")).toBe("serrano peppers");
  });

  it("and-compounds, slash forms, and or-substrings do NOT match", () => {
    for (const t of [
      "half and half",
      "pecans (halved and pieces)",
      "garlic and herb salt-free seasoning",
      "jellies and jams (various)",
      "80/20 ground beef",
      "oregano", // "or" as a substring, not a token
      "orange juice",
    ]) {
      expect(isDisjunctiveTerm(t)).toBe(false);
    }
  });
});

describe("disjunctionResolution", () => {
  it("mints an abstract concept under the verbatim phrase with a member-phrase search term", () => {
    const r = disjunctionResolution("white or yellow onion", [1, 0, 0]);
    expect(r.id).toBe("white or yellow onion");
    expect(r.node).toMatchObject({
      base: "white or yellow onion",
      detail: null,
      search_term: "white onion",
      concrete: false,
    });
    expect(r.edges).toEqual([]);
    expect(r.log).toMatchObject({ outcome: "novel", model: null });
    expect(r.log.detail).toMatchObject({ note: "disjunction_concept", disjuncts: ["white onion", "yellow onion"] });
  });
});

type Harness = {
  deps: DisjunctionDeps;
  repairs: DisjunctionRepairPlan[];
  inserted: { from: string; to: string; kind: string }[];
  enqueued: string[];
  logged: NormalizationLog[];
};

function harness(opts: {
  identities: IdentitySourceRow[];
  aliases?: AliasAuditRow[];
  edges?: EdgeRow[];
  maxPerTick?: number;
}): Harness {
  const h: Harness = { deps: undefined as unknown as DisjunctionDeps, repairs: [], inserted: [], enqueued: [], logged: [] };
  h.deps = {
    identitySources: async () => opts.identities.map((r) => ({ ...r })),
    aliasTargets: async () => (opts.aliases ?? []).map((a) => ({ ...a })),
    allEdges: async () => (opts.edges ?? []).map((e) => ({ ...e })),
    applyRepair: async (plan) => {
      h.repairs.push(plan);
    },
    insertEdge: async (from, to, kind) => {
      h.inserted.push({ from, to, kind });
    },
    enqueue: async (terms) => {
      h.enqueued.push(...terms);
    },
    log: async (entry) => {
      h.logged.push(entry);
    },
    disjunctionMaxPerTick: opts.maxPerTick ?? 10,
  };
  return h;
}

function counters(): DisjunctionCounters {
  return {
    disjunctionFlipped: 0,
    disjunctionFolded: 0,
    disjunctionEdges: 0,
    disjunctionEnqueued: 0,
    disjunctionSkipped: 0,
  };
}

const idRow = (
  id: string,
  representative: string | null = null,
  source: "auto" | "human" = "auto",
  concrete = 1,
): IdentitySourceRow => ({ id, representative, source, concrete });

const BASE = "serrano or jalapeño peppers";
const CHILD = "serrano or jalapeño peppers::form-diced";

describe("reconcileDisjunctions — shape sweep", () => {
  it("re-roots + flips the PRODUCTION SERRANO FIXTURE (base merged into its own child) and enqueues the disjuncts", async () => {
    const h = harness({
      identities: [idRow(BASE, CHILD), idRow(CHILD)],
      edges: [{ from_id: CHILD, to_id: BASE, kind: "general", source: "auto", audited_at: 500 }],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toEqual([
      { base: BASE, searchTerm: "serrano peppers", mintBase: false, reroot: true, flip: true, children: [CHILD] },
    ]);
    expect(s).toMatchObject({ disjunctionFlipped: 1, disjunctionFolded: 1 });
    // No disjunct nodes/aliases exist yet: both enqueue, nothing links.
    expect(h.inserted).toHaveLength(0);
    expect([...h.enqueued].sort()).toEqual(["jalapeño peppers", "serrano peppers"]);
    expect(s.disjunctionEnqueued).toBe(2);
  });

  it("the converged serrano family plans no further repairs (quiesced by predicate)", async () => {
    const h = harness({
      identities: [idRow(BASE, null, "auto", 0), idRow(CHILD, BASE)],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toHaveLength(0);
    expect(s).toMatchObject({ disjunctionFlipped: 0, disjunctionFolded: 0 });
  });

  it("flips a bare concrete disjunction node abstract", async () => {
    const h = harness({ identities: [idRow("white or yellow onion")] });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toEqual([
      { base: "white or yellow onion", searchTerm: "white onion", mintBase: false, reroot: false, flip: true, children: [] },
    ]);
    expect(s.disjunctionFlipped).toBe(1);
  });

  it("mints a missing abstract base for an orphaned ::detail child", async () => {
    const h = harness({ identities: [idRow(CHILD)] });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toEqual([
      { base: BASE, searchTerm: "serrano peppers", mintBase: true, reroot: false, flip: false, children: [CHILD] },
    ]);
    expect(s).toMatchObject({ disjunctionFlipped: 0, disjunctionFolded: 1 });
  });

  it("never flips or folds human nodes (skipped and counted)", async () => {
    const h = harness({
      identities: [idRow("white or yellow onion", null, "human"), idRow(BASE), idRow(CHILD, null, "human")],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    // The human base family is skipped whole; the auto serrano base still flips (its human child is not folded).
    expect(h.repairs).toEqual([
      { base: BASE, searchTerm: "serrano peppers", mintBase: false, reroot: false, flip: true, children: [] },
    ]);
    expect(s.disjunctionSkipped).toBe(2);
  });

  it("leaves a base merged into an UNRELATED survivor alone (not a shape this sweep owns)", async () => {
    const h = harness({ identities: [idRow(BASE, "onions"), idRow("onions")] });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toHaveLength(0);
  });

  it("caps writes per tick", async () => {
    const h = harness({
      identities: [idRow("white or yellow onion"), idRow("anaheim or cubanelle peppers")],
      maxPerTick: 1,
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toHaveLength(1);
    expect(s.disjunctionFlipped).toBe(1);
  });
});

describe("reconcileDisjunctions — membership guarantee", () => {
  const concept = idRow("white or yellow onion", null, "auto", 0);

  it("links a resolved disjunct as a born-stamped membership edge, once", async () => {
    const h = harness({
      identities: [concept, idRow("white onion"), idRow("yellow onion")],
      aliases: [
        { variant: "white onion", id: "white onion" },
        { variant: "yellow onion", id: "yellow onion" },
      ],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.inserted).toEqual([
      { from: "white onion", to: "white or yellow onion", kind: "membership" },
      { from: "yellow onion", to: "white or yellow onion", kind: "membership" },
    ]);
    expect(h.logged.map((l) => l.outcome)).toEqual(["edge_restore", "edge_restore"]);
    expect(h.logged[0].detail).toMatchObject({ note: "disjunction_membership", kind: "membership" });
    expect(s.disjunctionEdges).toBe(2);
    expect(h.enqueued).toEqual([]);
  });

  it("resolves a disjunct through the alias front door AND the representative chain", async () => {
    const h = harness({
      identities: [concept, idRow("yellow onion", "onions"), idRow("onions"), idRow("white onion")],
      aliases: [{ variant: "yellow onion", id: "yellow onion" }],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    // "yellow onion" resolves through its merged node to the survivor "onions"; "white onion"
    // has no alias but IS a node id — the front door's id fallback.
    expect(h.inserted).toEqual([
      { from: "white onion", to: "white or yellow onion", kind: "membership" },
      { from: "onions", to: "white or yellow onion", kind: "membership" },
    ]);
  });

  it("skips the insert when an edge already stands in either direction", async () => {
    const h = harness({
      identities: [concept, idRow("white onion")],
      aliases: [{ variant: "white onion", id: "white onion" }],
      edges: [{ from_id: "white or yellow onion", to_id: "white onion", kind: "containment", source: "auto" }],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.inserted.filter((e) => e.from === "white onion")).toHaveLength(0);
    // the other disjunct is still unresolved → enqueued
    expect(h.enqueued).toEqual(["yellow onion"]);
  });

  it("re-enqueues unresolved disjuncts every tick until capture places them", async () => {
    const h = harness({ identities: [concept] });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    await reconcileDisjunctions(h.deps, s);
    expect(h.enqueued).toEqual(["white onion", "yellow onion", "white onion", "yellow onion"]);
    expect(s.disjunctionEnqueued).toBe(4);
  });

  it("links members in the SAME tick as the family repair (post-repair in-memory view)", async () => {
    const h = harness({
      identities: [idRow("white or yellow onion"), idRow("white onion")],
      aliases: [{ variant: "white onion", id: "white onion" }],
    });
    const s = counters();
    await reconcileDisjunctions(h.deps, s);
    expect(h.repairs).toHaveLength(1); // the flip
    expect(h.inserted).toEqual([{ from: "white onion", to: "white or yellow onion", kind: "membership" }]);
  });
});
