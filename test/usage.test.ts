import { describe, it, expect, vi } from "vitest";
import {
  fetchUsage,
  fetchUsageTrends,
  fetchToolUsage,
  mapAccountUsage,
  mapKvHistory,
  resolveNamespaceLabel,
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

function fetchReturning(
  body: unknown,
  status = 200,
): { fetchImpl: typeof fetch; calls: number; lastRequest: { query?: string; variables?: unknown } | null } {
  let calls = 0;
  let lastRequest: { query?: string; variables?: unknown } | null = null;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    // The GraphQL fetchers send a JSON body; the AE SQL fetchers send a plain SQL string. Only the
    // former is captured for assertion — ignore a non-JSON body rather than throwing in the mock.
    if (typeof init?.body === "string") {
      try {
        lastRequest = JSON.parse(init.body);
      } catch {
        lastRequest = null;
      }
    }
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    get calls() {
      return calls;
    },
    get lastRequest() {
      return lastRequest;
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
    // ns_a leads (more writes than ns_b); each namespace row is keyed by id, and (with no
    // id→binding map passed) both resolve to the generic "unlabeled" fallback.
    expect(usage.kv.namespaces[0]).toEqual({
      namespace_id: "ns_a",
      read: 5000,
      write: 700,
      delete: 0,
      list: 0,
      resolved: { label: "ns_a", color: "var(--kv-unlabeled)", unlabeled: true },
    });
    expect(usage.kv.namespaces.map((n) => n.namespace_id)).toEqual(["ns_a", "ns_b"]);
  });

  it("resolves namespace labels via the supplied id→binding map", () => {
    const account = {
      kvOperations: [{ dimensions: { namespaceId: "abc123", actionType: "read" }, sum: { requests: 10 } }],
      aiInference: [],
    };
    const idToBinding = new Map([["abc123", "KROGER_KV"]]);
    const usage = mapAccountUsage(account, "2026-06-28", 1, idToBinding);
    if (!usage.configured) throw new Error("expected configured");
    expect(usage.kv.namespaces[0].resolved).toEqual({ label: "KROGER_KV", color: "var(--kv-kroger)", unlabeled: false });
  });

  it("sums Workers AI neurons per model and a total, dropping unknown KV actions", () => {
    const account = {
      kvOperations: [{ dimensions: { namespaceId: "ns_a", actionType: "bogus" }, sum: { requests: 99 } }],
      aiInference: [
        { dimensions: { modelId: "@cf/baai/bge-base-en-v1.5" }, sum: { totalNeurons: 1200 } },
        { dimensions: { modelId: "@cf/meta/llama" }, sum: { totalNeurons: 800 } },
      ],
    };
    const usage = mapAccountUsage(account, "2026-06-28", 1_700_000_000_000);
    if (!usage.configured) throw new Error("expected configured");
    expect(usage.kv.totals).toEqual({ read: 0, write: 0, delete: 0, list: 0 }); // unknown action dropped
    expect(usage.ai.neurons_used).toBe(2000);
    expect(usage.ai.neurons_limit).toBe(FREE_TIER_LIMITS.aiNeurons);
    expect(usage.ai.by_model[0]).toEqual({ model: "@cf/baai/bge-base-en-v1.5", neurons: 1200 });
  });

  it("rounds Cloudflare's fractional neurons to integers (the INT payload contract)", () => {
    const account = {
      kvOperations: [],
      aiInference: [
        { dimensions: { modelId: "a" }, sum: { totalNeurons: 10453.803226754151 } },
        { dimensions: { modelId: "b" }, sum: { totalNeurons: 12.5 } },
      ],
    };
    const usage = mapAccountUsage(account, "2026-06-28", 1);
    if (!usage.configured) throw new Error("expected configured");
    // Each model rounded, and the total is the sum of the rounded per-model values.
    expect(usage.ai.by_model).toEqual([
      { model: "a", neurons: 10454 },
      { model: "b", neurons: 13 },
    ]);
    expect(usage.ai.neurons_used).toBe(10467);
    expect(Number.isInteger(usage.ai.neurons_used)).toBe(true);
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
        aiInference: [{ dimensions: { modelId: "m" }, sum: { totalNeurons: 42 } }],
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

  // Guards the exact GraphQL dataset/field/filter names against silent regression: the previous
  // bug was a non-existent node name (`workersKvOperationsAdaptiveGroups`) that Cloudflare rejected
  // with "unknown field". The response-parsing tests above cannot catch that — they feed a canned
  // response and never inspect the request — so assert the request body directly.
  it("sends the live-schema dataset/field names and a 30-day KV range ending today", async () => {
    const f = fetchReturning(graphqlBody({}));
    const now = Date.parse("2026-06-28T10:00:00Z");
    await fetchUsage(configuredEnv(), { fetchImpl: f.fetchImpl, now: () => now });
    const query = f.lastRequest?.query ?? "";
    // KV dataset + its widened date-range filter (30 days ending today) + the `date` dimension
    // the per-namespace history needs (design.md Decision 1: widen the SAME query, not a new one).
    expect(query).toContain("kvOperationsAdaptiveGroups");
    expect(query).toContain('date_geq: "2026-05-30"'); // 29 days before 2026-06-28 (30-day window)
    expect(query).toContain('date_leq: "2026-06-28"');
    expect(query).toContain("dimensions { namespaceId actionType date }");
    // AI dataset + its datetimeHour filter + the renamed dimension/metric (today only — AI is unchanged)
    expect(query).toContain("aiInferenceAdaptiveGroups");
    expect(query).toContain('datetimeHour_geq: "2026-06-28T00:00:00Z"');
    expect(query).toContain('datetimeHour_leq: "2026-06-28T23:00:00Z"');
    expect(query).toContain("modelId");
    expect(query).toContain("totalNeurons");
    // The old, non-existent names must not reappear.
    expect(query).not.toContain("workersKvOperationsAdaptiveGroups");
    expect(query).not.toContain("workersAiInferenceRequestsAdaptiveGroups");
    expect(query).not.toMatch(/\bmodelName\b/);
    // The day bounds are inlined into the query; only accountTag stays a bound variable.
    expect(f.lastRequest?.variables).toEqual({ accountTag: "acct123" });
  });

  it("populates kv.history from the same widened response, and resolves namespace labels", async () => {
    const f = fetchReturning(
      graphqlBody({
        kvOperations: [
          { dimensions: { namespaceId: "ns_a", actionType: "read", date: "2026-06-27" }, sum: { requests: 10 } },
          { dimensions: { namespaceId: "ns_a", actionType: "read", date: "2026-06-28" }, sum: { requests: 20 } },
        ],
        aiInference: [],
      }),
    );
    const now = Date.parse("2026-06-28T10:00:00Z");
    const env = { CF_ACCOUNT_ID: "acct123", CF_ANALYTICS_TOKEN: "tok", KV_NAMESPACE_LABELS: "ns_a:KROGER_KV" } as unknown as Env;
    const result = await fetchUsage(env, { fetchImpl: f.fetchImpl, now: () => now });
    if (!result.configured) throw new Error("expected configured");
    // Today's snapshot only counts today's row.
    expect(result.kv.totals.read).toBe(20);
    expect(result.kv.namespaces[0].resolved).toEqual({ label: "KROGER_KV", color: "var(--kv-kroger)", unlabeled: false });
    // History covers the full window and is zero-filled/ascending.
    expect(result.kv.history.window_days).toBe(TRENDS_WINDOW_DAYS);
    expect(result.kv.history.days).toHaveLength(TRENDS_WINDOW_DAYS);
    expect(result.kv.history.days[0].day).toBe("2026-05-30");
    expect(result.kv.history.days[result.kv.history.days.length - 1].day).toBe("2026-06-28");
    const day27 = result.kv.history.days.find((d) => d.day === "2026-06-27")!;
    expect(day27.namespaces[0]).toEqual({ namespace_id: "ns_a", read: 10, write: 0, delete: 0, list: 0, resolved: { label: "KROGER_KV", color: "var(--kv-kroger)", unlabeled: false } });
    // A day with literally no rows still appears, zero-filled, not omitted.
    const quietDay = result.kv.history.days.find((d) => d.day === "2026-06-01")!;
    expect(quietDay.namespaces[0]).toEqual({ namespace_id: "ns_a", read: 0, write: 0, delete: 0, list: 0, resolved: { label: "KROGER_KV", color: "var(--kv-kroger)", unlabeled: false } });
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

describe("resolveNamespaceLabel", () => {
  it("resolves a known id to its mapped binding's label/color", () => {
    const idToBinding = new Map([["abc", "OAUTH_KV"]]);
    expect(resolveNamespaceLabel("abc", idToBinding)).toEqual({ label: "OAUTH_KV", color: "var(--kv-oauth)", unlabeled: false });
  });

  it("falls back to the generic 'unlabeled' marker for an unmapped id, still reporting the raw id", () => {
    expect(resolveNamespaceLabel("deadbeef", new Map())).toEqual({ label: "deadbeef", color: "var(--kv-unlabeled)", unlabeled: true });
  });

  it("falls back to unlabeled for an id mapped to a binding outside the known three", () => {
    const idToBinding = new Map([["xyz", "SOME_FUTURE_KV"]]);
    expect(resolveNamespaceLabel("xyz", idToBinding)).toEqual({ label: "xyz", color: "var(--kv-unlabeled)", unlabeled: true });
  });

  it("makes no outbound request — it is a pure static-table lookup", () => {
    // Type-level guarantee: the function signature takes no fetch/env, only data already in hand.
    // This test exists for the requirement's "no additional Cloudflare API call" scenario; the
    // assertion is just that calling it repeatedly produces the same result with no IO performed.
    const idToBinding = new Map([["abc", "TENANT_KV"]]);
    const a = resolveNamespaceLabel("abc", idToBinding);
    const b = resolveNamespaceLabel("abc", idToBinding);
    expect(a).toEqual(b);
  });
});

describe("mapKvHistory", () => {
  it("groups rows into a per-namespace, per-day series, ascending, zero-filling every namespace into every day", () => {
    const rows = [
      { dimensions: { namespaceId: "ns_a", actionType: "read", date: "2026-06-01" }, sum: { requests: 5 } },
      { dimensions: { namespaceId: "ns_b", actionType: "write", date: "2026-06-02" }, sum: { requests: 3 } },
    ];
    const result = mapKvHistory(rows, "2026-06-01", "2026-06-03", new Map());
    expect(result.window_days).toBe(3);
    expect(result.days.map((d) => d.day)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    // ns_a and ns_b both appear on EVERY day (zero-filled), not just the day they had rows.
    for (const day of result.days) {
      expect(day.namespaces.map((n) => n.namespace_id).sort()).toEqual(["ns_a", "ns_b"]);
    }
    const day1 = result.days[0];
    expect(day1.namespaces.find((n) => n.namespace_id === "ns_a")).toMatchObject({ read: 5, write: 0, delete: 0, list: 0 });
    expect(day1.namespaces.find((n) => n.namespace_id === "ns_b")).toMatchObject({ read: 0, write: 0, delete: 0, list: 0 });
  });

  it("reports a day with zero operations for a namespace as 0, never an absent entry", () => {
    const rows = [{ dimensions: { namespaceId: "ns_a", actionType: "read", date: "2026-06-01" }, sum: { requests: 5 } }];
    const result = mapKvHistory(rows, "2026-06-01", "2026-06-02", new Map());
    const day2 = result.days.find((d) => d.day === "2026-06-02")!;
    expect(day2).toBeDefined();
    expect(day2.namespaces[0]).toMatchObject({ namespace_id: "ns_a", read: 0, write: 0, delete: 0, list: 0 });
  });

  it("handles a row-cap-adjacent row count (namespaces × actions × days near the 1000-row ceiling)", () => {
    const namespaces = ["ns_a", "ns_b", "ns_c"];
    const actions = ["read", "write", "delete", "list"];
    const rows: { dimensions: { namespaceId: string; actionType: string; date: string }; sum: { requests: number } }[] = [];
    for (let d = 0; d < 30; d++) {
      const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      for (const ns of namespaces) {
        for (const action of actions) {
          rows.push({ dimensions: { namespaceId: ns, actionType: action, date: day }, sum: { requests: 1 } });
        }
      }
    }
    expect(rows.length).toBe(360); // 3 ns × 4 actions × 30 days — comfortably under the 1000-row cap
    const result = mapKvHistory(rows, "2026-01-01", "2026-01-30", new Map());
    expect(result.days).toHaveLength(30);
    for (const day of result.days) {
      expect(day.namespaces).toHaveLength(3);
      for (const ns of day.namespaces) {
        expect(ns).toMatchObject({ read: 1, write: 1, delete: 1, list: 1 });
      }
    }
  });

  it("resolves each history entry's namespace label/color from the supplied map", () => {
    const rows = [{ dimensions: { namespaceId: "id1", actionType: "read", date: "2026-06-01" }, sum: { requests: 1 } }];
    const result = mapKvHistory(rows, "2026-06-01", "2026-06-01", new Map([["id1", "TENANT_KV"]]));
    expect(result.days[0].namespaces[0].resolved).toEqual({ label: "TENANT_KV", color: "var(--kv-tenant)", unlabeled: false });
  });

  it("tolerates an empty row set, still producing a zero-filled, namespace-less window", () => {
    const result = mapKvHistory([], "2026-06-01", "2026-06-02", new Map());
    expect(result.days).toHaveLength(2);
    expect(result.days[0].namespaces).toEqual([]);
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
