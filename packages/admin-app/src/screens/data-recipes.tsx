// Data › Recipes (operator-data-explorer): the keyword/hybrid search list + the cross-tier
// recipe detail, ported from the SSR pages/data.tsx onto the parameterized reads. Search,
// mode, page, and page size are SERVER-side — the screen renders the payload's `hits` as-is
// and every toolbar control navigates with new search params (defaults omitted, so the
// plain-list URL stays clean); `keepPreviousData` keeps the previous page rendered while the
// next loads. The detail's markdown body arrives Worker-rendered (`payload.html`) and the
// frontmatter pre-parsed (`payload.frontmatter`) — no client-side markdown or YAML.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@grocery-agent/ui";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Item,
  ItemGroup,
  Pager,
  PrettyKV,
  StageTrack,
  TierBadge,
  type StageSpec,
} from "../components/kit";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XCircleIcon } from "../components/icons";
import { recipesQuery, recipeDetailQuery, type RecipesData, type RecipeDetailData } from "../lib/queries";
import { assertNever } from "../lib/assert";
import { DataShell, queryErrorMessage } from "./data";

// --- search params -------------------------------------------------------------

const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

type RecipesMode = "keyword" | "hybrid";
type RecipesPageSize = (typeof PAGE_SIZES)[number];

/** The Recipes list URL state — every field optional, present ONLY when non-default
 *  (q "", mode keyword, page 1, size 50 are omitted), so the plain-list URL stays clean
 *  and `navigate`/`Link` omit defaults structurally (`undefined` never serializes). */
export interface RecipesSearch {
  q?: string;
  mode?: "hybrid";
  /** 1-based in the URL (the read takes 0-based). */
  page?: number;
  size?: 25 | 100;
}

/** Validate the `/data(/recipes)` search params (shared by both list routes). */
export function validateRecipesSearch(s: Record<string, unknown>): RecipesSearch {
  const page = Number(s.page);
  const size = Number(s.size);
  return {
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
    mode: s.mode === "hybrid" ? "hybrid" : undefined,
    page: Number.isFinite(page) && page >= 2 ? Math.floor(page) : undefined,
    size: size === 25 || size === 100 ? size : undefined,
  };
}

/** Build the list's search params for a given query/mode/1-based page/size, omitting
 *  default-valued params (the SSR `recipesHref` convention). `size` is preserved across
 *  search/pagination whenever it differs from the default. */
function recipesSearch(q: string, mode: RecipesMode, page: number, size: RecipesPageSize): RecipesSearch {
  return {
    q: q || undefined,
    mode: mode === "hybrid" ? "hybrid" : undefined,
    page: page >= 2 ? page : undefined,
    size: size === DEFAULT_PAGE_SIZE ? undefined : size,
  };
}

// --- Recipes list ----------------------------------------------------------------

const STATUS_DOT: Record<string, string> = {
  indexed: "ok",
  skipped: "fail",
  pending: "never",
  orphaned: "muted",
};

type RecipeHit = RecipesData["hits"][number];

const FacetChips = ({ hit }: { hit: RecipeHit }) => {
  const items = [hit.protein, hit.cuisine, hit.time_total != null ? `${hit.time_total} min` : null].filter(
    (f): f is string => Boolean(f),
  );
  if (items.length === 0) return null;
  return (
    <span className="rfacets">
      {items.map((f) => (
        <span key={f} className="rfacet">
          {f}
        </span>
      ))}
    </span>
  );
};

/** The controlled search box — remounted via `key={q}` by the caller so the draft resets
 *  whenever the URL's q changes (a Clear click, a deep link). Submit navigates with the
 *  new q and a page reset, preserving mode + size. */
function RecipeSearchForm({ q, mode, size }: { q: string; mode: RecipesMode; size: RecipesPageSize }) {
  const navigate = useNavigate();
  const [draft, setDraft] = React.useState(q);
  return (
    <form
      className="recipe-search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ to: "/data/recipes", search: recipesSearch(draft, mode, 1, size) });
      }}
    >
      <SearchIcon size={15} />
      <input
        className="recipe-search-input"
        type="text"
        name="q"
        placeholder="Search recipes…"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
      {q ? (
        <Link className="recipe-search-clear" to="/data/recipes" search={recipesSearch("", mode, 1, size)} aria-label="Clear">
          <XCircleIcon size={15} />
        </Link>
      ) : null}
    </form>
  );
}

