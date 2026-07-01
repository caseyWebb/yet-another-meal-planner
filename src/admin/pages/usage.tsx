// The Usage area (usage-observability / usage-trends / tool-usage-trends), server-rendered.
// Four observability surfaces composed from the shared kit: headline stat tiles, an Account
// resources card (per-namespace-stacked KV-operation meters + a matching 30-day stacked
// sparkline, plus the Workers AI neurons meter + per-model chips), a per-job trends list, and a
// tool-usage table. Each fetched by calling the src/usage.ts reader directly and rendering its
// discriminated result (a `{ configured: false }` shape becomes its own setup card, independent
// of the other two surfaces — usage-observability/usage-trends/tool-usage-trends). Pure SSR, no
// client island (admin/CLAUDE.md rule 8): per-segment/per-bar hover detail is carried by the
// native `title` attribute, the same affordance the Status job uptime sparkline already uses —
// not a JS tooltip.

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import { Card, StatCardGrid, StatCard, DataTable } from "../ui/kit.js";
import { DatabaseIcon, SparklesIcon, ActivityIcon, CheckCircleIcon } from "../ui/icons.js";
import type { UsageResult, TrendsResult, ToolUsageResult, KvAction, NamespaceUsage } from "../../usage.js";

const KV_ACTIONS: readonly KvAction[] = ["read", "write", "delete", "list"];
const TICKS = "▁▂▃▄▅▆▇█";

const fmt = (n: number): string => n.toLocaleString();
const fmtK = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

function sparkline(days: { runs: number }[]): string {
  const max = Math.max(0, ...days.map((d) => d.runs));
  if (max <= 0) return "";
  return days.map((d) => TICKS[Math.round((d.runs / max) * 7)]).join("");
}

const NotConfigured = ({ children }: { children?: Child }) => (
  <div class="card">
    <section class="muted">{children}</section>
  </div>
);

// ── Account resources: per-namespace-stacked KV meters + their 30-day sparkline ────────────────

/** The namespace legend above the meters: one swatch + resolved label + raw id (as the hover
 *  title) per namespace observed in today's snapshot. */
const NamespaceLegend = ({ namespaces }: { namespaces: NamespaceUsage[] }) => (
  <div class="kv-legend">
    {namespaces.map((ns) => (
      <span class="kv-leg" title={ns.namespace_id}>
        <span class="kv-leg-dot" style={`background:${ns.resolved.color}`} />
        <span class="kv-leg-name">{ns.resolved.label}</span>
      </span>
    ))}
  </div>
);

/** One KV-operation meter: a namespace-stacked bar against the daily limit (ok/warn/fail
 *  recolored), with a per-segment `title` breakdown, plus a namespace-stacked 30-day sparkline
 *  (one column per day, stacked bottom→top in namespace order) with a per-column `title`
 *  breakdown summing back to that day's total. */
const KvMeter = ({
  action,
  namespaces,
  limit,
  historyDays,
}: {
  action: KvAction;
  namespaces: NamespaceUsage[];
  limit: number;
  historyDays: { day: string; namespaces: NamespaceUsage[] }[];
}) => {
  const total = namespaces.reduce((n, ns) => n + ns[action], 0);
  const level = total >= limit ? "fail" : total / limit >= 0.8 ? "warn" : "ok";
  const dayTotals = historyDays.map((d) => d.namespaces.reduce((n, ns) => n + ns[action], 0));
  const peak = Math.max(1, ...dayTotals);

  return (
    <div class={`meter ${level}`}>
      <div class="meter-head">
        <span class="meter-label">{action}s</span>
        <span class="meter-val">
          {fmt(total)} <span class="meter-lim">/ {fmt(limit)}</span>
        </span>
      </div>
      <div class="kv-bar">
        {namespaces.map((ns) => (
          <span
            class="kv-seg"
            style={`width:${limit > 0 ? (ns[action] / limit) * 100 : 0}%;background:${ns.resolved.color}`}
            title={`${ns.resolved.label}: ${fmt(ns[action])} ${action}s today`}
          />
        ))}
      </div>
      {historyDays.length > 0 ? (
        <div class="meter-trend">
          <div class="spark meter-spark kv-spark">
            {historyDays.map((d, i) => {
              const dt = dayTotals[i];
              const breakdown = d.namespaces.map((ns) => `${ns.resolved.label} ${fmt(ns[action])}`).join(" · ");
              return (
                <span class="spark-col" style={`height:${Math.max(6, Math.round((dt / peak) * 100))}%`} title={`${d.day}: ${fmt(dt)} ${action}s${breakdown ? ` (${breakdown})` : ""}`}>
                  {d.namespaces.map((ns) => (
                    <span class="spark-seg" style={`height:${dt > 0 ? (ns[action] / dt) * 100 : 0}%;background:${ns.resolved.color}`} />
                  ))}
                </span>
              );
            })}
          </div>
          <span class="meter-peak">peak {fmtK(peak)}</span>
        </div>
      ) : null}
    </div>
  );
};

/** The Workers AI neurons meter — a plain (non-stacked) progress bar, since neurons aren't
 *  namespace-attributed. */
const NeuronMeter = ({ used, limit }: { used: number; limit: number }) => {
  const level = used >= limit ? "fail" : limit > 0 && used / limit >= 0.8 ? "warn" : "ok";
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div class={`meter ${level}`}>
      <div class="meter-head">
        <span class="meter-label">neurons</span>
        <span class="meter-val">
          {fmt(used)} <span class="meter-lim">/ {fmt(limit)}</span>
        </span>
      </div>
      <div class="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={`width:${pct}%`} />
      </div>
    </div>
  );
};

