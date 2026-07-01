// The Discovery area (operator-admin): the candidate-pipeline view over `discovery_log`
// (background-discovery-sweep). SSR per admin/CLAUDE.md rule 8 — stat tiles, filter pills, the
// per-candidate progression-track cards, and the expand-to-stage-detail are all pure reads; only
// Retry/Delete are mutations, hydrated by client/discovery.tsx. This is the AREA'S SOLE CONTENT
// (`/admin/discovery`) — it absorbed the candidate log formerly at `/admin/logs/discovery`
// (admin-ui-redesign-discovery Decision 2); that route now redirects here.

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import { StatCardGrid, StatCard, Pager, PrettyKV, StageTrack, Badge } from "../ui/kit.js";
import {
  CompassIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  RotateIcon,
  RssIcon,
  MailIcon,
  ChevronDownIcon,
  TargetIcon,
  DownloadIcon,
  SparklesIcon,
  FileTextIcon,
  GitMergeIcon,
  ScanIcon,
} from "../ui/icons.js";
import { relAge, relFuture, isRetryable, entryTitle } from "../logs-shared.js";
import type { DiscoveryCandidate, MatchScore, StageKey } from "../../discovery-db.js";
import { DEFAULT_CONFIG } from "../../discovery-sweep.js";

/** Candidates per page. */
export const PAGE_SIZE = 6;

/** The pipeline's 7 stages, in real execution order — icon + a short blurb of what each does
 *  (design.md Decision 1 / the "Discovery candidate progression track" requirement). */
export const STAGES: Array<{ key: StageKey; label: string; icon: Child; blurb: string }> = [
  { key: "triage", label: "Triage", icon: <TargetIcon size={14} />, blurb: "Cheap taste pre-filter — title+summary embed near any member?" },
  { key: "acquire", label: "Acquire", icon: <DownloadIcon size={14} />, blurb: "Fetch the page + parse to structured recipe content." },
  { key: "classify", label: "Classify", icon: <SparklesIcon size={14} />, blurb: "env.AI classification → contract-valid frontmatter facets." },
  { key: "describe", label: "Describe", icon: <FileTextIcon size={14} />, blurb: "Generate the description and embed it — the authoritative vector." },
  { key: "dedup", label: "Dedup", icon: <GitMergeIcon size={14} />, blurb: "Near-duplicate cosine vs the corpus (and this tick's imports)." },
  { key: "match", label: "Match", icon: <ScanIcon size={14} />, blurb: "Taste cosine + dietary gate, then the negation-aware LLM confirm." },
  { key: "import", label: "Import", icon: <DownloadIcon size={14} />, blurb: "Assemble body + frontmatter, validate, write to the corpus." },
];
const STAGE_IX: Record<StageKey, number> = Object.fromEntries(STAGES.map((s, i) => [s.key, i])) as Record<StageKey, number>;

const OUTCOME_LABEL: Record<string, string> = {
  imported: "Imported",
  duplicate: "Duplicate",
  no_match: "No match",
  dietary_gated: "Dietary gated",
  rejected_source: "Source rejected",
  error: "Parked",
  failed: "Failed",
  deferred: "Deferred",
};

const ACQUIRE_REASON_LABEL: Record<string, string> = {
  unreachable: "Page unreachable",
  no_jsonld: "No recipe JSON-LD on page",
  not_a_recipe: "Not a recipe page",
  incomplete: "Recipe markup incomplete",
};

/** The filter pills, in display order. "retrying" matches `retryable` (either error/failed
 *  outcome with a pending next_retry_at); the rest match their outcome value 1:1. */
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "imported", label: "Imported" },
  { key: "retrying", label: "Retrying" },
  { key: "error", label: "Parked" },
  { key: "failed", label: "Failed" },
  { key: "no_match", label: "No match" },
  { key: "duplicate", label: "Duplicate" },
  { key: "dietary_gated", label: "Dietary" },
  { key: "deferred", label: "Deferred" },
];

function countFor(cands: DiscoveryCandidate[], key: string): number {
  if (key === "all") return cands.length;
  if (key === "retrying") return cands.filter((c) => c.retryable).length;
  return cands.filter((c) => c.outcome === key).length;
}

