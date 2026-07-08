// The grocery/pantry key-reconcile observability renderers (ported from the SSR panel's
// pages/reconcile.tsx onto React) — a read-only convergence card + its Status › Background-jobs
// sibling row. Two renderers over the one reconcile model the Worker read derives:
//
//   · ReconcileCard  — the convergence card. Two live states plus a fresh-deploy "never run":
//       converging → accent glyph, live counts, the per-tick stacked sparkline, backlog note.
//       converged  → a POSITIVE terminal state (green check, "converged"), not a dead "0".
//   · ReconcileStatusRow — the reconcile as a sibling of the recurring crons on the Status page.
//     Same state language, no uptime% (meaningless for a self-terminating backfill); converged
//     reads as a calm positive state, never "failing"/"never run".
//
// The model is typed via the wire payload (`ReconcileData` = the reconcile read's body;
// `StatusData["reconcile"]` is the same shape and satisfies the props structurally).

import { Link } from "@tanstack/react-router";
import { Item, Badge } from "./kit";
import { CheckCircleIcon, GitMergeIcon, ClockIcon, AlertTriangleIcon, ArrowRightIcon } from "./icons";
import { relAge } from "../lib/format";
import type { ReconcileData } from "../lib/queries";

/** The convergence model both consumers pass (StatusData["reconcile"] is the same shape). */
type ReconcileModel = ReconcileData;
type ReconcileTick = ReconcileModel["ticks"][number];
type ReconcileState = ReconcileModel["state"];

const tickTotal = (t: ReconcileTick): number => t.g + t.p;

