import { describe, it, expect } from "vitest";
import { UsagePage } from "../src/admin/pages/usage.js";
import type { UsageResult, TrendsResult, ToolUsageResult, NamespaceUsage } from "../src/usage.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

const ns = (id: string, counts: Partial<Record<"read" | "write" | "delete" | "list", number>>, resolved: NamespaceUsage["resolved"]): NamespaceUsage => ({
  namespace_id: id,
  read: 0,
  write: 0,
  delete: 0,
  list: 0,
  ...counts,
  resolved,
});

const KROGER = ns("ns_a", { read: 9000, write: 380, delete: 14, list: 40 }, { label: "KROGER_KV", color: "var(--kv-kroger)", unlabeled: false });
const UNLABELED = ns("ns_b", { read: 100, write: 620, delete: 0, list: 0 }, { label: "ns_b", color: "var(--kv-unlabeled)", unlabeled: true });

const usage: UsageResult = {
  configured: true,
  generated_at: 1,
  day: "2026-06-29",
  kv: {
    limits: { read: 100000, write: 1000, delete: 1000, list: 1000 },
    totals: { read: 9100, write: 1000, delete: 14, list: 40 },
    namespaces: [KROGER, UNLABELED],
    history: {
      window_days: 2,
      days: [
        { day: "2026-06-28", namespaces: [ns("ns_a", { read: 8000, write: 300 }, KROGER.resolved), ns("ns_b", {}, UNLABELED.resolved)] },
        { day: "2026-06-29", namespaces: [KROGER, UNLABELED] },
      ],
    },
  },
  ai: {
    neurons_limit: 10000,
    neurons_used: 42,
    by_model: [{ model: "bge", neurons: 42 }],
    history: {
      window_days: 2,
      days: [
        { day: "2026-06-28", neurons: 30 },
        { day: "2026-06-29", neurons: 42 },
      ],
    },
  },
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
  it("renders headline stat tiles", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("KV ops · today");
    expect(html).toContain("AI neurons · today");
    expect(html).toContain("MCP calls · 30d");
    expect(html).toContain("Error rate · 30d");
    expect(html).toContain("10.0%"); // 1 error / 10 calls
  });

  it("renders KV meters stacked per namespace, recolored as they approach/exceed the cap", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("KV operations");
    // write total (380 + 620 = 1000) is AT its limit → fail state
    expect(html).toContain("meter fail");
    expect(html).toContain("1,000");
    // read total (9100) is well under its 100,000 limit → ok state present too
    expect(html).toContain("meter ok");
    // each namespace contributes its own stacked segment, with a per-segment data-tip-* breakdown
    // (the shared sparkline-tooltip primitive, not the native title attribute)
    expect(html).toContain('class="kv-seg"');
    expect(html).toMatch(/data-tip-title="KROGER_KV"/);
    expect(html).toMatch(/data-tip-body="[\d,]+ writes today"/);
  });

  it("renders the namespace legend with resolved labels and colors — not the grey 'unlabeled' fallback for a resolved namespace", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("KROGER_KV");
    // the unmapped namespace still appears (raw id), not dropped
    expect(html).toContain("ns_b");
    // the resolved (KROGER_KV) namespace gets its palette color, never the generic grey fallback
    expect(html).toContain("var(--kv-kroger)");
    // the genuinely-unresolved namespace still renders — with the generic fallback color, not
    // dropped — but the resolved one above must NOT have fallen back to it
    expect(html).toContain("var(--kv-unlabeled)");
    const krogerSegment = html.match(/data-tip-title="KROGER_KV"[^>]*/)?.[0] ?? "";
    expect(krogerSegment).not.toContain("var(--kv-unlabeled)");
  });

  it("renders a namespace-stacked 30-day sparkline with a per-column data-tip-* breakdown (hover tooltip)", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("kv-spark");
    expect(html).toContain('class="spark-col"');
    expect(html).toContain('class="spark-seg"');
    expect(html).toMatch(/data-tip-title="2026-06-28"/);
    expect(html).toMatch(/data-tip-body="[\d,]+ writes \(KROGER_KV [\d,]+ · ns_b [\d,]+\)"/);
  });

  it("renders the AI neuron meter + per-model breakdown, plus a 30-day neuron sparkline", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("42 neurons");
    expect(html).toContain("bge");
    // The neuron sparkline renders with the shared data-tip-* hover tooltip primitive.
    expect(html).toContain("ai-spark");
    expect(html).toMatch(/data-tip-title="2026-06-28"/);
    expect(html).toMatch(/data-tip-body="30 neurons"/);
    expect(html).toMatch(/data-tip-body="42 neurons"/);
  });

  it("renders per-job trend sparklines from fetchUsageTrends data, unchanged", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("flyer-warm");
    expect(html).toContain("6 runs");
  });

  it("renders the tool-usage table from fetchToolUsage data, busiest first", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain("place_order");
    expect(html).toContain("10.0%");
    expect(html).toContain("100 ms");
    expect(html).toContain("300 ms");
  });

  it("renders setup cards for each dashboard independently when analytics is unconfigured", () => {
    const html = render(
      UsagePage({ usage: { configured: false }, trends: { configured: false }, tools: { configured: false } }),
    );
    expect(html).toContain("CF_ACCOUNT_ID");
    expect(html).toContain("not configured");
    expect(html).toContain("Usage trends not available");
    expect(html).toContain("Tool usage not available");
  });

  it("renders one surface's not-configured state while another surface's data still renders", () => {
    const html = render(UsagePage({ usage, trends: { configured: false }, tools }));
    // the configured KV/AI surface still renders…
    expect(html).toContain("KV operations");
    expect(html).toContain("42 neurons");
    // …while the unconfigured trends surface shows its own setup card
    expect(html).toContain("Usage trends not available");
    // and the tool table (also configured) still renders
    expect(html).toContain("place_order");
  });

  it("ships no dedicated client island (only the shared, page-agnostic sparkline-tip script every admin page loads via Layout — no hydration props, no per-page bundle)", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).not.toContain("application/json");
    expect(html).toContain("/admin/islands/sparkline-tip.js");
    expect(html.match(/\/admin\/islands\/[a-z-]+\.js/g)).toEqual(["/admin/islands/sparkline-tip.js"]);
  });

  it("adds spacing below the 'Cloudflare usage for <day> (UTC)…' caption", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toMatch(/class="muted small usage-caption"/);
  });

  it("uses the wide container (matching Data/Discovery/Logs/Config), not the narrower default, so the 4-column stat grid and stacked meters have room to fit without overflow", () => {
    const html = render(UsagePage({ usage, trends, tools }));
    expect(html).toContain('class="wrap wrap-wide"');
  });
});
