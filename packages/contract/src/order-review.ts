import { z } from "zod";

export const KNOWN_ORDER_REVIEW_CONTRACT_VERSION = 1;
export const ORDER_REVIEW_CONTRACT_FLOOR = 1;
export const ORDER_REVIEW_CONTRACT_CEILING = KNOWN_ORDER_REVIEW_CONTRACT_VERSION;

const PriceSchema = z.object({ regular: z.number().nonnegative(), promo: z.number().nonnegative() });
const FulfillmentSchema = z.object({ curbside: z.boolean(), delivery: z.boolean() });
export const OrderReviewProductSchema = z.object({
  sku: z.string().min(1), brand: z.string(), description: z.string(), size: z.string().nullable(),
  price: PriceSchema, on_sale: z.boolean(), unit_price: z.number().nonnegative().optional(),
  base_unit: z.string().optional(), fulfillment: FulfillmentSchema,
  aisle: z.object({ number: z.string().optional(), description: z.string().optional(), side: z.string().optional() }).nullable().optional(),
});

export const SelectionSourceSchema = z.enum(["matched", "same_identity", "broader", "manual", "impulse"]);
export const OrderReviewDivergenceSchema = z.object({
  category: z.enum(["list", "store", "availability", "selection", "quantity", "price", "promotion", "brand_preference"]),
  line_key: z.string().optional(), message: z.string(),
});
export const SearchDivergenceSchema = z.object({
  rung: z.enum(["general", "containment", "base", "search_term", "manual"]),
  requested_label: z.string(), searched_label: z.string(), relation: z.enum(["general", "containment"]).optional(),
  missing_constraints: z.array(z.string()), candidate_terms: z.array(z.string()),
});

const StageSelectionSchema = z.object({
  line_key: z.string().min(1), sku: z.string().min(1), source: SelectionSourceSchema.exclude(["matched"]),
  divergence: SearchDivergenceSchema.optional(),
});
const ImpulseSchema = z.object({ key: z.string().min(1), label: z.string().trim().min(2).max(80), sku: z.string().min(1).optional() });
const SavedBrandMarkerSchema = z.object({ family_key: z.string().min(1), brand: z.string().min(1) });

export const OrderReviewStageSchema = z.object({
  skipped: z.array(z.string()).default([]),
  quantities: z.record(z.string(), z.number().int().min(1).max(99)).default({}),
  selections: z.array(StageSelectionSchema).default([]),
  impulses: z.array(ImpulseSchema).default([]),
  saved_brands: z.array(SavedBrandMarkerSchema).default([]),
});

const BaseLineSchema = z.object({
  line_key: z.string(), name: z.string(), display_name: z.string().optional(), quantity: z.number().int().positive(),
  assumed_quantity: z.boolean(), for_recipes: z.array(z.string()), provenance: z.enum(["planned", "impulse"]),
});
export const OrderReviewMatchedLineSchema = BaseLineSchema.extend({
  selected: OrderReviewProductSchema, selection_source: SelectionSourceSchema,
  options: z.array(OrderReviewProductSchema), featured_swap: OrderReviewProductSchema.optional(),
  family_key: z.string(), family_fingerprint: z.string(),
});
export const OrderReviewDecisionLineSchema = BaseLineSchema.extend({
  kind: z.enum(["choose_one", "unavailable"]), candidates: z.array(OrderReviewProductSchema),
  family_key: z.string(), family_fingerprint: z.string(), can_save_brand: z.boolean(), can_search_broader: z.boolean(), can_search_manual: z.boolean(),
});
export const OrderReviewLeftOffSchema = z.object({
  line_key: z.string(), name: z.string(), reason: z.enum(["skipped", "undecided", "unavailable", "revalidation_failed", "underived"]),
});

export const OrderReviewDataSchema = z.object({
  contract_version: z.number().int(), preview_fingerprint: z.string(), grocery_snapshot_version: z.string(), as_of: z.string(),
  store: z.object({ name: z.string(), location_id: z.string() }).nullable(), quote_disclaimer: z.string(),
  stale_cart_count: z.number().int().nonnegative(), cleared_cart_ack_required: z.boolean(),
  matched: z.array(OrderReviewMatchedLineSchema), decisions: z.array(OrderReviewDecisionLineSchema),
  left_off: z.array(OrderReviewLeftOffSchema), underived: z.array(z.string()),
  counts: z.object({ going_to_cart: z.number().int().nonnegative(), needs_decision: z.number().int().nonnegative(), left_off: z.number().int().nonnegative() }),
  estimated_total: z.number().nullable(), flyer_savings: z.number().nullable(), stage: OrderReviewStageSchema,
});

