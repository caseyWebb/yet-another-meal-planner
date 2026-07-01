// The Normalization area (operator-admin): the operator audit + override surface over the
// organic ingredient-identity graph (organic-ingredient-normalization). Three tabs — Decisions
// (the capture audit stream), Queue (pending novel terms), Aliases (the live variant→id map,
// which subsumes the retired Config › Aliases editor). SSR per admin/CLAUDE.md rule 8: stat
// tiles, filter pills, the <details> decision cards, and the tables are pure reads deep-linked
// by query params; only the mutations (Override / Re-queue / Delete / Add-alias) hydrate via
// client/normalize.tsx, calling the typed /admin/api/normalization/* routes.

import type { Child } from "hono/jsx";
import { Layout } from "../ui/layout.js";
import { StatCardGrid, StatCard } from "../ui/kit.js";
import {
  DatabaseIcon,
  LinkIcon,
  GitMergeIcon,
  ClockIcon,
  SparklesIcon,
  AlertTriangleIcon,
  RotateIcon,
  TrashIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  SearchIcon,
  XCircleIcon,
  MinusCircleIcon,
  UsersIcon,
  LayersIcon,
  TargetIcon,
} from "../ui/icons.js";
import { relAge, relFuture } from "../logs-shared.js";
import type {
  NormalizationPage,
  NormalizationDecision,
  AliasRow,
  NodesPage,
  GraphNode,
  NodeEdge,
} from "../../normalize-admin.js";
import type { ReconcileObservability } from "../../reconcile-admin.js";
import { ReconcileCard } from "./reconcile.js";

export const ALIAS_PAGE_SIZE = 25;

const OUTCOME_LABEL: Record<string, string> = {
  same: "Same",
  spec: "Specialization",
  novel: "Novel",
  merge: "Merge",
  nollm: "No-LLM",
  fail: "Failed",
};

/** The decision filter pills, in display order. */
const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "same", label: "Same" },
  { key: "spec", label: "Specialization" },
  { key: "novel", label: "Novel" },
  { key: "merge", label: "Merge" },
  { key: "nollm", label: "No-LLM" },
  { key: "fail", label: "Failed" },
];

/** Query-param state the SSR view + island both read. */
export interface NormalizeQuery {
  tab: "decisions" | "queue" | "aliases" | "reconcile" | "nodes";
  filter: string;
  q: string;
  src: string;
  page: number;
  /** Selected node id on the Nodes tab (SSR browse selection); "" = the node list. */
  node: string;
  /** Node-list facet on the Nodes tab: all | base | detail | concept | orphan. */
  facet: string;
}

export function parseQuery(url: URL): NormalizeQuery {
  const tabRaw = url.searchParams.get("tab");
  const tab =
    tabRaw === "queue" || tabRaw === "aliases" || tabRaw === "reconcile" || tabRaw === "nodes"
      ? tabRaw
      : "decisions";
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw - 1 : 0;
  return {
    tab,
    filter: url.searchParams.get("filter") ?? "all",
    q: url.searchParams.get("q") ?? "",
    src: url.searchParams.get("src") ?? "all",
    page,
    node: url.searchParams.get("node") ?? "",
    facet: url.searchParams.get("facet") ?? "all",
  };
}

function href(part: Partial<NormalizeQuery>, cur: NormalizeQuery): string {
  const q = { ...cur, ...part };
  const p = new URLSearchParams();
  if (q.tab !== "decisions") p.set("tab", q.tab);
  if (q.filter !== "all") p.set("filter", q.filter);
  if (q.q) p.set("q", q.q);
  if (q.src !== "all") p.set("src", q.src);
  if (q.node) p.set("node", q.node);
  if (q.facet !== "all") p.set("facet", q.facet);
  if (q.page > 0) p.set("page", String(q.page + 1));
  const s = p.toString();
  return s ? `/admin/normalize?${s}` : "/admin/normalize";
}

/** Canonical id renderer — base in normal weight, ::detail as a lighter badge, a concept tag. */
const ResolvedId = ({ base, detail, concept }: { base: string; detail: string | null; concept?: boolean }) => (
  <span class="nz-id">
    <span class="nz-id-base">{base}</span>
    {detail ? (
      <>
        <span class="nz-id-dot">·</span>
        <span class="nz-id-detail">{detail}</span>
      </>
    ) : null}
    {concept ? <span class="nz-id-tag">concept</span> : null}
  </span>
);

const OutcomeBadge = ({ d }: { d: NormalizationDecision }) => (
  <span class={`nz-badge oc-${d.outcome}`}>
    {OUTCOME_LABEL[d.outcome] ?? d.outcome}
    {d.failedSafe ? " → Novel" : ""}
  </span>
);