/** A compact month/day label from epoch ms (the SSR convention — UTC). */
function fmtDate(ms: number): string {
  const d = new Date(ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}`;
}

/** Relative age of a nullable instant, or an em-dash when absent. */
const age = (ms: number | null, now: number): string => (ms != null ? relAge(ms, now) : "—");

/** Per-tick stacked sparkline: grocery (accent) below, pantry (deep) above. Bars scale to the
 *  tallest tick shown; a zero tick renders as a thin floor — which is exactly how "converged"
 *  reads: a run of silent no-ops. `compact` shrinks it for the Status row. */
const ReconcileSpark = ({ ticks, compact }: { ticks: ReconcileTick[]; compact?: boolean }) => {
  const max = Math.max(1, ...ticks.map(tickTotal));
  return (
    <div
      className={compact ? "rk-spark compact" : "rk-spark"}
      role="img"
      aria-label="grocery and pantry rows re-keyed per recent tick"
    >
      {ticks.map((t, i) => {
        const total = tickTotal(t);
        const h = total === 0 ? 0 : Math.max(6, Math.round((total / max) * 100));
        return (
          <div key={i} className="rk-col" title={total === 0 ? "no-op" : `${t.g} grocery · ${t.p} pantry`}>
            {total === 0 ? (
              <span className="rk-col-zero" />
            ) : (
              <span className="rk-col-stack" style={{ height: `${h}%` }}>
                <span className="rk-seg rk-seg-p" style={{ flex: t.p }} />
                <span className="rk-seg rk-seg-g" style={{ flex: t.g }} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** The badge word for a state (the sub-nav pill + the card badge + the Status row badge). */
function stateWord(state: ReconcileState): string {
  return state === "converged" ? "converged" : state === "neverRun" ? "idle" : "converging";
}

/** The convergence card. `now` is the render clock for the relative ages. */
export const ReconcileCard = ({ s, now }: { s: ReconcileModel; now: number }) => {
  const converged = s.state === "converged";
  const neverRun = s.state === "neverRun";
  const thisTick = s.grocery_rekeyed + s.pantry_rekeyed;
  // A settled state (converged OR fresh no-history) shows the calm "done" body; converging shows live.
  const settled = converged || neverRun;

  return (
    <section className={`rk-card ${s.state}`}>
      <header className="rk-head">
        <span className={`rk-glyph ${s.state}`}>{settled ? <CheckCircleIcon size={20} /> : <GitMergeIcon size={20} />}</span>
        <div className="rk-headline">
          <div className="rk-title-row">
            <span className="rk-title">grocery / pantry reconcile</span>
            <span className={`rk-badge ${s.state}`}>{stateWord(s.state)}</span>
          </div>
          <p className="rk-sub">
            {settled
              ? "Every grocery & pantry row resolves to a canonical id. Nothing left to re-key."
              : "Re-keying grocery & pantry rows onto canonical ids — merging surface-form duplicates as the identity graph learns them."}
          </p>
        </div>
      </header>

      {settled ? (
        <div className="rk-done">
          <dl className="rk-facts">
            <div className="rk-fact">
              <dt>Re-keyed (last {s.ticks.length} runs)</dt>
              <dd>{s.lifetimeMerged.toLocaleString()}</dd>
            </div>
            <div className="rk-fact">
              <dt>Converged</dt>
              <dd>{neverRun ? "—" : age(s.convergedAt, now)}</dd>
            </div>
            <div className="rk-fact">
              <dt>Last tick</dt>
              <dd className="rk-noop">{neverRun ? "never run" : `${age(s.lastTick, now)} · no-op`}</dd>
            </div>
          </dl>
          {s.ticks.length > 0 ? <ReconcileSpark ticks={s.ticks} /> : null}
          <p className="rk-foot">
            <ClockIcon size={12} /> Runs every {s.cadenceMin}m and exits immediately while there's nothing to do.
            {!neverRun ? (
              <>
                <span className="rk-sep">·</span>
                Last merge {age(s.lastMerge, now)}.
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="rk-live">
          <div className="rk-counts">
            <div className="rk-count">
              <div className="rk-count-v">{s.grocery_rekeyed.toLocaleString()}</div>
              <div className="rk-count-k">
                <span className="rk-dot rk-dot-g" /> grocery re-keyed
              </div>
            </div>
            <div className="rk-count">
              <div className="rk-count-v">{s.pantry_rekeyed.toLocaleString()}</div>
              <div className="rk-count-k">
                <span className="rk-dot rk-dot-p" /> pantry re-keyed
              </div>
            </div>
            <div className="rk-count rk-count-tot">
              <div className="rk-count-v">{thisTick.toLocaleString()}</div>
              <div className="rk-count-k">this tick</div>
            </div>
          </div>

          <div className="rk-spark-wrap">
            <div className="rk-spark-cap">
              <span>rows re-keyed / tick</span>
              <span className="rk-spark-axis">last {s.ticks.length} runs →</span>
            </div>
            <ReconcileSpark ticks={s.ticks} />
          </div>

          {s.truncated ? (
            <div className="rk-backlog">
              <AlertTriangleIcon size={14} />
              <span>
                <strong>Backlog remaining.</strong> Hit the {s.cap}/tick cap — the rest converges next run.
              </span>
            </div>
          ) : (
            <p className="rk-foot">
              <ClockIcon size={12} /> Last tick {age(s.lastTick, now)}.
              <span className="rk-sep">·</span>
              {s.lifetimeMerged.toLocaleString()} rows re-keyed{s.startedAt != null ? ` since ${fmtDate(s.startedAt)}` : ""}.
              <span className="rk-sep">·</span>
              Self-terminates once every row is canonical.
            </p>
          )}
        </div>
      )}
    </section>
  );
};

/** The reconcile as a sibling of the recurring crons on the Status › Background jobs list. No
 *  uptime sparkline (a self-terminating backfill has no meaningful uptime%); its re-key history
 *  rides instead. Converged reads as a calm positive state, never "failing"/"never run". The name
 *  links to the Normalize › Reconcile area (client-side). */
export const ReconcileStatusRow = ({ s, now }: { s: ReconcileModel; now: number }) => {
  const converged = s.state === "converged";
  const neverRun = s.state === "neverRun";
  const settled = converged || neverRun;
  const thisTick = s.grocery_rekeyed + s.pantry_rekeyed;

  const stats: [string, string][] = settled
    ? [
        ["state", "idle"],
        ["recent", s.lifetimeMerged.toLocaleString()],
      ]
    : [
        ["grocery", String(s.grocery_rekeyed)],
        ["pantry", String(s.pantry_rekeyed)],
        ["truncated", String(s.truncated)],
      ];

  return (
    <Item
      outline
      className={`job-item rk-job ${s.state}`}
      media={<span className={`sglyph ${settled ? "ok" : "rk-run"}`}>{settled ? <CheckCircleIcon /> : <GitMergeIcon />}</span>}
      title={
        // TODO: the Normalize agent adds the validated `tab` search param to /normalize.
        <Link className="rk-job-name" to="/normalize" search={{ tab: "reconcile" } as never}>
          grocery-reconcile <ArrowRightIcon size={12} />
        </Link>
      }
      description={
        <span className="job-meta">
          {settled ? (
            <>
              {neverRun ? "No runs yet — nothing to re-key" : "Caught up — nothing to re-key"}
              {s.lastMerge != null ? (
                <>
                  <span className="job-sep"> · </span>last merge {age(s.lastMerge, now)}
                </>
              ) : null}
            </>
          ) : (
            <>
              Ran {age(s.lastTick, now)}
              <span className="job-sep"> · </span>
              {thisTick} rows re-keyed this tick
              {s.truncated ? (
                <>
                  <span className="job-sep"> · </span>
                  <span className="txt-bad">backlog remaining</span>
                </>
              ) : null}
            </>
          )}
        </span>
      }
      actions={<Badge variant="secondary">{stateWord(s.state)}</Badge>}
    >
      {s.ticks.length > 0 ? (
        <div className="rk-status-spark">
          <div className="uptime-head">
            <span className="uptime-cap muted small">Re-key history</span>
            <span className="uptime-pct muted small">last {s.ticks.length} runs</span>
          </div>
          <ReconcileSpark ticks={s.ticks} compact />
        </div>
      ) : null}
      <div className="jstats">
        {stats.map(([k, v]) => (
          <span key={k} className="jstat">
            <span className="jstat-k">{k}</span>
            <span className="jstat-v">{v}</span>
          </span>
        ))}
      </div>
    </Item>
  );
};
