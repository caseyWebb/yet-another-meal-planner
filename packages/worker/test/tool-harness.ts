// An in-memory MCP invocation harness for tests: build the SAME per-tenant server `/mcp`
// builds (`buildServer`) and drive it over the SDK's in-memory transport, so a tool's
// catalog entry and every invocation match what a real MCP client gets — identical Zod
// validation and identical structured-error serialization (src/errors.ts). Used by tests
// that exercise a tool end-to-end without standing up the OAuth/transport stack.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** A tool invocation's outcome: `isError` mirrors the MCP result flag, and `result` is the
 *  tool's structured payload (the JSON our tools serialize into one text content item,
 *  parsed back). */
export interface ToolInvocation {
  isError: boolean;
  result: unknown;
}

/**
 * Connect an in-process MCP `Client` to `server`, run `use`, and tear both down. Stateless
 * per call, mirroring the per-request server `/mcp` builds. Teardown is best-effort
 * (allSettled) so a close failure never masks the result or error from `use`.
 */
export async function withServer<T>(
  server: McpServer,
  use: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-harness", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await use(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

/** Parse an MCP tool result into the harness shape. Our tools serialize structured JSON
 *  into one text content item (src/errors.ts `ok`/`fail`), so parse it back; anything
 *  else (multiple items, non-text) is handed through verbatim. */
function unwrapResult(raw: { content?: unknown; isError?: boolean }): ToolInvocation {
  const isError = raw.isError === true;
  const content = raw.content;
  if (Array.isArray(content) && content.length === 1) {
    const only = content[0] as { type?: string; text?: string };
    if (only?.type === "text" && typeof only.text === "string") {
      try {
        return { isError, result: JSON.parse(only.text) };
      } catch {
        return { isError, result: only.text };
      }
    }
  }
  return { isError, result: content ?? null };
}

/** One entry from a `tools/list` response: the name plus its raw `_meta` (undefined when
 *  absent). The plane-split assertion surface (mcp-tool-gating): an app-only op carries
 *  `_meta.ui.visibility: ["app"]`; every other tool is model-visible by omission (the
 *  ext-apps default is `["model", "app"]`). */
export interface RegisteredToolInfo {
  name: string;
  meta: Record<string, unknown> | undefined;
}

/**
 * List every tool `server` has registered, with its `_meta`. This is the FULL registered
 * set for BOTH planes — `tools/list` never filters by visibility itself (that's a host-side
 * convention, not a server-side one), so this is exactly what a registration-matrix test
 * (mcp-tool-gating) needs: assert the name set for the gating requirement, and the `_meta`
 * for the app-plane visibility requirement.
 */
export async function listRegisteredTools(server: McpServer): Promise<RegisteredToolInfo[]> {
  return withServer(server, async (client) => {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, meta: t._meta as Record<string, unknown> | undefined }));
  });
}

/**
 * Invoke one tool over a connected client, returning its structured result/error.
 *
 * The server wraps everything into a result: a tool's OWN structured error (src/errors.ts
 * `fail`) rides as an `isError: true` result carrying our JSON shape, and a protocol-level
 * error — an unknown tool name, or arguments that failed the tool's input schema — also
 * comes back `isError: true` but with a PLAIN-text message (`McpServer.createToolError`).
 * We pass the structured ones through verbatim and normalize the plain-text ones into the
 * same `{ error, message }` shape. A throw here is a transport failure (not a tool/protocol
 * error) → `upstream_unavailable`.
 */
export async function invokeTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolInvocation> {
  let raw: { content?: unknown; isError?: boolean };
  try {
    raw = (await client.callTool({ name, arguments: args })) as {
      content?: unknown;
      isError?: boolean;
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { isError: true, result: { error: "upstream_unavailable", message } };
  }
  const out = unwrapResult(raw);
  // A plain-text isError result is a protocol error (unknown tool / bad arguments); the
  // tool's own structured errors are objects and pass through untouched. We match the SDK's
  // specific unknown-tool wording (`Tool <name> not found`, capital T) rather than a bare
  // "not found", so a Zod validation message that happens to contain "not found" isn't
  // mislabeled.
  if (out.isError && typeof out.result === "string") {
    const message = out.result;
    const error: "not_found" | "validation_failed" = /Tool .+ not found/.test(message)
      ? "not_found"
      : "validation_failed";
    return { isError: true, result: { error, message } };
  }
  return out;
}
