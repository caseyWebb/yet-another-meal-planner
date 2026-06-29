import { describe, it, expect } from "vitest";
import { UsagePage } from "../src/admin/pages/usage.js";
import type { UsageResult, TrendsResult, ToolUsageResult } from "../src/usage.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

const usage: UsageResult = {
  configured: true,
  generated_at: 1,
  day: "2026-06-29",
  kv: {
    limits: { read: 100000, write: 1000, delete: 1000, list: 1000 },
    totals: { read: 5, write: 1200, delete: 0, list: 2 },
    namespaces: [{ namespace_id: "ns1", read: 5, write: 1200, delete: 0, list: 2 }],
  },
  ai: { neurons_limit: 10000, neurons_used: 42, by_model: [{ model: "bge", neurons: 42 }] },
};

const trends: TrendsResult = {
  configured: true,
  generated_at: 1,
  window_days: 30,
  jobs: [
    {
      job: "flyer-warm",
      days: [
        { day: "2026-06-28", runs: 2, avg_ms: 10, total_ms: 20 },
        { day: "2026-06-29", runs: 4, avg_ms: 5, total_ms: 20 },
      ],
    },
  ],
};

const tools: ToolUsageResult = {
  configured: true,
  generated_at: 1,
  window_days: 30,
  tools: [{ tool: "place_order", calls: 10, errors: 1, p50_ms: 100, p95_ms: 300 }],
};

describe("Usage SSR", () => {
  it("renders KV meters (over-limit flagged), namespaces, AI, the trend sparkline, and tools", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("KV operations");
    expect(html).toContain("1200 / 1000"); // write over its limit
    expect(html).toContain("status-word fail"); // over-limit meter flagged red
    expect(html).toContain("ns1");
    expect(html).toContain("42 neurons");
    expect(html).toContain("flyer-warm");
    expect(html).toContain("place_order");
    expect(html).toContain("10% err"); // 1 / 10 calls
  });

  it("renders setup cards for each dashboard when analytics is unconfigured", () => {
    const html = render(
      UsagePage({ usage: { configured: false }, trends: { configured: false }, tools: { configured: false } }),
    );
    expect(html).toContain("CF_ACCOUNT_ID");
    expect(html).toContain("not configured");
  });
});
