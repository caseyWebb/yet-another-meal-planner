import {
  BrandSaveReceiptSchema,
  CatalogSearchResultSchema,
  OrderReviewDataSchema,
  OrderReviewSendResultSchema,
  orderReviewContractSupport,
  type OrderReviewData,
  type OrderReviewModelContext,
  type OrderReviewOutcome,
} from "@yamp/contract";
import type { OrderReviewHostAdapter } from "./order-review-controller";

export interface OrderReviewBridgeResult {
  structuredContent?: Record<string, unknown>;
  content?: { type: string; text?: string }[];
  isError?: boolean;
}
export interface OrderReviewBridge {
  callServerTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<OrderReviewBridgeResult>;
  updateModelContext(params: { structuredContent?: Record<string, unknown> }): Promise<unknown>;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<unknown>;
  requestTeardown?(params?: Record<string, never>): Promise<void>;
}
export interface OrderReviewCapabilities {
  mode: "interactive" | "delegate" | "readonly";
  contractSupported: boolean;
}

export function resolveOrderReviewCapabilities(input: {
  contractVersion: unknown;
  serverTools: boolean;
  updateModelContext: boolean;
  message: boolean;
  hydrated: boolean;
}): OrderReviewCapabilities {
  const contractSupported = orderReviewContractSupport(input.contractVersion) === "supported";
  if (!contractSupported) return { mode: "readonly", contractSupported };
  if (input.serverTools && input.updateModelContext)
    return { mode: input.hydrated ? "interactive" : "readonly", contractSupported };
  if (!input.serverTools && input.message) return { mode: "delegate", contractSupported };
  return { mode: "readonly", contractSupported };
}

export function orderReviewFromBridge(result: OrderReviewBridgeResult): OrderReviewData | null {
  if (result.isError) return null;
  try {
    return OrderReviewDataSchema.parse(result.structuredContent?.preview ?? result.structuredContent);
  } catch {
    return null;
  }
}

function requireResult<T>(result: OrderReviewBridgeResult, parse: (value: unknown) => T, message: string): T {
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? message);
  return parse(result.structuredContent);
}

export function createOrderReviewBridgeAdapter(
  bridge: OrderReviewBridge,
  capabilities: OrderReviewCapabilities,
  close?: () => void,
): OrderReviewHostAdapter {
  return {
    mode: capabilities.mode,
    online: true,
    async preview(stage) {
      return requireResult(
        await bridge.callServerTool({ name: "read_order_review", arguments: { stage } }),
        (value) => OrderReviewDataSchema.parse(value),
        "Review refresh failed",
      );
    },
    async search(mode, line_key, preview_fingerprint, stage, query) {
      const name = mode === "broader" ? "search_order_broader" : "search_order_catalog";
      return requireResult(
        await bridge.callServerTool({
          name,
          arguments: { line_key, preview_fingerprint, stage, ...(query ? { query } : {}) },
        }),
        (value) => CatalogSearchResultSchema.parse(value),
        "Catalog search failed",
      );
    },
    async saveBrand(input) {
      return requireResult(
        await bridge.callServerTool({ name: "save_order_brand_preference", arguments: input }),
        (value) => BrandSaveReceiptSchema.parse(value),
        "Brand save failed",
      );
    },
    async send(input) {
      return requireResult(
        await bridge.callServerTool({ name: "place_order", arguments: input }),
        (value) => OrderReviewSendResultSchema.parse(value),
        "Order send failed",
      );
    },
    async publishModelContext(context: OrderReviewModelContext) {
      await bridge.updateModelContext({ structuredContent: context as unknown as Record<string, unknown> });
    },
    async notifyCompletion(outcome: OrderReviewOutcome & { carted_names: string[] }) {
      if (outcome.send.status !== "sent") return;
      const leftOff = outcome.send.left_off.map((line) => line.name);
      const learned = [...outcome.send.steps.cache.inserted, ...outcome.send.steps.cache.updated];
      await bridge.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Sent to the Kroger cart: ${outcome.carted_names.length ? outcome.carted_names.join(", ") : `${outcome.send.steps.cart.count ?? 0} items`}.`,
              leftOff.length ? `Stayed to-buy: ${leftOff.join(", ")}.` : "Nothing stayed to-buy.",
              learned.length
                ? `Store matches learned for: ${learned.join(", ")}.`
                : "No new store matches were learned.",
            ].join(" "),
          },
        ],
      });
    },
    async delegate(action) {
      await bridge.sendMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: `Please re-preview current store facts and send this exact staged order request: ${JSON.stringify(action)}.`,
          },
        ],
      });
    },
    async closeToGrocery() {
      if (close) close();
      else await bridge.requestTeardown?.({});
    },
  };
}
