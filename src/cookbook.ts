// The hosted cookbook (r2-corpus-store) — the browse view of the SHARED recipe corpus,
// served by the Worker. It is built from the D1 `recipes` index (the list) + the R2
// corpus (each recipe's body), server-rendered on request, so it always reflects the
// latest reconcile.
//
// Open (no auth), like `/health`: the corpus is shared group content, not tenant-private.
// An operator who wants it gated can front it with Cloudflare Access (an edge concern,
// not Worker code). `recipe_site_url` resolves `<origin>/cookbook`, the host the agent
// points members at.
//
// SECURITY: the recipe body is agent-/human-authored shared content rendered to HTML on
// an open, cross-tenant surface, so it is UNTRUSTED for rendering. Two defenses: (1) a
// `marked` renderer that DROPS raw HTML (no `<script>`/`onerror=`) and scheme-filters
// link/image URLs (no `javascript:`), since a recipe body is markdown and needs no raw
// HTML; (2) a restrictive `Content-Security-Policy` (no script at all) as defense in
// depth. The corpus-store / parse / D1 layers throw structured `ToolError`s, so the
// handler wraps its body in a try/catch (this surface has no `runTool` boundary) and maps
// them to a clean 404/503 instead of a 500.

import { Marked } from "marked";
import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "./recipe-index.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";
import { embedText, EMBED_DIM } from "./embedding.js";
import { filterRecipes } from "./recipes.js";
import {
  COOKBOOK_K,
  DEFAULT_SIMILARITY_FLOOR,
  mergeCookbookResults,
  normalizeQuery,
  queryVectorCacheKey,
  type CookbookHit,
  type EmbeddedCandidate,
} from "./cookbook-search.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Allow only http(s), root-relative, and fragment URLs; everything else (javascript:, data:, …) → "#". */
function safeUrl(u: unknown): string {
  const s = typeof u === "string" ? u.trim() : "";
  return /^https?:\/\//i.test(s) || s.startsWith("/") || s.startsWith("#") ? s : "#";
}

// A markdown renderer for UNTRUSTED bodies: raw HTML is dropped (recipes are markdown, not
// HTML), and link/image URLs are scheme-filtered. Module-level (reused across requests).
const md = new Marked({
  renderer: {
    html() {
      return ""; // drop raw HTML blocks + inline HTML entirely
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const t = title ? ` title="${esc(title)}"` : "";
      return `<a href="${esc(safeUrl(href))}"${t}>${text}</a>`;
    },
    image({ href, title, text }) {
      const t = title ? ` title="${esc(title)}"` : "";
      return `<img src="${esc(safeUrl(href))}" alt="${esc(text)}"${t}>`;
    },
  },
});

const STYLE = `
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:48rem;margin:0 auto;padding:1.5rem;line-height:1.6}
a{color:#c2410c;text-decoration:none}a:hover{text-decoration:underline}
h1{margin-bottom:.25rem}
.meta{color:#6b7280;font-size:.9rem}
ul.recipes{list-style:none;padding:0}
ul.recipes li{padding:.6rem 0;border-bottom:1px solid #e5e7eb}
.chip{display:inline-block;background:#fef3c7;color:#92400e;border-radius:999px;padding:.05rem .5rem;font-size:.75rem;margin-right:.25rem}
.desc{color:#374151}
nav{margin-bottom:1rem}
form.search{display:flex;gap:.5rem;margin:1rem 0}
form.search input[type=search]{flex:1;min-width:0;padding:.4rem .6rem;font-size:1rem}
form.search button{padding:.4rem .9rem;font-size:1rem;cursor:pointer}
`;

// No script at all (script-src defaults to 'none' under default-src 'none'); inline styles
// only; images over https/data. A second line of defense behind the sanitizing renderer.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'";

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      ...(status === 200 ? { "cache-control": "max-age=300" } : {}),
    },
  });
}

function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${bodyHtml}</body></html>`;
  return htmlResponse(html, 200);
}

function notice(status: number, heading: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(heading)}</title><style>${STYLE}</style></head>
<body><nav><a href="/cookbook">← Cookbook</a></nav><h1>${esc(heading)}</h1></body></html>`;
  return htmlResponse(html, status);
}

/** A loose index entry / search hit → the compact shape the list renderer needs. */
function toHit(r: Record<string, unknown>): CookbookHit {
  return {
    slug: String(r.slug),
    title: typeof r.title === "string" && r.title.length > 0 ? r.title : String(r.slug),
    description: typeof r.description === "string" ? r.description : null,
    protein: typeof r.protein === "string" ? r.protein : null,
    cuisine: typeof r.cuisine === "string" ? r.cuisine : null,
  };
}

