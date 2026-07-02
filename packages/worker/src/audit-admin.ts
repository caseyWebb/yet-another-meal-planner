// Reader for the operator admin audit-observability surfaces (admin-audit-observability):
// the Normalize › Audits tab, the Decisions › Edges segment, and the Status identity-audit
// row. Follows `reconcile-admin.ts`'s split — pure `derive*` functions over `JobRun[]`
// windows (unit-testable without D1) + thin `read*` wrappers over `readJobRuns`/`src/db.ts`.
//
// The three audit passes (alias audit · edge audit · sku-cache re-key) are self-terminating
// convergence jobs: they drain a backlog toward zero and quiesce to silent no-ops, so —
// exactly like the grocery/pantry reconcile — "converged" is the POSITIVE terminal state and
// there is no meaningful uptime%. The shared backlog is the count of un-audited alias + edge
// rows (`source='auto' AND audited_at IS NULL`); its burndown series is reconstructed from
// the run history by back-summation (the jobs don't record remaining-backlog per tick):
// `remaining_after(run k) = live_count + Σ audited(runs after k)`. Monotone by construction
// and exact at the live end; two mid-window effects skew the old tail — rows ARRIVING during
// the window read slightly high, and un-audited rows DELETED outside the audited count (the
// replay's reverse-edge deletions) read slightly low. Both are fine for a trend sparkline —
// the headline number is always the live COUNT.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { readJobRuns, type JobRun } from "./health.js";
import { ALIAS_AUDIT_JOB } from "./ingredient-alias-audit.js";
import { EDGE_AUDIT_JOB, EDGE_TERM_RE } from "./ingredient-edge-audit.js";
import { SKU_REKEY_JOB } from "./sku-cache-rekey.js";
import { NORMALIZE_CORESOLVE_REJECT_BACKOFF_MS } from "./ingredient-normalize.js";

/** How many recent runs each pass's sparkline shows (and the reader fetches per job). */
export const AUDIT_RUN_WINDOW = 15;

/** Audit cron cadence in minutes — the passes ride the every-5-minutes janitor tick. */
export const AUDIT_CADENCE_MIN = 5;

/** How many edge-decision log rows the Edges segment reads (newest first). */
export const EDGE_DECISION_LIMIT = 200;

/** The co-resolution rejection backoff, in whole days (the table's re-litigation window). */
export const CORESOLVE_BACKOFF_DAYS = Math.round(NORMALIZE_CORESOLVE_REJECT_BACKOFF_MS / 86_400_000);

/** Converged is the POSITIVE terminal state (backlog at zero and holding); `neverRun` is a
 *  fresh deploy with no audit run history at all. */
export type AuditState = "converging" | "converged" | "neverRun";

export type AuditPassId = "alias" | "edge" | "sku";

/** One run's worked/changed counts (oldest→newest in `ticks`) — the pass sparkline's shape:
 *  `changed` stacked inside `worked`, decaying to a floor of no-op ticks once caught up. */
export interface AuditTick {
  worked: number;
  changed: number;
}

/** One audit pass's card model. `summary` is the latest run's numeric counts in the job's own
 *  field order (the counts it upserts to job_health) — rendered as stat chips verbatim. */
export interface AuditPass {
  id: AuditPassId;
  ticks: AuditTick[];
  /** The latest tick's counts (0/0 once settled). */
  worked: number;
  changed: number;
  summary: Array<[string, number]>;
  /** Epoch ms of the most recent run, or null with no history. */
  lastRun: number | null;
  /** The latest run was a healthy no-op (nothing left for this pass). */
  settled: boolean;
}

/** The shared alias+edge backlog burndown (the hero + the Status row). */
export interface AuditBacklog {
  /** Live count of un-audited alias rows (exact). */
  alias: number;
  /** Live count of un-audited edge rows (exact). */
  edge: number;
  total: number;
  /** Remaining-after-each-run series, oldest→newest, back-summed; ends at the live count.
   *  Empty with no run history. */
  aliasSeries: number[];
  edgeSeries: number[];
  /** Both backlogs at zero — the positive terminal state. */
  converged: boolean;
}

