// The Usage screen (usage-observability / usage-trends / tool-usage-trends). Four observability
// surfaces from ONE primary query (`UsageData` = { usage, trends, tools }): headline stat tiles,
// the Account-resources card (per-namespace-stacked KV-operation meters + matching 30-day
// stacked sparklines, plus the Workers AI neurons meter + per-model rows), the per-job trends
// list, and the tool-usage table. Each surface renders its reader's discriminated result — a
// `{ configured: false }` shape becomes its own setup card, independent of the other surfaces.
// Per-segment/per-bar hover detail rides the shared `data-tip-title`/`data-tip-body` sparkline-
// tooltip attributes (the root layout's useSparklineTips delegation picks them up — no wiring).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { usageQuery, type UsageData } from "../lib/queries";
import { apiErrorOf } from "../lib/api";
import { assertNever } from "../lib/assert";
import { Badge, Button, Card, DataTable, ErrorBanner, Progress, StatCard, StatCardGrid, StatPill } from "../components/kit";
import { DatabaseIcon, SparklesIcon, ActivityIcon, CheckCircleIcon } from "../components/icons";

type UsageResult = UsageData["usage"];
type TrendsResult = UsageData["trends"];
type ToolUsageResult = UsageData["tools"];
type AiUsageResult = UsageData["aiUsage"];
type AiBacklog = UsageData["aiBacklog"];
type ConfiguredUsage = Extract<UsageResult, { configured: true }>;
type NamespaceUsage = ConfiguredUsage["kv"]["namespaces"][number];
type KvHistoryDay = ConfiguredUsage["kv"]["history"]["days"][number];
type AiHistoryDay = ConfiguredUsage["ai"]["history"]["days"][number];

const KV_ACTIONS = ["read", "write", "delete", "list"] as const;
type KvAction = (typeof KV_ACTIONS)[number];
const TICKS = "▁▂▃▄▅▆▇█";

const fmt = (n: number): string => n.toLocaleString();
const fmtK = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

function sparkline(days: { runs: number }[]): string {
  const max = Math.max(0, ...days.map((d) => d.runs));
  if (max <= 0) return "";
  return days.map((d) => TICKS[Math.round((d.runs / max) * 7)]).join("");
}

const NotConfigured = ({ children }: { children?: React.ReactNode }) => (
  <Card>
    <section className="muted">{children}</section>
  </Card>
);

// ── Account resources: per-namespace-stacked KV meters + their 30-day sparkline ────────────────

/** A short per-binding descriptor for the three known KV namespaces (`wrangler.jsonc`
 *  `kv_namespaces`) — purely a display nicety, so an unresolved/operator-relabeled namespace
 *  just omits the note rather than guessing at one. */
const NAMESPACE_NOTES: Record<string, string> = {
  KROGER_KV: "Kroger SKU/session cache",
  OAUTH_KV: "OAuth tokens + grants",
  TENANT_KV: "Per-tenant ephemeral state",
};

/** The namespace legend above the meters: one swatch + resolved label + a short descriptor for
 *  a known binding + the raw id as the hover title, per namespace in today's snapshot. */
const NamespaceLegend = ({ namespaces }: { namespaces: NamespaceUsage[] }) => (
  <div className="kv-legend">
    {namespaces.map((ns) => (
      <span key={ns.namespace_id} className="kv-leg" title={ns.namespace_id}>
        <span className="kv-leg-dot" style={{ background: ns.resolved.color }} />
        <span className="kv-leg-name">{ns.resolved.label}</span>
        {NAMESPACE_NOTES[ns.resolved.label] ? (
          <span className="kv-leg-note muted">{NAMESPACE_NOTES[ns.resolved.label]}</span>
        ) : null}
      </span>
    ))}
  </div>
);

/** One KV-operation meter: a namespace-stacked bar against the daily limit (ok/warn/fail
 *  recolored), with a per-segment `data-tip-*` breakdown, plus a namespace-stacked 30-day
 *  sparkline (one column per day, stacked bottom→top in namespace order) with a per-column
 *  `data-tip-*` breakdown summing back to that day's total. */