function matchesFilter(c: DiscoveryCandidate, key: string): boolean {
  if (key === "all") return true;
  if (key === "retrying") return c.retryable;
  return c.outcome === key;
}

/** Build the `/admin/discovery` href for a given filter + page (omits default-valued params). */
function href(filter: string, page: number): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (page > 0) params.set("page", String(page + 1));
  const qs = params.toString();
  return qs ? `/admin/discovery?${qs}` : "/admin/discovery";
}

/** Whether a row's `source` looks like an email address (vs a feed name) — the same shape the
 *  sweep's inbox path uses for `source` (a sender address). */
function isEmailSource(source: string | null): boolean {
  return !!source && source.includes("@");
}

function attribution(detail: unknown): string {
  const d = (detail ?? {}) as Record<string, unknown>;
  const attrs = Array.isArray(d.attribution) ? d.attribution : [];
  return attrs
    .map((a) => (a && typeof a === "object" ? `@${(a as Record<string, unknown>).tenant}` : null))
    .filter((x): x is string => !!x)
    .join(", ");
}

/** A one-line plain-language summary of where/why the candidate stands (design.md's summary
 *  line). Mirrors the mock's summaryLine, grounded in the real detail shapes. */
function summaryLine(c: DiscoveryCandidate): string {
  const d = (c.detail ?? {}) as Record<string, unknown>;
  switch (c.outcome) {
    case "imported": {
      const who = attribution(c.detail);
      return `Imported${who ? ` → tagged for ${who}` : ""}${c.slug ? ` · ${c.slug}` : ""}`;
    }
    case "duplicate":
      return `Near-duplicate of ${String(d.duplicate_of ?? "an existing recipe")}`;
    case "no_match":
      return d.stage === "triage"
        ? "Stopped at triage — no member near in taste"
        : d.stage === "confirm"
          ? "Cleared cosine, but the LLM confirm declined all candidates"
          : "No member cleared the taste threshold";
    case "dietary_gated":
      return `Gated by a hard dietary restriction${d.restriction ? ` — ${d.restriction}` : ""}${d.tenant ? ` (@${d.tenant})` : ""}`;
    case "rejected_source":
      return `Source on the member reject list${d.tenant ? ` (@${d.tenant})` : ""}`;
    case "error": {
      const reason = typeof d.reason === "string" ? d.reason : "unknown reason";
      const label = ACQUIRE_REASON_LABEL[reason] ?? reason;
      return `Parked at ${STAGES[STAGE_IX[c.haltStage]].label} — ${label}${d.status ? ` (${d.status})` : ""}`;
    }
    case "failed":
      return `Infrastructure failure at ${STAGES[STAGE_IX[c.haltStage]].label} — ${String(d.reason ?? "unexpected error")}`;
    case "deferred":
      return `Passed match; deferred at import — ${String(d.note ?? "rate cap reached, re-queued for next tick")}`;
    default:
      return c.outcome;
  }
}

/** The Retry-clock / terminal readout for a retryable or terminal row (design.md's retry-clock
 *  requirement). Non-retryable, non-terminal rows (a plain rejection) render nothing. */
const RetryReadout = ({ c, now }: { c: DiscoveryCandidate; now: number }) => {
  const isTerminal = isRetryable(c.outcome) && !c.retryable && c.attempts > 0;
  if (c.retryable) {
    return (
      <div class="dc-retry" data-candidate-id={c.id}>
        <span class="muted small">
          attempt {c.attempts}/{DEFAULT_CONFIG.retryMaxAttempts}
          {c.next_retry_at ? ` · auto-retry ${relFuture(new Date(c.next_retry_at).getTime(), now)}` : ""}
        </span>
        <button class="btn dc-retry-btn" data-variant="outline" data-size="sm" data-action="retry" data-id={c.id}>
          <RotateIcon size={13} /> Retry now
        </button>
        <button class="btn" data-variant="ghost" data-size="sm" data-action="delete" data-id={c.id}>
          Delete
        </button>
      </div>
    );
  }
  if (isTerminal) {
    return (
      <div class="dc-retry" data-candidate-id={c.id}>
        <span class="dc-terminal muted small">terminal · retry cap ({DEFAULT_CONFIG.retryMaxAttempts}) reached</span>
        <button class="btn" data-variant="ghost" data-size="sm" data-action="delete" data-id={c.id}>
          Delete
        </button>
      </div>
    );
  }
  return null;
};

