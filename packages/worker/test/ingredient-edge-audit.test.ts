import { describe, it, expect } from "vitest";
import { auditEdges, type EdgeAuditDeps } from "../src/ingredient-edge-audit.js";
import type { EdgeAuditRow, EdgeRow, IdentitySourceRow, NormalizationLog } from "../src/corpus-db.js";
import type { DirectionCheck } from "../src/ingredient-classify.js";
import { ToolError } from "../src/errors.js";

type Harness = {
  deps: EdgeAuditDeps;
  deleted: EdgeAuditRow[];
  stamped: EdgeAuditRow[];
  logs: NormalizationLog[];
  checkCalls: { from: string; to: string }[];
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
  maxPerTick?: number;
}): Harness {
  const h = {
    deleted: [] as EdgeAuditRow[],
    stamped: [] as EdgeAuditRow[],
    logs: [] as NormalizationLog[],
    checkCalls: [] as { from: string; to: string }[],
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
    now: () => 1000,
    maxPerTick: opts.maxPerTick ?? 10,
  };
  return h;
}

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
