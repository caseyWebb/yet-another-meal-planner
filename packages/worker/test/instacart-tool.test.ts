import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerInstacartTool } from "../src/instacart-tool.js";
import { sqliteEnv } from "./sqlite-d1.js";
import { invokeTool, withServer } from "./tool-harness.js";

describe("create_instacart_handoff MCP transport", () => {
  it("registers the explicit read-only contract and shares not_configured behavior", async () => {
    const env = sqliteEnv().env;
    const server = new McpServer({ name: "instacart-test", version: "0" });
    registerInstacartTool(server, env, "alice");
    await withServer(server, async (client) => {
      const tool = (await client.listTools()).tools.find((entry) => entry.name === "create_instacart_handoff")!;
      expect(tool.description).toMatch(/never targets a retailer/is);
      expect(tool.description).toMatch(/cart.*order.*advances grocery rows.*send or spend/is);
      expect(await invokeTool(client, "create_instacart_handoff", {})).toEqual({ isError: false, result: { status: "unavailable", code: "not_configured" } });
    });
  });
});
