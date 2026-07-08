// The Data explorer area (operator-data-explorer), server-rendered. Three purpose-built
// explorers over D1 + the R2 corpus — Recipes (keyword/hybrid search + cross-tier detail),
// Stores (the shared registry + per-store identity/SKU/notes detail), and Guidance (a
// breadcrumb browser over the R2 `guidance/**` tree). Pure SSR: search/mode/pagination and
// detail all ride query/path params, so every state is deep-linkable — no islands, it's all
// reads. Members/Corpus/Discovery/System are NOT here: member data lives at `/admin/members`,
// the corpus lookup tables (aliases/flyer_terms/feeds) are the Config area's shared-corpus
// editors, Discovery's tables are the `/admin/discovery` area, and System (reconcile_errors/
// bug_reports/schema_meta) has no redesigned home yet — deliberately deferred, inspectable via
// `wrangler d1 execute` in the interim (see design.md).

import type { Child } from "hono/jsx";
import { Hono } from "hono";
import { Layout } from "../ui/layout.js";
import { Item, ItemGroup, Badge, TierBadge, Pager, PrettyKV, StageTrack, type StageSpec } from "../ui/kit.js";
import { parseMarkdownDocument, renderMarkdown } from "../markdown.js";
import { SearchIcon, XCircleIcon, ChevronLeftIcon, ChevronRightIcon, StoreIcon, FolderIcon, FileTextIcon } from "../ui/icons.js";
import type { Env } from "../../env.js";
import { parseMarkdown } from "../../parse.js";
import {
  recipeList,
  recipeDetail,
  recipeFacets,
  searchRecipes,
  storeList,
  storeDetail,
  guidanceListing,
  guidanceObject,
  type RecipeDetail,
  type RecipeListEntry,
  type RecipeSearchResult,
  type SearchMode,
  type StoreListEntry,
  type StoreDetail,
  type StoreNoteGroup,
  type StoreNoteRow,
  type GuidanceListing,
} from "../../admin-data.js";

const VIEWS = [
  { slug: "recipes", label: "Recipes" },
  { slug: "stores", label: "Stores" },
  { slug: "guidance", label: "Guidance" },
] as const;

/** The Recipes list page-size selector's offered values and default (operator-data-explorer's
 *  "configurable page size, default 50" delta — replaces the old fixed `PAGE_SIZE = 6`). */
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 50;

/** Parse a `?size=` query value to one of `PAGE_SIZES`, defaulting to `DEFAULT_PAGE_SIZE` for
 *  anything absent/unrecognized (never a caller-controlled arbitrary page size). */
function parsePageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function html(node: { toString(): string }): string {
  return "<!doctype html>" + node.toString();
}

// --- shell --------------------------------------------------------------------

/** The Data area shell. `active` selects the sub-nav pill; `detail` hides the sub-nav
 *  entirely so an open record owns the full width (operator-data-explorer's "sub-nav hides
 *  behind an open detail" requirement). */
const DataShell = ({ active, detail, children }: { active: string; detail?: boolean; children?: Child }) => (
  <Layout title="Data · grocery-agent admin" active="/admin/data" wide>
    {!detail ? (
      <div class="data-nav">
        {VIEWS.map((v) => (
          <a href={`/admin/data/${v.slug}`} class={v.slug === active ? "pill active" : "pill"}>
            {v.label}
          </a>
        ))}
      </div>
    ) : null}
    {children}
  </Layout>
);

// --- Recipes --------------------------------------------------------------------

const STATUS_DOT: Record<string, string> = {
  indexed: "ok",
  skipped: "fail",
  pending: "never",
  orphaned: "muted",
};

/** Build the `/admin/data/recipes` href for a given query/mode/page/size (omits default-valued
 *  params so the plain-list URL stays clean, matching Discovery's `href` convention). `size` is
 *  preserved across search/pagination whenever it differs from the default, so a page-size
 *  choice survives a search or a Prev/Next click (deep-linkable, per the page-size delta). */
function recipesHref(query: string, mode: SearchMode, page: number, size: number = DEFAULT_PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (mode !== "keyword") params.set("mode", mode);
  if (page > 0) params.set("page", String(page + 1));
  if (size !== DEFAULT_PAGE_SIZE) params.set("size", String(size));
  const qs = params.toString();
  return qs ? `/admin/data/recipes?${qs}` : "/admin/data/recipes";
}

