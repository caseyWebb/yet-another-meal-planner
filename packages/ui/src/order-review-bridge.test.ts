import { describe, expect, it, vi } from "vitest";
import type { OrderReviewData, OrderReviewModelContext } from "@yamp/contract";
import { createOrderReviewBridgeAdapter, resolveOrderReviewCapabilities, type OrderReviewBridge } from "./order-review-bridge";

const data: OrderReviewData = {
  contract_version: 1, preview_fingerprint: "p", grocery_snapshot_version: "g", as_of: "2026-07-12T00:00:00Z",
  store: { name: "Kroger", location_id: "L1" }, quote_disclaimer: "quote", stale_cart_count: 0, cleared_cart_ack_required: false,
  matched: [], decisions: [], left_off: [], underived: [], counts: { going_to_cart: 0, needs_decision: 0, left_off: 0 }, estimated_total: null, flyer_savings: null,
  stage: { skipped: [], quantities: {}, selections: [], impulses: [], saved_brands: [] },
};

describe("Order Review MCP bridge", () => {
  it("requires D19 boot plus server tools/model context and degrades newer/delegate safely", () => {
    expect(resolveOrderReviewCapabilities({ contractVersion: 1, serverTools: true, updateModelContext: true, message: true, hydrated: false }).mode).toBe("readonly");
    expect(resolveOrderReviewCapabilities({ contractVersion: 1, serverTools: true, updateModelContext: true, message: true, hydrated: true }).mode).toBe("interactive");
    expect(resolveOrderReviewCapabilities({ contractVersion: 2, serverTools: true, updateModelContext: true, message: true, hydrated: true }).mode).toBe("readonly");
    expect(resolveOrderReviewCapabilities({ contractVersion: 1, serverTools: false, updateModelContext: false, message: true, hydrated: false }).mode).toBe("delegate");
  });

  it("mirrors full context without messages for drafts/save and announces one successful send", async () => {
    const updateModelContext = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async () => undefined);
    const bridge: OrderReviewBridge = {
      updateModelContext, sendMessage,
      callServerTool: vi.fn(async ({ name }) => {
        if (name === "save_order_brand_preference") return { structuredContent: { status: "saved", family_key: "milk", brand: "A", family: { tiers: [["A"]], any_brand: false }, family_fingerprint: "f", changed: true } };
        if (name === "place_order") return { structuredContent: { status: "sent", steps: { list: { advanced: true }, cart: { written: true, count: 1 }, send: { recorded: true, id: "s", item_count: 1, estimated_total: 2, flyer_savings: 0 }, cache: { committed: true, inserted: ["milk"], updated: [], unchanged: [] } }, left_off: [], verified_saved_brands: [] } };
        return { structuredContent: data as unknown as Record<string, unknown> };
      }),
    };
    const adapter = createOrderReviewBridgeAdapter(bridge, { mode: "interactive", contractSupported: true });
    const context: OrderReviewModelContext = { preview: data, stage: data.stage, save_receipts: [], action_summary: "quantity changed" };
    await adapter.publishModelContext?.(context);
    await adapter.saveBrand({ family_key: "milk", line_key: "milk", brand: "A", expected_family_fingerprint: "f0", preview_fingerprint: "p" });
    expect(sendMessage).not.toHaveBeenCalled();
    const send = await adapter.send({ stage: data.stage, preview_fingerprint: "p", cleared_cart_ack: false });
    await adapter.notifyCompletion?.({ send, save_receipts: [] });
    expect(updateModelContext).toHaveBeenCalledWith({ structuredContent: context });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
