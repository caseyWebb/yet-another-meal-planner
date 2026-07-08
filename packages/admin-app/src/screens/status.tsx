// The Status area — the service-health home view (operator-admin), ported from the SSR panel's
// pages/status.tsx onto the SPA's one primary query (`statusQuery`). Renders the corpus stat
// tiles (client-side links into their areas), the exposed-gate + AI-quota alerts, the per-job
// rows (run-history uptime sparkline whose segments deep-link to Logs, healthy/unhealthy-since,
// summary chips, the recipe-index row's inline backfill gauge), the reconcile + identity-audit
// convergence sibling rows, the ingest satellites, and the live dependencies.
//
// The job wire shape `{ ok: bool|null, never_run? }` collapses to one `JobState`, and the
// posture's four (non-exclusive) booleans derive one display `GateState` — both exhaustive.
// Absolute times render in UTC; `now` is the payload's `generated_at` (the read's clock), and
// the refresh button's "checked Xs ago" is the one label on the render clock.

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@grocery-agent/ui";
import {
  StatCardGrid,
  StatCard,
  ItemGroup,
  Item,
  Badge,
  Button,
  ErrorBanner,
  SparklineTrack,
  StatPill,
  type TipSegment,
} from "../components/kit";
import { UtensilsIcon, UsersIcon, RssIcon, DatabaseIcon, AlertTriangleIcon } from "../components/icons";
import { ReconcileStatusRow } from "../components/reconcile";
import { AuditStatusRow, RecipeBackfillGauge } from "../components/audits";
import { assertNever } from "../lib/assert";
import { apiErrorOf } from "../lib/api";
import { relAge } from "../lib/format";
import { statusQuery, queryClient, type StatusData } from "../lib/queries";
import { currentStreakStart, deriveRecipeBackfill, type RecipeBackfill } from "../lib/status-derive";

// The run-history window: the fixed number of sparkline slots rendered (a shorter history is
// ghost-padded up to it). Mirrors STATUS_SPARKLINE_WINDOW in packages/worker/src/admin/api.ts
// (the status read fetches the same window) — keep in sync.
const STATUS_SPARKLINE_WINDOW = 30;

// The wire shapes, derived from the payload type (never Worker imports).
type Payload = StatusData["payload"];
type JobStatus = Payload["jobs"][number];
type AdminPosture = Payload["admin"];
type JobRun = StatusData["runsByJob"][string][number];
type Satellite = StatusData["satellites"][number];

type JobState = "healthy" | "failing" | "neverRun";

/** Collapse `{ ok: bool|null, never_run? }` to one state: null/never-run → neverRun. */
function jobStateOf(job: JobStatus): JobState {
  if (job.never_run || job.ok === null) return "neverRun";
  return job.ok ? "healthy" : "failing";
}

type GateState = "exposed" | "gated" | "devBypass" | "disabled";

/** The gate's single display state, by the same precedence the /health.svg badge uses. */
function gateStateOf(a: AdminPosture): GateState {
  if (a.exposed) return "exposed";
  if (a.access_configured) return "gated";
  if (a.dev_bypass_set) return "devBypass";
  return "disabled";
}

/** An epoch-ms instant as a compact UTC string (e.g. "Jun 27, 14:34 UTC"). */
function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

/** A timestamp-shaped int (≥ ~2001 in epoch ms) renders as a UTC time; everything else as JSON. */
function summaryValue(v: unknown): string {
  if (typeof v === "number" && v >= 1_000_000_000_000) return fmtUtc(v);
  return JSON.stringify(v);
}

function jobStateClassWord(s: JobState): [string, string] {
  switch (s) {
    case "healthy":
      return ["ok", "ok"];
    case "failing":
      return ["fail", "failing"];
    case "neverRun":
      return ["never", "never run"];
    default:
      return assertNever(s);
  }
}

