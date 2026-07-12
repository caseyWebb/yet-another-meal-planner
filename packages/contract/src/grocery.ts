import { z } from "zod";

import type { OfflineWalkContext } from "./shop.js";

export const KNOWN_GROCERY_CONTRACT_VERSION = 2;
export const GROCERY_CONTRACT_FLOOR = 1;
export const GROCERY_CONTRACT_CEILING = KNOWN_GROCERY_CONTRACT_VERSION;

const RecipeAttributionSchema = z.object({
  slug: z.string(),
  planned_for: z.string().nullable().optional(),
  plan_id: z.string().optional(),
});

const GroceryLineSchema = z.object({
  key: z.string(),
  name: z.string(),
  display_name: z.string().optional(),
  quantity: z.union([z.string(), z.number()]),
  assumed_quantity: z.boolean().optional(),
  kind: z.enum(["grocery", "household", "other"]),
  domain: z.string(),
  origin: z.enum(["list", "plan", "both"]),
  source: z.enum(["ad_hoc", "menu", "pantry_low", "stockup"]).optional(),
  staple: z.boolean().optional(),
  status: z.enum(["active", "in_cart", "ordered"]).optional(),
  checked_at: z.string().nullable(),
  row_version: z.number().int().nonnegative(),
  updated_at: z.string().nullable(),
  note: z.string().nullable().optional(),
  for_recipes: z.array(z.string()),
  recipe_attribution: z.array(RecipeAttributionSchema).optional(),
  placement: z.object({
    section: z.string().optional(),
    aisle_number: z.string().optional(),
    aisle_side: z.string().optional(),
  }).nullable().optional(),
  substitutes: z.array(z.unknown()).optional(),
});

const PantryCoveredSchema = z.object({
  key: z.string(),
  name: z.string(),
  display_name: z.string().optional(),
  for_recipes: z.array(z.string()),
  freshness: z.enum(["covered", "worth_a_look"]),
  freshness_reason: z.string().optional(),
  on_hand: z.object({
    quantity: z.string().optional(),
    category: z.string().optional(),
    last_verified_at: z.string().optional(),
  }),
  buy_anyway: z.boolean(),
});

const SendLineSchema = z.object({
  key: z.string(),
  name: z.string(),
  quantity: z.union([z.string(), z.number()]),
  row_version: z.number().int().nonnegative(),
  unit_price: z.number().nullable(),
  savings: z.number().nullable(),
});

const SendGroupSchema = z.object({
  send_id: z.string().nullable(),
  store: z.string().nullable(),
  location_id: z.string().nullable(),
  fulfillment: z.string().nullable(),
  sent_at: z.string().nullable(),
  placed_at: z.string().nullable(),
  awaiting_confirmation: z.boolean(),
  estimated_total: z.number().nullable(),
  flyer_savings: z.number().nullable(),
  can_mark_placed: z.boolean(),
  lines: z.array(SendLineSchema),
});

const SubstitutionDecisionSchema = z.object({
  original_key: z.string().min(1), replacement_key: z.string().min(1), attribution_signature: z.string(),
  created_replacement: z.boolean(), replacement_version: z.number().int().nullable(), row_version: z.number().int().positive(),
  created_at: z.string(), updated_at: z.string(),
});
const CoverageDecisionSchema = z.object({
  line_key: z.string().min(1), created_row: z.boolean(), created_row_version: z.number().int().nullable(),
  row_version: z.number().int().positive(), created_at: z.string(), updated_at: z.string(),
});

export const GroceryListDataSchema = z.object({
  contract_version: z.number().int(),
  snapshot_version: z.string(),
  as_of: z.string(),
  lines: z.array(GroceryLineSchema),
  to_buy: z.array(z.string()),
  pantry_covered: z.array(PantryCoveredSchema),
  substitution_decisions: z.array(SubstitutionDecisionSchema).optional(),
  coverage_decisions: z.array(CoverageDecisionSchema).optional(),
  in_cart_groups: z.array(SendGroupSchema),
  underived: z.array(z.string()),
  location: z.object({ id: z.string() }).nullable(),
  flyer_as_of: z.string().nullable(),
  walk_context: z.custom<OfflineWalkContext>().nullable().optional(),
  counts: z.object({
    to_buy: z.number().int().nonnegative(),
    checked: z.number().int().nonnegative(),
    in_carts: z.number().int().nonnegative(),
    recipes: z.number().int().nonnegative(),
  }),
});

export type GroceryListData = z.infer<typeof GroceryListDataSchema>;
export type GroceryLine = z.infer<typeof GroceryLineSchema>;
export type GrocerySendGroup = z.infer<typeof SendGroupSchema>;

export interface GroceryModelContext extends GroceryListData {
  action_summary: string;
  outcome?: { kind: "added" | "removed" | "checked" | "pantry" | "substitution" | "relisted" | "placed"; message: string };
}

export function parseGroceryListData(value: unknown): GroceryListData {
  return GroceryListDataSchema.parse(value);
}

export function groceryContractSupport(version: unknown): "supported" | "older" | "newer" | "invalid" {
  if (!Number.isInteger(version)) return "invalid";
  if ((version as number) < GROCERY_CONTRACT_FLOOR) return "older";
  if ((version as number) > GROCERY_CONTRACT_CEILING) return "newer";
  return "supported";
}
