// The Status area — the service-health home view (operator-admin), server-rendered. Calls
// `buildHealthPayload`, the corpus-counts reader, and `readJobRuns` per job directly (SSR — no
// island, no client fetch), and composes the foundation kit (`StatCardGrid`/`StatCard`,
// `Item`/`ItemGroup`, `Sparkline`) over that data.
//
// The job wire shape `{ ok: bool|null, never_run? }` collapses to one `JobState`, and the
// posture's four (non-exclusive) booleans derive one display `GateState` — both exhaustive
// (admin/CLAUDE.md discipline). Absolute times render in UTC (SSR has no browser zone); the
// timezone-independent relative age is the at-a-glance signal.
//
// The overall healthy/degraded rollup lives in the global health dock (shell-injected on every
// admin page, admin-ui-redesign-foundation) — this view keeps the corpus tiles, the detailed
// per-job rows (with their run-history uptime sparkline + healthy/unhealthy-since), and the live
// dependencies as their own group.

import { Layout } from "../ui/layout.js";
import { StatCardGrid, StatCard, ItemGroup, Item, Badge } from "../ui/kit.js";
import { assertNever } from "../lib/remote.js";
import { currentStreakStart, type HealthPayload, type JobStatus, type JobRun } from "../../health.js";
import type { AdminPosture } from "../../admin.js";
import type { CorpusCounts } from "../../admin-data.js";

type JobState = "healthy" | "failing" | "neverRun";

/** Collapse `{ ok: bool|null, never_run? }` to one state: null/never-run → neverRun. */
export function jobStateOf(job: JobStatus): JobState {
  if (job.never_run || job.ok === null) return "neverRun";
  return job.ok ? "healthy" : "failing";
}

type GateState = "exposed" | "gated" | "devBypass" | "disabled";

/** The gate's single display state, by the same precedence the /health.svg badge uses. */
export function gateStateOf(a: AdminPosture): GateState {
  if (a.exposed) return "exposed";
  if (a.access_configured) return "gated";
  if (a.dev_bypass_set) return "devBypass";
  return "disabled";
}