const KvMeter = ({
  action,
  namespaces,
  limit,
  historyDays,
}: {
  action: KvAction;
  namespaces: NamespaceUsage[];
  limit: number;
  historyDays: KvHistoryDay[];
}) => {
  const total = namespaces.reduce((n, ns) => n + ns[action], 0);
  const level = total >= limit ? "fail" : total / limit >= 0.8 ? "warn" : "ok";
  const dayTotals = historyDays.map((d) => d.namespaces.reduce((n, ns) => n + ns[action], 0));
  const peak = Math.max(1, ...dayTotals);

  return (
    <div className={`meter ${level}`}>
      <div className="meter-head">
        <span className="meter-label">{action}s</span>
        <span className="meter-val">
          {fmt(total)} <span className="meter-lim">/ {fmt(limit)}</span>
        </span>
      </div>
      <div className="kv-bar">
        {namespaces.map((ns) => (
          <span
            key={ns.namespace_id}
            className="kv-seg"
            style={{ width: `${limit > 0 ? (ns[action] / limit) * 100 : 0}%`, background: ns.resolved.color }}
            data-tip-title={ns.resolved.label}
            data-tip-body={`${fmt(ns[action])} ${action}s today`}
          />
        ))}
      </div>
      {historyDays.length > 0 ? (
        <div className="meter-trend">
          <div className="spark meter-spark kv-spark">
            {historyDays.map((d, i) => {
              const dt = dayTotals[i];
              const breakdown = d.namespaces.map((ns) => `${ns.resolved.label} ${fmt(ns[action])}`).join(" · ");
              return (
                <span
                  key={d.day}
                  className="spark-col"
                  style={{ height: `${Math.max(6, Math.round((dt / peak) * 100))}%` }}
                  data-tip-title={d.day}
                  data-tip-body={`${fmt(dt)} ${action}s${breakdown ? ` (${breakdown})` : ""}`}
                >
                  {d.namespaces.map((ns) => (
                    <span
                      key={ns.namespace_id}
                      className="spark-seg"
                      style={{ height: `${dt > 0 ? (ns[action] / dt) * 100 : 0}%`, background: ns.resolved.color }}
                    />
                  ))}
                </span>
              );
            })}
          </div>
          <span className="meter-peak">peak {fmtK(peak)}</span>
        </div>
      ) : null}
    </div>
  );
};

/** The Workers AI neurons meter — a plain (non-stacked) progress bar, since neurons aren't
 *  namespace-attributed — plus a 30-day neuron sparkline (single series) with a per-column
 *  `data-tip-*` hover breakdown, the same shared tooltip primitive the KV sparkline uses. */
const NeuronMeter = ({ used, limit, historyDays }: { used: number; limit: number; historyDays: AiHistoryDay[] }) => {
  const level = used >= limit ? "fail" : limit > 0 && used / limit >= 0.8 ? "warn" : "ok";
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const peak = Math.max(1, ...historyDays.map((d) => d.neurons));
  return (
    <div className={`meter ${level}`}>
      <div className="meter-head">
        <span className="meter-label">neurons</span>
        <span className="meter-val">
          {fmt(used)} <span className="meter-lim">/ {fmt(limit)}</span>
        </span>
      </div>
      <Progress value={pct} />
      {historyDays.length > 0 ? (
        <div className="meter-trend">
          <div className="spark meter-spark ai-spark">
            {historyDays.map((d) => (
              <span
                key={d.day}
                className="spark-col"
                style={{ height: `${Math.max(6, Math.round((d.neurons / peak) * 100))}%` }}
                data-tip-title={d.day}
                data-tip-body={`${fmt(d.neurons)} neurons`}
              >
                <span className="spark-seg" style={{ height: "100%", background: "var(--kv-oauth)" }} />
              </span>
            ))}
          </div>
          <span className="meter-peak">peak {fmtK(peak)}</span>
        </div>
      ) : null}
    </div>
  );
};

