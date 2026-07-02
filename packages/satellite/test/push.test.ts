import { describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type BatchResponse, type RecipeItem } from "@grocery-agent/contract";
import { buildBatch, pushBatch, SATELLITE_VERSION, type FetchImpl } from "../src/push.js";

const item = (source: string): RecipeItem => ({
  title: "T",
  ingredients: ["a"],
  instructions: ["b"],
  source,
});

const CONNECTOR = "https://mcp.example";
const KEY = "ingest-key-123";

/** A fake fetch that returns a canned status + body, recording the calls it saw. */
function fakeFetch(responses: Array<{ status: number; body: unknown }>): FetchImpl & { calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  const impl = ((url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) });
  }) as FetchImpl & { calls: unknown[] };
  impl.calls = calls;
  return impl;
}

const cleanBody: BatchResponse = { received: 1, accepted: 1, deduped: 0, rejected: 0, results: [] };
const partialBody: BatchResponse = {
  received: 2,
  accepted: 1,
  deduped: 1,
  rejected: 0,
  results: [],
};

describe("buildBatch", () => {
  it("stamps the capability, source, satellite version, and contract version", () => {
    const batch = buildBatch("Paid Example", [item("https://paid.example/r/1")]);
    expect(batch.capability).toBe("recipe-scrape");
    expect(batch.source).toBe("Paid Example");
    expect(batch.satellite_version).toBe(SATELLITE_VERSION);
    expect(batch.contract_version).toBe(CONTRACT_VERSION);
    expect(batch.observations).toHaveLength(1);
    expect(batch.observations[0].kind).toBe("recipe");
  });
});

describe("pushBatch", () => {
  const noWait = { baseDelayMs: 0, sleep: () => Promise.resolve() };

  it("maps 200 with a clean summary to accepted", async () => {
    const f = fakeFetch([{ status: 200, body: cleanBody }]);
    const out = await pushBatch(CONNECTOR, KEY, buildBatch("S", [item("https://p.example/1")]), f, noWait);
    expect(out.result).toBe("accepted");
    // POSTs to /admin/api/ingest with a bearer key.
    const call = f.calls[0] as { url: string; init: { headers: Record<string, string> } };
    expect(call.url).toBe("https://mcp.example/admin/api/ingest");
    expect(call.init.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("maps 200 with deduped/rejected counts to partial", async () => {
    const f = fakeFetch([{ status: 200, body: partialBody }]);
    const out = await pushBatch(CONNECTOR, KEY, buildBatch("S", [item("https://p.example/1"), item("https://p.example/2")]), f, noWait);
    expect(out.result).toBe("partial");
    if (out.result === "partial") expect(out.response.deduped).toBe(1);
  });

  it("maps 401 to bad_key without retrying", async () => {
    const f = fakeFetch([{ status: 401, body: { error: "bad_key" } }]);
    const out = await pushBatch(CONNECTOR, KEY, buildBatch("S", [item("https://p.example/1")]), f, noWait);
    expect(out.result).toBe("bad_key");
    expect(f.calls).toHaveLength(1);
  });

  it("maps 400 to bad_payload with the server message", async () => {
    const f = fakeFetch([{ status: 400, body: { error: "bad_payload", message: "boom" } }]);
    const out = await pushBatch(CONNECTOR, KEY, buildBatch("S", [item("https://p.example/1")]), f, noWait);
    expect(out.result).toBe("bad_payload");
    if (out.result === "bad_payload") expect(out.error).toBe("boom");
  });

  it("retries a 429 then succeeds", async () => {
    const f = fakeFetch([
      { status: 429, body: { error: "rate_limited" } },
      { status: 200, body: cleanBody },
    ]);
    const sleep = vi.fn(() => Promise.resolve());
    const out = await pushBatch(CONNECTOR, KEY, buildBatch("S", [item("https://p.example/1")]), f, {
      baseDelayMs: 1,
      sleep,
    });
    expect(out.result).toBe("accepted");
    expect(f.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("gives up as rate_limited after exhausting retries on persistent 429", async () => {
    const f = fakeFetch([{ status: 429, body: {} }]);
    const out = await pushBatch(CONNECTOR, KEY, buildBatch("S", [item("https://p.example/1")]), f, {
      maxAttempts: 3,
      ...noWait,
    });
    expect(out.result).toBe("rate_limited");
    expect(f.calls).toHaveLength(3);
  });

  it("self-validates and returns bad_payload before any network call", async () => {
    const f = fakeFetch([{ status: 200, body: cleanBody }]);
    // An empty observations array violates the strict v2 schema.
    const bad = { capability: "recipe-scrape", source: "S", satellite_version: "1", contract_version: CONTRACT_VERSION, observations: [] };
    const out = await pushBatch(CONNECTOR, KEY, bad as never, f, noWait);
    expect(out.result).toBe("bad_payload");
    expect(f.calls).toHaveLength(0);
  });
});
