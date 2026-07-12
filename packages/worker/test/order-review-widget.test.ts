import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { ORDER_REVIEW_WIDGET_MARKER, ORDER_REVIEW_WIDGET_URI, registerOrderReviewWidget } from "../src/order-review-widget.js";
import type { OrderWiring } from "../src/order-tools.js";
import type { Env } from "../src/env.js";
import { sqliteEnv } from "./sqlite-d1.js";
import { withServer } from "./tool-harness.js";

const T = "casey";
const HTML = `<!DOCTYPE html><html><head><meta name="mcp-widget" content="${ORDER_REVIEW_WIDGET_MARKER}"></head><body></body></html>`;
function setup(asset = HTML) {
  const h = sqliteEnv([T]);
  const env = { ...(h.env as object), ASSETS: { fetch: async () => new Response(asset) } } as unknown as Env;
  const wiring: OrderWiring = {
    resolve: async () => ({ resolved: false, reason: "unavailable", message: "none" }), revalidateSku: async () => null,
    getLocationId: async () => "L1", search: async () => [], productById: async () => null, cartAdd: async () => {},
  };
  const server = new McpServer({ name: "order-review-widget-test", version: "0" });
  registerOrderReviewWidget(server, env, T, wiring);
  return { server, env };
}

describe("Order Review MCP wiring", () => {
  it("registers marked self-contained resource plus display and app-only operations", async () => {
    await withServer(setup().server, async (client) => {
      const { tools } = await client.listTools();
      const display = tools.find((tool) => tool.name === "display_order_review");
      expect((display?._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri).toBe(ORDER_REVIEW_WIDGET_URI);
      for (const name of ["read_order_review", "search_order_broader", "search_order_catalog", "save_order_brand_preference"])
        expect(tools.some((tool) => tool.name === name)).toBe(true);
      const resource = await client.readResource({ uri: ORDER_REVIEW_WIDGET_URI });
      expect(resource.contents[0]).toMatchObject({ uri: ORDER_REVIEW_WIDGET_URI, mimeType: RESOURCE_MIME_TYPE });
      expect((resource.contents[0] as { text?: string }).text).toContain(ORDER_REVIEW_WIDGET_MARKER);
    });
  });

  it("display and boot share preview facts/text and leak no credentials", async () => {
    await withServer(setup().server, async (client) => {
      const display = await client.callTool({ name: "display_order_review", arguments: {} });
      const boot = await client.callTool({ name: "read_order_review", arguments: {} });
      expect(display.structuredContent).toMatchObject({ contract_version: 1, store: { location_id: "L1" } });
      expect(boot.structuredContent).toMatchObject({ contract_version: 1, store: { location_id: "L1" } });
      expect((display.content as { text?: string }[])[0].text).toContain("going to cart");
      expect(JSON.stringify(display.structuredContent)).not.toMatch(/token|cookie|session_id|signed_url/i);
    });
  });

  it("rejects a marker-less member SPA fallback", async () => {
    await withServer(setup("<!doctype html><title>member</title>").server, async (client) => {
      await expect(client.readResource({ uri: ORDER_REVIEW_WIDGET_URI })).rejects.toThrow();
    });
  });
});
