import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "./env.js";
import { runTool } from "./errors.js";
import { createInstacartHandoff } from "./instacart.js";

export function registerInstacartTool(server: McpServer, env: Env, tenant: string): void {
  server.registerTool(
    "create_instacart_handoff",
    {
      description:
        "Create or reuse an Instacart Marketplace shopping-list page for the current derived to-buy set. This is an external review handoff only: it never targets a retailer, adds to a cart, places an order, advances grocery rows, records a send or spend, or claims a purchase.",
      inputSchema: {},
    },
    () => runTool(() => createInstacartHandoff(env, tenant)),
  );
}
