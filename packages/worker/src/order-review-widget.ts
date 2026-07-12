import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { CatalogSearchResultSchema, OrderReviewDataSchema, OrderReviewStageSchema } from "@yamp/contract";
import { z } from "zod";
import type { Env } from "./env.js";
import { ToolError, fail } from "./errors.js";
import type { OrderWiring } from "./order-tools.js";
import { readOrderReview, saveOrderReviewBrand, searchOrderBroader, searchOrderCatalog } from "./order-review.js";

export const ORDER_REVIEW_WIDGET_URI = "ui://order/review";
export const ORDER_REVIEW_WIDGET_MARKER = "order-review-widget";
const WIDGET_ASSET_URL = "https://assets.local/widgets/order-review.html";

export function orderReviewText(review: Awaited<ReturnType<typeof readOrderReview>>): string {
  const lines = [
    `Order review for ${review.store?.name ?? "the current store"}: ${review.counts.going_to_cart} going to cart, ${review.counts.needs_decision} need a decision.`,
    ...review.matched.map((line) => `- ${line.display_name ?? line.name}: ${line.selected.brand} ${line.selected.description}, quantity ${line.quantity}`),
    ...review.decisions.map((line) => `- ${line.name}: ${line.kind === "choose_one" ? "choose one" : "unavailable"}`),
  ];
  if (review.estimated_total != null) lines.push(`Current estimated total: $${review.estimated_total.toFixed(2)}.`);
  lines.push(review.quote_disclaimer);
  return lines.join("\n");
}

async function result(body: () => Promise<unknown>, kind: "review" | "search" | "receipt" = "receipt") {
  try {
    const value = await body();
    if (kind === "review") OrderReviewDataSchema.parse(value);
    if (kind === "search") CatalogSearchResultSchema.parse(value);
    const text = kind === "review" ? orderReviewText(value as Awaited<ReturnType<typeof readOrderReview>>) : JSON.stringify(value);
    return { structuredContent: value as Record<string, unknown>, content: [{ type: "text" as const, text }] };
  } catch (error) {
    if (error instanceof ToolError) return fail(error.toShape());
    return fail({ error: "upstream_unavailable", message: error instanceof Error ? error.message : String(error) });
  }
}

export function registerOrderReviewWidget(server: McpServer, env: Env, tenant: string, wiring: OrderWiring): void {
  const deps = { wiring };
  registerAppResource(server, "Order Review", ORDER_REVIEW_WIDGET_URI, {
    description: "Self-contained, freshly revalidated Kroger order review.",
  }, async () => {
    const response = await env.ASSETS.fetch(new Request(WIDGET_ASSET_URL));
    if (!response.ok) throw new ToolError("not_found", `order review widget asset is unavailable (status ${response.status})`);
    const html = await response.text();
    if (!html.includes(ORDER_REVIEW_WIDGET_MARKER)) throw new ToolError("not_found", "order review widget asset not found (received the SPA shell)");
    return { contents: [{ uri: ORDER_REVIEW_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  });
  registerAppTool(server, "display_order_review", {
    title: "Display order review", description: "Render a fresh Kroger order review. Prices are quotes and unresolved choices require member confirmation.",
    inputSchema: {}, _meta: { ui: { resourceUri: ORDER_REVIEW_WIDGET_URI } },
  }, async () => ({ ...(await result(() => readOrderReview(env, tenant, undefined, deps), "review")), _meta: { ui: { resourceUri: ORDER_REVIEW_WIDGET_URI } } }));
  registerAppTool(server, "read_order_review", {
    title: "Read order review", description: "App-callable empty or staged review re-preview.", inputSchema: { stage: OrderReviewStageSchema.optional() },
    _meta: { ui: { visibility: ["app"] } },
  }, async ({ stage }) => result(() => readOrderReview(env, tenant, stage, deps), "review"));
  registerAppTool(server, "search_order_broader", {
    title: "Search broader", description: "App-callable bounded factual broader search.",
    inputSchema: { line_key: z.string(), preview_fingerprint: z.string(), stage: OrderReviewStageSchema.optional() }, _meta: { ui: { visibility: ["app"] } },
  }, async ({ line_key, preview_fingerprint, stage }) => result(() => searchOrderBroader(env, tenant, line_key, preview_fingerprint, stage, deps), "search"));
  registerAppTool(server, "search_order_catalog", {
    title: "Search Kroger catalog", description: "App-callable bounded manual catalog search.",
    inputSchema: { line_key: z.string(), preview_fingerprint: z.string(), stage: OrderReviewStageSchema.optional(), query: z.string().min(2).max(80) }, _meta: { ui: { visibility: ["app"] } },
  }, async ({ line_key, preview_fingerprint, stage, query }) => result(() => searchOrderCatalog(env, tenant, line_key, preview_fingerprint, stage, query, deps), "search"));
  registerAppTool(server, "save_order_brand_preference", {
    title: "Save preferred brand", description: "App-callable narrow family preference merge.",
    inputSchema: { family_key: z.string(), line_key: z.string(), brand: z.string(), expected_family_fingerprint: z.string(), preview_fingerprint: z.string(), stage: OrderReviewStageSchema }, _meta: { ui: { visibility: ["app"] } },
  }, async (input) => result(() => saveOrderReviewBrand(env, tenant, input, deps)));
}
