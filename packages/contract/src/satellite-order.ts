// The satellite ORDER-FILL wire contract — the source of truth for the two direct
// `POST /satellite/order/list` and `POST /satellite/order/receipt` payloads, shared by the
// Worker (serves the pull-list, validates the receipt) and, in a later phase, the satellite's
// local helper (fetches the pull-list, posts the receipt). Because both runtimes import this
// module, the pull-list + receipt shapes can never drift.
//
// Order-fill is a DIRECT request/response (satellite-order-cart-fill), NOT a pull-channel task
// and NOT a push batch: ordering is human-directed and a store cart write is a non-idempotent
// side effect, so there is no claim/lease/task. The per-item cart-fill outcomes ride the shared
// observation union as the `order` kind (./ingest.ts); this module carries the two envelopes
// that wrap them.
//
// See openspec specs/satellite-order-cart-fill.

import { z } from "zod";
import { MAX_BATCH_ITEMS, LocalRejectsSchema, type ItemResult, type ParseResult, type LocalReject } from "./ingest.js";

/** Format a ZodError's issues into a compact, field-scoped message (mirrors ./ingest.ts). */
function fmtIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * One line of the pull-list (`POST /satellite/order/list`): the tenant's `computeToBuy` result
 * for the satellite to fill, carrying its canonical ingredient id (`item_id`, === the issued
 * order-list's authoritative key AND `grocery_list.normalized_name`) plus the display fields the
 * human sees. `assumed_quantity` flags a line whose package count defaulted to 1.
 */
export const OrderLineSchema = z.object({
  item_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  for_recipes: z.array(z.string()),
  assumed_quantity: z.boolean(),
});
export type OrderLine = z.infer<typeof OrderLineSchema>;

/** A pull-list line skipped because the pantry already has it — surfaced for the human to decide. */
export interface OrderPartial {
  name: string;
  for_recipes: string[];
}

/**
 * The pull-list response the Worker serves for a satellite-fulfilled tenant: the freshly-resolved
 * to-buy set, the tenant's primary store slug + location id, and the issued `order_list_id` (the
 * receipt correlation key + authoritative issued-set record). `location_id` MAY be null (a
 * satellite store's location is the operator's `preferred_location` label, which may be unset).
 */
export interface OrderListResponse {
  order_list_id: string;
  store: string;
  location_id: string | null;
  items: OrderLine[];
  partials: OrderPartial[];
}

/**
 * The receipt request the local helper posts (`POST /satellite/order/receipt`): the issued
 * `order_list_id`, the per-item `order` observations (kept RAW here — each is validated one-by-one
 * downstream with `parseObservationItem`, so one malformed item never sinks the receipt, mirroring
 * the pull-channel results envelope), and the optional `mark_placed` flag (a re-post with no new
 * observations that advances the issued `in_cart` lines to `ordered` after the human checked out).
 */
export interface OrderReceiptRequest {
  order_list_id: string;
  /** Present on a fill receipt — the per-item `order` observations; each validated individually. */
  observations?: unknown[];
  /** True on the optional mark-placed re-post (advance issued in_cart lines to ordered). */
  mark_placed?: boolean;
  /**
   * Additive, OPTIONAL local-reject summary (satellite-source-audit) — the emits the cart-fill
   * adapter's validator dropped locally, pre-aggregated per category. Recorded `origin: local` by
   * the Worker.
   */
  local_rejects?: LocalReject[];
}

/** The LENIENT receipt envelope the Worker validates against (observations stay raw for per-item validation). */
const OrderReceiptEnvelopeSchema = z.object({
  order_list_id: z.string().trim().min(1),
  observations: z.array(z.unknown()).max(MAX_BATCH_ITEMS).optional(),
  mark_placed: z.boolean().optional(),
  local_rejects: LocalRejectsSchema.optional(),
});

/** The receipt endpoint's response: the order-list's post-application status + the per-item intake results. */
export interface OrderReceiptResponse {
  order_list: { id: string; status: string };
  results: ItemResult[];
}

/** Validate a raw body as an order-receipt request META (observations stay raw for per-item validation). */
export function parseOrderReceiptRequest(input: unknown): ParseResult<OrderReceiptRequest> {
  const r = OrderReceiptEnvelopeSchema.safeParse(input);
  if (r.success) {
    return {
      ok: true,
      value: {
        order_list_id: r.data.order_list_id,
        ...(r.data.observations !== undefined ? { observations: r.data.observations } : {}),
        ...(r.data.mark_placed !== undefined ? { mark_placed: r.data.mark_placed } : {}),
        ...(r.data.local_rejects !== undefined ? { local_rejects: r.data.local_rejects } : {}),
      },
    };
  }
  return { ok: false, error: fmtIssues(r.error) };
}
