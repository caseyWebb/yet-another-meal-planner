import { describe, it, expect } from "vitest";
import { auditEdges, isStructuralEdge, type EdgeAuditDeps } from "../src/ingredient-edge-audit.js";
import type { EdgeAuditRow, EdgeRow, EdgeDropLogRow, IdentitySourceRow, NormalizationLog } from "../src/corpus-db.js";
import type { DirectionCheck, SatisfiesDirection } from "../src/ingredient-classify.js";
import { ToolError } from "../src/errors.js";

type Harness = {
  deps: EdgeAuditDeps;
  deleted: EdgeAuditRow[];
  stamped: EdgeAuditRow[];
  logs: NormalizationLog[];
  checkCalls: { from: string; to: string }[];
  /** Born-stamped edge inserts (guarantee + replay restores); mintBase = the minted base id or null. */
  inserted: { from: string; to: string; kind: string; mintBase: string | null }[];
  /** Replay marks written to edge_drop log rows. */
  marked: { id: number; detail: Record<string, unknown> }[];
};

const edge = (from_id: string, to_id: string, kind = "general", source: "auto" | "human" = "auto"): EdgeRow => ({
  from_id,
  to_id,
  kind,
  source,
});

function harness(opts: {
  batch: EdgeAuditRow[];
  /** The FULL edge table (defaults to the batch as auto edges). */
  edges?: EdgeRow[];
  identities?: IdentitySourceRow[];
  check?: (from: string, to: string) => Promise<DirectionCheck>;
  /** Un-replayed edge_drop log rows for the replay sub-pass. */
  drops?: EdgeDropLogRow[];
  maxPerTick?: number;
  replayMaxPerTick?: number;
  structuralMaxPerTick?: number;
}): Harness {
  const h = {
    deleted: [] as EdgeAuditRow[],
    stamped: [] as EdgeAuditRow[],
    logs: [] as NormalizationLog[],
    checkCalls: [] as { from: string; to: string }[],
    inserted: [] as { from: string; to: string; kind: string; mintBase: string | null }[],
    marked: [] as { id: number; detail: Record<string, unknown> }[],
  } as Harness;
  h.deps = {
    loadBatch: async (limit) => opts.batch.slice(0, limit),
    identities: async () => (opts.identities ?? []).map((i) => ({ ...i })),
    allEdges: async () => (opts.edges ?? opts.batch.map((e) => edge(e.from_id, e.to_id, e.kind))).map((e) => ({ ...e })),
    checkDirection: async (from, to) => {
      h.checkCalls.push({ from, to });
      if (!opts.check) throw new Error("checkDirection not expected");
      return opts.check(from, to);
    },
    deleteEdge: async (from_id, to_id, kind) => {
      h.deleted.push({ from_id, to_id, kind });
    },
    stamp: async (from_id, to_id, kind) => {
      h.stamped.push({ from_id, to_id, kind });
    },
    log: async (entry) => {
      h.logs.push(entry);
    },
    insertEdge: async (from, to, kind, o) => {
      h.inserted.push({ from, to, kind, mintBase: o?.mintBase?.id ?? null });
    },
    unreplayedDrops: async (limit) => (opts.drops ?? []).slice(0, limit).map((d) => ({ ...d })),
    markReplayed: async (id, detail) => {
      h.marked.push({ id, detail: detail as Record<string, unknown> });
    },
    now: () => 1000,
    maxPerTick: opts.maxPerTick ?? 10,
    replayMaxPerTick: opts.replayMaxPerTick ?? 10,
    structuralMaxPerTick: opts.structuralMaxPerTick ?? 20,
  };
  return h;
}

const idRow = (id: string, representative: string | null = null, source: "auto" | "human" = "auto"): IdentitySourceRow => ({
  id,
  representative,
  source,
});

const drop = (id: number, term: string, detail: Record<string, unknown> | null = null): EdgeDropLogRow => ({
  id,
  term,
  detail,
});

