// Capture-first taste-substitution edges (converge-meal-planning-surfaces, D6/D7): the agent-side
// capture trigger + the edge-audit exclusion the writes make necessary. Over a REAL-SQLite env
// (migration 0048's weight/qualifier columns applied), because the capture relies on the atomic
// `ON CONFLICT … weight = weight + 1` increment and the audit reads' `kind != 'substitution'`
// filter — neither of which the SQL-regex fake simulates.
//
// A taste-substitution edge is captured when a member ACCEPTS a swap: an `add_to_grocery_list`
// annotated with `substitutes_for` (the recipe ingredient the added item stands in for). Detection
// is PURE SET LOGIC against the identity graph (no classifier): mint X → Y only when Y ≠ X and Y is
// not a factual neighbor of X. The edge is operator-global — born a weight-1 candidate, incremented
// on repeat, promoted (and surfaced by the depth-1 walk) at weight ≥ 2. Because these edges live in
// `ingredient_edge` alongside the factual satisfies edges, they are excluded BY KIND from the edge
// audit's reads so the satisfies re-audit can never select/delete one and the orphan lens is never
// masked.

import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { addGroceryRow } from "../src/session-db.js";
import {
  ingredientContext,
  captureSubstitution,
  readIdentityNeighbors,
  readEdgeAuditBatch,
  readAllEdges,
  SUBSTITUTION_KIND,
} from "../src/corpus-db.js";
import { readNodesPage } from "../src/normalize-admin.js";
import { readAuditObservability } from "../src/audit-admin.js";
import type { Env } from "../src/env.js";

const T = "casey";
const TODAY = "2026-07-09";

function seedNode(h: SqliteEnv, id: string, concrete = true, representative: string | null = null): void {
  h.raw
    .prepare(
      "INSERT INTO ingredient_identity (id, base, detail, concrete, representative, source, decided_at) VALUES (?, ?, ?, ?, ?, 'auto', 1)",
    )
    .run(
      id,
      id.includes("::") ? id.slice(0, id.indexOf("::")) : id,
      id.includes("::") ? id.slice(id.indexOf("::") + 2) : null,
      concrete ? 1 : 0,
      representative,
    );
}

function seedEdge(h: SqliteEnv, from: string, to: string, kind: string): void {
  h.raw
    .prepare("INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES (?, ?, ?, 'auto', 1)")
    .run(from, to, kind);
}

/** The substitution edges only, projected to the fields under test (drops source/decided_at/…). */
function subEdges(h: SqliteEnv): { from_id: string; to_id: string; kind: string; weight: number }[] {
  return h
    .rows<{ from_id: string; to_id: string; kind: string; weight: number }>("ingredient_edge")
    .filter((e) => e.kind === SUBSTITUTION_KIND)
    .map((e) => ({ from_id: e.from_id, to_id: e.to_id, kind: e.kind, weight: e.weight }));
}