const RecipesList = ({ data, q, mode, size }: { data: RecipesData; q: string; mode: RecipesMode; size: RecipesPageSize }) => (
  <>
    <p className="recipe-hint muted small">
      {data.total} {data.total === 1 ? "recipe" : "recipes"}
      {q && mode === "hybrid" ? " · ranked by relevance — hybrid surfaces semantically-related dishes" : null}
      {q && mode === "keyword" ? " · keyword match over indexed metadata" : null}
      {!q ? " in the corpus and index" : null}
    </p>

    {data.resolvedMode === "hybrid-degraded" ? (
      <Alert className="my-3">
        <AlertDescription>Semantic ranking unavailable (Workers AI) — showing keyword matches.</AlertDescription>
      </Alert>
    ) : null}

    {data.hits.length === 0 ? (
      <p className="muted">
        No recipes match "{q}". {mode === "keyword" ? "Try Hybrid for related dishes." : null}
      </p>
    ) : (
      <ItemGroup className="recipe-list">
        {data.hits.map((hit) => (
          <Link key={hit.slug} className="item-link" to="/data/recipes/$slug" params={{ slug: hit.slug }}>
            <Item
              outline
              className="recipe-item"
              media={<span className={`rdot dot ${STATUS_DOT[hit.status]}`} />}
              title={
                <span className="rtitle">
                  {hit.title ?? hit.slug}
                  {hit.semantic ? (
                    <span className="rsem" title="Surfaced semantically">
                      semantic
                    </span>
                  ) : null}
                </span>
              }
              actions={
                <div className="ritem-trail">
                  {hit.score != null ? (
                    <span className="relbar" title={`relevance ${Math.round(hit.score * 100)}%`}>
                      <span className="relbar-fill" style={{ width: `${Math.round(hit.score * 100)}%` }} />
                    </span>
                  ) : null}
                  <TierBadge status={hit.status} />
                  <ChevronRightIcon size={16} />
                </div>
              }
            >
              <div className="rsub">
                <span className="rslug">{hit.slug}</span>
                <FacetChips hit={hit} />
              </div>
            </Item>
          </Link>
        ))}
      </ItemGroup>
    )}

    {data.pages > 1 ? (
      <Pager
        info={`Page ${data.page + 1} of ${data.pages} · ${data.page * data.size + 1}–${Math.min(
          data.total,
          data.page * data.size + data.size,
        )} of ${data.total}`}
        prev={
          data.page > 0 ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/data/recipes" search={recipesSearch(q, mode, data.page, size)}>
                <ChevronLeftIcon size={15} /> Prev
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              <ChevronLeftIcon size={15} /> Prev
            </Button>
          )
        }
        next={
          data.page < data.pages - 1 ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/data/recipes" search={recipesSearch(q, mode, data.page + 2, size)}>
                Next <ChevronRightIcon size={15} />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next <ChevronRightIcon size={15} />
            </Button>
          )
        }
      />
    ) : null}
  </>
);

/** The Recipes list screen (both `/data` and `/data/recipes`). The toolbar is URL-driven
 *  and stays mounted across fetches; the hint/list/pager render from the primary query. */
export function RecipesListScreen({ search }: { search: RecipesSearch }) {
  const q = search.q ?? "";
  const mode: RecipesMode = search.mode ?? "keyword";
  const page = search.page ?? 1;
  const size: RecipesPageSize = search.size ?? DEFAULT_PAGE_SIZE;
  const query = useQuery(recipesQuery({ q, mode, page: page - 1, size }));

  const body = (() => {
    switch (query.status) {
      case "pending":
        return <p className="screen-loading">Loading …</p>;
      case "error":
        return <ErrorBanner message={queryErrorMessage(query.error)} />;
      case "success":
        return <RecipesList data={query.data} q={q} mode={mode} size={size} />;
      default:
        return assertNever(query);
    }
  })();

  return (
    <DataShell active="recipes">
      <h2>Recipes</h2>
      <div className="recipe-toolbar">
        <RecipeSearchForm key={q} q={q} mode={mode} size={size} />
        <div className="seg" role="tablist" aria-label="Search mode">
          <Link
            className={mode === "keyword" ? "seg-btn active" : "seg-btn"}
            to="/data/recipes"
            search={recipesSearch(q, "keyword", 1, size)}
          >
            Keyword
          </Link>
          <Link
            className={mode === "hybrid" ? "seg-btn active" : "seg-btn"}
            to="/data/recipes"
            search={recipesSearch(q, "hybrid", 1, size)}
          >
            Hybrid
          </Link>
        </div>
        <div className="seg" role="tablist" aria-label="Page size">
          {PAGE_SIZES.map((s) => (
            <Link
              key={s}
              className={s === size ? "seg-btn active" : "seg-btn"}
              to="/data/recipes"
              search={recipesSearch(q, mode, 1, s)}
            >
              {s}
            </Link>
          ))}
        </div>
      </div>
      {body}
    </DataShell>
  );
}

// --- Recipe detail ----------------------------------------------------------------