/** One `<li>` for the recipe list — shared by the index and the search results. */
function recipeListItem(hit: CookbookHit): string {
  const chips = [hit.protein, hit.cuisine]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => `<span class="chip">${esc(v)}</span>`)
    .join("");
  const desc = hit.description ? `<div class="desc">${esc(hit.description)}</div>` : "";
  return `<li><a href="/cookbook/${esc(hit.slug)}">${esc(hit.title)}</a> ${chips}${desc}</li>`;
}

/** The server-rendered search form (GET → `/cookbook?q=…`). No script — a plain form,
 *  so the restrictive no-script CSP is unaffected. `q` is echoed back, escaped. */
function searchForm(q: string): string {
  return `<form class="search" method="GET" action="/cookbook" role="search">
<input type="search" name="q" value="${esc(q)}" placeholder="Search recipes…" aria-label="Search recipes">
<button type="submit">Search</button>
</form>`;
}

/** The cookbook index: every recipe in the D1 index, titled + linked, with a short blurb. */
async function renderIndex(env: Env): Promise<Response> {
  const index = await loadRecipeIndex(env);
  const recipes = Object.values(index)
    .map(toHit)
    .sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
  const items = recipes.map(recipeListItem).join("\n");
  const body = `<h1>Cookbook</h1>
${searchForm("")}
<p class="meta">${recipes.length} recipe${recipes.length === 1 ? "" : "s"}</p>
<ul class="recipes">${items || "<li>No recipes yet.</li>"}</ul>`;
  return page("Cookbook", body);
}

/** One recipe page: its R2 body rendered to HTML, with a title + meta line from frontmatter. */
async function renderRecipe(env: Env, slug: string): Promise<Response> {
  const store = createR2CorpusStore(env.CORPUS);
  const text = await store.getFile(`recipes/${slug}.md`);
  if (text === null) return notice(404, "Recipe not found");
  const { frontmatter, body } = parseMarkdown(text, `recipes/${slug}.md`);
  const title = typeof frontmatter.title === "string" ? frontmatter.title : slug;
  const meta = [frontmatter.protein, frontmatter.cuisine, frontmatter.time_total ? `${frontmatter.time_total} min` : null]
    .filter((v): v is string | number => v != null && v !== "")
    .map((v) => esc(v))
    .join(" · ");
  // The body is UNTRUSTED — render through the sanitizing `md` instance (no raw HTML, no
  // unsafe URL schemes), never the default `marked`.
  const bodyHtml = await md.parse(body);
  // Only show the source as a link when it is a safe http(s) URL; a non-http scheme
  // (e.g. a `javascript:` injection) is dropped rather than rendered even as inert text.
  const source = typeof frontmatter.source === "string" ? frontmatter.source : null;
  const safeSource = source && /^https?:\/\//i.test(source.trim()) ? source.trim() : null;
  const sourceLine = safeSource
    ? `<p class="meta">Source: <a href="${esc(safeSource)}">${esc(safeSource)}</a></p>`
    : "";
  const html = `<nav><a href="/cookbook">← Cookbook</a></nav>
<h1>${esc(title)}</h1>
${meta ? `<p class="meta">${meta}</p>` : ""}
${sourceLine}
${bodyHtml}`;
  return page(title, html);
}

// --- Hybrid search (cookbook-search) -------------------------------------------------

/** Query vectors are stable — they change only when EMBED_MODEL changes, which re-keys
 *  the cache — so they can be held a long while; a miss simply re-embeds. */
const QVEC_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Read a query's cached embedding vector, or null on a miss. A parse/shape mismatch is
 *  treated as a miss (self-healing — the next search re-embeds), never a throw. */
async function getCachedQueryVector(env: Env, q: string): Promise<number[] | null> {
  const raw = await env.KROGER_KV.get(queryVectorCacheKey(q));
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v) && v.length === EMBED_DIM && v.every((n) => typeof n === "number")) {
      return v as number[];
    }
  } catch {
    // fall through to a miss
  }
  return null;
}

/** Write-through a freshly embedded query vector under the model+query key, with a TTL. */
async function putCachedQueryVector(env: Env, q: string, vec: number[]): Promise<void> {
  await env.KROGER_KV.put(queryVectorCacheKey(q), JSON.stringify(vec), {
    expirationTtl: QVEC_TTL_SECONDS,
  });
}

