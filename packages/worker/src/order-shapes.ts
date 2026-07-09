// The order + to-buy-view PURE DATA shapes (order-placement / member-app-grocery D9): a
// LEAF module with zero workerd references, so the app Playwright harness — whose
// tsconfig is deliberately workers-types-free — can type its order-dialog fixtures
// against the REAL op result (`import type { PlaceOrderOutcome }`) without absorbing
// the worker-typed module graph, and the member app can import the SAME wire shapes
// instead of hand-mirroring them. The runtime modules re-export these (matching.ts:
// CandidateView; order.ts: the line/result shapes; order-tools.ts: the input/outcome;
// to-buy.ts: the derived-view shapes), so every existing importer is unchanged.

import type { GroceryKind } from "./grocery.js";

/** A Kroger per-item aisle placement at one store (the `KrogerCandidate.aisleLocation`
 *  shape, mirrored here so the leaf stays workerd-free — member-app-differentiators D5). */
export interface AisleLocation {
  number: string;
  description: string;
  side?: string;
}

/** One product candidate as surfaced to a caller (an ambiguous match / checkpoint pick). */
export interface CandidateView {
  sku: string;
  brand: string;
  size: string | null;
  price: { regular: number; promo: number };
  on_sale: boolean;
  unit_price?: number;
  fulfillment: { curbside: boolean; delivery: boolean };
}

export interface ResolvedLine {
  name: string;
  sku: string;
  brand: string;
  size: string | null;
  quantity: number;
  /** Carried from the to-buy line: quantity defaulted to 1 (no count supplied). */
  assumed_quantity: boolean;
  /** Fresh price at resolution — surfaced so the agent can sanity-check at preview. */
  price?: { regular: number; promo: number };
  /** Whether the resolved SKU is on sale at resolution (lets the agent spot a lapsed deal). */
  on_sale?: boolean;
  /** The resolved product's aisle placement at the caller's location, when Kroger
   *  reports one — threaded into the SKU-cache commit's aisle capture (D5). */
  aisleLocation?: AisleLocation | null;
}

export interface CheckpointLine {
  name: string;
  kind: "ambiguous" | "unavailable";
  candidates?: CandidateView[];
  message: string;
}

/** An item skipped because the pantry already has it (prompt candidate). */
export interface PartialItem {
  name: string;
  for_recipes: string[];
}

export interface PlaceOrderResult {
  resolved: ResolvedLine[];
  checkpoint: CheckpointLine[];
  sku_cache: { committed: boolean; error?: string };
  cart: { written: boolean; count?: number; error?: string; code?: string };
  /** The list advance runs BEFORE the cart write (double-add guard). On a cart
   *  failure the advance is rolled back to `active` (`rolled_back: true`); a failed
   *  rollback reports `{ advanced: true, rolled_back: false, error }` — items are
   *  marked in_cart with NO cart write, and a retried order will not re-add them. */
  list: { advanced: boolean; rolled_back?: boolean; error?: string };
  preview: boolean;
}

/** The order operation's input — the tool's schema shape, shared with the route. */
export interface PlaceOrderInput {
  menu_needs?: { name: string; quantity?: number; for_recipes?: string[] }[];
  quantities?: Record<string, number>;
  include_partials?: string[];
  overrides?: { name: string; sku: string; brand?: string; size?: string | null }[];
  /** Order-scoped opt-out: names resolved through the same funnel and dropped from the
   *  to-buy set BEFORE resolution — never persisted (member-app-grocery D4/D6). */
  exclude?: string[];
  preview?: boolean;
}

/** The order operation's result — the tool's return shape, shared with the route (and the
 *  app's order-dialog test fixtures type against it). */
export interface PlaceOrderOutcome extends PlaceOrderResult {
  partials: PartialItem[];
  /** Planned recipe slugs whose ingredient list is not yet derived — the caller can
   *  compensate (ask/add explicitly) rather than silently under-buy. */
  underived: string[];
}

// --- the derived to-buy view (member-app-grocery D1/D3) ---------------------------

/** One line of the derived to-buy view: the order-time line + its provenance. */
export interface ToBuyViewLine {
  name: string;
  /** Package count the order would use; derived rows default to 1 (`assumed_quantity`). */
  quantity: number;
  assumed_quantity: boolean;
  for_recipes: string[];
  /** `list` = an explicit row the plan does not need; `plan` = a virtual (derived) line
   *  with no stored row; `both` = a stored row the plan also needs (a materialization). */
  origin: "list" | "plan" | "both";
  /** The canonical merge key — the `grocery_list.normalized_name` a materialization of
   *  this line upserts under (so stored row + derived need can never duplicate). */
  key: string;
  kind: GroceryKind;
  domain: string;
  note?: string | null;
  /** Enriched read only (`read_to_buy` `enrich` / `?enrich=1` — member-app-differentiators
   *  D6): the line's captured placement at the caller's location, `department` derived
   *  from the identity graph when no aisle is captured. ABSENT on the default read
   *  (byte-identical). */
  placement?: LinePlacement | null;
  /** Enriched read only (inline-substitution-hints D1–D3): this line's cross-ingredient
   *  hints from the shared annotator (`annotateSubstitutes`) — identity-graph siblings
   *  each carrying `in_pantry` and, when the primary store's warmed flyer rollup matches,
   *  `on_sale_hint`. Computed under the SAME single Locations resolve the aisle
   *  enrichment pays. Always an array when the enriched read is served (empty, never
   *  omitted, for a line with no graph neighbors — honest sparsity, not a fabricated
   *  hint). ABSENT on the default read (byte-identical). */
  substitutes?: SiblingSuggestion[];
}

