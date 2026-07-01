// Tool-call instrumentation (tool-usage-trends). One seam for the whole MCP surface: wrap the
// server's `registerTool` ONCE in buildServer so every tool — the inline registrations AND those
// added by the group-registration functions, plus any tool added later — emits one tenant-clean
// data point per call (tool name, outcome, duration) to the `grocery_tool` AE dataset, with no
// per-tool or per-call-site wiring. The outcome is read from the tool's own MCP result
// (`runTool`'s `fail()` sets `isError`); a raw throw that bypasses `runTool` records `error` via
// the `finally`. Emission is best-effort and fires AFTER the result is computed, so it never
// changes a tool's result and never sits between the handler and the response (recordToolPoint's
// `writeDataPoint` is non-blocking and costs no KV/D1 budget).

import type { Env } from "./env.js";
import { recordToolPoint } from "./health.js";

/** The minimal shape of an MCP tool result this decorator inspects — `runTool` flags errors. */
interface ToolCallResult {
  isError?: boolean;
}

/** The minimal slice of `McpServer` the decorator rebinds — kept narrow so a test can fake it. */
export interface ToolRegistrar {
  registerTool(name: string, config: unknown, handler: (...args: unknown[]) => unknown): unknown;
}

/**
 * Rebind `server.registerTool` so each registered handler is timed and its outcome emitted to the
 * `grocery_tool` dataset, returning the handler's result **unchanged**. Call once, before any tool
 * is registered, so every registration (inline and via the `register*Tools` helpers) is covered.
 */
export function instrumentTools(server: ToolRegistrar, env: Pick<Env, "TOOL_AE">): void {
  const original = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) =>
    original(name, config, async (...args: unknown[]) => {
      const startedAt = Date.now();
      let ok = false;
      try {
        const result = (await handler(...args)) as ToolCallResult;
        ok = !result?.isError;
        return result;
      } finally {
        // After the result is computed; a throw still records `error` then propagates unchanged.
        recordToolPoint(env, name, { ok, durationMs: Date.now() - startedAt });
      }
    });
}
