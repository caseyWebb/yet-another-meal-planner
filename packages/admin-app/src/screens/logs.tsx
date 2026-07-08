// The Logs screen (operator-admin): the all-cron-jobs run log — a flat, filterable, paginated,
// newest-first list of `job_runs` records across every registered background job. ONE primary
// query loads the whole bounded payload (`LogsRunsData`); the job filter (`?job=`) and page
// (`?page=`) are validated search params resolved CLIENT-side over it, and per-entry
// expand/collapse keeps the SSR page's native <details class="log-entry">/<summary
// class="log-row"> markup (the harness's TableComponent keys on `details.log-entry`). A
// `?run=<id>` param (the Status sparkline's deep-link) resolves client-side against the payload:
// found → that run's job filter + page + a highlighted (`hl`), pre-expanded entry; pruned/unknown
// → the default view (no error).
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { logsRunsQuery, type LogsRunsData } from "../lib/queries";
import { apiErrorOf } from "../lib/api";
import { assertNever } from "../lib/assert";
import { relAge } from "../lib/format";
import { Button, ErrorBanner, ItemGroup, Pager, PrettyKV } from "../components/kit";

/** Entries per page of the all-jobs run log (the SSR page's PAGE_SIZE). */
export const PAGE_SIZE = 12;

type JobRun = LogsRunsData["runs"][number];

const routeApi = getRouteApi("/logs");

/** Compact absolute instant in UTC (the SSR page's fmtUtc), e.g. "Jun 27, 14:34 UTC". */
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

const RunEntry = ({ run, now, highlighted }: { run: JobRun; now: number; highlighted: boolean }) => {
  const summary = run.summary as Record<string, unknown>;
  const pairs = Object.entries(summary);
  return (
    <details
      className={highlighted ? "log-entry hl" : "log-entry"}
      data-run-id={run.id}
      open={highlighted || undefined}
    >
      <summary className="log-row">
        <span className={`dot ${run.ok ? "ok" : "fail"}`} />
        <span className="log-job">{run.job}</span>
        <span className={`log-outcome ${run.ok ? "ok" : "fail"}`}>{run.ok ? "ok" : "failed"}</span>
        <span className="log-time muted small" title={fmtUtc(run.ran_at)}>
          {relAge(run.ran_at, now)}
        </span>
        <span className="log-dur muted small">{fmtDuration(run.duration_ms)}</span>
      </summary>
      <div className="log-detail">
        <p className="log-summary-label muted small">summary</p>
        <PrettyKV obj={summary} />
        {!run.ok && typeof summary.error === "string" ? <ErrorBanner message={summary.error} /> : null}
        {pairs.length === 0 && run.ok ? <p className="muted small">(no summary)</p> : null}
        {run.job === "discovery-sweep" ? (
          <p className="small">
            <Link to="/discovery">View discovery candidates →</Link>
          </p>
        ) : null}
      </div>
    </details>
  );
};

/** The loaded log view: filter pills (All + one per registered job), the ok/failed hint line,
 *  the paginated entry list, and the pager. Filtering + pagination are pure client-side slices
 *  over the one payload. */
const LogsView = ({ data, onRefresh }: { data: LogsRunsData; onRefresh: () => void }) => {
  const search = routeApi.useSearch();
  const navigate = routeApi.useNavigate();
  const [now] = React.useState(() => Date.now());
  const runs = data.runs;

  // `?run=` resolves client-side against the payload: found → its job filter + its page +
  // highlight; pruned/unknown → the default view (the SSR route's degrade, without an error).
  const linked = search.run != null ? runs.find((r) => r.id === search.run) : undefined;
  const job = linked ? linked.job : search.job;
  const filtered = job === "All" ? runs : runs.filter((r) => r.job === job);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const requested = linked
    ? Math.floor(Math.max(0, filtered.findIndex((r) => r.id === linked.id)) / PAGE_SIZE)
    : search.page - 1;
  const pg = Math.min(Math.max(0, requested), pages - 1);
  const shown = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);
  const okCount = filtered.filter((r) => r.ok).length;
  const failCount = filtered.length - okCount;

  /** Navigate to a filter/page combination (the route's stripSearchParams middleware omits the
   *  defaults, so the unfiltered first page is the bare /logs); any `?run=` highlight is a
   *  one-shot deep-link and drops on the first filter/page change. */
  const go = (nextJob: string, nextPage: number) =>
    navigate({ search: { job: nextJob, page: nextPage + 1, run: undefined } });

  return (
    <div>
      <div className="log-head">
        <h2>Logs</h2>
        <div className="log-actions">
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          {runs.length > 0 ? <span className="muted small">last run {relAge(runs[0].ran_at, now)}</span> : null}
        </div>
      </div>

      <div className="data-nav">
        <button type="button" className={job === "All" ? "pill active" : "pill"} onClick={() => go("All", 0)}>
          All jobs
        </button>
        {data.jobs.map((j) => (
          <button key={j} type="button" className={job === j ? "pill active" : "pill"} onClick={() => go(j, 0)}>
            {j}
          </button>
        ))}
      </div>

      <p className="recipe-hint muted small">
        {filtered.length} runs · {okCount} ok · {failCount} failed
      </p>

      {shown.length === 0 ? (
        <p className="muted">No runs recorded yet.</p>
      ) : (
        <ItemGroup className="log-list">
          {shown.map((run) => (
            <RunEntry key={run.id} run={run} now={now} highlighted={linked?.id === run.id} />
          ))}
        </ItemGroup>
      )}

      {pages > 1 ? (
        <Pager
          info={`Page ${pg + 1} of ${pages} · ${filtered.length} runs`}
          prev={
            <Button variant="outline" size="sm" disabled={pg === 0} onClick={() => go(job, pg - 1)}>
              Prev
            </Button>
          }
          next={
            <Button variant="outline" size="sm" disabled={pg >= pages - 1} onClick={() => go(job, pg + 1)}>
              Next
            </Button>
          }
        />
      ) : null}
    </div>
  );
};

export function LogsScreen(): React.ReactElement {
  const q = useQuery(logsRunsQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading logs…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <LogsView data={q.data} onRefresh={() => void q.refetch()} />;
    default:
      return assertNever(q);
  }
}
