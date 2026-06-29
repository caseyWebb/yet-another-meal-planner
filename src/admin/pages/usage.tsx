// The Usage area (usage-observability / usage-trends / tool-usage-trends), server-rendered.
// Three read-only dashboards — account resource usage (KV ops + AI neurons vs the daily free
// tier), per-job run trends (sparklines), and per-tool call/error/latency — each fetched by
// calling the src/usage.ts reader directly and rendering its discriminated result (a
// `{ configured: false }` shape becomes a setup card). Refresh is a page reload (no island).

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import type { UsageResult, TrendsResult, ToolUsageResult } from "../../usage.js";

const KV_ACTIONS = ["read", "write", "delete", "list"] as const;
const TICKS = "▁▂▃▄▅▆▇█";

function sparkline(days: { runs: number }[]): string {
  const max = Math.max(0, ...days.map((d) => d.runs));
  if (max <= 0) return "";
  return days.map((d) => TICKS[Math.round((d.runs / max) * 7)]).join("");
}

const MeterRow = ({ label, used, limit }: { label: string; used: number; limit: number }) => {
  const cls = used >= limit ? "fail" : "ok";
  return (
    <div class="status-row">
      <div class="status-line">
        <span class={`dot ${cls}`} />
        <span class="status-label">{label}</span>
        <span class={`status-word ${cls}`}>
          {used} / {limit}
        </span>
      </div>
    </div>
  );
};

const NotConfigured = ({ children }: { children?: Child }) => <div class="card muted">{children}</div>;

const UsagePanel = ({ usage }: { usage: UsageResult }) => {
  if (!usage.configured) {
    return (
      <NotConfigured>
        Usage analytics not configured. Set <code>CF_ACCOUNT_ID</code> and a read-only <code>CF_ANALYTICS_TOKEN</code>{" "}
        (Account Analytics: Read) to read account-wide KV-operation and Workers AI neuron usage. Reading usage costs no
        KV.
      </NotConfigured>
    );
  }
  return (
    <div>
      <p class="muted small">Cloudflare usage for {usage.day} (UTC), against the daily free-tier limits.</p>
      <div class="card">
        <h2>KV operations</h2>
        {KV_ACTIONS.map((a) => (
          <MeterRow label={`${a}s`} used={usage.kv.totals[a]} limit={usage.kv.limits[a]} />
        ))}
      </div>
      <div class="card">
        <h2>By namespace</h2>
        <p class="muted small">Keyed by Cloudflare namespace id (read · write · delete · list).</p>
        {usage.kv.namespaces.length === 0 ? (
          <p class="muted">No KV operations recorded today.</p>
        ) : (
          usage.kv.namespaces.map((ns) => (
            <div class="status-row">
              <div class="status-line">
                <span class="status-label" title={ns.namespace_id}>
                  {ns.namespace_id}
                </span>
                <span class="status-word muted">
                  {ns.read} · {ns.write} · {ns.delete} · {ns.list}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      <div class="card">
        <h2>Workers AI</h2>
        <MeterRow label="neurons" used={usage.ai.neurons_used} limit={usage.ai.neurons_limit} />
        {usage.ai.by_model.length === 0 ? (
          <p class="muted">No Workers AI inference recorded today.</p>
        ) : (
          <div class="summary">
            {usage.ai.by_model.map((m) => (
              <span class="summary-item">
                <span class="summary-k muted small">{m.model}</span>
                <span class="summary-v small">{m.neurons} neurons</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const TrendsPanel = ({ trends }: { trends: TrendsResult }) => {
  if (!trends.configured) {
    return (
      <NotConfigured>
        Usage trends not available. Per-job run history comes from the Workers Analytics Engine SQL API (reuses{" "}
        <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code>). Set them to see per-job trends over the last 30
        days.
      </NotConfigured>
    );
  }
  return (
    <div class="card">
      <h2>Trends</h2>
      <p class="muted small">Per-job runs over the last {trends.window_days} days (UTC), oldest → newest.</p>
      {trends.jobs.length === 0 ? (
        <p class="muted">No usage data points recorded yet.</p>
      ) : (
        trends.jobs.map((job) => {
          const totalRuns = job.days.reduce((n, d) => n + d.runs, 0);
          const totalMs = job.days.reduce((n, d) => n + d.total_ms, 0);
          const avg = totalRuns > 0 ? Math.round(totalMs / totalRuns) : 0;
          return (
            <div class="status-row">
              <div class="status-line">
                <span class="status-label">{job.job}</span>
                <span class="status-word muted" title="runs per day (oldest → newest)">
                  {sparkline(job.days)}
                </span>
                <span class="status-word muted small">
                  {totalRuns} runs · {avg} ms avg
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

const ToolsPanel = ({ tools }: { tools: ToolUsageResult }) => {
  if (!tools.configured) {
    return (
      <NotConfigured>
        Tool usage not available. Per-tool call history comes from the Workers Analytics Engine SQL API (reuses{" "}
        <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code>). Set them to see per-tool calls, error rate, and
        latency over the last 30 days.
      </NotConfigured>
    );
  }
  return (
    <div class="card">
      <h2>Tool usage</h2>
      <p class="muted small">MCP tool calls over the last {tools.window_days} days, busiest first.</p>
      {tools.tools.length === 0 ? (
        <p class="muted">No tool calls recorded yet.</p>
      ) : (
        tools.tools.map((t) => {
          const cls = t.errors === 0 ? "ok" : "fail";
          const errPct = t.calls > 0 ? Math.round((t.errors / t.calls) * 100) : 0;
          return (
            <div class="status-row">
              <div class="status-line">
                <span class={`dot ${cls}`} />
                <span class="status-label">{t.tool}</span>
                <span class="status-word muted small">
                  {t.calls} calls · {errPct}% err · p50 {t.p50_ms} ms · p95 {t.p95_ms} ms
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export const UsagePage = ({
  usage,
  trends,
  tools,
}: {
  usage: UsageResult;
  trends: TrendsResult;
  tools: ToolUsageResult;
}) => (
  <Layout title="Usage · grocery-agent admin" active="/admin/usage">
    <div class="status-head">
      <h2>Usage</h2>
      <a href="/admin/usage" class="nav-link" style="border:0">
        Refresh
      </a>
    </div>
    <UsagePanel usage={usage} />
    <TrendsPanel trends={trends} />
    <ToolsPanel tools={tools} />
  </Layout>
);