/** A to-buy line's placement on the aisle-enriched read (member-app-differentiators D6). */
export interface LinePlacement {
  aisle_number?: string;
  aisle_description?: string;
  aisle_side?: string;
  /** Graph-derived department fallback (the key's parent via out-edges, precedence
   *  membership → general → containment). Absent when the key has no parent. */
  department?: string;
}

/** A need the pantry cancels, joined with the pantry row's verify metadata. */
export interface PantryCoveredLine {
  name: string;
  for_recipes: string[];
  on_hand: { quantity?: string; category?: string; last_verified_at?: string };
}

/** A stored `in_cart` row — the deterministic stale-cart signal. */
export interface InCartLine {
  name: string;
  added_at: string;
}

/** The derived to-buy view (identical from the tool and the endpoint). */
export interface ToBuyView {
  to_buy: ToBuyViewLine[];
  pantry_covered: PantryCoveredLine[];
  in_cart: InCartLine[];
  underived: string[];
  /** Enriched read only (D6): the store the placements are for — null when no
   *  Kroger location is resolvable (placements then carry `department` only). ABSENT
   *  on the default read (byte-identical). */
  location?: { id: string } | null;
  /** Enriched read only (inline-substitution-hints D8): when the primary store's
   *  warmed flyer rollup that fed `substitutes[].on_sale_hint` was last refreshed
   *  (ISO 8601) — null when no rollup was used (cold cache, suppressed staleness, or
   *  no resolvable store). ABSENT on the default read (byte-identical). */
  flyer_as_of?: string | null;
}

// --- the substitution read (member-app-differentiators D1–D3) ----------------------

/** The `suggest_substitutions` / POST /api/grocery/substitutions input. */
export interface SuggestSubstitutionsInput {
  /** Absent = the caller's current derived to-buy set, in view order. */
  names?: string[];
  /** Per-call line budget; defaults to and is capped at 12 (D1). */
  max_lines?: number;
}

/** A product as the substitution read reports it (current pick / alternative). */
export interface SubstitutionProduct {
  sku: string;
  brand: string;
  description: string;
  size: string | null;
  price: { regular: number; promo: number };
  on_sale: boolean;
  available: boolean;
  unit_price?: number;
  base_unit?: string;
  aisleLocation: AisleLocation | null;
}

/** The closed, deterministic reason vocabulary (D2) — nothing else is ever produced. */
export type SubstitutionReason = "cheaper" | "on_sale" | "in_stock";

/** A same-identity alternative from the one term search, `compareUnitPrice`-ranked. */
export interface SubstitutionAlternative extends SubstitutionProduct {
  reasons: SubstitutionReason[];
}

/** A cross-ingredient sibling from the depth-1 identity-graph walk (D3), relation-labeled.
 *  Shared by the enriched to-buy read's per-line `substitutes[]` (`ToBuyViewLine`,
 *  computed by `annotateSubstitutes` — inline-substitution-hints D1). */
export interface SiblingSuggestion {
  /** The suggestion's canonical ingredient id (representative-resolved, concrete). */
  id: string;
  /** Human-readable label (base + detail). */
  label: string;
  relation: {
    role: "satisfies" | "sibling" | "generalization" | "substitution";
    kind: "general" | "containment" | "membership" | "substitution";
    /** The shared parent, for `role: "sibling"`. */
    via?: string;
    /** Substitution relations only (`role: "substitution"`): the accrued observation weight of
     *  the promoted `substitution` edge, and its optional authored qualifier (a sub ratio like
     *  `1:2`, a leavening/cook-time caveat). A substitute is a taste judgment surfaced AFTER every
     *  factual identity relation — it never gates a match or a purchase (excluded from
     *  `satisfies()`); the narrower weighs fitness. */
    weight?: number;
    qualifier?: string;
  };
  /** A pantry row exists for this id — already on hand. */
  in_pantry: boolean;
  /** The primary store's flyer rollup carries a matching sale item (default sale floor). */
  on_sale_hint?: { sku: string; description: string; price: { regular: number; promo: number }; savings: number };
}

/** One line's substitution suggestions — the alternatives-only op (inline-substitution-
 *  hints D4). Cross-ingredient sibling suggestions live on the enriched to-buy read's
 *  `substitutes[]` instead (`ToBuyViewLine`), not here. */
export interface LineSuggestions {
  for: { name: string; key: string; origin?: "list" | "plan" | "both" };
  status: "ok" | "current_unavailable" | "no_cached_pick";
  current: SubstitutionProduct | null;
  alternatives: SubstitutionAlternative[];
}

/** The substitution read's result — shared by the tool and the endpoint (D1). */
export interface SuggestSubstitutionsResult {
  suggestions: LineSuggestions[];
  /** Names not processed this call (the per-call budget) — call again with these. */
  remaining: string[];
  /** The resolved Kroger location, or null (walk-store degradation). */
  location: { id: string } | null;
}
