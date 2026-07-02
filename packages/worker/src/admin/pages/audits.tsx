// The Normalize › Audits surface + its Status sibling row (admin-audit-observability) — SSR
// only, read-only renderers over the `audit-admin.ts` model. The audit passes are
// self-terminating convergence jobs in the reconcile mould, so the vocabulary matches
// `reconcile.tsx`: converged is a POSITIVE terminal state (green "clean", "holds at zero"),
// never a dead 0 — and the Status row shows a backlog burndown, never an uptime% (meaningless
// for a draining backlog). The `au-*`/`bf-*` classes are panel layout the design supplies
// (Basecoat lacks them) — see `styles.css`.
//
//   · BurndownSpark        — remaining-backlog bars falling to a green floor (shared with the
//                            Status row and the recipe-backfill gauge).
//   · AuditsTab            — the burndown hero + three pass cards + restorations log +
//                            merge-rejection memory.
//   · AuditStatusRow       — the identity audit as ONE Status › Background-jobs sibling row.
//   · RecipeBackfillGauge  — the recipe-index row's inline unresolved-terms burndown.

import { Item, Badge } from "../ui/kit.js";
import {
  CheckCircleIcon,
  ActivityIcon,
  ClockIcon,
  LinkIcon,
  GitMergeIcon,
  DatabaseIcon,
  ArrowRightIcon,
  RotateIcon,
  XCircleIcon,
  AlertTriangleIcon,
} from "../ui/icons.js";
import { assertNever } from "../lib/remote.js";
import { relAge, relFuture } from "../logs-shared.js";
import type {
  AuditObservability,
  AuditPass,
  AuditPassId,
  AuditState,
  EdgeRestoration,
  MergeRejection,
  RecipeBackfill,
} from "../../audit-admin.js";

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
    <div
      class={compact ? "au-burn compact" : "au-burn"}
      role="img"
      aria-label="rows remaining per recent sweep"
    >
      {series.map((v) => {
        const h = v === 0 ? 0 : Math.max(6, Math.round((v / max) * 100));
        return (
          <div class="au-burn-col" title={v === 0 ? "clean" : `${v.toLocaleString()} to go`}>
            {v === 0 ? <span class="au-burn-floor" /> : <span class={`au-burn-bar ${tone}`} style={`height:${h}%`} />}
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
    <div class="au-spark" role="img" aria-label="rows audited per recent tick">
      {pass.ticks.map((t) => {
        const h = t.worked === 0 ? 0 : Math.max(6, Math.round((t.worked / max) * 100));
        return (
          <div class="au-burn-col" title={t.worked === 0 ? "no-op" : `${t.worked} worked · ${t.changed} changed`}>
            {t.worked === 0 ? (
              <span class="au-spark-zero" />
            ) : (
              <span class="au-spark-stack" style={`height:${h}%`}>
                <span class="au-spark-seg changed" style={`flex:${Math.max(0.001, t.changed)}`} />
                <span class="au-spark-seg kept" style={`flex:${Math.max(0.001, t.worked - t.changed)}`} />
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
    <section class={`au-hero ${cls}`}>
      <header class="rk-head">
        <span class={`rk-glyph ${cls}`}>{converged ? <CheckCircleIcon size={20} /> : <ActivityIcon size={20} />}</span>
        <div class="rk-headline">
          <div class="rk-title-row">
            <span class="rk-title">audit backlog</span>
            <span class={`rk-badge ${cls}`}>{converged ? "clean" : "draining"}</span>
          </div>
          <p class="rk-sub">
            {converged
              ? "Every alias and edge row has been audited. The backlog holds at zero — new rows are swept within a tick."
              : "Un-audited alias and edge rows still to sweep. Each pass drains the backlog toward zero; the good state is empty and staying empty."}
          </p>
        </div>
      </header>

      <div class="au-hero-grid">
        <div class="au-burn-head">
          <div class="au-burn-count">
            <span class={b.alias === 0 ? "au-burn-v zero" : "au-burn-v"}>{b.alias.toLocaleString()}</span>
            <span class="au-burn-k">
              <span class="au-dot au-dot-alias" /> alias rows
            </span>
          </div>
          {b.aliasSeries.length > 0 ? <BurndownSpark series={b.aliasSeries} tone="g" /> : null}
        </div>
        <div class="au-burn-head">
          <div class="au-burn-count">
            <span class={b.edge === 0 ? "au-burn-v zero" : "au-burn-v"}>{b.edge.toLocaleString()}</span>
            <span class="au-burn-k">
              <span class="au-dot au-dot-edge" /> edge rows
            </span>
          </div>
          {b.edgeSeries.length > 0 ? <BurndownSpark series={b.edgeSeries} tone="p" /> : null}
        </div>
      </div>

      <p class="rk-foot">
        {converged ? (
          <>
            <CheckCircleIcon size={12} /> Backlog at zero.
            <span class="rk-sep">·</span>
            Sweeps every {s.cadenceMin}m and exits immediately while there's nothing to audit.
          </>
        ) : (
          <>
            <ClockIcon size={12} /> {b.total.toLocaleString()} rows to go.
            <span class="rk-sep">·</span>
            Sweeps every {s.cadenceMin}m
            {s.lastSweep != null ? (
              <>
                <span class="rk-sep">·</span>last sweep {age(s.lastSweep, now)}
              </>
            ) : null}
            .
          </>
        )}
      </p>
    </section>
  );
};

/** Per-pass presentation (label/blurb/icon) — static, keyed by the reader's pass ids. */
const PASS_META: Record<AuditPassId, { label: string; blurb: string; icon: (size: number) => unknown }> = {
  alias: {
    label: "alias audit",
    blurb:
      "Re-reads every alias row and reconciles it with the current graph — stamping it audited, repointing wrong maps, minting missing ids, and merging duplicates.",
    icon: (size) => <LinkIcon size={size} />,
  },
  edge: {
    label: "edge audit",
    blurb:
      "Re-reads every satisfies-edge and drops the unsound ones — self-loops and the edges that close a cycle — keeping the directed graph acyclic.",
    icon: (size) => <GitMergeIcon size={size} />,
  },
  sku: {
    label: "sku-cache re-key",
    blurb:
      "Re-keys cached Kroger SKU rows onto their canonical ingredient id and collapses duplicate cache entries left behind by merges.",
    icon: (size) => <DatabaseIcon size={size} />,
  },
};

/** One audit pass as a compact convergence card: state, this-tick summary chips, worked/tick spark. */
const PassCard = ({ pass, now }: { pass: AuditPass; now: number }) => {
  const meta = PASS_META[pass.id];
  const cls = pass.settled ? "converged" : "converging";
  return (
    <div class={`au-pass ${cls}`}>
      <div class="au-pass-head">
        <span class={`au-pass-ico ${cls}`}>{meta.icon(16)}</span>
        <span class="au-pass-name">{meta.label}</span>
        <span class={`au-pass-badge ${cls}`}>{pass.settled ? "settled" : "auditing"}</span>
      </div>
      <p class="au-pass-blurb">{meta.blurb}</p>

      {pass.ticks.length > 0 ? (
        <div class="au-pass-spark">
          <div class="au-pass-spark-cap">
            <span>{pass.settled ? "no-op" : `${pass.worked} worked · ${pass.changed} changed`} / tick</span>
            <span class="au-pass-axis">last {pass.ticks.length} →</span>
          </div>
          <WorkedSpark pass={pass} />
        </div>
      ) : null}

      {pass.summary.length > 0 ? (
        <div class="jstats au-pass-stats">
          {pass.summary.map(([k, v]) => (
            <span class="jstat">
              <span class="jstat-k">{k}</span>
              <span class="jstat-v">{v.toLocaleString()}</span>
            </span>
          ))}
        </div>
      ) : null}

      <p class="au-pass-foot">
        <ClockIcon size={11} /> {pass.lastRun != null ? `ran ${age(pass.lastRun, now)}` : "never run"}
      </p>
    </div>
  );
};

/** Restorations / replay log — one-shot events where a later pass re-decided a past edge
 *  drop. A replay restore links back to the drop decision it revisits (an Edges-segment
 *  anchor); a structural restore is the deterministic guarantee re-inserting a spec→base edge. */
const RestorationsList = ({ restorations, now }: { restorations: EdgeRestoration[]; now: number }) => {
  if (restorations.length === 0) {
    return <p class="nz-al-empty muted small au-restore-empty">No restorations yet — no past drop has needed revisiting.</p>;
  }
  return (
    <div class="au-restore">
      {restorations.map((r) => {
        const tone = r.via === "replay" ? "ok" : "info";
        return (
          <div class={`au-rst tone-${tone}`} id={`rst-${r.id}`}>
            <span class="au-rst-ico">{r.via === "replay" ? <RotateIcon size={15} /> : <GitMergeIcon size={15} />}</span>
            <div class="au-rst-main">
              <div class="au-rst-top">
                <span class={`au-rst-kind tone-${tone}`}>{r.via === "replay" ? "restored" : "structural guarantee"}</span>
                <span class="au-rst-edge">
                  <code>{r.from}</code>
                  <ArrowRightIcon size={12} />
                  <code>{r.to}</code>
                  <span class="au-rst-rel">{r.kind}</span>
                </span>
                <span class="au-rst-time muted">{age(r.createdAt, now)}</span>
              </div>
              {r.reason ? <div class="au-rst-verdict">{r.reason}</div> : null}
              {r.origin != null ? (
                <div class="au-rst-origin">
                  revisits{" "}
                  <a class="au-rst-link" href={`/admin/normalize?stream=edges&filter=drop#edge-${r.origin}`} title="Open the original decision">
                    <span class="au-rst-was">edge_drop</span> <code>#{r.origin}</code>
                  </a>
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
  <div class="cfg-table-wrap au-rej-wrap">
    <table class="cfg-table au-rej-table">
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
            <td colspan={3} class="nz-al-empty muted small">
              No rejected pairs on record — nothing is being held back.
            </td>
          </tr>
        ) : (
          rejections.map((r) => (
            <tr>
              <td>
                <span class="au-rej-pair">
                  <code>{r.a}</code>
                  <span class="au-rej-x">
                    <XCircleIcon size={12} />
                  </span>
                  <code>{r.b}</code>
                </span>
              </td>
              <td class="small muted">{age(r.rejectedAt, now)}</td>
              <td class="small">
                <span class="au-rej-until">
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

/** The Normalize › Audits tab body. */
export const AuditsTab = ({
  s,
  restorations,
  rejections,
  backoffDays,
  now,
}: {
  s: AuditObservability;
  restorations: EdgeRestoration[];
  rejections: MergeRejection[];
  backoffDays: number;
  now: number;
}) => (
  <div class="au-tab">
    <p class="nz-queue-blurb muted small">
      The identity graph re-checks itself continuously. Three rolling passes drain a backlog of un-audited rows to zero and
      hold it there — repointing bad aliases, dropping unsound edges, and re-keying the SKU cache. Empty is healthy.
    </p>

    <BurndownHero s={s} now={now} />

    <p class="group-label">Audit passes</p>
    <div class="au-pass-grid">
      {s.passes.map((p) => (
        <PassCard pass={p} now={now} />
      ))}
    </div>

    <p class="group-label">Restorations · replay log</p>
    <p class="au-section-note muted small">
      One-shot events where a smarter pass revisited a past edge drop — replay restores link the decision they re-decided;
      structural restores are the deterministic spec→base guarantee.
    </p>
    <RestorationsList restorations={restorations} now={now} />

    <p class="group-label">Merge-rejection memory</p>
    <p class="au-section-note muted small">
      Co-resolution pairs the classifier declined to merge, held under a {backoffDays}-day backoff so the same pair isn't
      re-litigated every sweep.
    </p>
    <RejectionsTable rejections={rejections} now={now} />
  </div>
);

/** The identity audit as ONE Status › Background-jobs sibling row (like the reconcile row):
 *  a self-terminating convergence with a backlog burndown — NO uptime% — expandable
 *  (native `<details>`, zero JS) to the three passes' this-tick counts. The name links to
 *  Normalize › Audits. */
export const AuditStatusRow = ({ s, now }: { s: AuditObservability; now: number }) => {
  const b = s.backlog;
  const settled = s.state === "converged" || s.state === "neverRun";
  return (
    <Item
      outline
      class={`job-item au-job ${s.state}`}
      media={<span class={`sglyph ${settled ? "ok" : "rk-run"}`}>{settled ? <CheckCircleIcon /> : <ActivityIcon />}</span>}
      title={
        <a class="rk-job-name" href="/admin/normalize?tab=audits">
          identity-audit <ArrowRightIcon size={12} />
        </a>
      }
      description={
        <span class="job-meta">
          {s.state === "neverRun" ? (
            "No runs yet — nothing audited"
          ) : b.converged ? (
            <>
              Audited clean — backlog at zero
              {s.lastSweep != null ? (
                <>
                  <span class="job-sep"> · </span>swept {age(s.lastSweep, now)}
                </>
              ) : null}
            </>
          ) : (
            <>
              Ran {age(s.lastSweep, now)}
              <span class="job-sep"> · </span>
              {b.total.toLocaleString()} rows to audit
            </>
          )}
        </span>
      }
      actions={<Badge variant="secondary">{stateWord(s.state)}</Badge>}
    >
      {b.aliasSeries.length > 0 || b.edgeSeries.length > 0 ? (
        <div class="rk-status-spark">
          <div class="uptime-head">
            <span class="uptime-cap muted small">Backlog burndown</span>
            <span class="uptime-pct muted small">{b.converged ? "holding at zero" : `${b.total.toLocaleString()} remaining`}</span>
          </div>
          <div class="au-status-burns">
            {b.aliasSeries.length > 0 ? (
              <div class="au-status-burn">
                <BurndownSpark series={b.aliasSeries} tone="g" compact />
                <span class="au-status-lab">alias</span>
              </div>
            ) : null}
            {b.edgeSeries.length > 0 ? (
              <div class="au-status-burn">
                <BurndownSpark series={b.edgeSeries} tone="p" compact />
                <span class="au-status-lab">edge</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <details class="au-job-passes">
        <summary class="au-job-passes-cap muted small">Per-pass this tick</summary>
        <div class="jstats">
          {s.passes.map((p) => (
            <span class="jstat">
              <span class="jstat-k">{PASS_META[p.id].label}</span>
              <span class="jstat-v">{p.worked.toLocaleString()}</span>
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
    <div class="bf-gauge">
      <div class="uptime-head">
        <span class="uptime-cap muted small">Recipe backfill</span>
        <span class="uptime-pct muted small">
          {b.unresolved.toLocaleString()} unresolved · {pct}% resolved
        </span>
      </div>
      <BurndownSpark series={b.series} tone="b" compact />
      <div class="bf-foot">
        <span class="bf-note">
          {b.start.toLocaleString()} distinct recipe terms → {b.unresolved.toLocaleString()} not yet in the identity graph,
          draining as normalization catches up.
        </span>
        {b.degraded ? (
          <span class="bf-degraded" title="resolver outage for a tick — no rows resolved; the backfill resumes next tick">
            <AlertTriangleIcon size={12} /> degraded tick{b.degradedAt != null ? ` ${age(b.degradedAt, now)}` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
};