describe("taste-substitution capture (agent-side, add_to_grocery_list substitutes_for)", () => {
  it("an accepted cross-canonical swap mints a weight-1 candidate, unsurfaced until promoted", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "sour cream");
    seedNode(h, "greek yogurt");

    const { item } = await addGroceryRow(h.env, T, { name: "greek yogurt", substitutes_for: "sour cream" }, TODAY);
    // The grocery add itself is unchanged by the capture signal.
    expect(item.name).toBe("greek yogurt");
    // X = substitutes_for (sour cream), Y = added item (greek yogurt): edge X → Y at weight 1.
    expect(subEdges(h)).toEqual([{ from_id: "sour cream", to_id: "greek yogurt", kind: "substitution", weight: 1 }]);
    // Weight 1 is a candidate — the depth-1 walk surfaces only PROMOTED (weight ≥ 2) edges.
    const neighbors = await readIdentityNeighbors(h.env, ["sour cream"]);
    expect(neighbors.get("sour cream")?.substitutions ?? []).toEqual([]);
  });

  it("a repeat observation promotes the edge to weight 2 and the walk surfaces it", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "sour cream");
    seedNode(h, "greek yogurt");

    await addGroceryRow(h.env, T, { name: "greek yogurt", substitutes_for: "sour cream" }, TODAY);
    await addGroceryRow(h.env, T, { name: "greek yogurt", substitutes_for: "sour cream" }, TODAY);

    expect(subEdges(h)).toEqual([{ from_id: "sour cream", to_id: "greek yogurt", kind: "substitution", weight: 2 }]);
    const neighbors = await readIdentityNeighbors(h.env, ["sour cream"]);
    const subs = neighbors.get("sour cream")?.substitutions ?? [];
    expect(subs.map((s) => s.id)).toEqual(["greek yogurt"]);
    expect(subs[0].weight).toBe(2);
  });

  it("no edge when the added item is already an identity neighbor of the replaced ingredient", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "scallion");
    seedNode(h, "green onion");
    // scallion satisfies green onion — a factual neighbor, so a swap between them is identity, not taste.
    seedEdge(h, "scallion", "green onion", "general");

    await addGroceryRow(h.env, T, { name: "scallion", substitutes_for: "green onion" }, TODAY);
    expect(subEdges(h)).toEqual([]);
  });

  it("no edge when the swap resolves to the same canonical id (a product/price swap)", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "green onion");
    h.raw
      .prepare("INSERT INTO ingredient_alias (variant, id, source, decided_at) VALUES (?, ?, 'auto', 1)")
      .run("scallions", "green onion");

    await addGroceryRow(h.env, T, { name: "scallions", substitutes_for: "green onion" }, TODAY);
    expect(subEdges(h)).toEqual([]);
  });

  it("is best-effort: an empty substitutes_for and a non-food add mint nothing and never fail the add", async () => {
    const h = sqliteEnv([T]);
    seedNode(h, "greek yogurt");

    // Blank substitutes_for resolves to empty → no-op; the add still succeeds.
    const { item: a } = await addGroceryRow(h.env, T, { name: "greek yogurt", substitutes_for: "   " }, TODAY);
    expect(a.name).toBe("greek yogurt");
    // A non-food add never enters the identity graph, so substitutes_for is ignored outright.
    const { item: b } = await addGroceryRow(
      h.env,
      T,
      { name: "paper towels", kind: "household", substitutes_for: "napkins" },
      TODAY,
    );
    expect(b.kind).toBe("household");
    expect(subEdges(h)).toEqual([]);
  });

  it("captureSubstitution swallows a graph-read failure (best-effort, never throws)", async () => {
    const h = sqliteEnv([T]);
    const ctx = await ingredientContext(h.env);
    // An env whose DB throws on every prepare — the neighbor read fails; capture must not propagate.
    const brokenEnv = {
      DB: {
        prepare() {
          throw new Error("boom");
        },
      },
    } as unknown as Env;
    await expect(captureSubstitution(brokenEnv, ctx, "sour cream", "greek yogurt")).resolves.toBeUndefined();
    // Nothing was written to the real graph either.
    expect(subEdges(h)).toEqual([]);
  });
});

describe("substitution edges are excluded from the identity edge audit", () => {
  it("the audit batch, the reverse-pair set, the backlog count, and the orphan lens all skip them", async () => {
    const h = sqliteEnv([T]);
    // A concrete node whose ONLY edge is an auto, un-audited substitution edge.
    seedNode(h, "sour cream");
    seedNode(h, "greek yogurt");
    // A factual auto un-audited edge alongside it, proving the exclusion is kind-specific.
    seedNode(h, "chicken");
    seedNode(h, "chicken::thighs");
    seedEdge(h, "chicken::thighs", "chicken", "general");
    // The captured substitution edge (auto, audited_at NULL — backlog-eligible by source + stamp).
    h.raw
      .prepare(
        "INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at, weight) VALUES ('sour cream','greek yogurt','substitution','auto',1,2)",
      )
      .run();

    // (a) the satisfies re-audit batch (which can DELETE edges) never selects the substitution edge.
    const batch = await readEdgeAuditBatch(h.env, 10);
    expect(batch.map((e) => e.kind)).toEqual(["general"]);
    expect(batch.some((e) => e.kind === "substitution")).toBe(false);

    // (b) the reverse-pair lookup set omits it (so it can't be a factual edge's 2-cycle casualty).
    expect((await readAllEdges(h.env)).some((e) => e.kind === "substitution")).toBe(false);

    // (c) the un-audited edge backlog count omits it (else it would never drain — it is never audited).
    const obs = await readAuditObservability(h.env);
    expect(obs.backlog.edge).toBe(1); // the factual general edge only

    // (d) the orphan lens is not masked: greek yogurt has only a substitution edge → still an orphan;
    //     the node with a real satisfies edge is not.
    const nodes = await readNodesPage(h.env);
    expect(nodes.orphans).toContain("greek yogurt");
    expect(nodes.orphans).toContain("sour cream");
    expect(nodes.orphans).not.toContain("chicken::thighs");
  });
});