function jobStateBadgeVariant(s: JobState): string {
  switch (s) {
    case "healthy":
      return "secondary";
    case "failing":
      return "destructive";
    case "neverRun":
      return "outline";
    default:
      return assertNever(s);
  }
}

function gateStateClassWord(s: GateState): [string, string] {
  switch (s) {
    case "exposed":
      return ["fail", "exposed"];
    case "gated":
      return ["ok", "gated"];
    case "devBypass":
      return ["muted", "dev bypass"];
    case "disabled":
      return ["muted", "disabled"];
    default:
      return assertNever(s);
  }
}

function gateStateBadgeVariant(s: GateState): string {
  switch (s) {
    case "exposed":
      return "destructive";
    case "gated":
      return "secondary";
    case "devBypass":
    case "disabled":
      return "outline";
    default:
      return assertNever(s);
  }
}

/** A state glyph: a filled dot in the job/dependency's state color (the row's media slot). */
const StateGlyph = ({ cls }: { cls: string }) => (
  <span className={`sglyph ${cls}`}>
    <span className={`dot ${cls}`} />
  </span>
);

const SummaryBlock = ({ pairs }: { pairs: [string, string][] }) => (
  <div className="jstats">
    {pairs.map(([k, v]) => (
      <StatPill key={k} label={k} value={v} />
    ))}
  </div>
);

/** The "Healthy since" / "Unhealthy since" label, derived from the job's current run streak.
 *  Null (no run history yet) renders nothing — the caller omits the whole uptime block. */
const SinceLabel = ({ ok, since }: { ok: boolean; since: number }) => (
  <span className={ok ? "" : "txt-bad"}>
    {ok ? "Healthy since" : "Unhealthy since"} {fmtUtc(since)}
  </span>
);

/** The per-job uptime sparkline: recent runs oldest→newest as ok/fail bars, with a % uptime
 *  label. `runs` is newest-first (as the read returns) — reversed for the oldest→newest bar
 *  order. Bar height is binary (ok bars full, fail bars short); each segment carries the
 *  shared sparkline-tip data ("N runs ago", ok/error + "click to view log") and deep-links to
 *  the run's Logs entry (client-side, href kept for middle-click). */
const Uptime = ({ runs }: { runs: JobRun[] }) => {
  const navigate = useNavigate();
  const ordered = [...runs].reverse(); // oldest → newest
  const okCount = runs.filter((r) => r.ok).length;
  const pct = Math.round((okCount / runs.length) * 100);
  const segments: TipSegment[] = ordered.map((r, i) => {
    const n = ordered.length - i; // runs ago, 1 = most recent
    return {
      frac: r.ok ? 1 : 0.28,
      state: r.ok ? "ok" : "fail",
      tipTitle: `${n} ${n === 1 ? "run" : "runs"} ago`,
      tipBody: `${r.ok ? "completed ok" : "failed"} · click to view log`,
      tipVariant: r.ok ? undefined : ("fail" as const),
      href: `/admin/logs?run=${r.id}`,
      // TODO: the Logs agent adds the validated `run` search param to /logs.
      onNavigate: () => navigate({ to: "/logs", search: { run: r.id } as never }),
      ariaLabel: `run ${n} ${n === 1 ? "run" : "runs"} ago — ${r.ok ? "ok" : "failed"}, view log`,
    };
  });
  return (
    <div className="uptime">
      <div className="uptime-head">
        <span className="uptime-cap muted small">Run history</span>
        <span className="uptime-pct muted small">
          {pct}% uptime · {runs.length} runs
        </span>
      </div>
      <SparklineTrack segments={segments} axis slots={STATUS_SPARKLINE_WINDOW} />
    </div>
  );
};

