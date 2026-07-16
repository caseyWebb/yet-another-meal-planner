// The shared substitute annotator (inline-substitution-hints D1/D3, narrowed to
// ACTIONABLE-only by scope-substitution-suggestions): the deterministic CHEAP half of
// what member-app-differentiators originally shipped as one op behind
// `suggest_substitutions` — the PURE depth-1 identity-graph walk (`identitySiblings`)
// plus the `in_pantry` / `in_cart` / `on_list` / `on_sale_hint` actionability filter
// (`annotateSubstitutes`). Factored into its own leaf module so BOTH the enriched to-buy
// read (`to-buy.ts`) and the slimmed alternatives-only op (`substitutions.ts`, which
// still calls `computeToBuyView` for its default line source) can depend on this without
// a module cycle between the two.
//
//   identitySiblings — the PURE depth-1 walk over the persisted identity graph:
//     satisfies (in-edges, any kind) → general-kind siblings → generalizations
//     (out-edges, general/containment only) → containment-kind siblings →
//     membership-kind siblings; lexicographic within each tier, deduped
//     first-relation-wins, concrete targets only, excluding the line itself. Every
//     suggestion carries its relation label — the walk proposes and NAMES the relation;
//     fitness judgment stays with the member or the LLM (the architecture's narrowing
//     step).
//
//   annotateSubstitutes — batches the walk over EVERY requested line key in ONE
//     `readIdentityNeighbors` call (no per-line N+1: the enriched read covers the
//     whole to-buy set, not a budgeted subset), takes the FULL ordered walk UNCAPPED
//     (no to-buy-set exclusion — a walked target's OWN actionability decides its fate,
//     not whether it happens to share the caller's batch), computes each target's
//     reasons — `in_pantry` (an already-loaded pantry names set), `in_cart` / `on_list`
//     (the caller's already-loaded cart/active-list key sets), `on_sale_hint` (a match
//     against the caller's already-resolved, already-staleness-filtered primary-store
//     flyer rollup, no per-sibling search, no KV touch of its own) — keeps only targets
//     with at least one truthy reason (on-sale independent; the three possession
//     reasons require membership), preserving precedence order, THEN slices to
//     `SIBLINGS_CAP` — filter BEFORE the cap, never after, or an actionable target
//     ranked past the raw cap would starve behind non-actionable higher-precedence ones.
//     Pure D1 + already-resolved inputs; issues no Kroger call.

import type { Env } from "./env.js";
import { readIdentityNeighbors, type IdentityNeighbor, type IdentityNeighbors, type IngredientContext } from "./corpus-db.js";
import { baseOf, type FlyerItem } from "./matching.js";
import type { SiblingSuggestion } from "./order-shapes.js";

export type { SiblingSuggestion } from "./order-shapes.js";

/** Sibling suggestions returned per line — membership-last means a broad class
 *  family only surfaces when nothing better exists. */
export const SIBLINGS_CAP = 4;

const EDGE_KINDS = new Set(["general", "containment", "membership"]);

type Relation = SiblingSuggestion["relation"];
type WalkSuggestion = Pick<SiblingSuggestion, "id" | "label" | "relation">;

/**
 * The pure D3 walk over one line's depth-1 neighbor sets. Emits suggestions in the
 * fixed precedence satisfies → `general`-kind siblings → generalizations →
 * `containment`-kind siblings → `membership`-kind siblings, each tier ordered
 * lexicographically by id, deduped across tiers (first relation wins). Targets must
 * be concrete (buyable); the line itself (`neighbors.id`) and anything in `exclude`
 * (the caller's to-buy set, resolved) never surface. Depth is exactly one edge, or
 * two edges through one shared parent — no transitive chains.
 */