const Candidates = ({ d }: { d: NormalizationDecision }) => {
  if (d.candidates.length === 0) {
    return <p class="nz-empty muted small">No candidates — the embedder returned nothing usable.</p>;
  }
  const anyChosen = d.candidates.some((c) => c.chosen);
  return (
    <div class="nz-cands">
      {d.candidates.map((c) => (
        <div class={c.chosen ? "nz-cand chosen" : "nz-cand"}>
          <span class="nz-cand-id">{c.id}</span>
          <span class="nz-cand-track">
            <span
              class={`nz-cand-fill${c.chosen ? " chosen" : ""}${d.belowFloor ? " floor" : ""}`}
              style={`width:${Math.round(c.score * 100)}%`}
            />
          </span>
          <span class="nz-cand-score">{c.score.toFixed(2)}</span>
          {c.chosen ? <span class="nz-cand-flag">chosen</span> : <span class="nz-cand-flag ghost" />}
        </div>
      ))}
      {!anyChosen ? (
        <p class="nz-cands-note muted small">
          {d.belowFloor
            ? "All below the similarity floor — resolved as a new base with no LLM call."
            : d.outcome === "novel" || d.outcome === "fail"
              ? "None chosen — the classifier judged this a distinct product."
              : "None chosen."}
        </p>
      ) : null}
    </div>
  );
};

/** The canonical id a decision resolved to (base or base::detail), for the Nodes deep-link. */
function decisionNodeId(d: NormalizationDecision): string {
  const id = d.outcome === "merge" ? (d.mergeInto ?? d.base) : d.detail ? `${d.base}::${d.detail}` : d.base;
  return id;
}

/** The resolved-id, linked into its node when one exists in the graph (a deep-link to the Nodes tab). */
const ResolvedDecId = ({ d, query, nodeIds }: { d: NormalizationDecision; query: NormalizeQuery; nodeIds: Set<string> }) => {
  const id = decisionNodeId(d);
  const inner =
    d.outcome === "merge" ? <ResolvedId base={d.mergeInto ?? d.base} detail={null} /> : <ResolvedId base={d.base} detail={d.detail} concept={d.concept} />;
  if (nodeIds.has(id)) {
    return (
      <a class="nz-resolve-link" href={href({ tab: "nodes", node: id, filter: "all", q: "", page: 0 }, query)} title="View in the node graph">
        {inner}
      </a>
    );
  }
  return inner;
};