/** Coarse relative age from a millisecond delta (generated_at is "now"). */
export function relAge(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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
const StateGlyph = ({ cls }: { cls: string }) => <span class={`sglyph ${cls}`}><span class={`dot ${cls}`} /></span>;

const SummaryBlock = ({ pairs }: { pairs: [string, string][] }) => (
  <div class="summary">
    {pairs.map(([k, v]) => (
      <span class="summary-item">
        <span class="summary-k muted small">{k}</span>
        <span class="summary-v small">{v}</span>
      </span>
    ))}
  </div>
);

/** The "Healthy since" / "Unhealthy since" label, derived from the job's current run streak.
 *  Null (no run history yet) renders nothing — the caller omits the whole uptime block. */
const SinceLabel = ({ ok, since }: { ok: boolean; since: number }) => (
  <span class={ok ? "" : "txt-bad"}>
    {ok ? "Healthy since" : "Unhealthy since"} {fmtUtc(since)}
  </span>
);

/** The per-job uptime sparkline: recent runs oldest→newest as ok/fail bars, with a % uptime
 *  label. `runs` is newest-first (as `readJobRuns` returns) — reversed for the oldest→newest
 *  bar order the mock specifies. Bar height is binary (ok bars full, fail bars short) since
 *  `Sparkline` scales by value, not by a per-bar color — the color comes from a class override
 *  per bar via inline composition below. */
const Uptime = ({ runs }: { runs: JobRun[] }) => {
  const ordered = [...runs].reverse(); // oldest → newest
  const okCount = runs.filter((r) => r.ok).length;
  const pct = Math.round((okCount / runs.length) * 100);
  return (
    <div class="uptime">
      <div class="uptime-head">
        <span class="uptime-cap muted small">Run history</span>
        <span class="uptime-pct muted small">
          {pct}% uptime · {runs.length} runs
        </span>
      </div>
      <div class="spark">
        {ordered.map((r) => (
          <span class={`spark-bar ${r.ok ? "ok" : "fail"}`} style={`height:${r.ok ? 100 : 28}%`} title={fmtUtc(r.ran_at)} />
        ))}
      </div>
    </div>
  );
};

const JobRow = ({ job, now, runs }: { job: JobStatus; now: number; runs: JobRun[] }) => {
  const state = jobStateOf(job);
  const [cls] = jobStateClassWord(state);
  const pairs = Object.entries(job.summary ?? {}).map(([k, v]) => [k, summaryValue(v)] as [string, string]);
  const streakStart = currentStreakStart(runs);
  return (
    <Item
      outline
      media={<StateGlyph cls={cls} />}
      title={job.name}
      description={
        <span class="job-meta">
          {job.last_run_at != null ? `Ran ${relAge(now - job.last_run_at)}` : "Never run"}
          {streakStart != null ? (
            <>
              <span class="job-sep"> · </span>
              <SinceLabel ok={job.ok === true} since={streakStart} />
            </>
          ) : null}
        </span>
      }
      actions={<Badge variant={jobStateBadgeVariant(state)}>{jobStateClassWord(state)[1]}</Badge>}
    >
      {runs.length > 0 ? <Uptime runs={runs} /> : null}
      {pairs.length > 0 ? <SummaryBlock pairs={pairs} /> : undefined}
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
      description={gs === "gated" && posture.email_allowlist ? <span class="job-meta">email allowlist on</span> : undefined}
      actions={<Badge variant={gateStateBadgeVariant(gs)}>{word}</Badge>}
    />
  );
};

/** A destructive-alert warning icon (inline Lucide `triangle-alert`; Basecoat ships no icons). */
const WarnIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="lucide lucide-triangle-alert"
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

export const StatusPage = ({
  payload,
  counts,
  runsByJob,
}: {
  payload: HealthPayload;
  counts: CorpusCounts;
  runsByJob: Record<string, JobRun[]>;
}) => (
  <Layout title="Status · grocery-agent admin" active="/admin">
    <div class="status-head">
      <h2>Service health</h2>
      <a href="/admin" class="btn" data-variant="ghost" data-size="sm">
        Refresh
      </a>
    </div>
    {payload.admin.exposed ? (
      <div class="alert" data-variant="destructive">
        <WarnIcon />
        <h2>Admin gate exposed</h2>
        <section>
          Access is unconfigured and the dev bypass is set — a deployed Worker would serve /admin unauthenticated. Set
          ACCESS_TEAM_DOMAIN and ACCESS_AUD (and clear ADMIN_DEV_BYPASS).
        </section>
      </div>
    ) : null}
    {payload.ai_quota_exhausted ? (
      <div class="alert" data-variant="destructive">
        <WarnIcon />
        <h2>Workers AI quota exhausted</h2>
        <section>
          The daily free allocation of 10,000 neurons is used up (error 4006), so the recipe-classify, recipe-embed, and
          discovery cron jobs cannot run their AI steps. They resume at the next daily reset — or upgrade to the Workers
          Paid plan to remove the cap.
        </section>
      </div>
    ) : null}

    <StatCardGrid>
      <StatCard label="Recipes" value={counts.recipes.toLocaleString()} href="/admin/data" />
      <StatCard label="Members" value={counts.members.toLocaleString()} href="/admin/members" />
      <StatCard label="RSS feeds" value={counts.feeds.toLocaleString()} />
      <StatCard label="Cached SKUs" value={counts.cached_skus.toLocaleString()} />
    </StatCardGrid>

    <p class="group-label">Background jobs</p>
    <ItemGroup>
      {payload.jobs.map((job) => (
        <JobRow job={job} now={payload.generated_at} runs={runsByJob[job.name] ?? []} />
      ))}
    </ItemGroup>

    <p class="group-label">Dependencies</p>
    <ItemGroup>
      <DependencyRow label="d1" cls={payload.d1.ok ? "ok" : "fail"} word={payload.d1.ok ? "reachable" : "unreachable"} />
      <AdminDependencyRow posture={payload.admin} />
    </ItemGroup>
  </Layout>
);
