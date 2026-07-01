// The Logs area (operator-admin). Its default content (`/admin/logs`) is the all-cron-jobs run
// log: a flat, filterable, paginated, newest-first list of `job_runs` records across every
// registered background job (HEALTH_JOBS), rendered SSR — no island, since the view is pure
// read + local disclosure (admin/CLAUDE.md rule 8). The filter (`?job=`) and the page (`?page=`)
// ride query params, so every filter/page combination is independently navigable; per-entry
// expand/collapse is a native <details>/<summary> (zero client JS). A `?run=<id>` query param
// (the Status sparkline's deep-link) resolves server-side to the right job filter, the right
// page, and a pre-expanded, highlighted entry — degrading to the default view when the run id
// no longer exists (pruned past the retention cap).
//
// The Discovery sweep's per-candidate outcome log lives at the top-level Discovery area
// (/admin/discovery — admin-ui-redesign-discovery), not under Logs. A `discovery-sweep` run's
// expanded detail links out there for per-candidate granularity; the legacy
// `/admin/logs/discovery` route (src/admin/app.tsx) redirects to it.

import { Layout } from "../ui/layout.js";
import { ItemGroup, Pager, PrettyKV } from "../ui/kit.js";
import { HEALTH_JOBS, type JobRunWithJob } from "../../health.js";

/** Entries per page of the all-jobs run log — exported so the route's `?run=` resolution can
 *  compute the same page index the view itself paginates by. */
export const PAGE_SIZE = 12;