const AccountResources = ({ usage }: { usage: ConfiguredUsage }) => (
  <Card>
    <div className="usage-sub">KV operations</div>
    {usage.kv.namespaces.length > 0 ? <NamespaceLegend namespaces={usage.kv.namespaces} /> : null}
    <div className="meter-list">
      {KV_ACTIONS.map((a) => (
        <KvMeter key={a} action={a} namespaces={usage.kv.namespaces} limit={usage.kv.limits[a]} historyDays={usage.kv.history.days} />
      ))}
    </div>
    <div className="usage-sep" />
    <div className="usage-sub">Workers AI</div>
    <div className="meter-list">
      <NeuronMeter used={usage.ai.neurons_used} limit={usage.ai.neurons_limit} historyDays={usage.ai.history.days} />
    </div>
    {usage.ai.by_model.length > 0 ? (
      <div className="summary" style={{ marginTop: ".7rem" }}>
        {usage.ai.by_model.map((m) => (
          <span key={m.model} className="summary-item">
            <span className="summary-k muted small">{m.model}</span>
            <span className="summary-v small">{fmt(m.neurons)} neurons</span>
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
        <p className="muted">No usage data points recorded yet.</p>
      ) : (
        trends.jobs.map((job) => {
          const totalRuns = job.days.reduce((n, d) => n + d.runs, 0);
          const totalMs = job.days.reduce((n, d) => n + d.total_ms, 0);
          const avg = totalRuns > 0 ? Math.round(totalMs / totalRuns) : 0;
          return (
            <div key={job.job} className="status-row">
              <div className="status-line">
                <span className="status-label">{job.job}</span>
                <span className="status-word muted" title="runs per day (oldest → newest)">
                  {sparkline(job.days)}
                </span>
                <span className="status-word muted small">
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
        <p className="muted">No tool calls recorded yet.</p>
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
              Tool: <span className="tool-name">{t.tool}</span>,
              calls: fmt(t.calls),
              errors:
                t.errors === 0 ? (
                  <span className="muted">0</span>
                ) : (
                  <span className="txt-bad">
                    {fmt(t.errors)} · {pct.toFixed(1)}%
                  </span>
                ),
              p50: `${t.p50_ms} ms`,
              p95: `${t.p95_ms} ms`,
            };
          })}
        />
      )}
    </Card>
  );
};

// ── Neurons by activity (ai-usage-attribution) ─────────────────────────────────────────────────
// The per-activity attribution tier: ranks the window's neuron spend by activity (rows arrive
// pre-sorted by est_neurons desc), splits it by trigger (cron/import/request — each is its own
// pre-grouped row, so import-time spend reads as its own line), reconciles the summed ESTIMATE
// against the account-level actual (usage.ai — the canonical neuron source), and pairs the cron
// activities with their draining backlog. Not-configured degrades exactly like the sibling panels.

/** Trigger → Badge variant, so cron/import/request are visually distinct in the split column. */
const TRIGGER_VARIANT: Record<string, string> = { cron: "default", import: "secondary", request: "outline" };

const AiUsagePanel = ({ aiUsage, aiBacklog, usage }: { aiUsage: AiUsageResult; aiBacklog: AiBacklog; usage: UsageResult }) => {
  if (!aiUsage.configured) {
    return (
      <NotConfigured>
        Neurons by activity not available. Per-activity AI spend comes from the Workers Analytics Engine SQL API (reuses{" "}
        <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code>). Set them to see neurons by activity, split by
        trigger, over the last 30 days.
      </NotConfigured>
    );
  }
  const totalEst = aiUsage.activities.reduce((n, a) => n + a.est_neurons, 0);
  return (
    <Card>
      {/* Reconciliation: the summed ESTIMATE against the account-level actual (never billing). */}
      <div className="usage-sub">Estimate vs account actual</div>
      <div className="summary">
        <span className="summary-item">
          <span className="summary-k muted small">estimated (summed)</span>
          <span className="summary-v small">{fmt(totalEst)} neurons</span>
        </span>
        {usage.configured ? (
          <span className="summary-item">
            <span className="summary-k muted small">account actual</span>
            <span className="summary-v small">{fmt(usage.ai.neurons_used)} neurons</span>
          </span>
        ) : null}
      </div>
      {usage.configured && usage.ai.by_model.length > 0 ? (
        <div className="summary">
          {usage.ai.by_model.map((m) => (
            <span key={m.model} className="summary-item">
              <span className="summary-k muted small">{m.model} actual</span>
              <span className="summary-v small">{fmt(m.neurons)} neurons</span>
            </span>
          ))}
        </div>
      ) : null}
      <p className="muted small">
        Estimated from token counts × a per-model rate — an attribution estimate, not billing. The account actual is
        Cloudflare&rsquo;s by-model neuron total.
      </p>

      <div className="usage-sep" />

      {/* Ranked activities: model / trigger / calls / tokens / est neurons, with a per-row share bar. */}
      {aiUsage.activities.length === 0 ? (
        <p className="muted">No AI calls recorded yet.</p>
      ) : (
        <DataTable
          columns={[
            "Activity",
            "Trigger",
            "Model",
            { key: "calls", label: "Calls", align: "right" },
            { key: "tokens", label: "Tokens", align: "right" },
            { key: "neurons", label: "Est. neurons", align: "right" },
          ]}
          rows={aiUsage.activities.map((a) => {
            const tokens = a.input_tokens + a.output_tokens;
            const share = totalEst > 0 ? (a.est_neurons / totalEst) * 100 : 0;
            const barPct = a.est_neurons > 0 ? Math.max(4, Math.round(share)) : 0;
            return {
              Activity: <span className="tool-name">{a.activity}</span>,
              Trigger: <Badge variant={TRIGGER_VARIANT[a.trigger] ?? "outline"}>{a.trigger || "—"}</Badge>,
              Model: <span className="muted small">{a.model || "—"}</span>,
              calls: fmt(a.calls),
              tokens: (
                <span data-tip-title={`${a.activity} tokens`} data-tip-body={`${fmt(a.input_tokens)} in · ${fmt(a.output_tokens)} out`}>
                  {fmt(tokens)}
                </span>
              ),
              neurons: (
                <div data-tip-title={a.activity} data-tip-body={`${share.toFixed(1)}% of estimated`}>
                  <div>{fmt(a.est_neurons)}</div>
                  <div className="ins-bar" style={{ marginTop: ".35rem" }}>
                    <span className="ins-bar-fill combo" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              ),
            };
          })}
        />
      )}

      {/* Backlog: a non-zero, falling count reads as "draining, will finish" vs steady churn. */}
      <div className="usage-sep" />
      <div className="usage-sub">Backlog draining</div>
      <div className="jstats">
        <StatPill label="classify" value={fmt(aiBacklog.classify)} />
        <StatPill label="describe" value={fmt(aiBacklog.describe)} />
        <StatPill label="embed" value={fmt(aiBacklog.embed)} />
      </div>
      <p className="muted small">
        A non-zero, falling backlog means a cron activity is draining a queue (e.g. a whole-corpus reclassify after a
        schema change) — it will finish. Near-zero backlog with steady neurons is normal churn.
      </p>
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
      <StatCard
        icon={<CheckCircleIcon size={15} />}
        label="Error rate · 30d"
        value={toolCalls != null ? `${errRate.toFixed(1)}%` : "—"}
      />
    </StatCardGrid>
  );
};

const UsageView = ({ data, onRefresh }: { data: UsageData; onRefresh: () => void }) => {
  const { usage, trends, tools, aiUsage, aiBacklog } = data;
  return (
    <div>
      <div className="status-head">
        <h2>Usage</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>

      {usage.configured ? (
        <p className="muted small usage-caption">Cloudflare usage for {usage.day} (UTC), against the daily free-tier limits.</p>
      ) : null}
      <HeadlineTiles usage={usage} tools={tools} />

      <p className="group-label">Account resources · daily free tier</p>
      {usage.configured ? (
        <AccountResources usage={usage} />
      ) : (
        <NotConfigured>
          Usage analytics not configured. Set <code>CF_ACCOUNT_ID</code> and a read-only <code>CF_ANALYTICS_TOKEN</code>{" "}
          (Account Analytics: Read) to read account-wide KV-operation and Workers AI neuron usage. Reading usage costs no
          KV.
        </NotConfigured>
      )}

      <p className="group-label">Neurons by activity · last {aiUsage.configured ? aiUsage.window_days : 30} days</p>
      <AiUsagePanel aiUsage={aiUsage} aiBacklog={aiBacklog} usage={usage} />

      <p className="group-label">Per-job runs · last {trends.configured ? trends.window_days : 30} days</p>
      <TrendsPanel trends={trends} />

      <p className="group-label">Tool usage · last {tools.configured ? tools.window_days : 30} days</p>
      <ToolsPanel tools={tools} />
    </div>
  );
};

export function UsageScreen(): React.ReactElement {
  const q = useQuery(usageQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading usage…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <UsageView data={q.data} onRefresh={() => void q.refetch()} />;
    default:
      return assertNever(q);
  }
}
