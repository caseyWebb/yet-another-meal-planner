// DIAGNOSTIC SPIKE — remove before merge to main.
//
// Proves the SERVER-SIDE MCP Apps wiring is correct, so that a "widget didn't render" in
// claude.ai is attributable to the host (known #671-class bugs), not to a miswire here.
// Gate 1 (does the host mount the iframe at all) depends entirely on this wiring: a tool
// carrying `_meta.ui.resourceUri`, and a readable `ui://` resource served with the MCP
// Apps MIME. Drives the SAME in-memory MCP client a real host uses (tool-harness).
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { registerHelloWidgetSpike, HELLO_URI, HELLO_WIDGET_HTML } from "../src/hello-widget-spike.js";
import { withServer } from "./tool-harness.js";

function freshServer(): McpServer {
  const server = new McpServer({ name: "spike-test", version: "0.0.0" });
  registerHelloWidgetSpike(server);
  return server;
}

describe("hello-widget-spike (MCP Apps diagnostic wiring)", () => {
  it("hello_widget references the ui:// resource via _meta.ui.resourceUri", async () => {
    await withServer(freshServer(), async (client) => {
      const { tools } = await client.listTools();
      const hello = tools.find((t) => t.name === "hello_widget");
      expect(hello).toBeDefined();
      // The one link a host follows to decide to render an iframe. Both the canonical and
      // the deprecated flat key are accepted by hosts; registerAppTool mirrors them.
      const meta = hello?._meta as { ui?: { resourceUri?: string }; "ui/resourceUri"?: string } | undefined;
      const resourceUri = meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
      expect(resourceUri).toBe(HELLO_URI);
    });
  });

  it("serves ui://hello/card as a readable MCP Apps HTML resource", async () => {
    await withServer(freshServer(), async (client) => {
      const read = await client.readResource({ uri: HELLO_URI });
      expect(read.contents).toHaveLength(1);
      const item = read.contents[0] as { uri: string; mimeType?: string; text?: string };
      expect(item.uri).toBe(HELLO_URI);
      expect(item.mimeType).toBe(RESOURCE_MIME_TYPE); // "text/html;profile=mcp-app" — the one mandatory string
      expect(item.mimeType).toBe("text/html;profile=mcp-app");
      // The self-contained view carries the bridge handshake + hydration hook a host drives.
      expect(item.text).toBe(HELLO_WIDGET_HTML);
      expect(item.text).toContain("ui/initialize");
      expect(item.text).toContain("ui/notifications/tool-result");
      // Regression guard for the bug this iteration fixed: the ui/initialize params key is
      // `appInfo` (App identification), NOT `clientInfo` — claude.ai rejects the latter and
      // never un-hides the frame (leaves the wrapper visibility:hidden).
      expect(item.text).toContain("appInfo:");
      expect(item.text).not.toContain("clientInfo:");
    });
  });

  it("exposes echo as a bridge-callable tool", async () => {
    await withServer(freshServer(), async (client) => {
      const echo = await client.callTool({ name: "echo", arguments: { text: "ping" } });
      const content = echo.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.text).toBe("ping");
      expect((echo.structuredContent as { text?: string })?.text).toBe("ping");
    });
  });

  it("hello_widget reports the client's MCP Apps capability (false for a vanilla SDK client)", async () => {
    await withServer(freshServer(), async (client) => {
      const res = await client.callTool({ name: "hello_widget", arguments: {} });
      const sc = res.structuredContent as { greeting: string; client_advertises_mcp_apps: boolean };
      expect(sc.greeting).toBe("hello world");
      // The vanilla in-memory Client doesn't advertise io.modelcontextprotocol/ui, so this is
      // false here. Against claude.ai the same field reveals whether the host negotiates it.
      expect(sc.client_advertises_mcp_apps).toBe(false);
    });
  });
});
