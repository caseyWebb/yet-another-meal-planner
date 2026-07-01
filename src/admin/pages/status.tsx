// The Status area — the service-health home view (operator-admin), server-rendered. Calls
// `buildHealthPayload` directly and renders the SAME `HealthPayload` the public `/health`
// returns: background-job health, the D1 probe, and the operator admin-gate posture. The Elm
// view's body-preserving 503-decode dance vanishes here — SSR calls the builder in-process,
// so there is no fetch, no decoder, and no transport-vs-degraded ambiguity.
//
// The job wire shape `{ ok: bool|null, never_run? }` collapses to one `JobState`, and the
// posture's four (non-exclusive) booleans derive one display `GateState` — both exhaustive
// (admin/CLAUDE.md discipline). Absolute times render in UTC (SSR has no browser zone); the
// timezone-independent relative age is the at-a-glance signal.

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import { assertNever } from "../lib/remote.js";
import type { HealthPayload, JobStatus } from "../../health.js";
import type { AdminPosture } from "../../admin.js";

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

const StatusRow = ({
  label,
  cls,
  word,
  age,
  ageTitle,
  detail,
}: {
  label: string;
  cls: string;
  word: string;
  age?: string;
  ageTitle?: string;
  detail?: Child;
}) => (
  <div class="status-row">
    <div class="status-line">
      <span class={`dot ${cls}`} />
      <span class="status-label">{label}</span>
      <span class={`status-word ${cls}`}>{word}</span>
      <span class="status-age muted small" title={ageTitle ?? ""}>
        {age ?? ""}
      </span>
    </div>
    {detail}
  </div>
);

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

const JobRow = ({ job, now }: { job: JobStatus; now: number }) => {
  const [cls, word] = jobStateClassWord(jobStateOf(job));
  const pairs = Object.entries(job.summary ?? {}).map(([k, v]) => [k, summaryValue(v)] as [string, string]);
  return (
    <StatusRow
      label={job.name}
      cls={cls}
      word={word}
      age={job.last_run_at != null ? relAge(now - job.last_run_at) : ""}
      ageTitle={job.last_run_at != null ? fmtUtc(job.last_run_at) : ""}
      detail={pairs.length > 0 ? <SummaryBlock pairs={pairs} /> : undefined}
    />
  );
};

const AdminRow = ({ posture }: { posture: AdminPosture }) => {
  const gs = gateStateOf(posture);
  const [cls, word] = gateStateClassWord(gs);
  const detail = gs === "gated" && posture.email_allowlist ? <SummaryBlock pairs={[["email allowlist", "on"]]} /> : undefined;
  return <StatusRow label="admin gate" cls={cls} word={word} detail={detail} />;
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

export const StatusPage = ({ payload }: { payload: HealthPayload }) => (
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
    {/* The overall healthy/degraded rollup lives in the global health dock (shell-injected on
        every area); this view keeps the detailed per-job / D1 / admin-gate rows. */}
    <div class="card">
      <section>
        {payload.jobs.map((job) => (
          <JobRow job={job} now={payload.generated_at} />
        ))}
        <StatusRow label="d1" cls={payload.d1.ok ? "ok" : "fail"} word={payload.d1.ok ? "reachable" : "unreachable"} />
        <AdminRow posture={payload.admin} />
      </section>
    </div>
  </Layout>
);