function facetChips(r: RecipeListEntry & { protein?: string | null; cuisine?: string | null; time_total?: number | null }): Child {
  const items = [r.protein, r.cuisine, r.time_total != null ? `${r.time_total} min` : null].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <span class="rfacets">
      {items.map((f) => (
        <span class="rfacet">{f}</span>
      ))}
    </span>
  );
}

/** The joined shape a search hit's row needs: the `recipeList` entry plus facet fields the
 *  hit itself doesn't carry (score/semantic do). One bulk facet read, not a per-row fetch. */
interface RecipeRow extends RecipeListEntry {
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
}

const RecipesListPage = ({
  rows,
  search,
  query,
  mode,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: {
  rows: Map<string, RecipeRow>;
  search: RecipeSearchResult;
  query: string;
  mode: SearchMode;
  page: number;
  pageSize?: number;
}) => {
  const results = search.results.filter((h) => rows.has(h.slug));
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const pg = Math.min(page, pages - 1);
  const shown = results.slice(pg * pageSize, pg * pageSize + pageSize);

  return (
    <DataShell active="recipes">
      <h2>Recipes</h2>
      <div class="recipe-toolbar">
        <form class="recipe-search" method="get" action="/admin/data/recipes">
          <SearchIcon size={15} />
          <input class="recipe-search-input" type="text" name="q" placeholder="Search recipes…" value={query} />
          {mode !== "keyword" ? <input type="hidden" name="mode" value={mode} /> : null}
          {query ? (
            <a class="recipe-search-clear" href={recipesHref("", mode, 0, pageSize)} aria-label="Clear">
              <XCircleIcon size={15} />
            </a>
          ) : null}
        </form>
        <div class="seg" role="tablist" aria-label="Search mode">
          <a class={mode === "keyword" ? "seg-btn active" : "seg-btn"} href={recipesHref(query, "keyword", 0, pageSize)}>
            Keyword
          </a>
          <a class={mode === "hybrid" ? "seg-btn active" : "seg-btn"} href={recipesHref(query, "hybrid", 0, pageSize)}>
            Hybrid
          </a>
        </div>
        <div class="seg" role="tablist" aria-label="Page size">
          {PAGE_SIZES.map((s) => (
            <a class={s === pageSize ? "seg-btn active" : "seg-btn"} href={recipesHref(query, mode, 0, s)}>
              {s}
            </a>
          ))}
        </div>
      </div>

      <p class="recipe-hint muted small">
        {results.length} {results.length === 1 ? "recipe" : "recipes"}
        {query && mode === "hybrid" ? " · ranked by relevance — hybrid surfaces semantically-related dishes" : null}
        {query && mode === "keyword" ? " · keyword match over indexed metadata" : null}
        {!query ? " in the corpus and index" : null}
      </p>

      {search.mode === "hybrid-degraded" ? (
        <div class="alert">
          <section>Semantic ranking unavailable (Workers AI) — showing keyword matches.</section>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p class="muted">
          No recipes match "{query}". {mode === "keyword" ? "Try Hybrid for related dishes." : null}
        </p>
      ) : (
        <ItemGroup class="recipe-list">
          {shown.map(({ slug, score, semantic }) => {
            const r = rows.get(slug)!;
            return (
              <a class="item-link" href={`/admin/data/recipes/${encodeURIComponent(slug)}`}>
                <Item
                  outline
                  class="recipe-item"
                  media={<span class={`rdot dot ${STATUS_DOT[r.status]}`} />}
                  title={
                    <span class="rtitle">
                      {r.title ?? slug}
                      {semantic ? (
                        <span class="rsem" title="Surfaced semantically">
                          semantic
                        </span>
                      ) : null}
                    </span>
                  }
                  actions={
                    <div class="ritem-trail">
                      {score != null ? (
                        <span class="relbar" title={`relevance ${Math.round(score * 100)}%`}>
                          <span class="relbar-fill" style={`width:${Math.round(score * 100)}%`} />
                        </span>
                      ) : null}
                      <TierBadge status={r.status} />
                      <ChevronRightIcon size={16} />
                    </div>
                  }
                >
                  <div class="rsub">
                    <span class="rslug">{slug}</span>
                    {facetChips(r)}
                  </div>
                </Item>
              </a>
            );
          })}
        </ItemGroup>
      )}

      {pages > 1 ? (
        <Pager
          info={`Page ${pg + 1} of ${pages} · ${pg * pageSize + 1}–${Math.min(results.length, pg * pageSize + pageSize)} of ${results.length}`}
          prev={
            pg > 0 ? (
              <a class="btn" data-variant="outline" data-size="sm" href={recipesHref(query, mode, pg - 1, pageSize)}>
                <ChevronLeftIcon size={15} /> Prev
              </a>
            ) : (
              <button class="btn" data-variant="outline" data-size="sm" disabled>
                <ChevronLeftIcon size={15} /> Prev
              </button>
            )
          }
          next={
            pg < pages - 1 ? (
              <a class="btn" data-variant="outline" data-size="sm" href={recipesHref(query, mode, pg + 1, pageSize)}>
                Next <ChevronRightIcon size={15} />
              </a>
            ) : (
              <button class="btn" data-variant="outline" data-size="sm" disabled>
                Next <ChevronRightIcon size={15} />
              </button>
            )
          }
        />
      ) : null}
    </DataShell>
  );
};

/** The recipe detail's pipeline stages (index / description / embedding). */
const RECIPE_STAGES: StageSpec[] = [
  { key: "index", label: "index" },
  { key: "description", label: "description" },
  { key: "embedding", label: "embedding" },
];

function pipelineHalt(d: RecipeDetail): number {
  if (d.status === "pending" || d.status === "skipped") return -1; // not yet at index
  if (d.derived?.state !== "described") return 0; // indexed, description pending
  if (!d.derived.has_embedding) return 1; // described, embedding pending
  return 2; // fully through the pipeline
}

const RecipeDetailPage = ({ detail }: { detail: RecipeDetail }) => {
  const halt = pipelineHalt(detail);
  const frontmatter = detail.source ? parseMarkdown(detail.source, "recipe source").frontmatter : null;
  const title = (frontmatter?.title as string | undefined) ?? (detail.projection?.title as string | undefined) ?? detail.slug;

  return (
    <DataShell active="recipes" detail>
      <a class="link-action rd-back" href="/admin/data/recipes">
        <ChevronLeftIcon size={15} /> All recipes
      </a>

      <div class="rd-head">
        <div>
          <h2 class="rd-title">{title}</h2>
          <div class="rd-slug">{detail.slug}</div>
        </div>
        <TierBadge status={detail.status} />
      </div>

      {detail.reconcile_message ? (
        <div class="alert" data-variant="destructive">
          <section>
            <h2>Skipped at reconcile</h2>
            <p>{detail.reconcile_message}</p>
          </section>
        </div>
      ) : null}

      {halt >= 0 ? (
        <div class="rd-pipeline">
          <StageTrack stages={RECIPE_STAGES} haltIndex={halt === 2 ? 3 : halt} kind="defer" imported={halt === 2} />
        </div>
      ) : null}

      <p class="group-label">Derived description</p>
      <div class="card">
        <section>
          {detail.derived?.description ? (
            <p class="rd-desc">{detail.derived.description}</p>
          ) : (
            <p class="muted" style="margin:0">
              Not yet generated — the recipe-embed cron writes the AI description on its next pass.
            </p>
          )}
        </section>
      </div>

      <p class="group-label">Recipe</p>
      <div class="card">
        <section>
          {detail.status !== "orphaned" && detail.body ? (
            <div class="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.body) }} />
          ) : (
            <p class="muted" style="margin:0">
              The R2 source object is gone — this is a stale projection (orphaned). The recipe-index cron will
              prune the row on its next pass.
            </p>
          )}
        </section>
      </div>

      <p class="group-label">
        Notes <span class="muted small">({detail.notes.length})</span>
      </p>
      {detail.notes.length === 0 ? (
        <p class="muted" style="margin-top:0">
          No attributed notes yet.
        </p>
      ) : (
        <div class="rd-notes">
          {detail.notes.map((n) => {
            const tags: string[] = Array.isArray(n.tags) ? (n.tags as string[]) : [];
            return (
              <div class="rd-note">
                <div class="rd-note-head">
                  <span class="rd-note-author">@{String(n.author ?? "")}</span>
                  {n.private ? <Badge variant="outline">private</Badge> : null}
                  {tags.map((t) => (
                    <span class="rfacet">{t}</span>
                  ))}
                  <span class="rd-note-time muted small">{String(n.created_at ?? "")}</span>
                </div>
                <div class="rd-note-body">{String(n.body ?? "")}</div>
              </div>
            );
          })}
        </div>
      )}

      <p class="group-label">
        R2 frontmatter <span class="muted small">recipes/{detail.slug}.md</span>
      </p>
      <div class="card">
        <section>
          <PrettyKV obj={frontmatter} />
        </section>
      </div>

      <p class="group-label">
        D1 index row <span class="muted small">recipes</span>
      </p>
      <div class="card">
        <section>
          {detail.projection ? (
            <PrettyKV obj={detail.projection} />
          ) : (
            <p class="muted" style="margin:0">
              Not in the index — {detail.status === "pending" ? "reconcile hasn't run yet." : "skipped at reconcile (see the reason above)."}
            </p>
          )}
        </section>
      </div>

      {detail.status !== "orphaned" && detail.source ? (
        <details class="rd-raw">
          <summary>
            <span class="rd-raw-caret">
              <ChevronRightIcon size={14} />
            </span>
            View raw R2 markdown
            <span class="muted small">recipes/{detail.slug}.md</span>
          </summary>
          <pre class="rd-raw-pre">{detail.source}</pre>
        </details>
      ) : null}
    </DataShell>
  );
};

// --- Stores -----------------------------------------------------------------

const StoresListPage = ({ stores }: { stores: StoreListEntry[] }) => (
  <DataShell active="stores">
    <h2>Stores</h2>
    <p class="recipe-hint muted small">{stores.length} stores in the shared registry</p>
    {stores.length === 0 ? (
      <p class="muted">No stores in the shared registry.</p>
    ) : (
      <ItemGroup class="recipe-list">
        {stores.map((s) => (
          <a class="item-link" href={`/admin/data/stores/${encodeURIComponent(s.slug)}`}>
            <Item
              outline
              class="recipe-item"
              media={
                <span class="store-ico">
                  <StoreIcon size={16} />
                </span>
              }
              title={<span class="rtitle">{s.name}</span>}
              actions={
                <div class="ritem-trail">
                  {s.chain ? <Badge variant="secondary">{s.chain}</Badge> : null}
                  <ChevronRightIcon size={16} />
                </div>
              }
            >
              <div class="rsub">
                <span class="rslug">{s.slug}</span>
                <span class="rfacets">
                  {s.domain ? <span class="rfacet">{s.domain}</span> : null}
                  <span class="rfacet">{s.notes_count} notes</span>
                  {s.skus_count > 0 ? <span class="rfacet">{s.skus_count} SKUs</span> : null}
                </span>
              </div>
            </Item>
          </a>
        ))}
      </ItemGroup>
    )}
  </DataShell>
);

const STORE_NOTE_GROUP_LABEL: Record<StoreNoteGroup, string> = {
  layout: "Layout",
  location: "Where-it-hides",
  stock: "Stock",
  general: "General",
};

const StoreNoteCards = ({ notes }: { notes: StoreNoteRow[] }) => (
  <div class="rd-notes">
    {notes.map((n) => (
      <div class="rd-note">
        <div class="rd-note-head">
          <span class="rd-note-author">@{n.author}</span>
          {n.private ? <Badge variant="outline">private</Badge> : null}
          {n.tags.map((t) => (
            <span class="rfacet">{t}</span>
          ))}
          <span class="rd-note-time muted small">{n.created_at ?? ""}</span>
        </div>
        <div class="rd-note-body">{n.body}</div>
      </div>
    ))}
  </div>
);

const StoreDetailPage = ({ detail }: { detail: StoreDetail }) => {
  const identity = {
    chain: detail.chain,
    label: detail.label,
    domain: detail.domain,
    address: detail.address,
    location_id: detail.location_id,
  };
  const noteCount = (Object.values(detail.notes) as StoreNoteRow[][]).reduce((n, g) => n + g.length, 0);

  return (
    <DataShell active="stores" detail>
      <a class="link-action rd-back" href="/admin/data/stores">
        <ChevronLeftIcon size={15} /> All stores
      </a>

      <div class="rd-head">
        <div>
          <h2 class="rd-title">{detail.name}</h2>
          <div class="rd-slug">{detail.slug}</div>
        </div>
        {detail.chain ? <Badge variant="secondary">{detail.chain}</Badge> : null}
      </div>

      <p class="group-label">Identity</p>
      <div class="card">
        <section>
          <PrettyKV obj={identity} />
        </section>
      </div>

      <p class="group-label">
        Cached SKUs <span class="muted small">sku_cache · location {detail.location_id ?? "—"}</span>
      </p>
      {detail.skus.length > 0 ? (
        <div class="card usage-card">
          <section>
            <table class="table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Brand</th>
                  <th style="text-align:right">Size</th>
                  <th>SKU</th>
                  <th style="text-align:right">Last used</th>
                </tr>
              </thead>
              <tbody>
                {detail.skus.map((k) => (
                  <tr>
                    <td>{k.ingredient}</td>
                    <td>{k.brand ?? "—"}</td>
                    <td style="text-align:right">{k.size ?? "—"}</td>
                    <td>
                      <span class="sku-code">{k.sku}</span>
                    </td>
                    <td style="text-align:right">
                      <span class="muted small">{k.last_used ?? "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : (
        <p class="muted" style="margin-top:0">
          No cached SKUs — {detail.location_id ? "none looked up yet at this location." : "not a Kroger location, so SKU lookups don't apply here."}
        </p>
      )}

      <p class="group-label">
        Store notes <span class="muted small">({noteCount})</span>
      </p>
      {(["layout", "location", "stock", "general"] as StoreNoteGroup[]).map((g) =>
        detail.notes[g].length === 0 ? null : (
          <div class="store-note-group">
            <div class="store-note-label">{STORE_NOTE_GROUP_LABEL[g]}</div>
            <StoreNoteCards notes={detail.notes[g]} />
          </div>
        ),
      )}
    </DataShell>
  );
};

// --- Guidance -----------------------------------------------------------------

function joinPrefix(prefix: string, name: string): string {
  return prefix ? `${prefix.replace(/\/$/, "")}/${name}` : name;
}

/** The breadcrumb segments from a `guidance/**` prefix: `["cooking_techniques", "salt.md"]`
 *  style path parts (root "guidance/" stripped), for both the folder view and a file view. */
function crumbSegments(path: string): string[] {
  return path.replace(/^guidance\/?/, "").replace(/\/$/, "").split("/").filter(Boolean);
}

const GuidanceBreadcrumb = ({ segments, fileSeg }: { segments: string[]; fileSeg?: string }) => (
  <div class="g-crumbs">
    <a class="g-crumb" href="/admin/data/guidance">
      guidance
    </a>
    {segments.map((seg, i) => (
      <>
        <span class="g-crumb-sep">/</span>
        <a class="g-crumb" href={`/admin/data/guidance?gprefix=${encodeURIComponent(segments.slice(0, i + 1).join("/"))}`}>
          {seg}
        </a>
      </>
    ))}
    {fileSeg ? (
      <>
        <span class="g-crumb-sep">/</span>
        <span class="g-crumb current">{fileSeg}</span>
      </>
    ) : null}
  </div>
);

type GuidanceView = { kind: "listing"; prefix: string; listing: GuidanceListing } | { kind: "object"; path: string; markdown: string };

const GuidancePage = ({ view }: { view: GuidanceView }) => {
  if (view.kind === "object") {
    const segments = crumbSegments(view.path);
    const fileSeg = segments.pop();
    const doc = parseMarkdownDocument(view.markdown, "guidance object");
    return (
      <DataShell active="guidance" detail>
        <a class="link-action rd-back" href={`/admin/data/guidance${segments.length ? `?gprefix=${encodeURIComponent(segments.join("/"))}` : ""}`}>
          <ChevronLeftIcon size={15} /> Back
        </a>
        <GuidanceBreadcrumb segments={segments} fileSeg={fileSeg} />
        <p class="group-label">{view.path}</p>
        {doc.frontmatter ? (
          <div class="card">
            <section>
              <PrettyKV obj={doc.frontmatter} />
            </section>
          </div>
        ) : null}
        <div class="card">
          <section>
            <div class="md" dangerouslySetInnerHTML={{ __html: doc.html }} />
          </section>
        </div>
      </DataShell>
    );
  }

  const segments = crumbSegments(view.prefix);
  const dirs = view.listing.entries.filter((e) => e.type === "dir");
  const files = view.listing.entries.filter((e) => e.type === "file");

  return (
    <DataShell active="guidance">
      <h2>Guidance</h2>
      <GuidanceBreadcrumb segments={segments} />
      <ul class="g-list">
        {dirs.map((d) => (
          <li class="g-row g-dir">
            <a href={`/admin/data/guidance?gprefix=${encodeURIComponent(joinPrefix(view.prefix, d.name))}`}>
              <span class="g-ico g-ico-dir">
                <FolderIcon size={16} />
              </span>
              <span class="g-name">{d.name}</span>
              <ChevronRightIcon size={15} />
            </a>
          </li>
        ))}
        {files.map((f) => (
          <li class="g-row g-file">
            <a href={`/admin/data/guidance?gpath=${encodeURIComponent(joinPrefix(view.prefix, f.name))}`}>
              <span class="g-ico g-ico-file">
                <FileTextIcon size={16} />
              </span>
              <span class="g-name">{f.name}</span>
              <span class="g-meta muted small">markdown</span>
              <ChevronRightIcon size={15} />
            </a>
          </li>
        ))}
      </ul>
    </DataShell>
  );
};

// --- route registration ------------------------------------------------------

async function renderRecipesList(c: { env: Env; req: { query(key: string): string | undefined } }): Promise<string> {
  const query = c.req.query("q") ?? "";
  const mode: SearchMode = c.req.query("mode") === "hybrid" ? "hybrid" : "keyword";
  const page = Math.max(0, Number(c.req.query("page") ?? "1") - 1);
  const pageSize = parsePageSize(c.req.query("size"));
  const [{ recipes }, search, facetRows] = await Promise.all([
    recipeList(c.env),
    searchRecipes(c.env, query, mode),
    recipeFacets(c.env),
  ]);
  const rows = new Map<string, RecipeRow>(
    recipes.map((r) => [r.slug, { ...r, ...(facetRows.get(r.slug) ?? { protein: null, cuisine: null, time_total: null }) }]),
  );
  return html(<RecipesListPage rows={rows} search={search} query={query} mode={mode} page={page} pageSize={pageSize} />);
}

export function registerDataRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/data", async (c) => c.html(await renderRecipesList(c)));
  app.get("/data/recipes", async (c) => c.html(await renderRecipesList(c)));
  app.get("/data/recipes/:slug", async (c) => {
    const detail = await recipeDetail(c.env, decodeURIComponent(c.req.param("slug")));
    return c.html(html(<RecipeDetailPage detail={detail} />));
  });

  app.get("/data/stores", async (c) => {
    const { stores } = await storeList(c.env);
    return c.html(html(<StoresListPage stores={stores} />));
  });
  app.get("/data/stores/:slug", async (c) => {
    const detail = await storeDetail(c.env, decodeURIComponent(c.req.param("slug")));
    return c.html(html(<StoreDetailPage detail={detail} />));
  });

  app.get("/data/guidance", async (c) => {
    const gpath = c.req.query("gpath");
    if (gpath) {
      const obj = await guidanceObject(c.env, gpath);
      return c.html(html(<GuidancePage view={{ kind: "object", path: obj.key, markdown: obj.markdown }} />));
    }
    const prefix = c.req.query("gprefix") ?? "";
    const listing = await guidanceListing(c.env, prefix || undefined);
    return c.html(html(<GuidancePage view={{ kind: "listing", prefix, listing }} />));
  });
}

// Exported for unit tests (rendering the views with fixed data).
export { RecipesListPage, RecipeDetailPage, StoresListPage, StoreDetailPage, GuidancePage, pipelineHalt };
