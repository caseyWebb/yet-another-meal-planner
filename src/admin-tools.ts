// The operator dev console (operator-admin capability). Helpers that let the
// Access-gated admin surface INSPECT and INVOKE the live MCP tool surface AS a chosen
// tenant — the in-Worker, credential-free analog of pointing the stock MCP Inspector at
// `/mcp`. The operator is already authenticated by Cloudflare Access, so "acting as
// <member>" needs no OAuth token; the chosen tenant is resolved by the same allowlist
// check the MCP surface uses (src/admin.ts `resolveActingTenant`).
//
// Faithfulness is the whole point: both helpers build the SAME per-tenant server `/mcp`
// builds (`buildServer`) and drive it over the SDK's in-memory transport, so the catalog
// and every invocation match what a real MCP client gets — identical Zod validation and
// identical structured-error serialization (src/errors.ts). No tool is reachable here
// that the MCP surface does not expose, and input validation is never bypassed.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { buildServer } from "./tools.js";

/** A tool invocation's outcome, shaped for the console: `isError` mirrors the MCP
 *  result flag, and `result` is the tool's structured payload (the JSON our tools
 *  serialize into a single text content item, parsed back). */
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
  const client = new Client({ name: "operator-admin-console", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return await use(client);
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
}

/** Parse an MCP tool result into the console shape. Our tools serialize structured JSON
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

/**
 * Invoke one tool over a connected client, returning its structured result/error.
 *
 * The server wraps everything into a result: a tool's OWN structured error (src/errors.ts
 * `fail`) rides as an `isError: true` result carrying our JSON shape, and a protocol-level
 * error — an unknown tool name, or arguments that failed the tool's input schema — also
 * comes back `isError: true` but with a PLAIN-text message (`McpServer.createToolError`).
 * We pass the structured ones through verbatim and normalize the plain-text ones into the
 * same `{ error, message }` shape, so the console renders every failure uniformly. A throw
 * here is a transport failure (not a tool/protocol error) → `upstream_unavailable`.
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
  // tool's own structured errors are objects and pass through untouched.
  if (out.isError && typeof out.result === "string") {
    const message = out.result;
    const error: "not_found" | "validation_failed" = /not found/i.test(message)
      ? "not_found"
      : "validation_failed";
    return { isError: true, result: { error, message } };
  }
  return out;
}

/** The tool catalog for `tenant` — each tool's name, description, and input JSON Schema,
 *  exactly as `/mcp`'s `tools/list` returns it. The content is tenant-independent; we
 *  resolve a tenant only so listing and invoking are gated identically. */
export function listToolsFor(env: Env, tenant: Tenant): Promise<{ tools: unknown[] }> {
  return withServer(buildServer(env, tenant), async (client) => {
    const { tools } = await client.listTools();
    return { tools };
  });
}

/** Invoke `name` as `tenant` with `args`, returning the tool's structured result/error. */
export function callToolFor(
  env: Env,
  tenant: Tenant,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolInvocation> {
  return withServer(buildServer(env, tenant), (client) => invokeTool(client, name, args));
}