export const CatalogSearchResultSchema = z.object({
  contract_version: z.number().int(), preview_fingerprint: z.string(), line_key: z.string(), query: z.string(),
  mode: z.enum(["broader", "manual"]), candidates: z.array(OrderReviewProductSchema.extend({ divergence: SearchDivergenceSchema.optional() })),
});

const BrandFamilySchema = z.object({ tiers: z.array(z.array(z.string())), any_brand: z.boolean() });
export const BrandSaveReceiptSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), family_key: z.string(), brand: z.string(), family: BrandFamilySchema, family_fingerprint: z.string(), changed: z.boolean() }),
  z.object({ status: z.literal("conflict"), family_key: z.string(), family: BrandFamilySchema.nullable(), family_fingerprint: z.string() }),
]);

const SendStepsSchema = z.object({
  list: z.object({ advanced: z.boolean(), rolled_back: z.boolean().optional(), error: z.string().optional() }),
  cart: z.object({ written: z.boolean(), count: z.number().int().nonnegative().optional(), error: z.string().optional(), code: z.string().optional() }),
  send: z.object({ recorded: z.boolean(), id: z.string().optional(), error: z.string().optional(), item_count: z.number().int().nonnegative().optional(), estimated_total: z.number().optional(), flyer_savings: z.number().optional() }),
  cache: z.object({ committed: z.boolean(), inserted: z.array(z.string()), updated: z.array(z.string()), unchanged: z.array(z.string()), error: z.string().optional() }),
});
const SendCommonSchema = z.object({ steps: SendStepsSchema, left_off: z.array(OrderReviewLeftOffSchema), verified_saved_brands: z.array(SavedBrandMarkerSchema) });
export const OrderReviewSendResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("review_changed"), preview: OrderReviewDataSchema, divergences: z.array(OrderReviewDivergenceSchema) }),
  z.object({ status: z.literal("cart_clearance_required"), preview: OrderReviewDataSchema }),
  z.object({ status: z.literal("preflight_failed"), code: z.string(), message: z.string(), preview: OrderReviewDataSchema.optional() }),
  SendCommonSchema.extend({ status: z.literal("send_failed") }),
  SendCommonSchema.extend({ status: z.literal("sent") }),
]);

export type OrderReviewStage = z.infer<typeof OrderReviewStageSchema>;
export type OrderReviewData = z.infer<typeof OrderReviewDataSchema>;
export type OrderReviewProduct = z.infer<typeof OrderReviewProductSchema>;
export type CatalogSearchResult = z.infer<typeof CatalogSearchResultSchema>;
export type BrandSaveReceipt = z.infer<typeof BrandSaveReceiptSchema>;
export type OrderReviewSendResult = z.infer<typeof OrderReviewSendResultSchema>;
export interface OrderReviewOutcome { send: OrderReviewSendResult; save_receipts: BrandSaveReceipt[] }
export interface OrderReviewModelContext { preview: OrderReviewData; stage: OrderReviewStage; save_receipts: BrandSaveReceipt[]; outcome?: OrderReviewSendResult; action_summary: string }

export function emptyOrderReviewStage(): OrderReviewStage {
  return { skipped: [], quantities: {}, selections: [], impulses: [], saved_brands: [] };
}
export function parseOrderReviewData(value: unknown): OrderReviewData { return OrderReviewDataSchema.parse(value); }
export function parseOrderReviewStage(value: unknown): OrderReviewStage { return OrderReviewStageSchema.parse(value); }
export function orderReviewContractSupport(version: unknown): "supported" | "older" | "newer" | "invalid" {
  if (!Number.isInteger(version)) return "invalid";
  if ((version as number) < ORDER_REVIEW_CONTRACT_FLOOR) return "older";
  if ((version as number) > ORDER_REVIEW_CONTRACT_CEILING) return "newer";
  return "supported";
}

export function canonicalOrderReviewValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalOrderReviewValue).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalOrderReviewValue(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export async function orderReviewFingerprint(value: unknown): Promise<string> {
  const runtime = globalThis as unknown as {
    crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
    TextEncoder: new () => { encode(value: string): Uint8Array };
  };
  const bytes = await runtime.crypto.subtle.digest("SHA-256", new runtime.TextEncoder().encode(canonicalOrderReviewValue(value)));
  return `sha256:${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