export function identitySiblings(
  neighbors: IdentityNeighbors,
  exclude: ReadonlySet<string> = new Set(),
  cap = SIBLINGS_CAP,
): WalkSuggestion[] {
  const x = neighbors.id;
  const admissible = (n: IdentityNeighbor): boolean =>
    n.concrete && n.id !== x && !exclude.has(n.id) && EDGE_KINDS.has(n.kind);
  const byId = (a: IdentityNeighbor, b: IdentityNeighbor): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const tier = (entries: IdentityNeighbor[], role: Relation["role"]): WalkSuggestion[] =>
    [...entries].filter(admissible).sort(byId).map((n) => ({
      id: n.id,
      label: n.label,
      relation: {
        role,
        kind: n.kind as Relation["kind"],
        ...(role === "sibling" && n.via !== undefined ? { via: n.via } : {}),
      },
    }));

  // Promoted substitution targets, ordered + labeled like a tier but sourced from the SEPARATE
  // `substitutions` field (a `SubstitutionNeighbor` has no edge `kind`/`via` — it carries weight +
  // an optional qualifier), so it bypasses `admissible`'s EDGE_KINDS gate. Depth-1, concrete only,
  // and — because substitution edges are excluded from satisfies() — surfacing it changes no match.
  const subTier: WalkSuggestion[] = [...neighbors.substitutions]
    .filter((n) => n.concrete && n.id !== x && !exclude.has(n.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({
      id: n.id,
      label: n.label,
      relation: {
        role: "substitution" as const,
        kind: "substitution" as const,
        weight: n.weight,
        ...(n.qualifier ? { qualifier: n.qualifier } : {}),
      },
    }));

  const tiers: WalkSuggestion[][] = [
    // satisfies — any kind: the edge's defining semantics (usable where x is requested).
    tier(neighbors.satisfiedBy, "satisfies"),
    // same-kind co-children, general first (the specialization families).
    tier(neighbors.coChildren.filter((n) => n.kind === "general"), "sibling"),
    // generalizations — what x itself satisfies; membership targets are classes, not purchases.
    tier(neighbors.satisfies.filter((n) => n.kind === "general" || n.kind === "containment"), "generalization"),
    tier(neighbors.coChildren.filter((n) => n.kind === "containment"), "sibling"),
    // membership co-children last + capped: a `vegetables`-style broad family only
    // surfaces when nothing better exists, always labeled with its `via` parent.
    tier(neighbors.coChildren.filter((n) => n.kind === "membership"), "sibling"),
    // substitution edges LAST: a TASTE substitute always ranks behind every factual identity
    // relation (first-relation-wins keeps a factual target ahead of a substitution one).
    subTier,
  ];

  const out: WalkSuggestion[] = [];
  const seen = new Set<string>();
  for (const t of tiers) {
    for (const s of t) {
      if (seen.has(s.id)) continue; // first relation wins
      seen.add(s.id);
      out.push(s);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Match a sibling against the flyer rollup's sale items (D3): a `FlyerItem` whose
 *  `matched_terms` contains the sibling's base or search_term as an ELEMENT — or, for
 *  satellite rollups whose `matched_terms` is empty by contract, whose lowercased
 *  description contains either as a substring. No per-sibling Kroger search, ever. */
function flyerHint(saleItems: FlyerItem[], base: string, searchTerm: string): SiblingSuggestion["on_sale_hint"] {
  const terms = [base.toLowerCase(), searchTerm.toLowerCase()];
  for (const item of saleItems) {
    const hit =
      item.matched_terms.length > 0
        ? item.matched_terms.some((t) => terms.includes(t.toLowerCase()))
        : terms.some((t) => item.description.toLowerCase().includes(t));
    if (hit) return { sku: item.sku, description: item.description, price: item.price, savings: item.savings };
  }
  return undefined;
}

/** Deps for `annotateSubstitutes` — the pieces a caller (`to-buy.ts`'s enriched read)
 *  already loads once per call: a pre-loaded pantry names set, the caller's `in_cart` /
 *  active-list grocery key sets (`storedGroceryKey`-keyed — scope-substitution-
 *  suggestions), the caller's primary store's flyer rollup ALREADY resolved +
 *  staleness-filtered (`readStoreFlyer` + `filterByMinSavings` + `isSatelliteRollupStale`
 *  — the caller's job, so this stays a pure join), and the ingredient context (for the
 *  flyer match's search-term lookup). */
export interface AnnotateSubstitutesDeps {
  pantry: ReadonlySet<string>;
  /** Resolved ids of the caller's `in_cart` grocery rows — an actionability reason
   *  (scope-substitution-suggestions). */
  inCart: ReadonlySet<string>;
  /** Resolved ids of the caller's `active` grocery-list rows — an actionability reason:
   *  a walked target already on the active list surfaces as a consolidation nudge
   *  (scope-substitution-suggestions), superseding the old to-buy-set exclusion. */
  onList: ReadonlySet<string>;
  saleItems: FlyerItem[];
  ctx: Pick<IngredientContext, "searchTerm">;
  /** Pre-loaded `readIdentityNeighbors` result over the SAME `lineKeys` set — e.g.
   *  `to-buy.ts`'s own read for its department fallback. When supplied, this function
   *  reuses it instead of issuing a second identical identity-graph scan. Absent, it
   *  loads its own (the standalone posture the isolation unit tests exercise). */
  neighborsByKey?: Map<string, IdentityNeighbors>;
}

/**
 * The shared cheap half (D1/D3), narrowed to ACTIONABLE suggestions only
 * (scope-substitution-suggestions): one batched `readIdentityNeighbors` call over EVERY
 * `lineKeys` entry (or the caller's own pre-loaded read over the identical set, via
 * `deps.neighborsByKey` — see `to-buy.ts`'s enriched read). Each line's walk is taken
 * UNCAPPED (`identitySiblings(neighbors, new Set(), Infinity)` — no to-buy-set exclusion
 * either: a walked target's own actionability decides its fate, not whether some OTHER
 * requested key already claims its id), every candidate annotated `in_pantry` / `in_cart`
 * / `on_list` / `on_sale_hint`, filtered to those carrying at least one truthy reason
 * (on-sale independent; the other three require membership) WHILE preserving precedence
 * order, THEN sliced to `SIBLINGS_CAP` — filter before the cap, never after, so an
 * actionable target ranked past the raw cap still gets its chance. Pure D1 +
 * already-resolved inputs — no KV touch, no Kroger call. Returns one entry per requested
 * key (an empty array for a no-edge or no-actionable-neighbor line, never omitted —
 * honest sparsity).
 */
export async function annotateSubstitutes(
  env: Env,
  lineKeys: string[],
  deps: AnnotateSubstitutesDeps,
): Promise<Map<string, SiblingSuggestion[]>> {
  const neighborsByKey = deps.neighborsByKey ?? (await readIdentityNeighbors(env, lineKeys));

  const out = new Map<string, SiblingSuggestion[]>();
  for (const key of lineKeys) {
    const neighbors = neighborsByKey.get(key);
    // A sibling's `via` is one of THIS line's satisfies-parents, each already carrying a
    // curated `labelOf` label — reuse it (reify-ingredient-display-names Tier 2) so the
    // relation target renders human while `via` keeps the raw parent id.
    const viaLabels = new Map((neighbors?.satisfies ?? []).map((p) => [p.id, p.label] as const));
    // The full precedence-ordered walk, UNCAPPED — see the function doc for why (Decision 1).
    const walked = neighbors ? identitySiblings(neighbors, new Set(), Infinity) : [];
    const siblings: SiblingSuggestion[] = [];
    for (const s of walked) {
      const in_pantry = deps.pantry.has(s.id);
      const in_cart = deps.inCart.has(s.id);
      const on_list = deps.onList.has(s.id);
      const on_sale_hint = flyerHint(deps.saleItems, baseOf(s.id), deps.ctx.searchTerm(s.id));
      // Actionable iff at least one reason holds — on-sale is INDEPENDENT (surfaces even
      // when unowned); the three possession reasons each require the member to actually
      // have, be carting, or already be listing the target. Filtered BEFORE the cap
      // below, preserving the walk's precedence order (Decision 1).
      if (!in_pantry && !in_cart && !on_list && !on_sale_hint) continue;
      if (siblings.length >= SIBLINGS_CAP) break; // cap AFTER the filter, never before
      const relation =
        s.relation.via !== undefined
          ? { ...s.relation, via_label: viaLabels.get(s.relation.via) ?? s.relation.via }
          : s.relation;
      siblings.push({
        id: s.id,
        label: s.label,
        relation,
        in_pantry,
        ...(in_cart ? { in_cart: true } : {}),
        ...(on_list ? { on_list: true } : {}),
        ...(on_sale_hint ? { on_sale_hint } : {}),
      });
    }
    out.set(key, siblings);
  }
  return out;
}