const JobRow = ({ job, now, runs, backfill }: { job: JobStatus; now: number; runs: JobRun[]; backfill?: RecipeBackfill | null }) => {
  const state = jobStateOf(job);
  const [cls] = jobStateClassWord(state);
  // When the row carries the backfill gauge, `unresolved`/`degraded` render THERE — keep them
  // out of the summary chips so the same facts don't show twice.
  const pairs = Object.entries(job.summary ?? {})
    .filter(([k]) => !(backfill && (k === "unresolved" || k === "degraded")))
    .map(([k, v]) => [k, summaryValue(v)] as [string, string]);
  const streakStart = currentStreakStart(runs);
  return (
    <Item
      outline
      className={cls === "fail" ? "job-item fail" : "job-item"}
      media={<StateGlyph cls={cls} />}
      title={job.name}
      description={
        <span className="job-meta">
          {job.last_run_at != null ? `Ran ${relAge(job.last_run_at, now)}` : "Never run"}
          {streakStart != null ? (
            <>
              <span className="job-sep"> · </span>
              <SinceLabel ok={runs[0].ok} since={streakStart} />
            </>
          ) : null}
        </span>
      }
      actions={<Badge variant={jobStateBadgeVariant(state)}>{jobStateClassWord(state)[1]}</Badge>}
    >
      {runs.length > 0 ? <Uptime runs={runs} /> : null}
      {pairs.length > 0 ? <SummaryBlock pairs={pairs} /> : undefined}
      {backfill ? <RecipeBackfillGauge b={backfill} now={now} /> : null}
    </Item>
  );
};

const DependencyRow = ({ label, cls, word }: { label: string; cls: string; word: string }) => (
  <Item
    outline
    media={<StateGlyph cls={cls} />}
    title={label}
    actions={<Badge variant={cls === "ok" ? "secondary" : cls === "fail" ? "destructive" : "outline"}>{word}</Badge>}
  />
);

const AdminDependencyRow = ({ posture }: { posture: AdminPosture }) => {
  const gs = gateStateOf(posture);
  const [cls, word] = gateStateClassWord(gs);
  return (
    <Item
      outline
      media={<StateGlyph cls={cls} />}
      title="admin gate"
      description={gs === "gated" && posture.email_allowlist ? <span className="job-meta">email allowlist on</span> : undefined}
      actions={<Badge variant={gateStateBadgeVariant(gs)}>{word}</Badge>}
    />
  );
};

/** One home-network satellite row (satellite ingest): health glyph, source count, last push,
 *  24h count, and a contract-skew warning when behind the Worker's current contract. */
const SatelliteRow = ({ s, now }: { s: Satellite; now: number }) => {
  const cls = s.health === "fresh" ? "ok" : s.health === "stale" ? "fail" : "never";
  return (
    <Item
      outline
      media={<StateGlyph cls={cls} />}
      title={s.label}
      description={
        <span className="job-meta">
          {s.sourceCount} {s.sourceCount === 1 ? "source" : "sources"}
          <span className="job-sep"> · </span>
          {s.lastPush == null ? "no pushes yet" : `last push ${relAge(s.lastPush, now)}`}
          {s.lastPush != null ? (
            <>
              <span className="job-sep"> · </span>
              {s.pushes24h} in 24h
            </>
          ) : null}
          {s.skew ? (
            <>
              <span className="job-sep"> · </span>
              {/* `skew` is computed server-side against the Worker's CONTRACT_VERSION; the
                  constant itself isn't in the status payload, so the target version is not
                  named here (the SSR page imported it from @grocery-agent/contract). */}
              <span className="txt-bad">contract {s.contractVersion} → behind worker</span>
            </>
          ) : null}
        </span>
      }
      actions={<Badge variant={cls === "ok" ? "secondary" : cls === "fail" ? "destructive" : "outline"}>{s.health}</Badge>}
    />
  );
};

