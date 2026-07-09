// The shared substitute annotator (inline-substitution-hints D1/D3): the deterministic
// CHEAP half of what member-app-differentiators originally shipped as one op behind
// `suggest_substitutions` — the PURE depth-1 identity-graph walk (`identitySiblings`)
// plus the `in_pantry` / `on_sale_hint` joins (`annotateSubstitutes`). Factored into its
// own leaf module so BOTH the enriched to-buy read (`to-buy.ts`) and the slimmed
// alternatives-only op (`substitutions.ts`, which still calls `computeToBuyView` for its
// default line source) can depend on this without a module cycle between the two.
//
//   identitySiblings — the PURE depth-1 walk over the persisted identity graph:
//     satisfies (in-edges, any kind) → general-kind siblings → generalizations
//     (out-edges, general/containment only) → containment-kind siblings →
//     membership-kind siblings; lexicographic within each tier, deduped
//     first-relation-wins, concrete targets only, excluding the line itself and the
//     caller's to-buy set, capped. Every suggestion carries its relation label — the
//     walk proposes and NAMES the relation; fitness judgment stays with the member or
//     the LLM (the architecture's narrowing step).
//
//   annotateSubstitutes — batches the walk over EVERY requested line key in ONE
//     `readIdentityNeighbors` call (no per-line N+1: the enriched read covers the
//     whole to-buy set, not a budgeted subset), excluding each OTHER requested key's
//     survivor id (a suggestion never proposes an id already in the caller's own
//     to-buy set), then annotates each sibling `in_pantry` (an already-loaded pantry
//     names set) and `on_sale_hint` (a match against the caller's already-resolved,
//     already-staleness-filtered primary-store flyer rollup — no per-sibling search,
//     no KV touch of its own). Pure D1 + already-resolved inputs; issues no Kroger call.

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
 *  already loads once per call: a pre-loaded pantry names set, the caller's primary
 *  store's flyer rollup ALREADY resolved + staleness-filtered (`readStoreFlyer` +
 *  `filterByMinSavings` + `isSatelliteRollupStale` — the caller's job, so this stays a
 *  pure join), and the ingredient context (for the flyer match's search-term lookup). */
export interface AnnotateSubstitutesDeps {
  pantry: ReadonlySet<string>;
  saleItems: FlyerItem[];
  ctx: Pick<IngredientContext, "searchTerm">;
  /** Pre-loaded `readIdentityNeighbors` result over the SAME `lineKeys` set — e.g.
   *  `to-buy.ts`'s own read for its department fallback. When supplied, this function
   *  reuses it instead of issuing a second identical identity-graph scan. Absent, it
   *  loads its own (the standalone posture the isolation unit tests exercise). */
  neighborsByKey?: Map<string, IdentityNeighbors>;
}

/**
 * The shared cheap half (D1/D3): one batched `readIdentityNeighbors` call over EVERY
 * `lineKeys` entry (or the caller's own pre-loaded read over the identical set, via
 * `deps.neighborsByKey` — see `to-buy.ts`'s enriched read), each line's walk excluded
 * against the survivor ids of that SAME set (a suggestion never proposes an id already
 * in the caller's own to-buy set), every sibling annotated `in_pantry` + `on_sale_hint`.
 * Pure D1 + already-resolved inputs — no KV touch, no Kroger call. Returns one entry
 * per requested key (an empty array for a no-edge line, never omitted — honest
 * sparsity).
 */
export async function annotateSubstitutes(
  env: Env,
  lineKeys: string[],
  deps: AnnotateSubstitutesDeps,
): Promise<Map<string, SiblingSuggestion[]>> {
  const neighborsByKey = deps.neighborsByKey ?? (await readIdentityNeighbors(env, lineKeys));

  // A suggestion never proposes an id already in the caller's OWN to-buy set — the
  // exclusion set is the survivor ids of every requested line (representative-resolved).
  const excludeIds = new Set<string>();
  for (const key of lineKeys) {
    const n = neighborsByKey.get(key);
    excludeIds.add(n ? n.id : key);
  }

  const out = new Map<string, SiblingSuggestion[]>();
  for (const key of lineKeys) {
    const neighbors = neighborsByKey.get(key);
    const siblings: SiblingSuggestion[] = (neighbors ? identitySiblings(neighbors, excludeIds) : []).map((s) => ({
      ...s,
      in_pantry: deps.pantry.has(s.id),
      ...(() => {
        const hint = flyerHint(deps.saleItems, baseOf(s.id), deps.ctx.searchTerm(s.id));
        return hint ? { on_sale_hint: hint } : {};
      })(),
    }));
    out.set(key, siblings);
  }
  return out;
}