const AccountResources = ({ usage }: { usage: Extract<UsageResult, { configured: true }> }) => (
  <Card>
    <div class="usage-sub">KV operations</div>
    {usage.kv.namespaces.length > 0 ? <NamespaceLegend namespaces={usage.kv.namespaces} /> : null}
    <div class="meter-list">
      {KV_ACTIONS.map((a) => (
        <KvMeter action={a} namespaces={usage.kv.namespaces} limit={usage.kv.limits[a]} historyDays={usage.kv.history.days} />
      ))}
    </div>
    <div class="usage-sep" />
    <div class="usage-sub">Workers AI</div>
    <div class="meter-list">
      <NeuronMeter used={usage.ai.neurons_used} limit={usage.ai.neurons_limit} />
    </div>
    {usage.ai.by_model.length > 0 ? (
      <div class="summary" style="margin-top:.7rem">
        {usage.ai.by_model.map((m) => (
          <span class="summary-item">
            <span class="summary-k muted small">{m.model}</span>
            <span class="summary-v small">{fmt(m.neurons)} neurons</span>
          </span>
        ))}
      </div>
    ) : null}
  </Card>
);

// ── Per-job trends ───────────────────────────────────────────────────────────────────────────

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
    <Card>
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
                  {fmt(totalRuns)} runs · {avg} ms avg
                </span>
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
};

// ── Tool usage ───────────────────────────────────────────────────────────────────────────────

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
    <Card>
      {tools.tools.length === 0 ? (
        <p class="muted">No tool calls recorded yet.</p>
      ) : (
        <DataTable
          columns={[
            "Tool",
            { key: "calls", label: "Calls", align: "right" },
            { key: "errors", label: "Errors", align: "right" },
            { key: "p50", label: "p50", align: "right" },
            { key: "p95", label: "p95", align: "right" },
          ]}
          rows={tools.tools.map((t) => {
            const pct = t.calls > 0 ? (t.errors / t.calls) * 100 : 0;
            return {
              Tool: <span class="tool-name">{t.tool}</span>,
              calls: fmt(t.calls),
              errors: t.errors === 0 ? <span class="muted">0</span> : <span class="txt-bad">{fmt(t.errors)} · {pct.toFixed(1)}%</span>,
              p50: `${t.p50_ms} ms`,
              p95: `${t.p95_ms} ms`,
            };
          })}
        />
      )}
    </Card>
  );
};

// ── Headline stat tiles ──────────────────────────────────────────────────────────────────────

const HeadlineTiles = ({ usage, tools }: { usage: UsageResult; tools: ToolUsageResult }) => {
  const kvToday = usage.configured ? KV_ACTIONS.reduce((n, a) => n + usage.kv.totals[a], 0) : null;
  const neuronsUsed = usage.configured ? usage.ai.neurons_used : null;
  const neuronsLimit = usage.configured ? usage.ai.neurons_limit : null;
  const toolCalls = tools.configured ? tools.tools.reduce((n, t) => n + t.calls, 0) : null;
  const toolErrors = tools.configured ? tools.tools.reduce((n, t) => n + t.errors, 0) : null;
  const errRate = toolCalls != null && toolCalls > 0 ? ((toolErrors ?? 0) / toolCalls) * 100 : 0;

  return (
    <StatCardGrid>
      <StatCard icon={<DatabaseIcon size={15} />} label="KV ops · today" value={kvToday != null ? fmt(kvToday) : "—"} />
      <StatCard
        icon={<SparklesIcon size={15} />}
        label="AI neurons · today"
        value={neuronsUsed != null ? fmt(neuronsUsed) : "—"}
        sub={neuronsLimit != null ? `of ${fmt(neuronsLimit)}` : undefined}
      />
      <StatCard icon={<ActivityIcon size={15} />} label="MCP calls · 30d" value={toolCalls != null ? fmt(toolCalls) : "—"} />
      <StatCard icon={<CheckCircleIcon size={15} />} label="Error rate · 30d" value={toolCalls != null ? `${errRate.toFixed(1)}%` : "—"} />
    </StatCardGrid>
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
      <a href="/admin/usage" class="btn" data-variant="ghost" data-size="sm">
        Refresh
      </a>
    </div>

    {usage.configured ? <p class="muted small">Cloudflare usage for {usage.day} (UTC), against the daily free-tier limits.</p> : null}
    <HeadlineTiles usage={usage} tools={tools} />

    <p class="group-label">Account resources · daily free tier</p>
    {usage.configured ? (
      <AccountResources usage={usage} />
    ) : (
      <NotConfigured>
        Usage analytics not configured. Set <code>CF_ACCOUNT_ID</code> and a read-only <code>CF_ANALYTICS_TOKEN</code>{" "}
        (Account Analytics: Read) to read account-wide KV-operation and Workers AI neuron usage. Reading usage costs no
        KV.
      </NotConfigured>
    )}

    <p class="group-label">Per-job runs · last {trends.configured ? trends.window_days : 30} days</p>
    <TrendsPanel trends={trends} />

    <p class="group-label">Tool usage · last {tools.configured ? tools.window_days : 30} days</p>
    <ToolsPanel tools={tools} />
  </Layout>
);