/** Resolve the query's embedding: a cache hit skips Workers AI entirely; a miss embeds the
 *  NORMALIZED query (matching the cache key) and write-through caches it (best-effort — a
 *  cache write failure must not fail the search). */
async function resolveQueryVector(env: Env, q: string): Promise<number[]> {
  const cached = await getCachedQueryVector(env, q);
  if (cached !== null) return cached;
  const vec = await embedText(env, normalizeQuery(q));
  await putCachedQueryVector(env, q, vec).catch(() => {});
  return vec;
}

/** The search results page: the prefilled form, an "N results" heading (or a clean empty
 *  state), and the shared recipe list. Always 200 — "no matches" is a normal outcome. */
function searchResultsPage(q: string, results: CookbookHit[]): Response {
  const header = `<nav><a href="/cookbook">← All recipes</a></nav>
<h1>Cookbook</h1>
${searchForm(q)}`;
  const body =
    results.length > 0
      ? `${header}
<p class="meta">${results.length} result${results.length === 1 ? "" : "s"} for "${esc(q)}"</p>
<ul class="recipes">${results.map(recipeListItem).join("\n")}</ul>`
      : `${header}
<p class="meta">No recipes match "${esc(q)}".</p>`;
  return page(`Search · ${q}`, body);
}

/**
 * Render hybrid search results for a non-empty `q`. The SUBSTRING tier (title+tags, the
 * same match `search_recipes` membership runs — `owned: []`, so nothing is gated on this
 * anonymous surface) is always computed. The SEMANTIC tier is best-effort and NEVER
 * load-bearing: any failure loading the embeddings or embedding the query (Workers AI
 * down, empty embed index) disables it and the substring results render alone. The index
 * load itself can still throw → the caller maps it to a 503, exactly like the index page.
 */
async function renderSearch(env: Env, q: string): Promise<Response> {
  const index = await loadRecipeIndex(env);
  const substring: CookbookHit[] = filterRecipes(index, { query: q }).map((r) =>
    toHit(r.frontmatter),
  );

  let queryVec: number[] | null = null;
  let candidates: EmbeddedCandidate[] = [];
  try {
    const embeddings = await loadRecipeEmbeddings(env);
    for (const r of Object.values(index)) {
      const vec = embeddings.get(String(r.slug));
      if (vec) candidates.push({ ...toHit(r), embedding: vec });
    }
    // Embed only when there is something to rank — skips the Workers AI call (and the
    // cache write) when no embedded recipe survived into the current index.
    if (candidates.length > 0) {
      queryVec = await resolveQueryVector(env, q);
    }
  } catch {
    // Semantic tier unavailable — fall back to substring-only (graceful degradation).
    queryVec = null;
    candidates = [];
  }

  const results = mergeCookbookResults(
    substring,
    candidates,
    queryVec,
    DEFAULT_SIMILARITY_FLOOR,
    COOKBOOK_K,
  );
  return searchResultsPage(q, results);
}

/**
 * Handle a `/cookbook` request. `/cookbook` lists the corpus from the D1 index (or, with a
 * `?q=`, renders hybrid search results); `/cookbook/<slug>` renders one recipe's R2 body.
 * Open + read-only. The render path can throw structured `ToolError`s (R2 down, D1 down,
 * malformed YAML in a hand-edited recipe), so map them to a graceful 404/503 rather than a
 * 500 — there is no `runTool` boundary on this open HTML surface.
 */
export async function handleCookbook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const { pathname } = url;
  try {
    if (pathname === "/cookbook" || pathname === "/cookbook/") {
      const q = (url.searchParams.get("q") ?? "").trim();
      return q ? await renderSearch(env, q) : await renderIndex(env);
    }
    const m = pathname.match(/^\/cookbook\/([^/]+)\/?$/);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      if (!SLUG_RE.test(slug)) return notice(404, "Recipe not found");
      return await renderRecipe(env, slug);
    }
    return new Response("Not found", { status: 404 });
  } catch (e) {
    const code = e instanceof ToolError ? e.code : "";
    // A bad upstream (R2/D1) is transient → 503; a malformed recipe (bad YAML) → 404.
    if (code === "upstream_unavailable" || code === "storage_error") {
      return notice(503, "The cookbook is temporarily unavailable");
    }
    if (code === "malformed_data" || code === "not_found") return notice(404, "Recipe not found");
    return notice(500, "Something went wrong");
  }
}
