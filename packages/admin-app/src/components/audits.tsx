// The Normalize › Audits surface + its Status sibling row (ported from the SSR panel's
// pages/audits.tsx onto React) — read-only renderers over the audit-surface payload. The audit
// passes are self-terminating convergence jobs in the reconcile mould, so the vocabulary matches
// `reconcile.tsx`: converged is a POSITIVE terminal state (green "clean", "holds at zero"),
// never a dead 0 — and the Status row shows a backlog burndown, never an uptime% (meaningless
// for a draining backlog).
//
//   · BurndownSpark        — remaining-backlog bars falling to a green floor (shared with the
//                            Status row, the pass cards, and the recipe-backfill gauge).
//   · AuditsTab            — the burndown hero + four pass cards (each with its own backlog
//                            burndown gauge; the edge card carries the replay state and the
//                            fourth card is the disjunction sweep) + restorations log +
//                            merge-rejection memory.
//   · AuditStatusRow       — the identity audit as ONE Status › Background-jobs sibling row.
//   · RecipeBackfillGauge  — the recipe-index row's inline unresolved-terms burndown.
//
// Models are typed via the wire payload (`NormalizeAuditData`); `StatusData["audit"]` is the
// same shape as `NormalizeAuditData["obs"]` and satisfies `AuditStatusRow`'s prop structurally.

import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { Item, Badge } from "./kit";
import {
  CheckCircleIcon,
  ActivityIcon,
  ClockIcon,
  LinkIcon,
  GitMergeIcon,
  DatabaseIcon,
  LayersIcon,
  ArrowRightIcon,
  RotateIcon,
  XCircleIcon,
  AlertTriangleIcon,
} from "./icons";
import { assertNever } from "../lib/assert";
import { relAge, relFuture } from "../lib/format";
import type { NormalizeAuditData } from "../lib/queries";
import type { RecipeBackfill } from "../lib/status-derive";
import "../styles/audits.css";

// The audit-surface model, derived from the wire payload (never Worker imports).
type AuditObservability = NormalizeAuditData["obs"];
type AuditState = AuditObservability["state"];
type AuditPass = AuditObservability["passes"][number];
type AuditPassId = AuditPass["id"];
type AuditGauges = NormalizeAuditData["gauges"];
type PassGauge = AuditGauges["sku"];
type DisjunctionGauge = AuditGauges["disjunction"];
type EdgeRestoration = NormalizeAuditData["restorations"][number];
type MergeRejection = NormalizeAuditData["rejections"][number];

/** Relative age of a nullable instant, or an em-dash when absent. */
const age = (ms: number | null, now: number): string => (ms != null ? relAge(ms, now) : "—");

/** The badge word for the shared audit state. */
function stateWord(state: AuditState): string {
  switch (state) {
    case "converged":
      return "clean";
    case "converging":
      return "draining";
    case "neverRun":
      return "idle";
    default:
      return assertNever(state);
  }
}

/** Remaining-backlog burndown bars, oldest→newest, falling to a flat floor. A zero tick
 *  renders as a thin GREEN floor — exactly how "audited clean" reads. `tone`: g=accent
 *  (alias) · p=terra (edge) · b=blue (recipe backfill). */
export const BurndownSpark = ({ series, tone, compact }: { series: number[]; tone: "g" | "p" | "b"; compact?: boolean }) => {
  const max = Math.max(1, ...series);
  return (
    <div className={compact ? "au-burn compact" : "au-burn"} role="img" aria-label="rows remaining per recent sweep">
      {series.map((v, i) => {
        const h = v === 0 ? 0 : Math.max(6, Math.round((v / max) * 100));
        return (
          <div key={i} className="au-burn-col" title={v === 0 ? "clean" : `${v.toLocaleString()} to go`}>
            {v === 0 ? <span className="au-burn-floor" /> : <span className={`au-burn-bar ${tone}`} style={{ height: `${h}%` }} />}
          </div>
        );
      })}
    </div>
  );
};

