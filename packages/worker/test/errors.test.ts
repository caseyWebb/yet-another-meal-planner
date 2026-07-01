import { describe, it, expect } from "vitest";
import { ToolError, ok, fail, runTool } from "../src/errors.js";

describe("structured errors", () => {
  it("ok wraps data as JSON text content", () => {
    const res = ok({ recipes: [] });
    expect(res.content[0].text).toBe('{"recipes":[]}');
    expect(res.isError).toBeUndefined();
  });

  it("ToolError.toShape carries code, message, and context", () => {
    const shape = new ToolError("not_found", "Unknown slug", { slug: "x" }).toShape();
    expect(shape).toEqual({ error: "not_found", message: "Unknown slug", slug: "x" });
  });

  it("fail flags isError and serializes the error", () => {
    const res = fail({ error: "unsupported", message: "nope" });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual({ error: "unsupported", message: "nope" });
  });

  it("runTool returns ok for a successful body", async () => {
    const res = await runTool(async () => ({ value: 1 }));
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual({ value: 1 });
  });

  it("runTool converts a ToolError into a structured result", async () => {
    const res = await runTool(async () => {
      throw new ToolError("index_unavailable", "missing index");
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual({
      error: "index_unavailable",
      message: "missing index",
    });
  });

  it("runTool maps an unexpected throw to upstream_unavailable", async () => {
    const res = await runTool(async () => {
      throw new Error("boom");
    });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toEqual({
      error: "upstream_unavailable",
      message: "boom",
    });
  });
});
