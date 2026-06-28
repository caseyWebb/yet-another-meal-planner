import { describe, it, expect } from "vitest";
import { fetchUsage, mapAccountUsage, utcDay, FREE_TIER_LIMITS } from "../src/usage.js";
import type { Env } from "../src/env.js";

// A canned Cloudflare GraphQL Analytics response body (the slice usage.ts reads).
function graphqlBody(account: unknown) {
  return { data: { viewer: { accounts: [account] } } };
}

function fetchReturning(body: unknown, status = 200): { fetchImpl: typeof fetch; calls: number } {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    get calls() {
      return calls;
    },
  };
}

const configuredEnv = (): Env => ({ CF_ACCOUNT_ID: "acct123", CF_ANALYTICS_TOKEN: "tok" }) as unknown as Env;

describe("utcDay", () => {
  it("formats epoch ms as a YYYY-MM-DD UTC day", () => {
    expect(utcDay(Date.parse("2026-06-28T23:59:00Z"))).toBe("2026-06-28");
  });
});

describe("mapAccountUsage", () => {
  it("sums KV operations per namespace and per action, plus a grand total", () => {
    const account = {
      kvOperations: [
        { dimensions: { namespaceId: "ns_a", actionType: "write" }, sum: { requests: 700 } },
        { dimensions: { namespaceId: "ns_a", actionType: "read" }, sum: { requests: 5000 } },
        { dimensions: { namespaceId: "ns_b", actionType: "write" }, sum: { requests: 300 } },
        { dimensions: { namespaceId: "ns_b", actionType: "list" }, sum: { requests: 12 } },
      ],
      aiInference: [],
    };
    const usage = mapAccountUsage(account, "2026-06-28", 1_700_000_000_000);
    if (!usage.configured) throw new Error("expected configured");
    expect(usage.kv.totals).toEqual({ read: 5000, write: 1000, delete: 0, list: 12 });
    expect(usage.kv.limits).toEqual(FREE_TIER_LIMITS.kv);
    // ns_a leads (more writes than ns_b); each namespace row is keyed by id.
    expect(usage.kv.namespaces[0]).toEqual({ namespace_id: "ns_a", read: 5000, write: 700, delete: 0, list: 0 });
    expect(usage.kv.namespaces.map((n) => n.namespace_id)).toEqual(["ns_a", "ns_b"]);
  });

  it("sums Workers AI neurons per model and a total, dropping unknown KV actions", () => {
    const account = {
      kvOperations: [{ dimensions: { namespaceId: "ns_a", actionType: "bogus" }, sum: { requests: 99 } }],
      aiInference: [
        { dimensions: { modelName: "@cf/baai/bge-base-en-v1.5" }, sum: { neurons: 1200 } },
        { dimensions: { modelName: "@cf/meta/llama" }, sum: { neurons: 800 } },
      ],
    };
    const usage = mapAccountUsage(account, "2026-06-28", 1_700_000_000_000);
    if (!usage.configured) throw new Error("expected configured");
    expect(usage.kv.totals).toEqual({ read: 0, write: 0, delete: 0, list: 0 }); // unknown action dropped
    expect(usage.ai.neurons_used).toBe(2000);
    expect(usage.ai.neurons_limit).toBe(FREE_TIER_LIMITS.aiNeurons);
    expect(usage.ai.by_model[0]).toEqual({ model: "@cf/baai/bge-base-en-v1.5", neurons: 1200 });
  });

  it("tolerates an empty / shapeless account (no rows)", () => {
    const usage = mapAccountUsage({}, "2026-06-28", 1);
    if (!usage.configured) throw new Error("expected configured");
    expect(usage.kv.totals).toEqual({ read: 0, write: 0, delete: 0, list: 0 });
    expect(usage.kv.namespaces).toEqual([]);
    expect(usage.ai.neurons_used).toBe(0);
  });
});

describe("fetchUsage", () => {
  it("returns { configured: false } and makes NO request when the CF vars are unset", async () => {
    const f = fetchReturning(graphqlBody({}));
    const result = await fetchUsage({} as unknown as Env, { fetchImpl: f.fetchImpl, now: () => 1 });
    expect(result).toEqual({ configured: false });
    expect(f.calls).toBe(0);
  });

  it("returns { configured: false } when only one var is set (still no request)", async () => {
    const f = fetchReturning(graphqlBody({}));
    const result = await fetchUsage({ CF_ACCOUNT_ID: "acct123" } as unknown as Env, {
      fetchImpl: f.fetchImpl,
      now: () => 1,
    });
    expect(result).toEqual({ configured: false });
    expect(f.calls).toBe(0);
  });

  it("maps a configured response into the usage payload for the current UTC day", async () => {
    const f = fetchReturning(
      graphqlBody({
        kvOperations: [{ dimensions: { namespaceId: "ns_a", actionType: "write" }, sum: { requests: 1440 } }],
        aiInference: [{ dimensions: { modelName: "m" }, sum: { neurons: 42 } }],
      }),
    );
    const now = Date.parse("2026-06-28T10:00:00Z");
    const result = await fetchUsage(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => now });
    if (!result.configured) throw new Error("expected configured");
    expect(f.calls).toBe(1);
    expect(result.day).toBe("2026-06-28");
    expect(result.kv.totals.write).toBe(1440);
    expect(result.ai.neurons_used).toBe(42);
  });

  it("throws upstream_unavailable on a non-2xx", async () => {
    const f = fetchReturning("nope", 403);
    await expect(fetchUsage(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => 1 })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });

  it("throws upstream_unavailable when the GraphQL body carries errors", async () => {
    const f = fetchReturning({ errors: [{ message: "not authorized" }] });
    await expect(fetchUsage(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => 1 })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });

  it("throws upstream_unavailable when the transport fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(fetchUsage(configuredEnv(), { fetchImpl, now: () => 1 })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });
});