/** The audit-convergence model the Audits tab hero + the Status identity-audit row render. */
export interface AuditObservability {
  state: AuditState;
  backlog: AuditBacklog;
  /** alias · edge · sku, in display order. */
  passes: AuditPass[];
  /** Epoch ms of the most recent run across the three passes, or null. */
  lastSweep: number | null;
  cadenceMin: number;
}

/** A finite numeric summary field, else 0 (failure runs carry `{error}` summaries). */
function numField(summary: Record<string, unknown>, key: string): number {
  const v = summary[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** The latest run's numeric summary counts, in the job's declared field order. */
function summaryPairs(run: JobRun | undefined, fields: readonly string[]): Array<[string, number]> {
  if (!run) return [];
  return fields.map((f) => [f, numField(run.summary, f)] as [string, number]);
}

/** The alias/edge/sku summary field orders — mirror the jobs' summary types verbatim. */
const ALIAS_FIELDS = ["audited", "self_stamped", "kept", "repointed", "minted", "merged", "skipped"] as const;
const EDGE_FIELDS = [
  "audited",
  "self_loops",
  "cycles",
  "dropped",
  "kept",
  "skipped",
  "structural",
  "structural_restored",
  "self_loops_swept",
  "replayed",
  "restored",
] as const;
const SKU_FIELDS = ["rekeyed", "merged", "alias_retargeted"] as const;

/** worked/changed per run, per pass. Alias/edge work is `audited` (their backlog drain); a
 *  sku tick's work IS its changes (every re-key/merge is a mutation). Changed counts stay
 *  within the worked total so the stacked sparkline segments never exceed the bar. */
function tickOf(run: JobRun, id: AuditPassId): AuditTick {
  switch (id) {
    case "alias": {
      const worked = numField(run.summary, "audited");
      const changed = numField(run.summary, "repointed") + numField(run.summary, "minted") + numField(run.summary, "merged");
      return { worked, changed: Math.min(changed, worked) };
    }
    case "edge": {
      const worked = numField(run.summary, "audited");
      return { worked, changed: Math.min(numField(run.summary, "dropped"), worked) };
    }
    case "sku": {
      const worked =
        numField(run.summary, "rekeyed") + numField(run.summary, "merged") + numField(run.summary, "alias_retargeted");
      return { worked, changed: worked };
    }
  }
}

/** A pass's latest run is a healthy no-op (and, for sku, not capped mid-backlog). */
function isSettled(run: JobRun | undefined, id: AuditPassId): boolean {
  if (!run || !run.ok) return false;
  if (id === "sku" && run.summary.truncated === true) return false;
  return tickOf(run, id).worked === 0;
}

function derivePass(id: AuditPassId, runs: readonly JobRun[], fields: readonly string[]): AuditPass {
  const latest = runs[0];
  const ordered = [...runs].reverse();
  const ticks = ordered.map((r) => tickOf(r, id));
  const latestTick = latest ? tickOf(latest, id) : { worked: 0, changed: 0 };
  return {
    id,
    ticks,
    worked: latestTick.worked,
    changed: latestTick.changed,
    summary: summaryPairs(latest, fields),
    lastRun: latest ? latest.ran_at : null,
    settled: isSettled(latest, id),
  };
}

/**
 * Reconstruct the remaining-backlog series from a drain job's run history (newest-first) and
 * the live un-audited count: walking newest→oldest, each step back ADDS the rows that run
 * audited (they were still in the backlog before it ran). Returned oldest→newest; the last
 * point is exactly `current`. Empty history → empty series (the hero shows the count alone).
 */
export function backlogSeries(current: number, runs: readonly JobRun[]): number[] {
  const ordered = [...runs].reverse();
  const out: number[] = new Array(ordered.length);
  let remaining = current;
  for (let i = ordered.length - 1; i >= 0; i--) {
    out[i] = remaining;
    remaining += numField(ordered[i].summary, "audited");
  }
  return out;
}

/** The pure derivation the Audits tab + Status row share. Runs are newest-first per job (as
 *  `readJobRuns` returns); counts are the live un-audited totals. */
export function deriveAuditObservability(input: {
  aliasRuns: readonly JobRun[];
  edgeRuns: readonly JobRun[];
  skuRuns: readonly JobRun[];
  aliasBacklog: number;
  edgeBacklog: number;
}): AuditObservability {
  const passes: AuditPass[] = [
    derivePass("alias", input.aliasRuns, ALIAS_FIELDS),
    derivePass("edge", input.edgeRuns, EDGE_FIELDS),
    derivePass("sku", input.skuRuns, SKU_FIELDS),
  ];
  const converged = input.aliasBacklog === 0 && input.edgeBacklog === 0;
  // A fresh deploy with rows ALREADY waiting is a live backlog, not an idle "never run" — the
  // hero, the sub-nav dot, and the Status row must all read the same draining state. neverRun
  // is reserved for no-history AND nothing to drain.
  const neverRun =
    converged && input.aliasRuns.length === 0 && input.edgeRuns.length === 0 && input.skuRuns.length === 0;
  const lastSweep = passes.reduce<number | null>(
    (max, p) => (p.lastRun != null && (max == null || p.lastRun > max) ? p.lastRun : max),
    null,
  );
  return {
    state: neverRun ? "neverRun" : converged ? "converged" : "converging",
    backlog: {
      alias: input.aliasBacklog,
      edge: input.edgeBacklog,
      total: input.aliasBacklog + input.edgeBacklog,
      aliasSeries: backlogSeries(input.aliasBacklog, input.aliasRuns),
      edgeSeries: backlogSeries(input.edgeBacklog, input.edgeRuns),
      converged,
    },
    passes,
    lastSweep,
    cadenceMin: AUDIT_CADENCE_MIN,
  };
}

/** Read the audit-convergence model (SSR): the three jobs' run windows + the two live
 *  un-audited counts. Degrades like the reconcile reader — an unreachable D1 yields empty
 *  run windows (a `neverRun` model); a failed count read is a real `storage_error`. */
export async function readAuditObservability(env: Env): Promise<AuditObservability> {
  const d = db(env);
  const [aliasRuns, edgeRuns, skuRuns, aliasCount, edgeCount] = await Promise.all([
    readJobRuns(env, ALIAS_AUDIT_JOB, AUDIT_RUN_WINDOW),
    readJobRuns(env, EDGE_AUDIT_JOB, AUDIT_RUN_WINDOW),
    readJobRuns(env, SKU_REKEY_JOB, AUDIT_RUN_WINDOW),
    d.first<{ n: number }>("SELECT COUNT(*) AS n FROM ingredient_alias WHERE source = 'auto' AND audited_at IS NULL"),
    d.first<{ n: number }>("SELECT COUNT(*) AS n FROM ingredient_edge WHERE source = 'auto' AND audited_at IS NULL"),
  ]);
  return deriveAuditObservability({
    aliasRuns,
    edgeRuns,
    skuRuns,
    aliasBacklog: aliasCount?.n ?? 0,
    edgeBacklog: edgeCount?.n ?? 0,
  });
}

// === Edge decisions (Decisions › Edges + the Audits restorations log) =======================
// The edge audit's verdicts in `ingredient_normalization_log` (`edge_keep` / `edge_drop` /
// `edge_restore`). Post-calibration rows carry structured `detail` fields (`from`/`to`/`kind`);
// legacy rows encode the edge only in the `term` string — parsed with the SAME strict regex
// the replay uses (`EDGE_TERM_RE`). Rows that parse neither way are malformed legacy noise and
// are dropped from the stream. The Terms decisions stream keeps filtering `edge_*` outcomes
// out (`normalize-admin.ts`); this reader is the Edges segment's dedicated inverse.

/** One keep/drop verdict card on the Edges segment. */
export interface EdgeDecisionCard {
  /** The log row id (the restorations log links back to drops by this id). */
  id: number;
  outcome: "keep" | "drop";
  from: string;
  to: string;
  /** The satisfies-edge kind: general | containment | membership. */
  kind: string;
  /** The direction check's verdict (`forward`/`reverse`/`both`/`neither`), when a model ran. */
  direction: string | null;
  /** The check's reason line, when present. */
  reason: string | null;
  /** Deterministic-verdict marker (`self_loop` · `human_reverse` · `structural` · …), when present. */
  note: string | null;
  /** Amber flag chip: a self-loop drop, or a cycle-resolution drop. */
  flag: "self-loop" | "cycle" | null;
  model: string | null;
  createdAt: number;
  /** The `edge_restore` log id that later revisited this drop, or null (never revisited). */
  revisitedBy: number | null;
}

/** One restorations-log entry (an `edge_restore` row). `via` tells the replay's re-decision
 *  from the deterministic structural guarantee; `origin` is the revisited drop's log id. */
export interface EdgeRestoration {
  id: number;
  via: "replay" | "structural";
  from: string;
  to: string;
  kind: string;
  reason: string | null;
  origin: number | null;
  createdAt: number;
}

/** The Edges segment + restorations log in one bounded read. */
export interface EdgeDecisionLog {
  /** keep/drop verdicts, newest first. */
  decisions: EdgeDecisionCard[];
  /** `edge_restore` events, newest first. */
  restorations: EdgeRestoration[];
}

interface EdgeLogRow {
  id: number;
  term: string;
  outcome: string;
  model: string | null;
  detail: string | null;
  created_at: number | null;
}

/** The edge identity of a log row: structured `detail` fields first, else the strict legacy
 *  term parse. Null when neither yields an edge (malformed legacy noise — dropped). */
function edgeOf(row: EdgeLogRow, detail: Record<string, unknown>): { from: string; to: string; kind: string } | null {
  const { from, to, kind } = detail;
  if (typeof from === "string" && typeof to === "string" && typeof kind === "string") return { from, to, kind };
  const m = EDGE_TERM_RE.exec(row.term);
  if (!m) return null;
  return { from: m[1], to: m[3], kind: m[2] };
}

function parseDetail(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const p = JSON.parse(json);
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** The amber flag chip for a drop: a self-loop, or a cycle resolution (human-reverse and
 *  replay-pair drops are cycle-shaped by construction). LLM cycle drops carry only
 *  direction/reason and read as plain drops — acceptable; the note is still shown. */
function flagOf(outcome: "keep" | "drop", note: string | null): "self-loop" | "cycle" | null {
  if (outcome !== "drop") return null;
  if (note === "self_loop") return "self-loop";
  if (note === "human_reverse" || note === "replay_cycle") return "cycle";
  return null;
}

/** Read the edge-decision stream + restorations log (newest first, bounded). */
export async function readEdgeDecisionLog(env: Env, limit = EDGE_DECISION_LIMIT): Promise<EdgeDecisionLog> {
  const d = db(env);
  const rows = await d.all<EdgeLogRow>(
    "SELECT id, term, outcome, model, detail, created_at FROM ingredient_normalization_log " +
      "WHERE outcome IN ('edge_keep', 'edge_drop', 'edge_restore') ORDER BY id DESC LIMIT ?1",
    limit,
  );

  const restorations: EdgeRestoration[] = [];
  // drop log id → the restore that revisited it (newest wins; iterate newest-first so the
  // first writer stays).
  const revisitedBy = new Map<number, number>();
  for (const r of rows) {
    if (r.outcome !== "edge_restore") continue;
    const detail = parseDetail(r.detail);
    const edge = edgeOf(r, detail);
    if (!edge) continue;
    const origin = typeof detail.replay_of === "number" ? detail.replay_of : null;
    if (origin != null && !revisitedBy.has(origin)) revisitedBy.set(origin, r.id);
    restorations.push({
      id: r.id,
      via: origin != null ? "replay" : "structural",
      ...edge,
      reason: str(detail.reason) ?? str(detail.note),
      origin,
      createdAt: r.created_at ?? 0,
    });
  }

  const decisions: EdgeDecisionCard[] = [];
  for (const r of rows) {
    if (r.outcome !== "edge_keep" && r.outcome !== "edge_drop") continue;
    const detail = parseDetail(r.detail);
    const edge = edgeOf(r, detail);
    if (!edge) continue;
    const outcome = r.outcome === "edge_keep" ? ("keep" as const) : ("drop" as const);
    const note = str(detail.note);
    decisions.push({
      id: r.id,
      outcome,
      ...edge,
      direction: str(detail.direction),
      reason: str(detail.reason),
      note,
      flag: flagOf(outcome, note),
      model: r.model,
      createdAt: r.created_at ?? 0,
      revisitedBy: outcome === "drop" ? (revisitedBy.get(r.id) ?? null) : null,
    });
  }

  return { decisions, restorations };
}

// === Merge-rejection memory =================================================================

/** One co-resolution pair the classifier declined to merge, held under the backoff. */
export interface MergeRejection {
  a: string;
  b: string;
  rejectedAt: number;
  /** When the backoff lapses and the pair may be re-litigated. */
  expiresAt: number;
}

/** How many rejection rows the memory table reads, newest first (mirrors EDGE_DECISION_LIMIT). */
export const REJECTION_LIMIT = 200;

/** Read the merge-rejection memory, newest rejection first, bounded. Rows whose backoff has
 *  LAPSED are filtered out — a lapsed pair is re-eligible and will either re-reject (a fresh
 *  row) or merge, so rendering it as still-held would be false. */
export async function readMergeRejections(env: Env, now = Date.now()): Promise<MergeRejection[]> {
  const d = db(env);
  const rows = await d.all<{ a: string; b: string; decided_at: number }>(
    "SELECT a, b, decided_at FROM ingredient_coresolution_rejection ORDER BY decided_at DESC LIMIT ?1",
    REJECTION_LIMIT,
  );
  return rows
    .map((r) => ({
      a: r.a,
      b: r.b,
      rejectedAt: r.decided_at,
      expiresAt: r.decided_at + NORMALIZE_CORESOLVE_REJECT_BACKOFF_MS,
    }))
    .filter((r) => r.expiresAt > now);
}

// === The Normalize page's one-shot audit payload ============================================

/** Everything the Normalize area's Audits tab + Edges segment render (one read pass, rides
 *  the SSR props like the rest of the page model). */
export interface AuditSurface {
  obs: AuditObservability;
  edges: EdgeDecisionCard[];
  restorations: EdgeRestoration[];
  rejections: MergeRejection[];
  backoffDays: number;
}

export async function readAuditSurface(env: Env, now = Date.now()): Promise<AuditSurface> {
  const [obs, log, rejections] = await Promise.all([
    readAuditObservability(env),
    readEdgeDecisionLog(env),
    readMergeRejections(env, now),
  ]);
  return { obs, edges: log.decisions, restorations: log.restorations, rejections, backoffDays: CORESOLVE_BACKOFF_DAYS };
}

// === Recipe backfill (Status › recipe-index gauge) ==========================================
// The `recipe-index` job's summaries carry `unresolved` (distinct recipe terms not yet in the
// identity graph) per run — a direct convergence series, no reconstruction needed. `degraded`
// marks a tick where the resolver had an outage; the gauge shows it as a CALM amber chip (the
// backfill just resumes next tick), never the failure treatment.

/** The inline backfill gauge model on the recipe-index Status row. */
export interface RecipeBackfill {
  /** The latest run's unresolved count. */
  unresolved: number;
  /** The window's high-water unresolved count (the %-resolved denominator; ≥ unresolved). */
  start: number;
  /** Unresolved per run, oldest→newest. */
  series: number[];
  /** The latest run reported a degraded tick. */
  degraded: boolean;
  /** Epoch ms of the most recent degraded run in the window, or null. */
  degradedAt: number | null;
}

/** Derive the backfill gauge from the recipe-index run history (newest-first). Null when no
 *  run in the window carries a numeric `unresolved` (nothing to gauge — the row renders as a
 *  plain job). PURE — the Status page applies it to the runs it already fetched. */
export function deriveRecipeBackfill(runs: readonly JobRun[]): RecipeBackfill | null {
  const withUnresolved = runs.filter((r) => typeof r.summary.unresolved === "number");
  if (withUnresolved.length === 0) return null;
  const ordered = [...withUnresolved].reverse();
  const series = ordered.map((r) => numField(r.summary, "unresolved"));
  const latest = withUnresolved[0];
  const degradedRun = runs.find((r) => r.summary.degraded === true) ?? null;
  return {
    unresolved: numField(latest.summary, "unresolved"),
    start: Math.max(...series),
    series,
    degraded: latest.summary.degraded === true,
    degradedAt: degradedRun ? degradedRun.ran_at : null,
  };
}