/** The recipe detail's pipeline stages (index / description / embedding). */
const RECIPE_STAGES: StageSpec[] = [
  { key: "index", label: "index" },
  { key: "description", label: "description" },
  { key: "embedding", label: "embedding" },
];

/** Where the derivation pipeline halted for this recipe (-1 = not yet at index;
 *  2 = fully through) — the SSR `pipelineHalt`, over the read's payload. */
function pipelineHalt(d: RecipeDetailData): number {
  if (d.status === "pending" || d.status === "skipped") return -1; // not yet at index
  if (d.derived?.state !== "described") return 0; // indexed, description pending
  if (!d.derived.has_embedding) return 1; // described, embedding pending
  return 2; // fully through the pipeline
}

const RecipeDetail = ({ payload }: { payload: RecipeDetailData }) => {
  const halt = pipelineHalt(payload);
  const frontmatter = payload.frontmatter as Record<string, unknown> | null;
  const title =
    (frontmatter?.title as string | undefined) ?? (payload.projection?.title as string | undefined) ?? payload.slug;

  return (
    <DataShell active="recipes" detail>
      <Link className="link-action rd-back" to="/data/recipes">
        <ChevronLeftIcon size={15} /> All recipes
      </Link>

      <div className="rd-head">
        <div>
          <h2 className="rd-title">{title}</h2>
          <div className="rd-slug">{payload.slug}</div>
        </div>
        <TierBadge status={payload.status} />
      </div>

      {payload.reconcile_message ? (
        <Alert variant="destructive" className="my-3">
          <AlertTitle>Skipped at reconcile</AlertTitle>
          <AlertDescription>{payload.reconcile_message}</AlertDescription>
        </Alert>
      ) : null}

      {halt >= 0 ? (
        <div className="rd-pipeline">
          <StageTrack stages={RECIPE_STAGES} haltIndex={halt === 2 ? 3 : halt} kind="defer" imported={halt === 2} />
        </div>
      ) : null}

      <p className="group-label">Derived description</p>
      <Card>
        {payload.derived?.description ? (
          <p className="rd-desc">{payload.derived.description}</p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Not yet generated — the recipe-embed cron writes the AI description on its next pass.
          </p>
        )}
      </Card>

      <p className="group-label">Recipe</p>
      <Card>
        {payload.html ? (
          <div className="md" dangerouslySetInnerHTML={{ __html: payload.html }} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            The R2 source object is gone — this is a stale projection (orphaned). The recipe-index cron will prune the
            row on its next pass.
          </p>
        )}
      </Card>

      <p className="group-label">
        Notes <span className="muted small">({payload.notes.length})</span>
      </p>
      {payload.notes.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          No attributed notes yet.
        </p>
      ) : (
        <div className="rd-notes">
          {payload.notes.map((n, i) => {
            const tags: string[] = Array.isArray(n.tags) ? (n.tags as string[]) : [];
            return (
              <div key={i} className="rd-note">
                <div className="rd-note-head">
                  <span className="rd-note-author">@{String(n.author ?? "")}</span>
                  {n.private ? <Badge variant="outline">private</Badge> : null}
                  {tags.map((t) => (
                    <span key={t} className="rfacet">
                      {t}
                    </span>
                  ))}
                  <span className="rd-note-time muted small">{String(n.created_at ?? "")}</span>
                </div>
                <div className="rd-note-body">{String(n.body ?? "")}</div>
              </div>
            );
          })}
        </div>
      )}

      <p className="group-label">
        R2 frontmatter <span className="muted small">recipes/{payload.slug}.md</span>
      </p>
      <Card>
        <PrettyKV obj={frontmatter} />
      </Card>

      <p className="group-label">
        D1 index row <span className="muted small">recipes</span>
      </p>
      <Card>
        {payload.projection ? (
          <PrettyKV obj={payload.projection} />
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Not in the index —{" "}
            {payload.status === "pending" ? "reconcile hasn't run yet." : "skipped at reconcile (see the reason above)."}
          </p>
        )}
      </Card>

      {payload.status !== "orphaned" && payload.source ? (
        <details className="rd-raw">
          <summary>
            <span className="rd-raw-caret">
              <ChevronRightIcon size={14} />
            </span>
            View raw R2 markdown
            <span className="muted small">recipes/{payload.slug}.md</span>
          </summary>
          <pre className="rd-raw-pre">{payload.source}</pre>
        </details>
      ) : null}
    </DataShell>
  );
};

export function RecipeDetailScreen({ slug }: { slug: string }) {
  const query = useQuery(recipeDetailQuery(slug));
  switch (query.status) {
    case "pending":
      return <p className="screen-loading">Loading …</p>;
    case "error":
      return <ErrorBanner message={queryErrorMessage(query.error)} />;
    case "success":
      return <RecipeDetail payload={query.data} />;
    default:
      return assertNever(query);
  }
}