/** Per-pass rows-worked/tick bars (changed stacked inside worked). Decays to a thin floor of
 *  no-op ticks once the pass is caught up. */
const WorkedSpark = ({ pass }: { pass: AuditPass }) => {
  const max = Math.max(1, ...pass.ticks.map((t) => t.worked));
  return (
    <div className="au-spark" role="img" aria-label="rows audited per recent tick">
      {pass.ticks.map((t, i) => {
        const h = t.worked === 0 ? 0 : Math.max(6, Math.round((t.worked / max) * 100));
        return (
          <div key={i} className="au-burn-col" title={t.worked === 0 ? "no-op" : `${t.worked} worked · ${t.changed} changed`}>
            {t.worked === 0 ? (
              <span className="au-spark-zero" />
            ) : (
              <span className="au-spark-stack" style={{ height: `${h}%` }}>
                <span className="au-spark-seg changed" style={{ flex: Math.max(0.001, t.changed) }} />
                <span className="au-spark-seg kept" style={{ flex: Math.max(0.001, t.worked - t.changed) }} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** The backlog-burndown hero — the primary convergence gauge. Two backlogs (alias, edge)
 *  draining to zero; converged is a positive terminal state ("holds at zero"). */
const BurndownHero = ({ s, now }: { s: AuditObservability; now: number }) => {
  const b = s.backlog;
  const converged = b.converged;
  const cls = converged ? "converged" : "converging";
  return (
    <section className={`au-hero ${cls}`}>
      <header className="rk-head">
        <span className={`rk-glyph ${cls}`}>{converged ? <CheckCircleIcon size={20} /> : <ActivityIcon size={20} />}</span>
        <div className="rk-headline">
          <div className="rk-title-row">
            <span className="rk-title">audit backlog</span>
            <span className={`rk-badge ${cls}`}>{converged ? "clean" : "draining"}</span>
          </div>
          <p className="rk-sub">
            {converged
              ? "Every alias and edge row has been audited. The backlog holds at zero — new rows are swept within a tick."
              : "Un-audited alias and edge rows still to sweep. Each pass drains the backlog toward zero; the good state is empty and staying empty."}
          </p>
        </div>
      </header>

      <div className="au-hero-grid">
        <div className="au-burn-head">
          <div className="au-burn-count">
            <span className={b.alias === 0 ? "au-burn-v zero" : "au-burn-v"}>{b.alias.toLocaleString()}</span>
            <span className="au-burn-k">
              <span className="au-dot au-dot-alias" /> alias rows
            </span>
          </div>
          {b.aliasSeries.length > 0 ? <BurndownSpark series={b.aliasSeries} tone="g" /> : null}
        </div>
        <div className="au-burn-head">
          <div className="au-burn-count">
            <span className={b.edge === 0 ? "au-burn-v zero" : "au-burn-v"}>{b.edge.toLocaleString()}</span>
            <span className="au-burn-k">
              <span className="au-dot au-dot-edge" /> edge rows
            </span>
          </div>
          {b.edgeSeries.length > 0 ? <BurndownSpark series={b.edgeSeries} tone="p" /> : null}
        </div>
      </div>

      <p className="rk-foot">
        {converged ? (
          <>
            <CheckCircleIcon size={12} /> Backlog at zero.
            <span className="rk-sep">·</span>
            Sweeps every {s.cadenceMin}m and exits immediately while there's nothing to audit.
          </>
        ) : (
          <>
            <ClockIcon size={12} /> {b.total.toLocaleString()} rows to go.
            <span className="rk-sep">·</span>
            Sweeps every {s.cadenceMin}m
            {s.lastSweep != null ? (
              <>
                <span className="rk-sep">·</span>last sweep {age(s.lastSweep, now)}
              </>
            ) : null}
            .
          </>
        )}
      </p>
    </section>
  );
};

/** Per-pass presentation (label/blurb/icon/backlog vocabulary) — static, keyed by the reader's
 *  pass ids. Burndown tones reuse the established palette: alias=accent, edge=terra, and the
 *  sku plan rides the derived-gauge blue (the recipe backfill's tone) — no new colors. */
const PASS_META: Record<
  AuditPassId,
  { label: string; blurb: string; icon: (size: number) => React.ReactNode; backlogLabel: string; tone: "g" | "p" | "b" }
> = {
  alias: {
    label: "alias audit",
    blurb:
      "Re-reads every alias row and reconciles it with the current graph — stamping it audited, repointing wrong maps, minting missing ids, and merging duplicates.",
    icon: (size) => <LinkIcon size={size} />,
    backlogLabel: "un-audited alias rows",
    tone: "g",
  },
  edge: {
    label: "edge audit",
    blurb:
      "Re-reads every satisfies-edge and drops the unsound ones — self-loops and the edges that close a cycle — keeping the directed graph acyclic.",
    icon: (size) => <GitMergeIcon size={size} />,
    backlogLabel: "un-audited edge rows",
    tone: "p",
  },
  sku: {
    label: "sku-cache re-key",
    blurb:
      "Re-keys cached Kroger SKU rows onto their canonical ingredient id and collapses duplicate cache entries left behind by merges.",
    icon: (size) => <DatabaseIcon size={size} />,
    backlogLabel: "pending re-keys (live plan)",
    tone: "b",
  },
};

/** A card's own backlog count + trend row (the hero's treatment, card-sized). */
const PassBurndown = ({ gauge, label, tone }: { gauge: PassGauge; label: string; tone: "g" | "p" | "b" }) => (
  <div className="au-pass-burn">
    <div className="au-burn-count">
      <span className={gauge.count === 0 && !gauge.capped ? "au-burn-v sm zero" : "au-burn-v sm"}>
        {gauge.count.toLocaleString()}
        {gauge.capped ? "+" : ""}
      </span>
      <span className="au-burn-k">{label}</span>
    </div>
    {gauge.series.length > 0 ? <BurndownSpark series={gauge.series} tone={tone} compact /> : null}
  </div>
);

/** One audit pass as a compact convergence card: its OWN backlog burndown (count + trend +
 *  state chip — converged is the green positive terminal), this-tick summary chips, and the
 *  worked/tick spark. The edge card also carries the one-shot replay's state. */
const PassCard = ({
  pass,
  gauge,
  replay,
  now,
}: {
  pass: AuditPass;
  gauge: PassGauge;
  replay?: { pending: number; capped: boolean };
  now: number;
}) => {
  const meta = PASS_META[pass.id];
  const converged = gauge.count === 0 && !gauge.capped;
  const cls = converged ? "converged" : "converging";
  return (
    <div className={`au-pass ${cls}`}>
      <div className="au-pass-head">
        <span className={`au-pass-ico ${cls}`}>{meta.icon(16)}</span>
        <span className="au-pass-name">{meta.label}</span>
        <span className={`au-pass-badge ${cls}`}>{converged ? "settled" : "auditing"}</span>
      </div>
      <p className="au-pass-blurb">{meta.blurb}</p>

      <PassBurndown gauge={gauge} label={meta.backlogLabel} tone={meta.tone} />

      {pass.ticks.length > 0 ? (
        <div className="au-pass-spark">
          <div className="au-pass-spark-cap">
            <span>{pass.settled ? "no-op" : `${pass.worked} worked · ${pass.changed} changed`} / tick</span>
            <span className="au-pass-axis">last {pass.ticks.length} →</span>
          </div>
          <WorkedSpark pass={pass} />
        </div>
      ) : null}

      {pass.summary.length > 0 ? (
        <div className="jstats au-pass-stats">
          {pass.summary.map(([k, v]) => (
            <span key={k} className="jstat">
              <span className="jstat-k">{k}</span>
              <span className="jstat-v">{v.toLocaleString()}</span>
            </span>
          ))}
        </div>
      ) : null}

      {replay ? (
        <p className="au-pass-foot au-pass-replay">
          <RotateIcon size={11} />{" "}
          {replay.pending === 0
            ? "replay done — every pre-calibration drop re-checked"
            : `${replay.pending.toLocaleString()}${replay.capped ? "+" : ""} pre-calibration drop${
                replay.pending === 1 && !replay.capped ? "" : "s"
              } awaiting replay`}
        </p>
      ) : null}

      <p className="au-pass-foot">
        <ClockIcon size={11} /> {pass.lastRun != null ? `ran ${age(pass.lastRun, now)}` : "never run"}
      </p>
    </div>
  );
};

/** The disjunction shape sweep as a compact fourth convergence card: live concrete disjunctive
 *  ids burning to zero (the sweep's quiesce predicate), the normalize job's latest disjunction
 *  counters as chips. It deliberately does NOT feed the hero/Status converged state. */
const DisjunctionCard = ({ g, now }: { g: DisjunctionGauge; now: number }) => {
  const converged = g.live === 0;
  const cls = converged ? "converged" : "converging";
  return (
    <div className={`au-pass ${cls}`}>
      <div className="au-pass-head">
        <span className={`au-pass-ico ${cls}`}>
          <LayersIcon size={16} />
        </span>
        <span className="au-pass-name">disjunction sweep</span>
        <span className={`au-pass-badge ${cls}`}>{converged ? "settled" : "sweeping"}</span>
      </div>
      <p className="au-pass-blurb">
        Models "X or Y" terms as abstract constraints — flipping wrongly-concrete disjunction nodes, folding their spec
        children, and guaranteeing member edges.
      </p>

      <PassBurndown gauge={{ count: g.live, capped: false, series: g.series }} label="live concrete disjunctive ids" tone="b" />

      {g.summary.length > 0 ? (
        <div className="jstats au-pass-stats">
          {g.summary.map(([k, v]) => (
            <span key={k} className="jstat">
              <span className="jstat-k">{k}</span>
              <span className="jstat-v">{v.toLocaleString()}</span>
            </span>
          ))}
        </div>
      ) : null}

      <p className="au-pass-foot">
        <ClockIcon size={11} /> {g.lastRun != null ? `swept ${age(g.lastRun, now)} · rides the normalize job` : "never run"}
      </p>
    </div>
  );
};

/** Restorations / replay log — one-shot events where a later pass re-decided a past edge
 *  drop. A replay restore links back to the drop decision it revisits (an Edges-segment
 *  deep-link); a structural restore is the deterministic guarantee re-inserting a spec→base edge. */
const RestorationsList = ({ restorations, now }: { restorations: EdgeRestoration[]; now: number }) => {
  if (restorations.length === 0) {
    return <p className="nz-al-empty muted small au-restore-empty">No restorations yet — no past drop has needed revisiting.</p>;
  }
  return (
    <div className="au-restore">
      {restorations.map((r) => {
        const tone = r.via === "replay" ? "ok" : "info";
        return (
          <div key={r.id} className={`au-rst tone-${tone}`} id={`rst-${r.id}`}>
            <span className="au-rst-ico">{r.via === "replay" ? <RotateIcon size={15} /> : <GitMergeIcon size={15} />}</span>
            <div className="au-rst-main">
              <div className="au-rst-top">
                <span className={`au-rst-kind tone-${tone}`}>{r.via === "replay" ? "restored" : "structural guarantee"}</span>
                <span className="au-rst-edge">
                  <code>{r.from}</code>
                  <ArrowRightIcon size={12} />
                  <code>{r.to}</code>
                  <span className="au-rst-rel">{r.kind}</span>
                </span>
                <span className="au-rst-time muted">{age(r.createdAt, now)}</span>
              </div>
              {r.reason ? <div className="au-rst-verdict">{r.reason}</div> : null}
              {r.origin != null ? (
                <div className="au-rst-origin">
                  revisits{" "}
                  {/* An intra-Normalize deep-link (Edges stream, drop filter, decision anchor).
                      TODO: the Normalize agent adds the validated `stream`/`filter` search params. */}
                  <Link
                    className="au-rst-link"
                    to="/normalize"
                    search={{ stream: "edges", filter: "drop" } as never}
                    hash={`edge-${r.origin}`}
                    title="Open the original decision"
                  >
                    <span className="au-rst-was">edge_drop</span> <code>#{r.origin}</code>
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Merge-rejection memory — co-resolution pairs held under the backoff. */
const RejectionsTable = ({ rejections, now }: { rejections: MergeRejection[]; now: number }) => (
  <div className="cfg-table-wrap au-rej-wrap">
    <table className="cfg-table au-rej-table">
      <thead>
        <tr>
          <th>Rejected pair</th>
          <th>Rejected</th>
          <th>Backoff ends</th>
        </tr>
      </thead>
      <tbody>
        {rejections.length === 0 ? (
          <tr>
            <td colSpan={3} className="nz-al-empty muted small">
              No rejected pairs on record — nothing is being held back.
            </td>
          </tr>
        ) : (
          rejections.map((r) => (
            <tr key={`${r.a}|${r.b}`}>
              <td>
                <span className="au-rej-pair">
                  <code>{r.a}</code>
                  <span className="au-rej-x">
                    <XCircleIcon size={12} />
                  </span>
                  <code>{r.b}</code>
                </span>
              </td>
              <td className="small muted">{age(r.rejectedAt, now)}</td>
              <td className="small">
                <span className="au-rej-until">
                  <ClockIcon size={12} /> {relFuture(r.expiresAt, now)}
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

/** A pass card's burndown gauge: alias/edge reuse the hero's live counts + series verbatim
 *  (derived here, never stored twice); the stampless sku pass carries its own plan gauge. */
function gaugeOf(pass: AuditPass, s: AuditObservability, gauges: AuditGauges): PassGauge {
  switch (pass.id) {
    case "alias":
      return { count: s.backlog.alias, capped: false, series: s.backlog.aliasSeries };
    case "edge":
      return { count: s.backlog.edge, capped: false, series: s.backlog.edgeSeries };
    case "sku":
      return gauges.sku;
    default:
      return assertNever(pass.id);
  }
}

/** The Normalize › Audits tab body. */
export const AuditsTab = ({
  s,
  gauges,
  restorations,
  rejections,
  backoffDays,
  now,
}: {
  s: AuditObservability;
  gauges: AuditGauges;
  restorations: EdgeRestoration[];
  rejections: MergeRejection[];
  backoffDays: number;
  now: number;
}) => (
  <div className="au-tab">
    <p className="nz-queue-blurb muted small">
      The identity graph re-checks itself continuously. Rolling passes drain a backlog of un-audited rows to zero and hold
      it there — repointing bad aliases, dropping unsound edges, re-keying the SKU cache, and sweeping disjunctive shapes.
      Empty is healthy.
    </p>

    <BurndownHero s={s} now={now} />

    <p className="group-label">Audit passes</p>
    <div className="au-pass-grid">
      {s.passes.map((p) => (
        <PassCard key={p.id} pass={p} gauge={gaugeOf(p, s, gauges)} replay={p.id === "edge" ? gauges.replay : undefined} now={now} />
      ))}
      <DisjunctionCard g={gauges.disjunction} now={now} />
    </div>

    <p className="group-label">Restorations · replay log</p>
    <p className="au-section-note muted small">
      One-shot events where a smarter pass revisited a past edge drop — replay restores link the decision they re-decided;
      structural restores are the deterministic spec→base guarantee.
    </p>
    <RestorationsList restorations={restorations} now={now} />

    <p className="group-label">Merge-rejection memory</p>
    <p className="au-section-note muted small">
      Co-resolution pairs the classifier declined to merge, held under a {backoffDays}-day backoff so the same pair isn't
      re-litigated every sweep.
    </p>
    <RejectionsTable rejections={rejections} now={now} />
  </div>
);

/** The identity audit as ONE Status › Background-jobs sibling row (like the reconcile row):
 *  a self-terminating convergence with a backlog burndown — NO uptime% — expandable
 *  (native `<details>`, no extra state) to the three passes' this-tick counts. The name links
 *  to Normalize › Audits (client-side). */
export const AuditStatusRow = ({ s, now }: { s: AuditObservability; now: number }) => {
  const b = s.backlog;
  const settled = s.state === "converged" || s.state === "neverRun";
  return (
    <Item
      outline
      className={`job-item au-job ${s.state}`}
      media={<span className={`sglyph ${settled ? "ok" : "rk-run"}`}>{settled ? <CheckCircleIcon /> : <ActivityIcon />}</span>}
      title={
        // TODO: the Normalize agent adds the validated `tab` search param to /normalize.
        <Link className="rk-job-name" to="/normalize" search={{ tab: "audits" } as never}>
          identity-audit <ArrowRightIcon size={12} />
        </Link>
      }
      description={
        <span className="job-meta">
          {s.state === "neverRun" ? (
            "No runs yet — nothing audited"
          ) : b.converged ? (
            <>
              Audited clean — backlog at zero
              {s.lastSweep != null ? (
                <>
                  <span className="job-sep"> · </span>swept {age(s.lastSweep, now)}
                </>
              ) : null}
            </>
          ) : (
            <>
              Ran {age(s.lastSweep, now)}
              <span className="job-sep"> · </span>
              {b.total.toLocaleString()} rows to audit
            </>
          )}
        </span>
      }
      actions={<Badge variant="secondary">{stateWord(s.state)}</Badge>}
    >
      {b.aliasSeries.length > 0 || b.edgeSeries.length > 0 ? (
        <div className="rk-status-spark">
          <div className="uptime-head">
            <span className="uptime-cap muted small">Backlog burndown</span>
            <span className="uptime-pct muted small">{b.converged ? "holding at zero" : `${b.total.toLocaleString()} remaining`}</span>
          </div>
          <div className="au-status-burns">
            {b.aliasSeries.length > 0 ? (
              <div className="au-status-burn">
                <BurndownSpark series={b.aliasSeries} tone="g" compact />
                <span className="au-status-lab">alias</span>
              </div>
            ) : null}
            {b.edgeSeries.length > 0 ? (
              <div className="au-status-burn">
                <BurndownSpark series={b.edgeSeries} tone="p" compact />
                <span className="au-status-lab">edge</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <details className="au-job-passes">
        <summary className="au-job-passes-cap muted small">Per-pass this tick</summary>
        <div className="jstats">
          {s.passes.map((p) => (
            <span key={p.id} className="jstat">
              <span className="jstat-k">{PASS_META[p.id].label}</span>
              <span className="jstat-v">{p.worked.toLocaleString()}</span>
            </span>
          ))}
        </div>
      </details>
    </Item>
  );
};

/** The recipe-index row's inline backfill gauge: unresolved recipe terms draining toward zero
 *  as normalization catches up. `degraded` gets a CALM amber chip, never a failure — a single
 *  bad tick just resumes next run. */
export const RecipeBackfillGauge = ({ b, now }: { b: RecipeBackfill; now: number }) => {
  const pct = b.start > 0 ? Math.round((1 - b.unresolved / b.start) * 100) : 100;
  return (
    <div className="bf-gauge">
      <div className="uptime-head">
        <span className="uptime-cap muted small">Recipe backfill</span>
        <span className="uptime-pct muted small">
          {b.unresolved.toLocaleString()} unresolved · {pct}% resolved
        </span>
      </div>
      <BurndownSpark series={b.series} tone="b" compact />
      <div className="bf-foot">
        <span className="bf-note">
          {b.start.toLocaleString()} distinct recipe terms → {b.unresolved.toLocaleString()} not yet in the identity graph,
          draining as normalization catches up.
        </span>
        {b.degraded ? (
          <span className="bf-degraded" title="resolver outage for a tick — no rows resolved; the backfill resumes next tick">
            <AlertTriangleIcon size={12} /> degraded tick{b.degradedAt != null ? ` ${age(b.degradedAt, now)}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
};