/** The per-member match scores computed at the match stage (operator-admin's "A match-halted
 *  candidate shows its per-member scores" requirement) — best score first, so the operator sees
 *  at a glance how close the nearest member came, not only the pass/fail outcome. Renders
 *  nothing when the row carries no scores (e.g. halted before the match stage, or imported). */
const MatchScores = ({ scores }: { scores: MatchScore[] | null }) => {
  if (!scores || scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  return (
    <div class="dc-match-scores">
      {sorted.map((s) => (
        <span class="badge" data-variant="outline">
          @{s.tenant} {s.score.toFixed(2)}
        </span>
      ))}
    </div>
  );
};

const StageDetail = ({ c }: { c: DiscoveryCandidate }) => {
  const haltIx = STAGE_IX[c.haltStage];
  const imported = c.outcome === "imported";
  return (
    <div class="dc-stages">
      {STAGES.map((s, i) => {
        const done = i < haltIx || (i === haltIx && imported);
        const halt = i === haltIx && !imported;
        const rowClass = done ? "dcs-row done" : halt ? `dcs-row halt ${c.kind}` : "dcs-row todo";
        return (
          <div class={rowClass}>
            <span class="dcs-ico">{done ? <CheckCircleIcon size={15} /> : s.icon}</span>
            <div class="dcs-body">
              <div class="dcs-name">
                {s.label}
                {done ? (
                  <span class="dcs-tag ok">passed</span>
                ) : halt ? (
                  <span class="dcs-tag halt">stopped here</span>
                ) : (
                  <span class="dcs-tag todo">not reached</span>
                )}
              </div>
              <div class="dcs-blurb muted small">{s.blurb}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

const CandidateCard = ({ c, now }: { c: DiscoveryCandidate; now: number }) => {
  const email = isEmailSource(c.source);
  const rawRow: Record<string, unknown> = {
    id: c.id,
    url: c.url,
    outcome: c.outcome,
    slug: c.slug,
    attempts: c.attempts,
    next_retry_at: c.next_retry_at ? relFuture(new Date(c.next_retry_at).getTime(), now) : null,
    ...((c.detail ?? {}) as Record<string, unknown>),
  };
  return (
    <div class={`dc-card kind-${c.kind}`} data-candidate-id={c.id}>
      <details class="dc-details">
        {/* Everything visible on the collapsed card — including the retry clock/actions and the
            Details toggle affordance — lives inside <summary> so it is the ONE clickable native
            disclosure control: always visible, and correctly bidirectional (open ↔ closed) with
            zero client JS (mirrors the Logs area's <details>/<summary> pattern). */}
        <summary class="dc-main">
          <div class="dc-headrow">
            <span class="dc-title">{entryTitle(c)}</span>
            <Badge variant={c.kind === "accepted" ? "secondary" : c.kind === "park" || c.kind === "fail" ? "destructive" : "outline"}>
              {OUTCOME_LABEL[c.outcome] ?? c.outcome}
            </Badge>
          </div>
          <div class="dc-src">
            {email ? <MailIcon size={13} /> : <RssIcon size={13} />}
            <span class="dc-src-name">{c.source ?? ""}</span>
            {c.created_at ? (
              <>
                <span class="dimsep">·</span>
                <span class="muted">{relAge(new Date(c.created_at).getTime(), now)}</span>
              </>
            ) : null}
            {c.url ? <span class="dc-url muted">{c.url.replace(/^https?:\/\//, "").slice(0, 46)}</span> : null}
          </div>

          <StageTrack
            stages={STAGES.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))}
            haltIndex={STAGE_IX[c.haltStage]}
            kind={c.kind}
            imported={c.outcome === "imported"}
          />

          <div class="dc-summary">{summaryLine(c)}</div>
          <MatchScores scores={c.matchScores} />

          <div class="dc-foot">
            <RetryReadout c={c} now={now} />
            <span class="dc-expand">
              <span class="dc-expand-closed">
                Details <ChevronDownIcon size={14} />
              </span>
              <span class="dc-expand-open">
                Hide <span class="up"><ChevronDownIcon size={14} /></span>
              </span>
            </span>
          </div>
        </summary>

        <div class="dc-detail">
          <StageDetail c={c} />
          <div class="dc-rawwrap">
            <p class="log-summary-label muted small">discovery_log detail</p>
            <PrettyKV obj={rawRow} />
          </div>
        </div>
      </details>
    </div>
  );
};

/** The Discovery area's SSR content: stat tiles, filter pills, the paginated candidate list.
 *  `filter`/`page` are route query params so every combination is deep-linkable. */
export const DiscoveryView = ({
  candidates,
  filter,
  page,
  now,
}: {
  candidates: DiscoveryCandidate[];
  filter: string;
  page: number;
  now: number;
}) => {
  const total = candidates.length;
  const imported = candidates.filter((c) => c.outcome === "imported").length;
  const importRate = total > 0 ? Math.round((imported / total) * 100) : 0;
  const parkedFailed = candidates.filter((c) => c.outcome === "error" || c.outcome === "failed").length;
  const inRetryQueue = candidates.filter((c) => c.retryable).length;

  const filtered = candidates.filter((c) => matchesFilter(c, filter));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const shown = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);

  return (
    <div class="discovery">
      <div class="area-head status-head">
        <h2>Discovery</h2>
      </div>

      <StatCardGrid>
        <StatCard icon={<CompassIcon size={15} />} label="Candidates" value={total} />
        <StatCard icon={<CheckCircleIcon size={15} />} label="Imported" value={imported} sub={`${importRate}% of intake`} />
        <StatCard icon={<AlertTriangleIcon size={15} />} label="Parked / failed" value={parkedFailed} />
        <StatCard icon={<RotateIcon size={15} />} label="In retry queue" value={inRetryQueue} />
      </StatCardGrid>

      <div class="data-nav dc-filters">
        {FILTERS.map((f) => {
          const n = countFor(candidates, f.key);
          const active = filter === f.key;
          return (
            <a class={active ? "pill active" : "pill"} href={href(f.key, 0)} aria-disabled={n === 0 && f.key !== "all"}>
              {f.label}
              {n > 0 ? <span class="pill-count">{n}</span> : null}
            </a>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p class="muted">No candidates match this filter.</p>
      ) : (
        <div class="dc-list" id="discovery-list">
          {shown.map((c) => (
            <CandidateCard c={c} now={now} />
          ))}
        </div>
      )}

      {pages > 1 ? (
        <Pager
          info={`Page ${pg + 1} of ${pages} · ${filtered.length} candidates`}
          prev={
            pg > 0 ? (
              <a class="btn" data-variant="outline" data-size="sm" href={href(filter, pg - 1)}>
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
              <a class="btn" data-variant="outline" data-size="sm" href={href(filter, pg + 1)}>
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

function serializeProps(candidates: DiscoveryCandidate[]): string {
  return JSON.stringify({ candidates }).replace(/</g, "\\u003c");
}

/** The `/admin/discovery` page shell: the pipeline view SSR'd (first paint carries the data),
 *  plus the mutation island's hydration props + script (Retry/Delete only — everything else is
 *  a pure read, per admin/CLAUDE.md rule 8). */
export const DiscoveryPage = ({
  candidates,
  filter,
  page,
  now,
}: {
  candidates: DiscoveryCandidate[];
  filter: string;
  page: number;
  now: number;
}) => (
  <Layout title="Discovery · grocery-agent admin" active="/admin/discovery" wide>
    <div id="discovery-island">
      <DiscoveryView candidates={candidates} filter={filter} page={page} now={now} />
    </div>
    <script type="application/json" id="discovery-props" dangerouslySetInnerHTML={{ __html: serializeProps(candidates) }} />
    <script type="module" src="/admin/islands/discovery.js" />
  </Layout>
);