describe("auditEdges", () => {
  it("deletes a representative-resolved self-loop deterministically — no model call", async () => {
    const h = harness({
      batch: [{ from_id: "courgette", to_id: "zucchini", kind: "general" }],
      identities: [
        { id: "courgette", representative: "zucchini", source: "auto" },
        { id: "zucchini", representative: null, source: "auto" },
      ],
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: "courgette", to_id: "zucchini", kind: "general" }]);
    expect(h.checkCalls).toHaveLength(0);
    expect(h.logs[0]).toMatchObject({ outcome: "edge_drop", model: null, detail: { audit: "edge", note: "self_loop" } });
    expect(s).toMatchObject({ audited: 1, self_loops: 1, cycles: 0, kept: 0 });
  });

  it("resolves the production 2-cycle with ONE direction check: forward keeps this edge, drops the reverse", async () => {
    const h = harness({
      batch: [{ from_id: "whole cardamom pods", to_id: "ground cardamom", kind: "containment" }],
      edges: [
        edge("whole cardamom pods", "ground cardamom", "containment"),
        edge("ground cardamom", "whole cardamom pods", "general"),
      ],
      check: async () => ({ direction: "forward", reason: "whole grinds to ground" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toEqual([{ from: "whole cardamom pods", to: "ground cardamom" }]);
    expect(h.stamped).toEqual([{ from_id: "whole cardamom pods", to_id: "ground cardamom", kind: "containment" }]);
    expect(h.deleted).toEqual([{ from_id: "ground cardamom", to_id: "whole cardamom pods", kind: "general" }]);
    expect(h.logs.map((l) => l.outcome)).toEqual(["edge_keep", "edge_drop"]);
    expect(h.logs[0].detail).toMatchObject({ audit: "edge", direction: "forward" });
    expect(s).toMatchObject({ audited: 2, cycles: 1, kept: 1, skipped: 0 });
  });

  it("a `reverse` verdict drops this edge and stamps the reverse", async () => {
    const h = harness({
      batch: [{ from_id: "ground nutmeg", to_id: "whole nutmeg", kind: "general" }],
      edges: [edge("ground nutmeg", "whole nutmeg", "general"), edge("whole nutmeg", "ground nutmeg", "containment")],
      check: async () => ({ direction: "reverse", reason: "whole satisfies ground" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: "ground nutmeg", to_id: "whole nutmeg", kind: "general" }]);
    expect(h.stamped).toEqual([{ from_id: "whole nutmeg", to_id: "ground nutmeg", kind: "containment" }]);
    expect(s).toMatchObject({ audited: 2, cycles: 1, kept: 1 });
  });

  it("a `both` verdict keeps and stamps both sides; `neither` deletes both", async () => {
    const both = harness({
      batch: [{ from_id: "scallions", to_id: "green onion", kind: "general" }],
      edges: [edge("scallions", "green onion", "general"), edge("green onion", "scallions", "general")],
      check: async () => ({ direction: "both", reason: "interchangeable" }),
    });
    const sBoth = await auditEdges(both.deps);
    expect(both.deleted).toHaveLength(0);
    expect(both.stamped).toHaveLength(2);
    expect(sBoth).toMatchObject({ audited: 2, cycles: 1, kept: 2 });

    const neither = harness({
      batch: [{ from_id: "tuna in oil", to_id: "tuna in water", kind: "general" }],
      edges: [edge("tuna in oil", "tuna in water", "general"), edge("tuna in water", "tuna in oil", "general")],
      check: async () => ({ direction: "neither", reason: "distinct products" }),
    });
    const sNeither = await auditEdges(neither.deps);
    expect(neither.deleted).toHaveLength(2);
    expect(neither.stamped).toHaveLength(0);
    expect(sNeither).toMatchObject({ audited: 2, cycles: 1, kept: 0 });
  });

  it("a HUMAN reverse edge wins deterministically — the auto edge is deleted with no model call", async () => {
    const h = harness({
      batch: [{ from_id: "ground coriander", to_id: "coriander seed", kind: "containment" }],
      edges: [
        edge("ground coriander", "coriander seed", "containment"),
        edge("coriander seed", "ground coriander", "containment", "human"),
      ],
      check: async () => {
        throw new Error("no model call expected");
      },
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(0);
    expect(h.deleted).toEqual([{ from_id: "ground coriander", to_id: "coriander seed", kind: "containment" }]);
    expect(h.stamped).toHaveLength(0); // the human edge is untouched (never selected, never stamped)
    expect(h.logs[0]).toMatchObject({ outcome: "edge_drop", detail: { note: "human_reverse" } });
    expect(s).toMatchObject({ audited: 1, cycles: 1 });
  });

  it("drops a wrong-satisfies standing edge on a `neither` verdict, logging the verdict", async () => {
    const h = harness({
      batch: [{ from_id: "spaghetti", to_id: "rigatoni", kind: "general" }],
      check: async () => ({ direction: "neither", reason: "different pasta SKUs" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: "spaghetti", to_id: "rigatoni", kind: "general" }]);
    expect(h.logs[0]).toMatchObject({
      term: "spaghetti -[general]-> rigatoni",
      outcome: "edge_drop",
      detail: { audit: "edge", direction: "neither", reason: "different pasta SKUs" },
    });
    expect(s).toMatchObject({ audited: 1, dropped: 1, kept: 0 });
  });

  it("drops a wrong-direction standing edge on a `reverse` verdict", async () => {
    const h = harness({
      batch: [{ from_id: "garlic powder", to_id: "italian seasoning", kind: "membership" }],
      check: async () => ({ direction: "reverse", reason: "the blend contains garlic powder, not vice versa" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toHaveLength(1);
    expect(s).toMatchObject({ dropped: 1 });
  });

  it("stamps a valid standing edge on `forward` (readable forms go to the check)", async () => {
    const h = harness({
      batch: [{ from_id: "chicken::whole", to_id: "chicken::thighs", kind: "containment" }],
      check: async () => ({ direction: "forward", reason: "a whole bird contains thighs" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toEqual([{ from: "chicken whole", to: "chicken thighs" }]); // :: flattened
    expect(h.stamped).toEqual([{ from_id: "chicken::whole", to_id: "chicken::thighs", kind: "containment" }]);
    expect(h.logs[0]).toMatchObject({ outcome: "edge_keep", detail: { direction: "forward" } });
    expect(s).toMatchObject({ audited: 1, kept: 1, dropped: 0 });
  });

  it("KEEPS and stamps an edge on a contract-invalid check (never delete on an undecidable)", async () => {
    const h = harness({
      batch: [{ from_id: "a", to_id: "b", kind: "general" }],
      check: async () => {
        throw new ToolError("validation_failed", "bad output");
      },
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toHaveLength(0);
    expect(h.stamped).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ outcome: "edge_keep", detail: { note: "confirm_failed_safe" } });
    expect(s).toMatchObject({ audited: 1, kept: 1, skipped: 0 });
  });

  it("skips an edge un-stamped on a transient error (retried next tick), nothing written", async () => {
    const h = harness({
      batch: [{ from_id: "a", to_id: "b", kind: "general" }],
      check: async () => {
        throw new ToolError("storage_error", "AI down");
      },
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toHaveLength(0);
    expect(h.stamped).toHaveLength(0);
    expect(h.logs).toHaveLength(0);
    expect(s).toMatchObject({ audited: 0, skipped: 1 });
  });

  it("does not re-process a 2-cycle partner that is also in the batch (one check per pair)", async () => {
    const h = harness({
      batch: [
        { from_id: "whole cardamom pods", to_id: "ground cardamom", kind: "containment" },
        { from_id: "ground cardamom", to_id: "whole cardamom pods", kind: "general" },
      ],
      edges: [
        edge("whole cardamom pods", "ground cardamom", "containment"),
        edge("ground cardamom", "whole cardamom pods", "general"),
      ],
      check: async () => ({ direction: "forward", reason: "" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(1); // the pair resolved once; the partner row is skipped
    expect(s).toMatchObject({ audited: 2, cycles: 1 });
  });

  it("never re-processes an edge kept earlier in the tick via a later row's reverse scan", async () => {
    // e1's direction check is contract-invalid → fail-safe keep (stamped + handled) — but its
    // reverse e2 is deliberately left un-handled. When e2's own turn comes, the reverse scan
    // must EXCLUDE the already-kept e1: e2 validates STANDING on its own, and its `neither`
    // verdict deletes only e2 — the kept edge survives and is not double-counted.
    let calls = 0;
    const h = harness({
      batch: [
        { from_id: "a", to_id: "b", kind: "general" },
        { from_id: "b", to_id: "a", kind: "general" },
      ],
      edges: [edge("a", "b", "general"), edge("b", "a", "general")],
      check: async () => {
        calls++;
        if (calls === 1) throw new ToolError("validation_failed", "bad output");
        return { direction: "neither", reason: "distinct products" };
      },
    });
    const s = await auditEdges(h.deps);
    expect(h.stamped).toEqual([{ from_id: "a", to_id: "b", kind: "general" }]); // kept exactly once
    expect(h.deleted).toEqual([{ from_id: "b", to_id: "a", kind: "general" }]); // only e2 dropped
    expect(s).toMatchObject({ audited: 2, kept: 1, dropped: 1, skipped: 0 });
  });

  it("bounds the batch per tick and self-quiesces on an empty backlog", async () => {
    const bounded = harness({
      batch: [
        { from_id: "a", to_id: "b", kind: "general" },
        { from_id: "c", to_id: "d", kind: "general" },
      ],
      check: async () => ({ direction: "forward", reason: "" }),
      maxPerTick: 1,
    });
    const s = await auditEdges(bounded.deps);
    expect(s.audited).toBe(1);

    const idle = harness({ batch: [] });
    expect(await auditEdges(idle.deps)).toMatchObject({ audited: 0, skipped: 0 });
    expect(idle.checkCalls).toHaveLength(0);
  });
});

describe("isStructuralEdge", () => {
  it("matches exactly X::detail → X, nothing else", () => {
    expect(isStructuralEdge("rotel (original)::heat-mild", "rotel (original)")).toBe(true);
    expect(isStructuralEdge("rotel (original)", "rotel (original)::heat-mild")).toBe(false); // reverse shape
    expect(isStructuralEdge("a::b::c", "a::b")).toBe(false); // 3 segments
    expect(isStructuralEdge("a::b", "c")).toBe(false); // different base
    expect(isStructuralEdge("chicken::whole", "chicken::thighs")).toBe(false); // detailed to-side
    expect(isStructuralEdge("a::", "a")).toBe(false); // empty detail
  });
});

describe("auditEdges — structural exemption (normalization-audit-calibration)", () => {
  it("keeps a structural edge deterministically with NO model call (the rotel class)", async () => {
    const h = harness({
      batch: [{ from_id: "rotel (original)::heat-mild", to_id: "rotel (original)", kind: "general" }],
      identities: [idRow("rotel (original)::heat-mild"), idRow("rotel (original)")],
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(0);
    expect(h.deleted).toHaveLength(0);
    expect(h.stamped).toEqual([{ from_id: "rotel (original)::heat-mild", to_id: "rotel (original)", kind: "general" }]);
    expect(h.logs[0]).toMatchObject({
      outcome: "edge_keep",
      model: null,
      detail: { audit: "edge", note: "structural", from: "rotel (original)::heat-mild", to: "rotel (original)", kind: "general" },
    });
    expect(s).toMatchObject({ structural: 1, audited: 1, dropped: 0, kept: 0 });
  });

  it("a 2-cycle verdict never deletes a structural reverse side", async () => {
    // e = base → detail (the wrong direction). Its reverse is the STRUCTURAL edge: it is
    // shielded (stamped deterministically), and e is validated STANDING on its own — the
    // `neither` verdict deletes only e.
    const h = harness({
      batch: [{ from_id: "rotel (original)", to_id: "rotel (original)::heat-mild", kind: "general" }],
      edges: [
        edge("rotel (original)", "rotel (original)::heat-mild", "general"),
        edge("rotel (original)::heat-mild", "rotel (original)", "general"),
      ],
      identities: [idRow("rotel (original)::heat-mild"), idRow("rotel (original)")],
      check: async () => ({ direction: "neither", reason: "the general product does not satisfy the variety" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: "rotel (original)", to_id: "rotel (original)::heat-mild", kind: "general" }]);
    expect(h.stamped).toContainEqual({
      from_id: "rotel (original)::heat-mild",
      to_id: "rotel (original)",
      kind: "general",
    });
    expect(s).toMatchObject({ structural: 1, dropped: 1 });
  });

  it("a structural-shaped edge from a MERGED-AWAY node is not exempt (the fish-sauce class)", async () => {
    const h = harness({
      batch: [{ from_id: "fish sauce::type-sea-salt", to_id: "fish sauce", kind: "general" }],
      identities: [idRow("fish sauce::type-sea-salt", "flaky sea salt"), idRow("flaky sea salt"), idRow("fish sauce")],
      check: async () => ({ direction: "neither", reason: "sea salt is not fish sauce" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toEqual([{ from: "flaky sea salt", to: "fish sauce" }]); // resolved endpoints
    expect(h.deleted).toHaveLength(1);
    expect(s).toMatchObject({ structural: 0, dropped: 1 });
  });
});

describe("auditEdges — structural pre-pass (sweep + guarantee)", () => {
  it("restores missing structural edges born-stamped, minting missing bases (rotel/pickles class)", async () => {
    const h = harness({
      batch: [],
      edges: [],
      identities: [idRow("snacking pickles::form-chips"), idRow("garlic::form-jarred"), idRow("garlic")],
    });
    const s = await auditEdges(h.deps);
    expect(h.inserted).toEqual([
      { from: "snacking pickles::form-chips", to: "snacking pickles", kind: "general", mintBase: "snacking pickles" },
      { from: "garlic::form-jarred", to: "garlic", kind: "general", mintBase: null }, // base exists
    ]);
    const restores = h.logs.filter((l) => l.outcome === "edge_restore");
    expect(restores).toHaveLength(2);
    expect(restores[0].detail).toMatchObject({ note: "structural_guarantee", kind: "general" });
    expect(s).toMatchObject({ structural_restored: 2 });
    expect(h.checkCalls).toHaveLength(0);
  });

  it("is idempotent — an existing any-kind edge to the base suffices", async () => {
    const h = harness({
      batch: [],
      edges: [edge("snacking pickles::form-chips", "snacking pickles", "containment")],
      identities: [idRow("snacking pickles::form-chips"), idRow("snacking pickles")],
    });
    const s = await auditEdges(h.deps);
    expect(h.inserted).toHaveLength(0);
    expect(s.structural_restored).toBe(0);
  });

  it("skips merged-away detail nodes and respects the write cap", async () => {
    const capped = harness({
      batch: [],
      edges: [],
      identities: [idRow("a::x"), idRow("b::y"), idRow("c::z")],
      structuralMaxPerTick: 2,
    });
    expect((await auditEdges(capped.deps)).structural_restored).toBe(2);

    const merged = harness({
      batch: [],
      edges: [],
      identities: [idRow("a::x", "something else"), idRow("something else")],
    });
    expect((await auditEdges(merged.deps)).structural_restored).toBe(0);
  });

  it("sweeps a STAMPED rep-resolved self-loop (the post-repair salmon shape)", async () => {
    const OV = "salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye";
    const PREFIX = "salmon fillets, skin-on::species-atlantic-sockeye";
    const h = harness({
      batch: [],
      edges: [
        { from_id: OV, to_id: PREFIX, kind: "general", source: "auto", audited_at: 500 },
        { from_id: PREFIX, to_id: "salmon fillets, skin-on", kind: "general", source: "auto", audited_at: 500 },
      ],
      identities: [idRow(OV, PREFIX), idRow(PREFIX), idRow("salmon fillets, skin-on")],
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: OV, to_id: PREFIX, kind: "general" }]);
    expect(h.logs[0]).toMatchObject({ outcome: "edge_drop", model: null, detail: { note: "self_loop" } });
    expect(h.inserted).toHaveLength(0); // the prefix's base edge already stands
    expect(s).toMatchObject({ self_loops_swept: 1, structural_restored: 0 });
  });

  it("leaves UN-stamped self-loops to the drain (existing rule, one delete + one log)", async () => {
    const h = harness({
      batch: [{ from_id: "courgette", to_id: "zucchini", kind: "general" }],
      identities: [idRow("courgette", "zucchini"), idRow("zucchini")],
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toHaveLength(1);
    expect(h.logs.filter((l) => l.outcome === "edge_drop")).toHaveLength(1);
    expect(s).toMatchObject({ self_loops: 1, self_loops_swept: 0 });
  });
});

describe("auditEdges — edge-drop replay", () => {
  it("restores a wrongly-dropped edge under the recalibrated verdict (honey raisins)", async () => {
    const h = harness({
      batch: [],
      edges: [],
      identities: [idRow("honey raisins"), idRow("raisins")],
      drops: [drop(599, "honey raisins -[containment]-> raisins", { direction: "neither" })],
      check: async () => ({ direction: "forward", reason: "honey raisins are still raisins" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toEqual([{ from: "honey raisins", to: "raisins" }]);
    expect(h.inserted).toContainEqual({ from: "honey raisins", to: "raisins", kind: "containment", mintBase: null });
    const restore = h.logs.find((l) => l.outcome === "edge_restore");
    expect(restore).toMatchObject({
      term: "honey raisins -[containment]-> raisins",
      detail: { audit: "edge", replay_of: 599, direction: "forward" },
    });
    // The mark records the NEW verdict (the original one survives in the edge_restore row via
    // `replay_of`), so `direction` is the recalibrated "forward".
    expect(h.marked).toEqual([
      { id: 599, detail: { direction: "forward", replayed_at: 1000, replay: "restored" } },
    ]);
    expect(s).toMatchObject({ replayed: 1, restored: 1 });
  });

  it("marks deterministic and dead rows without model calls", async () => {
    const h = harness({
      batch: [],
      edges: [edge("rotel (original)::heat-mild", "rotel (original)", "general")],
      identities: [
        idRow("rotel (original)::heat-mild"),
        idRow("rotel (original)"),
        idRow("fish sauce::type-sea-salt", "flaky sea salt"),
        idRow("flaky sea salt"),
        idRow("fish sauce"),
      ],
      drops: [
        drop(1, "a -[general]-> b", { note: "self_loop" }),
        drop(2, "c -[general]-> d", { note: "human_reverse" }),
        drop(3, "rotel (original)::heat-mild -[general]-> rotel (original)", {}),
        drop(4, "fish sauce::type-sea-salt -[general]-> fish sauce", {}),
        drop(5, "not an edge term", {}),
      ],
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
    expect(h.marked.map((m) => m.detail.replay)).toEqual([
      "self_loop",
      "human_reverse",
      "structural",
      "endpoint_merged",
      "unparseable",
    ]);
    expect(s).toMatchObject({ replayed: 5, restored: 0 });
  });

  it("re-decides a PAIR when the reverse edge stands: forward restores + deletes the stamped wrong keep", async () => {
    // The production mislabel casualty: `whole frozen chicken -[containment]-> chicken tenderloin`
    // was dropped while the wrong reverse was kept + STAMPED. The pair re-decision converges it.
    const h = harness({
      batch: [],
      edges: [{ from_id: "chicken tenderloin", to_id: "whole frozen chicken", kind: "general", source: "auto", audited_at: 500 }],
      identities: [idRow("whole frozen chicken"), idRow("chicken tenderloin")],
      drops: [drop(574, "whole frozen chicken -[containment]-> chicken tenderloin", { direction: "forward" })],
      check: async () => ({ direction: "forward", reason: "a whole chicken satisfies a part, not the reverse" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(1); // ONE call decides the whole pair
    expect(h.deleted).toEqual([{ from_id: "chicken tenderloin", to_id: "whole frozen chicken", kind: "general" }]);
    expect(h.inserted).toEqual([
      { from: "whole frozen chicken", to: "chicken tenderloin", kind: "containment", mintBase: null },
    ]);
    const cycleDrop = h.logs.find((l) => l.outcome === "edge_drop");
    expect(cycleDrop?.detail).toMatchObject({ note: "replay_cycle", replay_of: 574, direction: "forward" });
    expect(h.marked[0].detail).toMatchObject({ replay: "restored", direction: "forward", cycle: true });
    expect(s).toMatchObject({ replayed: 1, restored: 1, dropped: 1 });
  });

  it("pair re-decision verdict matrix: both / reverse / neither", async () => {
    const fixture = (direction: SatisfiesDirection) =>
      harness({
        batch: [],
        edges: [edge("b", "a", "general")],
        identities: [idRow("a"), idRow("b")],
        drops: [drop(1, "a -[general]-> b", {})],
        check: async () => ({ direction, reason: "" }),
      });

    const both = fixture("both");
    const sBoth = await auditEdges(both.deps);
    expect(both.inserted).toHaveLength(1);
    expect(both.deleted).toHaveLength(0);
    expect(both.marked[0].detail).toMatchObject({ replay: "restored" });
    expect(sBoth).toMatchObject({ restored: 1, dropped: 0 });

    const rev = fixture("reverse");
    const sRev = await auditEdges(rev.deps);
    expect(rev.inserted).toHaveLength(0);
    expect(rev.deleted).toHaveLength(0);
    expect(rev.marked[0].detail).toMatchObject({ replay: "stands", direction: "reverse" });
    expect(sRev).toMatchObject({ restored: 0, dropped: 0 });

    const neither = fixture("neither");
    const sNeither = await auditEdges(neither.deps);
    expect(neither.inserted).toHaveLength(0);
    expect(neither.deleted).toEqual([{ from_id: "b", to_id: "a", kind: "general" }]); // neither holds
    expect(neither.marked[0].detail).toMatchObject({ replay: "stands", direction: "neither" });
    expect(sNeither).toMatchObject({ restored: 0, dropped: 1 });
  });

  it("a HUMAN standing reverse wins deterministically; a STRUCTURAL one blocks the restore", async () => {
    const human = harness({
      batch: [],
      edges: [edge("b", "a", "general", "human")],
      identities: [idRow("a"), idRow("b")],
      drops: [drop(1, "a -[general]-> b", {})],
    });
    const sHuman = await auditEdges(human.deps);
    expect(human.checkCalls).toHaveLength(0);
    expect(human.deleted).toHaveLength(0);
    expect(human.inserted).toHaveLength(0);
    expect(human.marked[0].detail).toMatchObject({ replay: "human_reverse_standing" });
    expect(sHuman.replayed).toBe(1);

    const structural = harness({
      batch: [],
      edges: [edge("rotel (original)::heat-mild", "rotel (original)", "general")],
      identities: [idRow("rotel (original)"), idRow("rotel (original)::heat-mild")],
      drops: [drop(2, "rotel (original) -[general]-> rotel (original)::heat-mild", {})],
    });
    const sStruct = await auditEdges(structural.deps);
    expect(structural.checkCalls).toHaveLength(0);
    expect(structural.deleted).toHaveLength(0);
    expect(structural.inserted).toHaveLength(0);
    expect(structural.marked[0].detail).toMatchObject({ replay: "structural_reverse" });
    expect(sStruct.replayed).toBe(1);
  });

  it("immunity is decided over ALL standing reverses (human + auto of another kind)", async () => {
    // The reverse pair is covered by BOTH a human edge and an auto edge of a different kind:
    // the human immunity wins for the whole set — zero model calls, nothing deleted.
    const h = harness({
      batch: [],
      edges: [edge("b", "a", "general", "human"), edge("b", "a", "containment")],
      identities: [idRow("a"), idRow("b")],
      drops: [drop(1, "a -[general]-> b", {})],
      check: async () => {
        throw new Error("no model call expected — a human reverse is deterministic");
      },
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(0);
    expect(h.deleted).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
    expect(h.marked[0].detail).toMatchObject({ replay: "human_reverse_standing" });
    expect(s).toMatchObject({ replayed: 1, restored: 0, dropped: 0 });
  });

  it("a pair verdict terminalizes every unprotected reverse consistently", async () => {
    const h = harness({
      batch: [],
      edges: [edge("b", "a", "general"), edge("b", "a", "containment")],
      identities: [idRow("a"), idRow("b")],
      drops: [drop(1, "a -[general]-> b", {})],
      check: async () => ({ direction: "forward", reason: "" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toHaveLength(1); // one verdict for the whole pair set
    expect(h.deleted).toEqual([
      { from_id: "b", to_id: "a", kind: "general" },
      { from_id: "b", to_id: "a", kind: "containment" },
    ]);
    expect(h.inserted).toHaveLength(1);
    expect(s).toMatchObject({ restored: 1, dropped: 2 });
  });

  it("a restore re-attaches to the RESOLVED surviving to-endpoint when TO was merged away", async () => {
    const h = harness({
      batch: [],
      edges: [],
      identities: [idRow("honey raisins"), idRow("raisins", "seedless raisins"), idRow("seedless raisins")],
      drops: [drop(599, "honey raisins -[containment]-> raisins", {})],
      check: async () => ({ direction: "forward", reason: "still raisins" }),
    });
    const s = await auditEdges(h.deps);
    expect(h.checkCalls).toEqual([{ from: "honey raisins", to: "seedless raisins" }]);
    expect(h.inserted).toEqual([
      { from: "honey raisins", to: "seedless raisins", kind: "containment", mintBase: null },
    ]);
    const restore = h.logs.find((l) => l.outcome === "edge_restore");
    expect(restore?.detail).toMatchObject({ to: "seedless raisins" });
    expect(s.restored).toBe(1);
  });

  it("a contract-invalid check marks without restoring or deleting; a transient leaves the row un-marked", async () => {
    const invalid = harness({
      batch: [],
      edges: [edge("b", "a", "general")],
      identities: [idRow("a"), idRow("b")],
      drops: [drop(1, "a -[general]-> b", {})],
      check: async () => {
        throw new ToolError("validation_failed", "bad output");
      },
    });
    const sInvalid = await auditEdges(invalid.deps);
    expect(invalid.deleted).toHaveLength(0);
    expect(invalid.inserted).toHaveLength(0);
    expect(invalid.marked[0].detail).toMatchObject({ replay: "confirm_failed_safe" });
    expect(sInvalid).toMatchObject({ replayed: 1, restored: 0 });

    const transient = harness({
      batch: [],
      edges: [],
      identities: [idRow("a"), idRow("b")],
      drops: [drop(1, "a -[general]-> b", {})],
      check: async () => {
        throw new ToolError("storage_error", "AI down");
      },
    });
    const sTransient = await auditEdges(transient.deps);
    expect(transient.marked).toHaveLength(0); // un-marked IS the retry state
    expect(sTransient).toMatchObject({ replayed: 0, skipped: 1 });
  });

  it("is bounded per tick", async () => {
    const h = harness({
      batch: [],
      edges: [],
      identities: [idRow("a"), idRow("b"), idRow("c"), idRow("d")],
      drops: [drop(1, "a -[general]-> b", {}), drop(2, "c -[general]-> d", {})],
      check: async () => ({ direction: "neither", reason: "" }),
      replayMaxPerTick: 1,
    });
    const s = await auditEdges(h.deps);
    expect(s.replayed).toBe(1); // the second row waits for the next tick
  });
});

describe("auditEdges — structural guarantee oscillation guard (disjunctive-term-modeling)", () => {
  const BASE = "serrano or jalapeño peppers";
  const CHILD = "serrano or jalapeño peppers::form-diced";

  it("sweeps the inverted family's stamped self-loop ONCE and never re-inserts (the live serrano churn)", async () => {
    // The production shape: the base was merged INTO its own surviving ::detail child, so the
    // stamped structural edge child→base is a rep-resolved self-loop. Pre-guard, step (a)
    // deleted it and step (b) re-inserted it every tick (16 drops / 14 restores logged in prod).
    const h = harness({
      batch: [],
      edges: [{ from_id: CHILD, to_id: BASE, kind: "general", source: "auto", audited_at: 500 }],
      identities: [idRow(BASE, CHILD), idRow(CHILD)],
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: CHILD, to_id: BASE, kind: "general" }]);
    expect(h.inserted).toHaveLength(0); // the guard: never guarantee a rep-resolved self-loop
    expect(s).toMatchObject({ self_loops_swept: 1, structural_restored: 0 });
    expect(h.checkCalls).toHaveLength(0);
  });

  it("the post-sweep inverted family is fully quiescent — churn ends BEFORE any shape sweep runs", async () => {
    const h = harness({
      batch: [],
      edges: [],
      identities: [idRow(BASE, CHILD), idRow(CHILD)],
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
    expect(s).toMatchObject({ self_loops_swept: 0, structural_restored: 0 });
  });

  it("the POST-FOLD family sweeps its stale structural edge once and never re-inserts (child no longer survives)", async () => {
    // After the disjunction shape sweep folds the child into the (now abstract) base, the old
    // structural edge child→base resolves to a self-loop: swept once by (a); (b) skips the
    // child entirely (it no longer survives) — the churn cannot restart.
    const h = harness({
      batch: [],
      edges: [{ from_id: CHILD, to_id: BASE, kind: "general", source: "auto", audited_at: 500 }],
      identities: [idRow(BASE), idRow(CHILD, BASE)],
    });
    const s = await auditEdges(h.deps);
    expect(h.deleted).toEqual([{ from_id: CHILD, to_id: BASE, kind: "general" }]);
    expect(h.inserted).toHaveLength(0);
    expect(s).toMatchObject({ self_loops_swept: 1, structural_restored: 0 });
  });

  it("a healthy detail node whose base resolves elsewhere still gets its guarantee edge", async () => {
    const h = harness({
      batch: [],
      edges: [],
      identities: [idRow("rotel (original)::heat-mild"), idRow("rotel (original)")],
    });
    const s = await auditEdges(h.deps);
    expect(h.inserted).toEqual([
      { from: "rotel (original)::heat-mild", to: "rotel (original)", kind: "general", mintBase: null },
    ]);
    expect(s).toMatchObject({ structural_restored: 1 });
  });
});
