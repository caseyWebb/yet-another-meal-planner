import { describe, it, expect } from "vitest";
import { reconfirmIdentities, type ReconfirmDeps } from "../src/ingredient-reconfirm.js";
import { readReconfirmBatch } from "../src/corpus-db.js";
import type { ReconfirmNode, NormalizationLog } from "../src/corpus-db.js";
import type { IdentityConfirm } from "../src/ingredient-classify.js";
import { fakeD1 } from "./fake-d1.js";
import { ToolError } from "../src/errors.js";

type CommittedEdges = { edges?: { from: string; to: string; kind: string }[]; log: NormalizationLog };

type Harness = {
  deps: ReconfirmDeps;
  committed: CommittedEdges[];
  merges: { loser: string; survivor: string }[];
  stamped: string[];
  confirmCalls: number;
};

function harness(opts: {
  nodes: ReconfirmNode[];
  identities?: { id: string; embedding: number[] }[];
  confirm?: (term: string, candidates: string[]) => Promise<IdentityConfirm>;
}): Harness {
  const committed: CommittedEdges[] = [];
  const merges: { loser: string; survivor: string }[] = [];
  const stamped: string[] = [];
  const h = { committed, merges, stamped, confirmCalls: 0 } as Harness;
  h.deps = {
    loadBatch: async (limit) => opts.nodes.slice(0, limit),
    identityEmbeddings: async () => (opts.identities ?? []).map((i) => ({ ...i })),
    confirm: async (term, candidates) => {
      h.confirmCalls++;
      if (!opts.confirm) throw new Error("confirm not expected");
      return opts.confirm(term, candidates);
    },
    commitEdges: async (r) => {
      committed.push(r);
    },
    merge: async (loser, survivor) => {
      merges.push({ loser, survivor });
    },
    stamp: async (id) => {
      stamped.push(id);
    },
    now: () => 1000,
    maxPerTick: 10,
    topK: 10,
  };
  return h;
}

