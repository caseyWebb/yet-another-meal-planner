import { describe, it, expect } from "vitest";
import { instrumentTools, type ToolRegistrar } from "../src/tool-instrumentation.js";
import type { Env } from "../src/env.js";

/** A fake registrar that records the (possibly-wrapped) handler so a test can invoke it. */
function fakeServer(): { server: ToolRegistrar; handlerFor: (name: string) => (...a: unknown[]) => unknown } {
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  const server: ToolRegistrar = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
      return undefined;
    },
  };
  return { server, handlerFor: (name) => handlers.get(name) as (...a: unknown[]) => unknown };
}

/** An env whose TOOL_AE captures every emitted point. */
function capturingEnv(): { env: Pick<Env, "TOOL_AE">; points: unknown[] } {
  const points: unknown[] = [];
  const env = { TOOL_AE: { writeDataPoint: (p: unknown) => points.push(p) } } as unknown as Pick<Env, "TOOL_AE">;
  return { env, points };
}

describe("instrumentTools (tool-usage-trends emission)", () => {
  it("emits an `ok` point for a successful tool result, returning the result unchanged", async () => {
    const { server, handlerFor } = fakeServer();
    const { env, points } = capturingEnv();
    instrumentTools(server, env);

    const result = { content: [{ type: "text", text: "{}" }] };
    server.registerTool("read_recipe", {}, async () => result);
    const got = await handlerFor("read_recipe")();

    expect(got).toBe(result); // unchanged object identity
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ indexes: ["read_recipe"], blobs: ["read_recipe", "ok"] });
    expect((points[0] as { doubles: number[] }).doubles[0]).toBeGreaterThanOrEqual(0);
  });

  it("emits an `error` point when the result is flagged isError", async () => {
    const { server, handlerFor } = fakeServer();
    const { env, points } = capturingEnv();
    instrumentTools(server, env);

    server.registerTool("place_order", {}, async () => ({ content: [], isError: true }));
    await handlerFor("place_order")();

    expect(points[0]).toMatchObject({ blobs: ["place_order", "error"] });
  });

  it("emits an `error` point and rethrows when the handler throws", async () => {
    const { server, handlerFor } = fakeServer();
    const { env, points } = capturingEnv();
    instrumentTools(server, env);

    server.registerTool("kroger_prices", {}, async () => {
      throw new Error("boom");
    });
    await expect(handlerFor("kroger_prices")()).rejects.toThrow("boom");
    expect(points[0]).toMatchObject({ blobs: ["kroger_prices", "error"] });
  });

  it("does not affect the result when TOOL_AE is unbound or throws", async () => {
    const { server, handlerFor } = fakeServer();
    instrumentTools(server, {} as Pick<Env, "TOOL_AE">); // no TOOL_AE
    server.registerTool("a", {}, async () => ({ ok: 1 }));
    await expect(handlerFor("a")()).resolves.toEqual({ ok: 1 });

    const { server: s2, handlerFor: h2 } = fakeServer();
    const throwingEnv = {
      TOOL_AE: {
        writeDataPoint: () => {
          throw new Error("AE down");
        },
      },
    } as unknown as Pick<Env, "TOOL_AE">;
    instrumentTools(s2, throwingEnv);
    s2.registerTool("b", {}, async () => ({ ok: 2 }));
    await expect(h2("b")()).resolves.toEqual({ ok: 2 });
  });
});