/** Coarse relative age, e.g. "just now" / "4m ago" / "2h ago" / "8d ago". */
function relAge(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Compact absolute instant in UTC (SSR has no browser zone), e.g. "Jun 27, 14:34 UTC". */
function fmtUtc(ms: number): string {
  const d = new Date(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mon} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

/** Run duration, e.g. "320 ms" / "1.8 s". */
function fmtDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** A timestamp-shaped int (≥ ~2001 in epoch ms) renders as a UTC time in the expanded summary;
 *  everything else as JSON (mirrors the Status page's `summaryValue`). */
function summaryValue(v: unknown): string {
  if (typeof v === "number" && v >= 1_000_000_000_000) return fmtUtc(v);
  return JSON.stringify(v);
}

/** Build the `/admin/logs` href for a given job filter + page (omits default-valued params so
 *  the unfiltered first page is the bare `/admin/logs`). */
function logsHref(job: string, page: number): string {
  const params = new URLSearchParams();
  if (job !== "All") params.set("job", job);
  if (page > 0) params.set("page", String(page + 1));
  const qs = params.toString();
  return qs ? `/admin/logs?${qs}` : "/admin/logs";
}

const JobFilterRow = ({ active }: { active: string }) => (
  <div class="data-nav">
    <a class={active === "All" ? "pill active" : "pill"} href={logsHref("All", 0)}>
      All jobs
    </a>
    {HEALTH_JOBS.map((j) => (
      <a class={active === j ? "pill active" : "pill"} href={logsHref(j, 0)}>
        {j}
      </a>
    ))}
  </div>
);

const RunEntry = ({ run, now, highlighted }: { run: JobRunWithJob; now: number; highlighted: boolean }) => {
  const pairs = Object.entries(run.summary).map(([k, v]) => [k, summaryValue(v)] as [string, string]);
  return (
    <details class={highlighted ? "log-entry hl" : "log-entry"} data-run-id={run.id} open={highlighted}>
      <summary class="log-row">
        <span class={`dot ${run.ok ? "ok" : "fail"}`} />
        <span class="log-job">{run.job}</span>
        <span class={`log-outcome ${run.ok ? "ok" : "fail"}`}>{run.ok ? "ok" : "failed"}</span>
        <span class="log-time muted small" title={fmtUtc(run.ran_at)}>
          {relAge(run.ran_at, now)}
        </span>
        <span class="log-dur muted small">{fmtDuration(run.duration_ms)}</span>
      </summary>
      <div class="log-detail">
        <p class="log-summary-label muted small">summary</p>
        <PrettyKV obj={run.summary} />
        {!run.ok && typeof run.summary.error === "string" ? (
          <div class="alert" data-variant="destructive">
            <section>{run.summary.error}</section>
          </div>
        ) : null}
        {pairs.length === 0 && run.ok ? <p class="muted small">(no summary)</p> : null}
        {run.job === "discovery-sweep" ? (
          <p class="small">
            <a href="/admin/discovery">View discovery candidates →</a>
          </p>
        ) : null}
      </div>
    </details>
  );
};

/** The default `/admin/logs` content: the all-jobs run log (filter, hint line, paginated
 *  entries). `highlightId` (from a resolved `?run=` deep-link) pre-expands and highlights that
 *  one entry. Exported for unit tests. */
export const AllJobsLog = ({
  runs,
  job,
  page,
  now,
  highlightId,
}: {
  runs: JobRunWithJob[];
  job: string;
  page: number;
  now: number;
  highlightId?: string | null;
}) => {
  const filtered = job === "All" ? runs : runs.filter((r) => r.job === job);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);
  const okCount = filtered.filter((r) => r.ok).length;
  const failCount = filtered.length - okCount;

  return (
    <div>
      <div class="log-head">
        <h2>Logs</h2>
        <div class="log-actions">
          <a class="btn" data-variant="ghost" data-size="sm" href="/admin/logs">
            Refresh
          </a>
          {runs.length > 0 ? <span class="muted small">last run {relAge(runs[0].ran_at, now)}</span> : null}
        </div>
      </div>

      <JobFilterRow active={job} />

      <p class="recipe-hint muted small">
        {filtered.length} runs · {okCount} ok · {failCount} failed
      </p>

      {shown.length === 0 ? (
        <p class="muted">No runs recorded yet.</p>
      ) : (
        <ItemGroup class="log-list">
          {shown.map((run) => (
            <RunEntry run={run} now={now} highlighted={highlightId === run.id} />
          ))}
        </ItemGroup>
      )}

      {pages > 1 ? (
        <Pager
          info={`Page ${pg + 1} of ${pages} · ${filtered.length} runs`}
          prev={
            pg > 0 ? (
              <a class="btn" data-variant="outline" data-size="sm" href={logsHref(job, pg - 1)}>
                Prev
              </a>
            ) : (
              <button class="btn" data-variant="outline" data-size="sm" disabled>
                Prev
              </button>
            )
          }
          next={
            pg < pages - 1 ? (
              <a class="btn" data-variant="outline" data-size="sm" href={logsHref(job, pg + 1)}>
                Next
              </a>
            ) : (
              <button class="btn" data-variant="outline" data-size="sm" disabled>
                Next
              </button>
            )
          }
        />
      ) : null}
    </div>
  );
};

/** The Logs submenu. Today it has one destination (a future log source is added here per the
 *  "A new log source is added as a submenu destination" scenario) — the Discovery candidate log
 *  is NOT one of them; it lives at the top-level Discovery area (/admin/discovery). */
const LogSubnav = ({ active }: { active: "all" }) => (
  <ul class="log-sources">
    <li class={active === "all" ? "log-source active" : "log-source"}>
      <a class="log-source-link" href="/admin/logs">
        All jobs
      </a>
    </li>
  </ul>
);

/** The all-jobs run log — the default `/admin/logs` content, and the area's sole content. Pure SSR. */
export const LogsPage = ({
  runs,
  job,
  page,
  now,
  highlightId,
}: {
  runs: JobRunWithJob[];
  job: string;
  page: number;
  now: number;
  highlightId?: string | null;
}) => (
  <Layout title="Logs · grocery-agent admin" active="/admin/logs" wide>
    <div class="logs">
      <LogSubnav active="all" />
      <AllJobsLog runs={runs} job={job} page={page} now={now} highlightId={highlightId} />
    </div>
  </Layout>
);