const node = (o: Partial<ReconfirmNode> & { id: string }): ReconfirmNode => ({
  base: o.id.split("::")[0],
  detail: o.id.includes("::") ? o.id.slice(o.id.indexOf("::") + 2) : null,
  embedding: [1, 0, 0],
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

describe("reconfirmIdentities", () => {
  it("enriches an edgeless auto node with a proposed edge and stamps it", async () => {
    const h = harness({
      nodes: [node({ id: "kielbasa" })],
      identities: [
        { id: "kielbasa", embedding: [1, 0, 0] }, // itself — must be excluded from neighbors
        { id: "sausage", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "novel", edges: [{ from: "NEW", to: "sausage", kind: "general" }] }),
    });
    const s = await reconfirmIdentities(h.deps);
    // The "NEW" endpoint maps to this node; the edge is committed additively.
    expect(h.committed[0].edges).toContainEqual({ from: "kielbasa", to: "sausage", kind: "general" });
    expect(h.committed[0].log).toMatchObject({ term: "kielbasa", outcome: "novel", isReconfirm: true });
    expect(h.stamped).toEqual(["kielbasa"]);
    expect(h.merges).toHaveLength(0);
    expect(s).toMatchObject({ reconfirmed: 1, edges_added: 1, merged: 0, still_novel: 1, skipped: 0 });
  });

  it("excludes the node itself from the confirm candidates", async () => {
    let seen: string[] = [];
    const h = harness({
      nodes: [node({ id: "kielbasa" })],
      identities: [
        { id: "kielbasa", embedding: [1, 0, 0] },
        { id: "sausage", embedding: [1, 0, 0] },
      ],
      confirm: async (_term, candidates) => {
        seen = candidates;
        return confirm({ outcome: "novel" });
      },
    });
    await reconfirmIdentities(h.deps);
    expect(seen).toEqual(["sausage"]); // never the node itself
  });

  it("merges a `same` synonym via the representative (this node is always the loser)", async () => {
    const h = harness({
      nodes: [node({ id: "scallions" })],
      identities: [
        { id: "scallions", embedding: [1, 0, 0] },
        { id: "green onion", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "same", match: "green onion" }),
    });
    const s = await reconfirmIdentities(h.deps);
    expect(h.merges).toEqual([{ loser: "scallions", survivor: "green onion" }]);
    expect(h.committed).toHaveLength(0); // merge writes its own (re-confirm-marked) log
    expect(h.stamped).toEqual(["scallions"]);
    expect(s).toMatchObject({ merged: 1, still_novel: 0, reconfirmed: 1 });
  });

  it("adds a general edge to a known base on `specialization` but does NOT change the node id", async () => {
    const h = harness({
      nodes: [node({ id: "andouille" })],
      identities: [
        { id: "andouille", embedding: [1, 0, 0] },
        { id: "sausage", embedding: [1, 0, 0] },
      ],
      confirm: async () => confirm({ outcome: "specialization", match: "sausage", detail: "cajun" }),
    });
    await reconfirmIdentities(h.deps);
    // The safe subset: a general edge to the known base; the node's id is untouched (no base::detail).
    expect(h.committed[0].edges).toContainEqual({ from: "andouille", to: "sausage", kind: "general" });
    expect(h.committed[0].log).toMatchObject({ resolved_id: "andouille", outcome: "specialization", isReconfirm: true });
    expect(h.merges).toHaveLength(0);
    expect(h.stamped).toEqual(["andouille"]);
  });

  it("does NOT add a specialization edge when the matched base is not a known candidate", async () => {
    const h = harness({
      nodes: [node({ id: "andouille" })],
      identities: [
        { id: "andouille", embedding: [1, 0, 0] },
        { id: "sausage", embedding: [1, 0, 0] },
      ],
      // match is not in the neighbor set → validateConfirm would reject it live, but guard anyway.
      confirm: async () => confirm({ outcome: "specialization", match: "charcuterie", detail: "cajun" }),
    });
    await reconfirmIdentities(h.deps);
    expect(h.committed[0].edges).toEqual([]); // no invented edge to an unknown base
  });

  it("skips a node on a transient error, leaving it un-stamped (retried next tick), nothing written", async () => {
    const h = harness({
      nodes: [node({ id: "mystery" })],
      identities: [
        { id: "mystery", embedding: [1, 0, 0] },
        { id: "olive oil", embedding: [1, 0, 0] },
      ],
      confirm: async () => {
        throw new ToolError("storage_error", "AI down");
      },
    });
    const s = await reconfirmIdentities(h.deps);
    expect(h.committed).toHaveLength(0);
    expect(h.merges).toHaveLength(0);
    expect(h.stamped).toHaveLength(0); // un-stamped IS the retry state
    expect(s).toMatchObject({ skipped: 1, reconfirmed: 0 });
  });

  it("fails safe to a no-op on a contract-invalid confirm (stamped, nothing changed)", async () => {
    const h = harness({
      nodes: [node({ id: "weird thing" })],
      identities: [
        { id: "weird thing", embedding: [1, 0, 0] },
        { id: "olive oil", embedding: [1, 0, 0] },
      ],
      confirm: async () => {
        throw new ToolError("validation_failed", "bad output");
      },
    });
    const s = await reconfirmIdentities(h.deps);
    // Stamped so it isn't re-processed; NO edge/merge invented; logged as a re-confirm.
    expect(h.stamped).toEqual(["weird thing"]);
    expect(h.merges).toHaveLength(0);
    expect(h.committed[0].edges ?? []).toEqual([]);
    expect(h.committed[0].log).toMatchObject({ isReconfirm: true, detail: { note: "confirm_failed_safe" } });
    expect(s).toMatchObject({ reconfirmed: 1, still_novel: 1, skipped: 0 });
  });

  it("stamps an isolated node (no neighbors) with no confirm call", async () => {
    const h = harness({
      nodes: [node({ id: "lonely" })],
      identities: [{ id: "lonely", embedding: [1, 0, 0] }], // only itself → no neighbors after exclusion
    });
    const s = await reconfirmIdentities(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(h.stamped).toEqual(["lonely"]);
    expect(s).toMatchObject({ still_novel: 1, reconfirmed: 1 });
  });

  it("self-quiesces to a no-op with no model calls when nothing is eligible", async () => {
    const h = harness({ nodes: [], confirm: async () => confirm({}) });
    const s = await reconfirmIdentities(h.deps);
    expect(h.confirmCalls).toBe(0);
    expect(s).toMatchObject({ reconfirmed: 0, merged: 0, still_novel: 0, edges_added: 0, skipped: 0 });
  });
});

describe("readReconfirmBatch eligibility", () => {
  it("returns only edgeless + auto + concrete + un-stamped nodes, oldest first", async () => {
    const f = fakeD1({
      tables: {
        ingredient_identity: [
          // eligible: auto, concrete, edgeless, un-stamped
          { id: "kielbasa", base: "kielbasa", detail: null, source: "auto", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 100 },
          { id: "andouille", base: "andouille", detail: null, source: "auto", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 50 },
          // excluded: has an edge (connected already)
          { id: "ground beef::fat-80-20", base: "ground beef", detail: "fat-80-20", source: "auto", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 10 },
          // excluded: human node (authoritative)
          { id: "green onion", base: "green onion", detail: null, source: "human", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 20 },
          // excluded: already stamped
          { id: "olive oil", base: "olive oil", detail: null, source: "auto", concrete: 1, reconfirmed_at: 999, embedding: JSON.stringify([1, 0, 0]), decided_at: 30 },
          // excluded: concept node (concrete=0)
          { id: "fresh-soft-cheese", base: "fresh-soft-cheese", detail: null, source: "auto", concrete: 0, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 40 },
          // excluded: no stored embedding (can't retrieve neighbors — capture embeds it first)
          { id: "gochujang", base: "gochujang", detail: null, source: "auto", concrete: 1, reconfirmed_at: null, embedding: null, decided_at: 5 },
          // excluded: already MERGED away (representative set) — a co-resolution loser is auto,
          // concrete, edgeless AND un-stamped, so without the representative filter it would
          // re-qualify and re-confirm could silently redirect its existing merge target.
          { id: "courgette", base: "courgette", detail: null, source: "auto", concrete: 1, representative: "zucchini", reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 15 },
        ],
        ingredient_edge: [
          { from_id: "ground beef::fat-80-20", to_id: "ground beef", kind: "general" },
        ],
      },
    });
    const batch = await readReconfirmBatch(f.env, 10);
    // Only the two edgeless auto concrete un-stamped embedded UNMERGED nodes, oldest decided_at first.
    expect(batch.map((n) => n.id)).toEqual(["andouille", "kielbasa"]);
    expect(batch[0]).toMatchObject({ id: "andouille", base: "andouille", detail: null, embedding: [1, 0, 0] });
  });

  it("honors the limit", async () => {
    const f = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "a", base: "a", detail: null, source: "auto", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 1 },
          { id: "b", base: "b", detail: null, source: "auto", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 2 },
          { id: "c", base: "c", detail: null, source: "auto", concrete: 1, reconfirmed_at: null, embedding: JSON.stringify([1, 0, 0]), decided_at: 3 },
        ],
        ingredient_edge: [],
      },
    });
    const batch = await readReconfirmBatch(f.env, 2);
    expect(batch.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
