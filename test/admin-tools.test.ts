import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolError, runTool } from "../src/errors.js";
import { withServer, invokeTool } from "../src/admin-tools.js";

/** A tiny server with a success tool, a structured-error tool, and an input-validated
 *  tool — enough to exercise the console's invocation plumbing (in-memory transport +
 *  error mapping) without standing up the full per-tenant env. */
function testServer(): McpServer {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  server.registerTool(
    "echo",
    { description: "echo a message", inputSchema: { msg: z.string() } },
    ({ msg }) => runTool(async () => ({ echoed: msg })),
  );
  server.registerTool("boom", { description: "always errors", inputSchema: {} }, () =>
    runTool(async () => {
      throw new ToolError("not_found", "nothing here", { slug: "x" });
    }),
  );
  return server;
}

describe("admin-tools invocation (in-memory transport)", () => {
  it("returns a tool's structured success result", async () => {
    const out = await withServer(testServer(), (c) => invokeTool(c, "echo", { msg: "hi" }));
    expect(out).toEqual({ isError: false, result: { echoed: "hi" } });
  });

  it("passes a tool's structured error through as isError data, not a throw", async () => {
    const out = await withServer(testServer(), (c) => invokeTool(c, "boom", {}));
    expect(out.isError).toBe(true);
    expect(out.result).toEqual({ error: "not_found", message: "nothing here", slug: "x" });
  });

  it("maps an unknown tool name to a structured not_found", async () => {
    const out = await withServer(testServer(), (c) => invokeTool(c, "ghost", {}));
    expect(out.isError).toBe(true);
    expect((out.result as { error: string }).error).toBe("not_found");
  });

  it("maps invalid arguments to validation_failed (the tool's own schema rejects)", async () => {
    const out = await withServer(testServer(), (c) => invokeTool(c, "echo", {}));
    expect(out.isError).toBe(true);
    expect((out.result as { error: string }).error).toBe("validation_failed");
  });

  it("lists the registered tools with their input schemas", async () => {
    const tools = (await withServer(testServer(), async (c) => (await c.listTools()).tools)) as Array<{
      name: string;
      inputSchema?: unknown;
    }>;
    expect(tools.map((t) => t.name).sort()).toEqual(["boom", "echo"]);
    expect(tools.find((t) => t.name === "echo")?.inputSchema).toBeDefined();
  });
});
