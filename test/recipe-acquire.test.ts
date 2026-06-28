import { describe, it, expect } from "vitest";
import { acquireRecipeContent } from "../src/recipe-acquire.js";

// The JSON-LD legs (no_jsonld / not_a_recipe / incomplete) run through HTMLRewriter, which
// doesn't exist in Node — they're exercised by jsonld.test.ts (findRecipe/normalizeRecipe) and
// the live smoke test. What IS node-runnable here is the reachability taxonomy: the "is this
// source walled/dead" signal that the discovery sweep and the operator feed-probe both report,
// and which used to be collapsed into a bare null. parse_recipe and the sweep share THIS exact
// helper, so the reason a candidate parks and the reason parse_recipe errors cannot drift.

describe("acquireRecipeContent — reachability taxonomy", () => {
  it("returns unreachable (no status) when the fetch throws", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await acquireRecipeContent("https://down.example/r", fetchImpl);
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("returns unreachable WITH the HTTP status on a non-2xx (a bot wall / dead link)", async () => {
    const fetchImpl = (async () => new Response("blocked", { status: 403 })) as unknown as typeof fetch;
    const result = await acquireRecipeContent("https://walled.example/r", fetchImpl);
    expect(result).toEqual({ ok: false, reason: "unreachable", status: 403 });
  });

  it("propagates a 404 as unreachable with its status", async () => {
    const fetchImpl = (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    const result = await acquireRecipeContent("https://dead.example/r", fetchImpl);
    expect(result).toMatchObject({ ok: false, reason: "unreachable", status: 404 });
  });
});
