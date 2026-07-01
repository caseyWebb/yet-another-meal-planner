import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import { readNodesPage } from "../src/normalize-admin.js";

// The Nodes lens reads the identity-graph structure — node list + directed satisfies-edges,
// orphan derivation, and stats — with edge endpoints representative-resolved. The seed mirrors
// nodes-data.jsx: a general-edge family, a concept membership, a merged pair, and an orphan.

function seeded() {
  return fakeD1({
    tables: {
      ingredient_identity: [
        // Sausage family — a base, a specialization (general edge), and an ORPHAN (kielbasa: no edge).
        { id: "sausage", base: "sausage", detail: null, concrete: 1, representative: null, source: "auto" },
        { id: "sausage::cajun", base: "sausage", detail: "cajun", concrete: 1, representative: null, source: "auto" },
        { id: "kielbasa", base: "kielbasa", detail: null, concrete: 1, representative: null, source: "auto" },
        // Concept class + a member (membership edge).
        { id: "fresh-soft-cheese", base: "fresh-soft-cheese", detail: null, concrete: 0, representative: null, source: "auto" },
        { id: "ricotta", base: "ricotta", detail: null, concrete: 1, representative: null, source: "human" },
        // Merged pair — cilantro re-keys to coriander; an edge on the merged id resolves to the survivor.
        { id: "coriander", base: "coriander", detail: null, concrete: 1, representative: null, source: "auto" },
        { id: "cilantro", base: "cilantro", detail: null, concrete: 1, representative: "coriander", source: "auto" },
        // A base whose only edge partner is the merged id (to exercise resolution on the OTHER side).
        { id: "herb", base: "herb", detail: null, concrete: 0, representative: null, source: "auto" },
      ],
      ingredient_alias: [
        { variant: "sausages", id: "sausage", source: "auto" },
        { variant: "link sausage", id: "sausage", source: "auto" },
        { variant: "cilantro leaves", id: "cilantro", source: "auto" }, // resolves through rep to coriander
      ],
      ingredient_edge: [
        { from_id: "sausage::cajun", to_id: "sausage", kind: "general" },
        { from_id: "ricotta", to_id: "fresh-soft-cheese", kind: "membership" },
        // An edge on the merged loser: cilantro → herb should surface on coriander (its survivor).
        { from_id: "cilantro", to_id: "herb", kind: "membership" },
      ],
    },
  });
}

describe("readNodesPage", () => {
  it("builds adjacency, orphans, concept/concrete, resolved edges, and stats", async () => {
    const page = await readNodesPage(seeded().env);
    const byId = Object.fromEntries(page.nodes.map((n) => [n.id, n]));

    // Nodes sorted by id, stable.
    expect(page.nodes.map((n) => n.id)).toEqual(
      [...page.nodes.map((n) => n.id)].sort((a, b) => a.localeCompare(b)),
    );

    // Directed adjacency: cajun satisfies sausage (outgoing on cajun, incoming on sausage).
    expect(byId["sausage::cajun"].outgoing).toContainEqual({ id: "sausage", kind: "general" });
    expect(byId["sausage::cajun"].incoming).toEqual([]);
    expect(byId["sausage"].incoming).toContainEqual({ id: "sausage::cajun", kind: "general" });
    expect(byId["sausage"].outgoing).toEqual([]);

    // Concept vs concrete.
    expect(byId["fresh-soft-cheese"].concrete).toBe(false);
    expect(byId["sausage"].concrete).toBe(true);

    // Membership edge into the concept class.
    expect(byId["fresh-soft-cheese"].incoming).toContainEqual({ id: "ricotta", kind: "membership" });

    // Representative-resolved edges: the edge stored on the merged id `cilantro` surfaces on its
    // survivor `coriander` (both endpoints resolved) — the merged loser itself carries none.
    expect(byId["coriander"].outgoing).toContainEqual({ id: "herb", kind: "membership" });
    expect(byId["herb"].incoming).toContainEqual({ id: "coriander", kind: "membership" });
    expect(byId["cilantro"].outgoing).toEqual([]);
    expect(byId["cilantro"].incoming).toEqual([]);

    // Aliases grouped by surviving id — the merged variant lands on the survivor, sorted.
    expect(byId["sausage"].aliases).toEqual(["link sausage", "sausages"]);
    expect(byId["coriander"].aliases).toEqual(["cilantro leaves"]);

    // rep + source flags.
    expect(byId["cilantro"].rep).toBe("coriander");
    expect(byId["coriander"].rep).toBe(null);
    expect(byId["ricotta"].source).toBe("human");

    // Orphan = concrete, non-merged, zero-degree. Only kielbasa qualifies.
    expect(page.orphans).toEqual(["kielbasa"]);
    expect(byId["kielbasa"].incoming).toEqual([]);
    expect(byId["kielbasa"].outgoing).toEqual([]);
    // A concept with no edges is NOT an orphan (orphan is a concrete signal); a merged node isn't either.
    expect(page.orphans).not.toContain("cilantro");

    // Stats.
    expect(page.stats).toEqual({ total: 8, concrete: 6, concepts: 2, orphans: 1 });
  });

  it("degrades to an empty-but-renderable model on an empty graph", async () => {
    const page = await readNodesPage(fakeD1().env);
    expect(page.nodes).toEqual([]);
    expect(page.orphans).toEqual([]);
    expect(page.stats).toEqual({ total: 0, concrete: 0, concepts: 0, orphans: 0 });
  });
});
