import { z } from "zod";

export const AisleMapStateSchema = z.enum(["unknown", "stale", "mapped"]);
export type AisleMapState = z.infer<typeof AisleMapStateSchema>;

export const AisleMapSummarySchema = z.object({
  state: AisleMapStateSchema,
  aisle_count: z.number().int().nonnegative(),
  as_of: z.string().nullable(),
});
export type AisleMapSummary = z.infer<typeof AisleMapSummarySchema>;

export const AisleMapEntrySchema = z.object({
  aisle_id: z.string().min(1),
  label: z.string().min(1),
  order: z.number().nullable(),
  sections: z.array(z.string().min(1)),
  visibility: z.enum(["shared", "private"]),
  observed_at: z.string(),
  note_id: z.string(),
  author: z.string().optional(),
});
export type AisleMapEntry = z.infer<typeof AisleMapEntrySchema>;

export const AisleMapDocumentSchema = z.object({
  store_slug: z.string(),
  effective: z.array(AisleMapEntrySchema),
  mine: z.array(AisleMapEntrySchema),
  summary: AisleMapSummarySchema,
  etag: z.string(),
});
export type AisleMapDocument = z.infer<typeof AisleMapDocumentSchema>;

export const AisleMapWriteSchema = z.object({
  entries: z.array(z.object({
    aisle_id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    sections: z.array(z.string().trim().min(1).max(120)).max(80),
    visibility: z.enum(["shared", "private"]).default("shared"),
  })).max(100),
}).strict();
export type AisleMapWrite = z.infer<typeof AisleMapWriteSchema>;

export const ShopCommitRequestSchema = z.object({
  session_id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, "session_id must be a ULID"),
  mode: z.enum(["store_walk", "manual_shop"]),
  store_slug: z.string().trim().min(1).nullable(),
  expected_checked_keys: z.array(z.string().trim().min(1).max(240)).min(1).max(500),
  snapshot_version: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  occurred_at: z.string().datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "store_walk" && !value.store_slug) ctx.addIssue({ code: "custom", path: ["store_slug"], message: "store_slug is required for a store walk" });
  if (value.mode === "manual_shop" && value.store_slug !== null) ctx.addIssue({ code: "custom", path: ["store_slug"], message: "store_slug must be null for a manual shop" });
  const sorted = [...new Set(value.expected_checked_keys)].sort();
  if (sorted.length !== value.expected_checked_keys.length || sorted.some((key, i) => key !== value.expected_checked_keys[i])) {
    ctx.addIssue({ code: "custom", path: ["expected_checked_keys"], message: "keys must be sorted and unique" });
  }
});
export type ShopCommitRequest = z.infer<typeof ShopCommitRequestSchema>;

export const ShopReceiptLineSchema = z.object({
  key: z.string(), name: z.string(), quantity: z.union([z.string(), z.number()]), purchase_count: z.number().int().positive(),
  quantity_assumed: z.boolean(), kind: z.enum(["grocery", "household", "other"]), domain: z.string(),
  pantry_received: z.boolean(), price_source: z.enum(["sku_cache", "flyer", "last_paid", "unpriced"]),
  unit_price: z.number().nullable(), amount: z.number().nullable(), savings: z.number().nullable(),
  department: z.string().nullable(), provenance: z.enum(["planned", "impulse"]),
});
export type ShopReceiptLine = z.infer<typeof ShopReceiptLineSchema>;

export const ShopReceiptSchema = z.object({
  session_id: z.string(), mode: z.enum(["store_walk", "manual_shop"]), store_slug: z.string().nullable(),
  domain: z.string(), occurred_at: z.string(), committed_at: z.string(), lines: z.array(ShopReceiptLineSchema),
  totals: z.object({ items: z.number().int().nonnegative(), priced: z.number().int().nonnegative(), amount: z.number(), savings: z.number() }),
});
export type ShopReceipt = z.infer<typeof ShopReceiptSchema>;

export type ShopCommitResult =
  | { outcome: "committed" | "replayed"; receipt: ShopReceipt; snapshot: import("./grocery.js").GroceryListData }
  | { outcome: "checked_set_changed"; current_checked_keys: string[]; snapshot: import("./grocery.js").GroceryListData }
  | { outcome: "idempotency_conflict"; receipt: ShopReceipt };

export interface OfflineWalkRouteGroup {
  id: string;
  label: string;
  placement_source: "location_note" | "section_map" | "cold_last" | "unmapped";
  line_keys: string[];
  warning: "stale_map" | null;
}

export interface OfflineWalkContext {
  store_slug: string;
  shared_name: string;
  display_name: string;
  domain: string;
  aisle_map: AisleMapSummary;
  groups: OfflineWalkRouteGroup[];
  observed_at: string | null;
}