const StatusView = ({ data }: { data: StatusData }) => {
  const navigate = useNavigate();
  const { payload, counts, runsByJob, reconcile, audit, satellites } = data;
  const now = payload.generated_at;
  const checkedAt = Date.now(); // captured once per render — the "checked Xs ago" label only
  return (
    <>
      <div className="area-head status-head">
        <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["status"] })}>
          Refresh · checked {relAge(payload.generated_at, checkedAt)}
        </Button>
      </div>
      {payload.admin.exposed ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Admin gate exposed</AlertTitle>
          <AlertDescription>
            Access is unconfigured and the dev bypass is set — a deployed Worker would serve /admin unauthenticated. Set
            ACCESS_TEAM_DOMAIN and ACCESS_AUD (and clear ADMIN_DEV_BYPASS).
          </AlertDescription>
        </Alert>
      ) : null}
      {payload.ai_quota_exhausted ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Workers AI quota exhausted</AlertTitle>
          <AlertDescription>
            The daily free allocation of 10,000 neurons is used up (error 4006), so the recipe-classify, recipe-embed, and
            discovery cron jobs cannot run their AI steps. They resume at the next daily reset — or upgrade to the Workers
            Paid plan to remove the cap.
          </AlertDescription>
        </Alert>
      ) : null}

      <StatCardGrid>
        <StatCard
          icon={<UtensilsIcon size={15} />}
          label="Recipes"
          value={counts.recipes.toLocaleString()}
          href="/admin/data"
          onNavigate={() => navigate({ to: "/data" })}
        />
        <StatCard
          icon={<UsersIcon size={15} />}
          label="Members"
          value={counts.members.toLocaleString()}
          href="/admin/members"
          onNavigate={() => navigate({ to: "/members" })}
        />
        <StatCard
          icon={<RssIcon size={15} />}
          label="RSS feeds"
          value={counts.feeds.toLocaleString()}
          href="/admin/config"
          onNavigate={() => navigate({ to: "/config" })}
        />
        <StatCard
          icon={<DatabaseIcon size={15} />}
          label="Cached SKUs"
          value={counts.cached_skus.toLocaleString()}
          href="/admin/data/stores"
          onNavigate={() => navigate({ to: "/data/stores" })}
        />
      </StatCardGrid>

      <p className="group-label">Background jobs</p>
      <ItemGroup>
        {payload.jobs.map((job) => (
          <JobRow
            key={job.name}
            job={job}
            now={now}
            runs={runsByJob[job.name] ?? []}
            // The recipe-index row carries the inline recipe-backfill gauge — its run summaries
            // report `unresolved` per tick, a direct convergence series over the same runs.
            backfill={job.name === "recipe-index" ? deriveRecipeBackfill(runsByJob[job.name] ?? []) : null}
          />
        ))}
        {/* The grocery/pantry key-reconcile: a self-terminating backfill, so it reads as a
            convergence (re-key history + converging/converged), not an uptime% like the recurring
            crons — a special-cased sibling row rather than one of `payload.jobs`. */}
        <ReconcileStatusRow s={reconcile} now={now} />
        {/* The identity audit (alias + edge re-audit + sku re-key) as ONE convergence sibling:
            backlog burndown, no uptime% — a draining backlog has no meaningful uptime. */}
        <AuditStatusRow s={audit} now={now} />
      </ItemGroup>

      {satellites.length > 0 ? (
        <>
          <p className="group-label">Ingest satellites</p>
          <ItemGroup>
            {satellites.map((s) => (
              <SatelliteRow key={s.id} s={s} now={now} />
            ))}
          </ItemGroup>
        </>
      ) : null}

      <p className="group-label">Dependencies</p>
      <ItemGroup>
        <DependencyRow label="d1" cls={payload.d1.ok ? "ok" : "fail"} word={payload.d1.ok ? "reachable" : "unreachable"} />
        <AdminDependencyRow posture={payload.admin} />
      </ItemGroup>
    </>
  );
};

/** The Status screen over its one primary query. */
export function StatusScreen() {
  const q = useQuery(statusQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading status…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <StatusView data={q.data} />;
    default:
      return assertNever(q);
  }
}