const DecisionCard = ({ d, now, query, nodeIds }: { d: NormalizationDecision; now: number; query: NormalizeQuery; nodeIds: Set<string> }) => (
  <div class={`nz-card oc-${d.outcome}`} data-term={d.term}>
    <details class="nz-details">
      <summary class="nz-main">
        <div class="nz-lead">
          <div class="nz-term-wrap">
            <div class="nz-term">{d.term}</div>
            <div class="nz-resolve">
              <ArrowRightIcon size={13} />
              <ResolvedDecId d={d} query={query} nodeIds={nodeIds} />
            </div>
          </div>
          <div class="nz-badges">
            <OutcomeBadge d={d} />
            {d.reconfirm ? (
              <span class="nz-reconfirm" title="From the periodic re-confirm pass, not the initial capture">
                <RotateIcon size={11} /> re-confirm
              </span>
            ) : null}
            <span class={d.source === "human" ? "nz-src human" : "nz-src"}>
              {d.source === "human" ? (
                <>
                  <UsersIcon size={11} /> human
                </>
              ) : (
                "auto"
              )}
            </span>
            {d.createdAt ? <span class="nz-time muted">{relAge(d.createdAt, now)}</span> : null}
          </div>
        </div>
        <div class="nz-foot">
          <span class="nz-expand">
            Details <ChevronDownIcon size={14} />
          </span>
          <div class="nz-actions">
            <button class="btn nz-act-btn" data-variant="outline" data-size="sm" data-action="requeue" data-term={d.term}>
              <RotateIcon size={13} /> Re-queue
            </button>
            <button class="btn nz-act-btn" data-size="sm" data-action="override" data-term={d.term}>
              Override
            </button>
            {d.outcome === "fail" ? (
              <button class="nz-del" title="Delete row" data-action="delete-decision" data-id={String(d.id)}>
                <TrashIcon size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </summary>

      <div class="nz-detail">
        <div class="nz-detail-block">
          <p class="nz-detail-label">
            Candidates <span class="muted">· nearest by cosine</span>
          </p>
          <Candidates d={d} />
        </div>
        <div class="nz-detail-meta">
          <div class="nz-meta-item">
            <span class="nz-meta-k">Model</span>
            {d.model ? (
              <code class="nz-meta-model">{d.model}</code>
            ) : (
              <span class="nz-chip-floor">
                <MinusCircleIcon size={12} /> below floor — no LLM
              </span>
            )}
          </div>
          {d.mergeInto ? (
            <div class="nz-meta-item">
              <span class="nz-meta-k">Merge</span>
              <span class="nz-edge">
                <code>{d.term}</code>
                <ArrowRightIcon size={12} />
                <code>{d.mergeInto}</code>
                <span class="nz-edge-rel">same-as</span>
              </span>
            </div>
          ) : null}
        </div>
        {d.edges.length > 0 || d.members.length > 0 ? (
          <div class="nz-detail-block">
            <p class="nz-detail-label">{d.concept ? "Membership edges" : "Proposed edges"}</p>
            <div class="nz-edges">
              {d.edges.map((e) => (
                <span class="nz-edge">
                  <code>{e.from}</code>
                  <ArrowRightIcon size={12} />
                  <code>{e.to}</code>
                  <span class="nz-edge-rel">{e.rel}</span>
                </span>
              ))}
              {d.members.map((m) => (
                <span class="nz-edge member">
                  <code>{m}</code>
                  <ArrowRightIcon size={12} />
                  <code>{d.base}</code>
                  <span class="nz-edge-rel">member-of</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {d.reason ? (
          <div class="nz-reason">
            <span class="nz-reason-k">Reason</span>
            <span class="nz-reason-v">"{d.reason}"</span>
          </div>
        ) : null}
      </div>
    </details>
  </div>
);

const QueueTable = ({ data, now }: { data: NormalizationPage; now: number }) => (
  <div class="nz-queue">
    <p class="nz-queue-blurb muted small">
      Novel terms seen in member input, waiting for the next normalization pass. Each is embedded, matched, and classified
      when its retry window opens.
    </p>
    <div class="cfg-table-wrap">
      <table class="cfg-table nz-queue-table">
        <thead>
          <tr>
            <th>Term</th>
            <th>First seen</th>
            <th class="ig-th-num">Attempts</th>
            <th>Next retry</th>
          </tr>
        </thead>
        <tbody>
          {data.queue.length === 0 ? (
            <tr>
              <td colspan={4} class="nz-al-empty muted small">
                The queue is empty — every seen term has been placed.
              </td>
            </tr>
          ) : (
            data.queue.map((q) => (
              <tr>
                <td>
                  <code class="nz-queue-term">{q.term}</code>
                </td>
                <td class="muted small">{q.firstSeenAt ? relAge(q.firstSeenAt, now) : "—"}</td>
                <td class="ig-th-num cfg-num">{q.attempts}</td>
                <td class="small">
                  {q.nextRetryAt ? (
                    <span class="nz-queue-next">
                      <ClockIcon size={12} /> {relFuture(q.nextRetryAt, now)}
                    </span>
                  ) : (
                    <span class="muted">due</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

function filterAliases(rows: AliasRow[], q: NormalizeQuery): AliasRow[] {
  const needle = q.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q.src !== "all" && r.source !== q.src) return false;
    if (!needle) return true;
    const idStr = r.base + (r.detail ? `::${r.detail}` : "");
    return `${r.variant} ${idStr}`.toLowerCase().includes(needle);
  });
}

const AliasesTab = ({ data, query }: { data: NormalizationPage; query: NormalizeQuery }) => {
  const SRC = [
    { key: "all", label: "All", n: data.aliases.length },
    { key: "human", label: "Human", n: data.aliases.filter((a) => a.source === "human").length },
    { key: "auto", label: "Auto", n: data.aliases.filter((a) => a.source === "auto").length },
  ];
  const filtered = filterAliases(data.aliases, query);
  const pages = Math.max(1, Math.ceil(filtered.length / ALIAS_PAGE_SIZE));
  const pg = Math.min(query.page, pages - 1);
  const shown = filtered.slice(pg * ALIAS_PAGE_SIZE, pg * ALIAS_PAGE_SIZE + ALIAS_PAGE_SIZE);

  return (
    <div class="nz-aliases">
      <p class="nz-queue-blurb muted small">
        The live surface-form → canonical id map the matcher reads. The cron grows it automatically; edit here only to pin a
        synonym it hasn't found or prune a bad one.
      </p>
      <div class="nz-al-toolbar">
        <form class="recipe-search nz-al-search" method="get" action="/admin/normalize">
          <input type="hidden" name="tab" value="aliases" />
          {query.src !== "all" ? <input type="hidden" name="src" value={query.src} /> : null}
          <SearchIcon size={15} />
          <input class="recipe-search-input" type="text" name="q" placeholder="Filter variants or ids…" value={query.q} />
          {query.q ? (
            <a class="recipe-search-clear" href={href({ q: "", page: 0 }, query)} aria-label="Clear">
              <XCircleIcon size={15} />
            </a>
          ) : null}
        </form>
        <div class="data-nav nz-al-srcpills">
          {SRC.map((s) => (
            <a class={query.src === s.key ? "pill active" : "pill"} href={href({ src: s.key, page: 0 }, query)}>
              {s.label}
              {s.n > 0 ? <span class="pill-count">{s.n}</span> : null}
            </a>
          ))}
        </div>
        <button class="btn nz-al-add" data-size="sm" data-action="alias-add">
          + Add mapping
        </button>
      </div>

      <div class="cfg-table-wrap">
        <table class="cfg-table nz-al-table">
          <thead>
            <tr>
              <th>Variant</th>
              <th class="nz-al-th-arrow" aria-label="maps to"></th>
              <th>Canonical id</th>
              <th>Source</th>
              <th class="cfg-th-act">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colspan={5} class="nz-al-empty muted small">
                  No mappings match this filter.
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr>
                  <td>
                    <code class="nz-al-variant">{r.variant}</code>
                  </td>
                  <td class="nz-al-arrow">
                    <ArrowRightIcon size={13} />
                  </td>
                  <td>
                    <span class="nz-al-id">
                      <ResolvedId base={r.base} detail={r.detail} concept={r.concept} />
                      {r.merged ? <span class="nz-al-merged">merged</span> : null}
                    </span>
                  </td>
                  <td>
                    <span class={r.source === "human" ? "nz-src human" : "nz-src"}>
                      {r.source === "human" ? (
                        <>
                          <UsersIcon size={11} /> human
                        </>
                      ) : (
                        "auto"
                      )}
                    </span>
                  </td>
                  <td class="cfg-row-act">
                    <button
                      class="cfg-remove"
                      data-action="alias-delete"
                      data-variant={r.variant}
                      title={r.source === "human" ? "Prune this pinned mapping" : "Prune — the cron may re-derive this"}
                      aria-label="Delete mapping"
                    >
                      <TrashIcon size={15} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <div class="nz-pager">
          {pg > 0 ? (
            <a class="btn" data-variant="outline" data-size="sm" href={href({ page: pg - 1 }, query)}>
              Prev
            </a>
          ) : (
            <button class="btn" data-variant="outline" data-size="sm" disabled>
              Prev
            </button>
          )}
          <span class="muted small">
            Page {pg + 1} of {pages} · {filtered.length} mappings
          </span>
          {pg < pages - 1 ? (
            <a class="btn" data-variant="outline" data-size="sm" href={href({ page: pg + 1 }, query)}>
              Next
            </a>
          ) : (
            <button class="btn" data-variant="outline" data-size="sm" disabled>
              Next
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};

// === Nodes tab ==============================================================
// A read-only browse over the identity graph: a node list (facet-filtered, deep-linkable by
// ?facet) opens a relationship detail (?node=<id>) that lays a node's incoming ("satisfied by")
// and outgoing ("satisfies") edges on one left→right axis — the edges are directional and
// asymmetric, so the two sides differ. Orphans (edgeless concrete non-merged nodes) are the audit
// signal, filterable. Pure SSR — selection is a query param, no client JS.

const NODE_PAGE_SIZE = 25;

/** Edge-kind badge presentation. general=blue · containment=amber · membership=violet. */
const EDGE_KIND_GLOSS: Record<string, string> = {
  general: "a specific type satisfies its base",
  containment: "a whole satisfies a part",
  membership: "a member satisfies a concept class",
};

const KindBadge = ({ kind }: { kind: string }) => <span class={`ng-kind k-${kind}`}>{kind}</span>;

/** A node's "kind" label for the list sub-line. */
function nodeKindLabel(n: GraphNode): string {
  return !n.concrete ? "concept class" : n.detail ? "specialization" : "base";
}

function isNodeOrphan(n: GraphNode): boolean {
  return n.concrete && n.rep == null && n.incoming.length === 0 && n.outgoing.length === 0;
}

const NODE_FACETS: Array<{ key: string; label: string; test: (n: GraphNode) => boolean }> = [
  { key: "all", label: "All", test: () => true },
  { key: "base", label: "Bases", test: (n) => n.concrete && !n.detail && n.rep == null },
  { key: "detail", label: "Specializations", test: (n) => !!n.detail },
  { key: "concept", label: "Concepts", test: (n) => !n.concrete },
  { key: "orphan", label: "Orphans", test: isNodeOrphan },
];

/** One directed edge chip on the satisfies axis. The arrow always points RIGHT (the global
 *  "satisfies" flow), so `dir` only orders the pill vs the arrow — incoming reads other→node,
 *  outgoing reads node→other. A known-node endpoint deep-links to that node. */
const EdgeChip = ({ e, dir, byId, query }: { e: NodeEdge; dir: "in" | "out"; byId: Map<string, GraphNode>; query: NormalizeQuery }) => {
  const other = byId.get(e.id);
  const arrow = (
    <span class="ng-arrow-wire">
      <KindBadge kind={e.kind} />
      <ArrowRightIcon size={13} />
    </span>
  );
  const pill = (
    <span class="ng-edge-node">
      {other ? <ResolvedId base={other.base} detail={other.detail} concept={!other.concrete} /> : <code>{e.id}</code>}
    </span>
  );
  const body = dir === "in" ? (
    <>
      {pill}
      {arrow}
    </>
  ) : (
    <>
      {arrow}
      {pill}
    </>
  );
  if (other) {
    return (
      <a class="ng-edge" href={href({ node: e.id }, query)} title={EDGE_KIND_GLOSS[e.kind] ?? e.kind}>
        {body}
      </a>
    );
  }
  return <span class="ng-edge disabled" title={EDGE_KIND_GLOSS[e.kind] ?? e.kind}>{body}</span>;
};

/** The relationship detail for one selected node — identity facts + the satisfies axis. */
const NodeDetail = ({ node, byId, query }: { node: GraphNode; byId: Map<string, GraphNode>; query: NormalizeQuery }) => {
  const orphan = isNodeOrphan(node);
  const inc = node.incoming;
  const out = node.outgoing;
  return (
    <div class="node-detail">
      <a class="btn nd-back" data-variant="outline" data-size="sm" href={href({ node: "" }, query)}>
        <ChevronLeftIcon size={15} /> Nodes
      </a>

      <div class="nd-head">
        <div class="nd-id">
          <span class={`ng-row-glyph big${!node.concrete ? " concept" : orphan ? " orphan" : ""}`}>
            {!node.concrete ? <LayersIcon size={20} /> : node.rep ? <GitMergeIcon size={20} /> : <TargetIcon size={20} />}
          </span>
          <div class="nd-id-text">
            <div class="nd-id-main">
              <ResolvedId base={node.base} detail={node.detail} concept={!node.concrete} />
            </div>
            <div class="nd-id-sub">
              {!node.concrete ? "abstract concept class" : node.detail ? <>specialization of <code>{node.base}</code></> : "canonical base"}
            </div>
          </div>
        </div>
        {orphan ? (
          <span class="ng-orphan-chip big">
            <AlertTriangleIcon size={13} /> orphan
          </span>
        ) : null}
      </div>

      <dl class="nd-facts">
        <div class="nd-fact">
          <dt>Kind</dt>
          <dd>
            {!node.concrete ? (
              <span class="ng-fact-concept">
                <LayersIcon size={13} /> concept class
              </span>
            ) : (
              <span class="ng-fact-concrete">
                <TargetIcon size={13} /> concrete product
              </span>
            )}
          </dd>
        </div>
        <div class="nd-fact">
          <dt>Base</dt>
          <dd>
            <code>{node.base}</code>
          </dd>
        </div>
        <div class="nd-fact">
          <dt>Detail</dt>
          <dd>{node.detail ? <code>{node.detail}</code> : <span class="pv-null">—</span>}</dd>
        </div>
        <div class="nd-fact">
          <dt>Source</dt>
          <dd>
            <span class={node.source === "human" ? "nz-src human" : "nz-src"}>
              {node.source === "human" ? (
                <>
                  <UsersIcon size={11} /> human
                </>
              ) : (
                "auto"
              )}
            </span>
          </dd>
        </div>
        <div class="nd-fact">
          <dt>Edges</dt>
          <dd>
            <span class="ng-fact-edges">
              {inc.length} in <span class="nz-id-dot">·</span> {out.length} out
            </span>
          </dd>
        </div>
        {node.rep ? (
          <div class="nd-fact">
            <dt>Merged into</dt>
            <dd>
              <a class="nd-rep-link" href={href({ node: node.rep }, query)}>
                <code>{node.rep}</code>
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      {node.rep ? (
        <div class="nd-rep">
          <GitMergeIcon size={14} />
          <span>
            Merged into{" "}
            <a class="nd-rep-link" href={href({ node: node.rep }, query)}>
              <code>{node.rep}</code>
            </a>{" "}
            — requests for this id re-key to the representative.
          </span>
        </div>
      ) : null}

      {node.aliases.length > 0 ? (
        <div class="nd-block">
          <p class="nz-detail-label">
            Aliases <span class="muted">· surface forms that resolve here</span>
          </p>
          <div class="nd-aliases">
            {node.aliases.map((a) => (
              <code class="nd-alias">{a}</code>
            ))}
          </div>
        </div>
      ) : null}

      <div class="nd-block">
        <p class="nz-detail-label">
          Relationships <span class="muted">· directed "satisfies" edges — left to right</span>
        </p>

        {orphan ? (
          <div class="nd-orphan-note">
            <AlertTriangleIcon size={16} />
            <div>
              <strong>No satisfies-edges — this node is orphaned.</strong>
              <p class="muted small">
                A concrete node with zero edges. Nothing satisfies it and it satisfies nothing, so it can't be matched through the
                graph — a below-floor mint that never got linked, and a candidate for a pinned alias/override.
              </p>
            </div>
          </div>
        ) : (
          <div class="ng-axis">
            <div class="ng-axis-col in">
              <div class="ng-axis-cap">
                <ChevronRightIcon size={12} class="ng-cap-in" /> Satisfied by<span class="ng-axis-n">{inc.length}</span>
              </div>
              {inc.length ? (
                inc.map((e) => <EdgeChip e={e} dir="in" byId={byId} query={query} />)
              ) : (
                <span class="ng-axis-empty">nothing points in</span>
              )}
            </div>

            <div class="ng-axis-center">
              <div class="ng-center-node">
                <ResolvedId base={node.base} detail={node.detail} concept={!node.concrete} />
              </div>
              <span class="ng-axis-flow">satisfies →</span>
            </div>

            <div class="ng-axis-col out">
              <div class="ng-axis-cap">
                Satisfies<span class="ng-axis-n">{out.length}</span>
                <ChevronRightIcon size={12} class="ng-cap-out" />
              </div>
              {out.length ? (
                out.map((e) => <EdgeChip e={e} dir="out" byId={byId} query={query} />)
              ) : (
                <span class="ng-axis-empty">points to nothing</span>
              )}
            </div>
          </div>
        )}

        <div class="nd-legend">
          {Object.keys(EDGE_KIND_GLOSS).map((k) => (
            <span class="nd-legend-item">
              <KindBadge kind={k} />
              <span class="muted small">{EDGE_KIND_GLOSS[k]}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

/** The Nodes tab: the node list (facet-filtered + paged), or the selected node's detail. */
const NodesTab = ({ nodes, query }: { nodes: NodesPage; query: NormalizeQuery }) => {
  const byId = new Map(nodes.nodes.map((n) => [n.id, n]));

  const selected = query.node ? byId.get(query.node) : undefined;
  if (selected) {
    return <NodeDetail node={selected} byId={byId} query={query} />;
  }

  const facetTest = (NODE_FACETS.find((f) => f.key === query.facet) ?? NODE_FACETS[0]).test;
  const rows = nodes.nodes.filter(facetTest);
  const pages = Math.max(1, Math.ceil(rows.length / NODE_PAGE_SIZE));
  const pg = Math.min(query.page, pages - 1);
  const shown = rows.slice(pg * NODE_PAGE_SIZE, pg * NODE_PAGE_SIZE + NODE_PAGE_SIZE);

  return (
    <div class="nodes">
      <p class="nz-queue-blurb muted small">
        Every canonical node in the identity graph — <code>base</code> or <code>base::detail</code>, concrete products and abstract
        concept classes — with its directed satisfies-edges. Pick a node to audit what it is and how it's connected. Edgeless
        concrete nodes surface under{" "}
        <a class="ng-inline-filter" href={href({ facet: "orphan", page: 0 }, query)}>
          Orphans
        </a>
        .
      </p>

      <div class="data-nav ng-facets">
        {NODE_FACETS.map((f) => {
          const n = nodes.nodes.filter(f.test).length;
          return (
            <a
              class={`pill${f.key === "orphan" ? " ng-pill-orphan" : ""}${query.facet === f.key ? " active" : ""}`}
              href={href({ facet: f.key, page: 0 }, query)}
              aria-disabled={n === 0 && f.key !== "all"}
            >
              {f.key === "orphan" ? <AlertTriangleIcon size={12} /> : null}
              {f.label}
              {n > 0 ? <span class="pill-count">{n}</span> : null}
            </a>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p class="nz-al-empty muted small">No nodes match this filter.</p>
      ) : (
        <div class="ng-list">
          {shown.map((n) => {
            const orphan = isNodeOrphan(n);
            return (
              <a class={`ng-row${orphan ? " orphan" : ""}`} href={href({ node: n.id }, query)}>
                <span class={`ng-row-glyph${!n.concrete ? " concept" : orphan ? " orphan" : ""}`}>
                  {!n.concrete ? <LayersIcon size={15} /> : n.rep ? <GitMergeIcon size={15} /> : <TargetIcon size={15} />}
                </span>
                <span class="ng-row-main">
                  <span class="ng-row-id">
                    <ResolvedId base={n.base} detail={n.detail} concept={!n.concrete} />
                  </span>
                  <span class="ng-row-sub">
                    <span class="ng-row-kind">{nodeKindLabel(n)}</span>
                    <span class="nz-id-dot">·</span>
                    <span>
                      {n.aliases.length} {n.aliases.length === 1 ? "alias" : "aliases"}
                    </span>
                    {n.rep ? (
                      <>
                        <span class="nz-id-dot">·</span>
                        <span class="ng-row-merged">
                          <GitMergeIcon size={11} /> merged → <code>{n.rep}</code>
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span class="ng-row-trail">
                  {orphan ? (
                    <span class="ng-orphan-chip">
                      <AlertTriangleIcon size={11} /> orphan
                    </span>
                  ) : (
                    <span class="ng-deg">
                      <span class="ng-deg-part" title="satisfied by (incoming)">
                        <ChevronRightIcon size={12} class="ng-deg-in" />
                        {n.incoming.length}
                      </span>
                      <span class="ng-deg-part" title="satisfies (outgoing)">
                        {n.outgoing.length}
                        <ChevronRightIcon size={12} class="ng-deg-out" />
                      </span>
                    </span>
                  )}
                  <ChevronRightIcon size={16} class="ng-row-chev" />
                </span>
              </a>
            );
          })}
        </div>
      )}

      {pages > 1 ? (
        <div class="nz-pager">
          {pg > 0 ? (
            <a class="btn" data-variant="outline" data-size="sm" href={href({ page: pg - 1 }, query)}>
              Prev
            </a>
          ) : (
            <button class="btn" data-variant="outline" data-size="sm" disabled>
              Prev
            </button>
          )}
          <span class="muted small">
            Page {pg + 1} of {pages} · {rows.length} nodes
          </span>
          {pg < pages - 1 ? (
            <a class="btn" data-variant="outline" data-size="sm" href={href({ page: pg + 1 }, query)}>
              Next
            </a>
          ) : (
            <button class="btn" data-variant="outline" data-size="sm" disabled>
              Next
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
};

/** The Normalization area's SSR content. `query` (tab/filter/q/src/page/node/facet) is route state so
 *  every combination is deep-linkable; `now` is the render clock for relative times. `reconcile` feeds
 *  the Reconcile tab's convergence card and `nodes` the Nodes tab (both read-only — no island). */
export const NormalizeView = ({
  data,
  query,
  now,
  reconcile,
  nodes,
}: {
  data: NormalizationPage;
  query: NormalizeQuery;
  now: number;
  reconcile: ReconcileObservability;
  nodes: NodesPage;
}) => {
  const stats = data.stats;
  // The set of node ids a decision's resolved id can deep-link into (the whole node list, so a
  // merged-away id still links). Built once for the Decisions cards.
  const nodeIds = new Set(nodes.nodes.map((n) => n.id));
  const cards: Array<{ icon: Child; label: string; value: Child; sub?: string; warn?: boolean; bad?: boolean }> = [
    { icon: <DatabaseIcon size={15} />, label: "Canonical nodes", value: stats.nodes.toLocaleString() },
    { icon: <LinkIcon size={15} />, label: "Aliases", value: stats.aliases.toLocaleString() },
    { icon: <GitMergeIcon size={15} />, label: "Satisfies-edges", value: stats.satisfies.toLocaleString() },
    { icon: <ClockIcon size={15} />, label: "Pending queue", value: stats.pending, sub: "awaiting a pass", warn: stats.pending > 0 },
    { icon: <SparklesIcon size={15} />, label: "Decisions · 24h", value: stats.decisions24h },
    { icon: <AlertTriangleIcon size={15} />, label: "Needs attention", value: stats.needsAttention, sub: "failed", bad: stats.needsAttention > 0 },
  ];

  const filteredDecisions = data.decisions.filter((d) => query.filter === "all" || d.outcome === query.filter);

  return (
    <div class="normalize">
      <div class="data-nav nz-subnav">
        <a class={query.tab === "decisions" ? "pill active" : "pill"} href={href({ tab: "decisions", page: 0 }, query)}>
          Decisions
        </a>
        <a class={query.tab === "queue" ? "pill active" : "pill"} href={href({ tab: "queue", page: 0 }, query)}>
          Queue
          {data.queue.length > 0 ? <span class="pill-count">{data.queue.length}</span> : null}
        </a>
        <a class={query.tab === "aliases" ? "pill active" : "pill"} href={href({ tab: "aliases", page: 0 }, query)}>
          Aliases
          {data.aliases.length > 0 ? <span class="pill-count">{data.aliases.length}</span> : null}
        </a>
        <a class={query.tab === "nodes" ? "pill active" : "pill"} href={href({ tab: "nodes", page: 0, node: "", facet: "all" }, query)}>
          Nodes
          {nodes.stats.total > 0 ? <span class="pill-count">{nodes.stats.total}</span> : null}
        </a>
        <a class={query.tab === "reconcile" ? "pill active" : "pill"} href={href({ tab: "reconcile", page: 0 }, query)}>
          <span class={`rk-tab-dot ${reconcile.state}`} />
          Reconcile
        </a>
      </div>

      <div class="area-head status-head">
        <h2>Normalization</h2>
        <a href={href({}, query)} class="btn" data-variant="ghost" data-size="sm">
          Refresh{data.lastSweep != null ? ` · last sweep ${relAge(data.lastSweep, now)}` : ""}
        </a>
      </div>

      <StatCardGrid>
        {cards.map((c) => (
          <StatCard icon={c.icon} label={c.label} value={c.value} sub={c.sub} />
        ))}
      </StatCardGrid>

      {query.tab === "queue" ? (
        <QueueTable data={data} now={now} />
      ) : query.tab === "aliases" ? (
        <AliasesTab data={data} query={query} />
      ) : query.tab === "nodes" ? (
        <NodesTab nodes={nodes} query={query} />
      ) : query.tab === "reconcile" ? (
        <div class="nz-reconcile">
          <ReconcileCard s={reconcile} now={now} />
        </div>
      ) : (
        <>
          <div class="data-nav nz-filters">
            {FILTERS.map((f) => {
              const n = f.key === "all" ? data.decisions.length : data.decisions.filter((d) => d.outcome === f.key).length;
              return (
                <a class={query.filter === f.key ? `pill nz-pill oc-${f.key} active` : `pill nz-pill oc-${f.key}`} href={href({ filter: f.key, page: 0 }, query)} aria-disabled={n === 0 && f.key !== "all"}>
                  {f.label}
                  {n > 0 ? <span class="pill-count">{n}</span> : null}
                </a>
              );
            })}
          </div>

          {filteredDecisions.length === 0 ? (
            <p class="muted">No decisions match this filter.</p>
          ) : (
            <div class="nz-list">
              {filteredDecisions.map((d) => (
                <DecisionCard d={d} now={now} query={query} nodeIds={nodeIds} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Native dialogs the island opens for the two form mutations. `<datalist>` gives a native
          typeahead over known ids with zero client JS. */}
      <datalist id="nz-known-ids">
        {data.knownIds.map((id) => (
          <option value={id} />
        ))}
      </datalist>

      <dialog id="nz-override" class="nz-dialog">
        <form class="nz-dialog-form" data-form="override">
          <h3 class="nz-dialog-title">Override normalization</h3>
          <p class="nz-dialog-desc muted small">
            Pin this term to a canonical id yourself. A human correction is authoritative — the automatic system will not
            overwrite it.
          </p>
          <label class="nz-dialog-field">
            <span class="nz-ov-k">Term</span>
            <code class="nz-ov-term" data-slot="term"></code>
          </label>
          <label class="nz-dialog-field">
            <span class="nz-ov-k">Canonical id</span>
            <input class="input" type="text" name="canonicalId" list="nz-known-ids" placeholder="Search or type an id — base or base::detail" />
          </label>
          <div class="nz-dialog-foot">
            <button class="btn" type="button" data-variant="outline" data-action="dialog-cancel">
              Cancel
            </button>
            <button class="btn" type="submit">
              Save as human correction
            </button>
          </div>
        </form>
      </dialog>

      <dialog id="nz-add" class="nz-dialog">
        <form class="nz-dialog-form" data-form="add">
          <h3 class="nz-dialog-title">Add alias mapping</h3>
          <p class="nz-dialog-desc muted small">
            Pin a surface form to a canonical id. Saved as a human mapping — authoritative, and the automatic system won't
            overwrite it.
          </p>
          <label class="nz-dialog-field">
            <span class="nz-ov-k">Variant</span>
            <input class="input" type="text" name="variant" placeholder="e.g. EVOO" />
          </label>
          <label class="nz-dialog-field">
            <span class="nz-ov-k">Canonical id</span>
            <input class="input" type="text" name="canonicalId" list="nz-known-ids" placeholder="Search or type an id — a new id is allowed too" />
          </label>
          <div class="nz-dialog-foot">
            <button class="btn" type="button" data-variant="outline" data-action="dialog-cancel">
              Cancel
            </button>
            <button class="btn" type="submit">
              Save as human mapping
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
};

function serializeProps(data: NormalizationPage, reconcile: ReconcileObservability, nodes: NodesPage): string {
  return JSON.stringify({ data, reconcile, nodes }).replace(/</g, "\\u003c");
}

/** The `/admin/normalize` shell: the area SSR'd (first paint carries the data) + the mutation
 *  island's hydration props + script (Override / Re-queue / Delete / Add-alias). The Reconcile and
 *  Nodes tabs are read-only (no island), so their models ride the SSR only. */
export const NormalizePage = ({
  data,
  query,
  now,
  reconcile,
  nodes,
}: {
  data: NormalizationPage;
  query: NormalizeQuery;
  now: number;
  reconcile: ReconcileObservability;
  nodes: NodesPage;
}) => (
  <Layout title="Normalization · grocery-agent admin" active="/admin/normalize" wide>
    <div id="normalize-island">
      <NormalizeView data={data} query={query} now={now} reconcile={reconcile} nodes={nodes} />
    </div>
    <script type="application/json" id="normalize-props" dangerouslySetInnerHTML={{ __html: serializeProps(data, reconcile, nodes) }} />
    <script type="module" src="/admin/islands/normalize.js" />
  </Layout>
);
