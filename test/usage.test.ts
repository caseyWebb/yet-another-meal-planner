import { describe, it, expect, vi } from "vitest";
import {
  fetchUsage,
  fetchUsageTrends,
  fetchToolUsage,
  mapAccountUsage,
  mapTrendRows,
  mapToolUsageRows,
  utcDay,
  FREE_TIER_LIMITS,
  TRENDS_WINDOW_DAYS,
} from "../src/usage.js";
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

// Regression guard for the `this`-binding bug: `defaultDeps` invokes the global `fetch` as
// `deps.fetchImpl(...)`, so an UNBOUND `fetch` stored on the object would run with `this`
// pointing at the deps object — which workerd rejects with "Illegal invocation". Every other
// test injects its own `fetchImpl`, so only this one exercises the real default. It re-imports
// the module with the global `fetch` stubbed by a `this`-recorder, runs the production path
// (no injected deps), and asserts `this` is pinned to `globalThis`, not the holder object.
describe("defaultDeps fetch binding", () => {
  it("invokes the global fetch with `this` pinned to globalThis, not the deps object", async () => {
    let capturedThis: unknown = "unset";
    const recorder = function (this: unknown) {
      capturedThis = this;
      return Promise.resolve(new Response(JSON.stringify(graphqlBody({})), { status: 200 }));
    } as unknown as typeof fetch;

    vi.stubGlobal("fetch", recorder);
    vi.resetModules();
    try {
      const mod = await import("../src/usage.js");
      // Production path: no injected fetchImpl, so this uses the real `defaultDeps`.
      await mod.fetchUsage(configuredEnv());
      // Pre-fix `{ fetchImpl: fetch }` captures `this === defaultDeps` (the holder); the bound
      // default pins it to globalThis. This assertion fails against the unbound code.
      expect(capturedThis).toBe(globalThis);
      expect(capturedThis).not.toBe(mod.defaultDeps);

      // Belt-and-suspenders: invoke the default fetchImpl DETACHED from its object, independent of
      // `fetchUsage`'s control flow. A bound function ignores the receiver; an unbound one would
      // capture `undefined` here (and `defaultDeps` when called as a method above).
      capturedThis = "unset";
      const detached = mod.defaultDeps.fetchImpl;
      await detached("https://example.invalid/", { method: "POST" });
      expect(capturedThis).toBe(globalThis);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

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

describe("mapTrendRows", () => {
  it("groups AE SQL rows into per-job series, ordered by job then day", () => {
    const rows = [
      { job: "recipe-classify", day: "2026-06-27 00:00:00", runs: 288, avg_ms: 120, total_ms: 34560 },
      { job: "flyer-warm", day: "2026-06-28 00:00:00", runs: 288, avg_ms: 40, total_ms: 11520 },
      { job: "recipe-classify", day: "2026-06-28 00:00:00", runs: 288, avg_ms: 130, total_ms: 37440 },
    ];
    const result = mapTrendRows(rows, 1_700_000_000_000, TRENDS_WINDOW_DAYS);
    if (!result.configured) throw new Error("expected configured");
    expect(result.window_days).toBe(TRENDS_WINDOW_DAYS);
    expect(result.jobs.map((j) => j.job)).toEqual(["flyer-warm", "recipe-classify"]);
    const classify = result.jobs.find((j) => j.job === "recipe-classify")!;
    // days ascending, normalized to YYYY-MM-DD
    expect(classify.days.map((d) => d.day)).toEqual(["2026-06-27", "2026-06-28"]);
    expect(classify.days[1]).toEqual({ day: "2026-06-28", runs: 288, avg_ms: 130, total_ms: 37440 });
  });

  it("coerces numeric strings and drops rows with no job name", () => {
    const rows = [
      { job: "email", day: "2026-06-28 00:00:00", runs: "3", avg_ms: "12.5", total_ms: "37.5" },
      { day: "2026-06-28 00:00:00", runs: 99 }, // no job → dropped
    ];
    const result = mapTrendRows(rows, 1, TRENDS_WINDOW_DAYS);
    if (!result.configured) throw new Error("expected configured");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toEqual({
      job: "email",
      days: [{ day: "2026-06-28", runs: 3, avg_ms: 12.5, total_ms: 37.5 }],
    });
  });

  it("tolerates an empty result set", () => {
    const result = mapTrendRows([], 1, TRENDS_WINDOW_DAYS);
    if (!result.configured) throw new Error("expected configured");
    expect(result.jobs).toEqual([]);
  });
});

describe("fetchUsageTrends", () => {
  it("returns { configured: false } and makes NO request when the CF vars are unset", async () => {
    const f = fetchReturning({ data: [] });
    const result = await fetchUsageTrends({} as unknown as Env, { fetchImpl: f.fetchImpl, now: () => 1 });
    expect(result).toEqual({ configured: false });
    expect(f.calls).toBe(0);
  });

  it("maps the AE SQL `data` rows into a trends payload", async () => {
    const f = fetchReturning({
      data: [{ job: "flyer-warm", day: "2026-06-28 00:00:00", runs: 288, avg_ms: 40, total_ms: 11520 }],
    });
    const result = await fetchUsageTrends(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => 1 });
    if (!result.configured) throw new Error("expected configured");
    expect(f.calls).toBe(1);
    expect(result.jobs[0].job).toBe("flyer-warm");
    expect(result.jobs[0].days[0]).toEqual({ day: "2026-06-28", runs: 288, avg_ms: 40, total_ms: 11520 });
  });

  it("throws upstream_unavailable on a non-2xx", async () => {
    const f = fetchReturning("nope", 403);
    await expect(fetchUsageTrends(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => 1 })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });

  it("throws upstream_unavailable when the transport fails", async () => {
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(fetchUsageTrends(configuredEnv(), { fetchImpl, now: () => 1 })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });
});

describe("mapToolUsageRows", () => {
  it("maps AE SQL rows into per-tool aggregates, busiest-first, coercing numeric strings", () => {
    const rows = [
      { tool: "read_recipe", calls: "5", errors: "1", p50_ms: "12", p95_ms: "40" },
      { tool: "place_order", calls: 20, errors: 0, p50_ms: 300, p95_ms: 900 },
    ];
    const result = mapToolUsageRows(rows, 1_700_000_000_000, TRENDS_WINDOW_DAYS);
    if (!result.configured) throw new Error("expected configured");
    expect(result.window_days).toBe(TRENDS_WINDOW_DAYS);
    // ordered by call count descending
    expect(result.tools.map((t) => t.tool)).toEqual(["place_order", "read_recipe"]);
    expect(result.tools[1]).toEqual({ tool: "read_recipe", calls: 5, errors: 1, p50_ms: 12, p95_ms: 40 });
  });

  it("drops rows with no tool name and tolerates an empty result set", () => {
    const result = mapToolUsageRows([{ calls: 9 }], 1, TRENDS_WINDOW_DAYS);
    if (!result.configured) throw new Error("expected configured");
    expect(result.tools).toEqual([]);
    expect(mapToolUsageRows([], 1, TRENDS_WINDOW_DAYS)).toMatchObject({ configured: true, tools: [] });
  });
});

describe("fetchToolUsage", () => {
  it("returns { configured: false } and makes NO request when the CF vars are unset", async () => {
    const f = fetchReturning({ data: [] });
    const result = await fetchToolUsage({} as unknown as Env, { fetchImpl: f.fetchImpl, now: () => 1 });
    expect(result).toEqual({ configured: false });
    expect(f.calls).toBe(0);
  });

  it("maps the AE SQL `data` rows into a tool-usage payload", async () => {
    const f = fetchReturning({
      data: [{ tool: "kroger_prices", calls: 12, errors: 2, p50_ms: 250, p95_ms: 800 }],
    });
    const result = await fetchToolUsage(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => 1 });
    if (!result.configured) throw new Error("expected configured");
    expect(f.calls).toBe(1);
    expect(result.tools[0]).toEqual({ tool: "kroger_prices", calls: 12, errors: 2, p50_ms: 250, p95_ms: 800 });
  });

  it("throws upstream_unavailable on a non-2xx", async () => {
    const f = fetchReturning("nope", 403);
    await expect(fetchToolUsage(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => 1 })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });
});
