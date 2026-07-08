// The order + to-buy-view PURE DATA shapes (order-placement / member-app-grocery D9): a
// LEAF module with zero workerd references, so the app Playwright harness — whose
// tsconfig is deliberately workers-types-free — can type its order-dialog fixtures
// against the REAL op result (`import type { PlaceOrderOutcome }`) without absorbing
// the worker-typed module graph, and the member app can import the SAME wire shapes
// instead of hand-mirroring them. The runtime modules re-export these (matching.ts:
// CandidateView; order.ts: the line/result shapes; order-tools.ts: the input/outcome;
// to-buy.ts: the derived-view shapes), so every existing importer is unchanged.

import type { GroceryKind } from "./grocery.js";

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
  list: { advanced: boolean; error?: string };
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
}
