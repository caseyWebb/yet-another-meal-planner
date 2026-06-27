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
// SEARCH: `/cookbook?q=` is keyword search ranked in the Worker over the indexed metadata
// (src/cookbook-search.ts) — no embeddings, no Workers AI. The server `?q=` page is a full
// keyword-ranked render (no-JS fallback, shareable URL); `/cookbook/search.js` enhances
// the index/search page into debounced, in-place search against the JSON endpoint
// `/cookbook/search?q=`. Clearing the box restores the index without a reload.
//
// SECURITY: a recipe body is agent-/human-authored shared content rendered to HTML on an
// open, cross-tenant surface, so it is UNTRUSTED for rendering. Defenses: (1) a `marked`
// renderer that DROPS raw HTML (no `<script>`/`onerror=`) and scheme-filters link/image
// URLs (no `javascript:`), since a recipe body is markdown and needs no raw HTML; (2) a
// per-page `Content-Security-Policy`. The recipe-body page `/cookbook/<slug>` keeps the
// STRICT no-script CSP (no `script-src` at all). The index/search page relaxes ONLY to
// `script-src 'self'; connect-src 'self'` to run the first-party search script and its
// fetch — no `'unsafe-inline'`, no third-party origin — and it renders results as escaped
// text (server) / `textContent` (client), never injecting untrusted HTML. The corpus-store
// / parse / D1 layers throw structured `ToolError`s, so the handler wraps its body in a
// try/catch (this surface has no `runTool` boundary) and maps them to a clean 404/503.

import { Marked } from "marked";
import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import { loadRecipeIndex } from "./recipe-index.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";
import { rankByKeyword, toHit, type CookbookHit } from "./cookbook-search.js";

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

// The recipe-body page renders untrusted markdown → keep the STRICT no-script CSP.
const CSP_STRICT = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'";
// The index/search page runs the first-party search script + its fetch — and nothing else:
// no `'unsafe-inline'` for script, no third-party origins.
const CSP_SEARCH =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'";

/** The one `<script>` the cookbook serves, loaded only on the index/search page. */
const SEARCH_SCRIPT_TAG = '<script src="/cookbook/search.js" defer></script>';

function htmlResponse(body: string, status: number, csp: string = CSP_STRICT): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      ...(status === 200 ? { "cache-control": "max-age=300" } : {}),
    },
  });
}

function page(title: string, bodyHtml: string, csp: string = CSP_STRICT): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${bodyHtml}</body></html>`;
  return htmlResponse(html, 200, csp);
}

function notice(status: number, heading: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(heading)}</title><style>${STYLE}</style></head>
<body><nav><a href="/cookbook">← Cookbook</a></nav><h1>${esc(heading)}</h1></body></html>`;
  return htmlResponse(html, status);
}

/** JSON for the search endpoint. Short cache — identical queries collapse at the edge. */
function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=60" },
  });
}

/** Serve the static client search script first-party (so `script-src 'self'` admits it). */
function scriptResponse(js: string): Response {
  return new Response(js, {
    status: 200,
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "max-age=3600" },
  });
}

/** One `<li>` for the recipe list — shared by the index and the server-rendered results. */
function recipeListItem(hit: CookbookHit): string {
  const chips = [hit.protein, hit.cuisine]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => `<span class="chip">${esc(v)}</span>`)
    .join("");
  const desc = hit.description ? `<div class="desc">${esc(hit.description)}</div>` : "";
  return `<li><a href="/cookbook/${esc(hit.slug)}">${esc(hit.title)}</a> ${chips}${desc}</li>`;
}

/** The search form. Works without JS (GET → `/cookbook?q=`); `search.js` enhances it into
 *  debounced, in-place search. `q` is echoed back, escaped. */
function searchForm(q: string): string {
  return `<form class="search" method="GET" action="/cookbook" role="search">
<input id="q" type="search" name="q" value="${esc(q)}" placeholder="Search recipes…" aria-label="Search recipes" autocomplete="off">
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
<div id="results"><p class="meta">${recipes.length} recipe${recipes.length === 1 ? "" : "s"}</p>
<ul class="recipes">${items || "<li>No recipes yet.</li>"}</ul></div>
${SEARCH_SCRIPT_TAG}`;
  return page("Cookbook", body, CSP_SEARCH);
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
  // unsafe URL schemes), never the default `marked`. The page keeps the strict no-script CSP.
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
  return page(title, html, CSP_STRICT);
}

// --- Keyword search (cookbook-search) ------------------------------------------------

/** The server-rendered results page (no-JS fallback + shareable `?q=` URL): the prefilled
 *  form, an "N results" heading (or a clean empty state), the shared recipe list, and the
 *  enhancement script. Always 200 — "no matches" is a normal outcome. */
function searchResultsPage(q: string, results: CookbookHit[]): Response {
  const header = `<nav><a href="/cookbook">← All recipes</a></nav>
<h1>Cookbook</h1>
${searchForm(q)}`;
  const inner =
    results.length > 0
      ? `<p class="meta">${results.length} result${results.length === 1 ? "" : "s"} for "${esc(q)}"</p>
<ul class="recipes">${results.map(recipeListItem).join("\n")}</ul>`
      : `<p class="meta">No recipes match "${esc(q)}".</p>`;
  const body = `${header}
<div id="results">${inner}</div>
${SEARCH_SCRIPT_TAG}`;
  return page(`Search · ${q}`, body, CSP_SEARCH);
}

/** Server-render keyword results for a non-empty `q` (the no-JS / shareable path). Shares
 *  `rankByKeyword` with the JSON endpoint, so the two agree on ordering. */
async function renderSearch(env: Env, q: string): Promise<Response> {
  const index = await loadRecipeIndex(env);
  return searchResultsPage(q, rankByKeyword(index, q));
}

/** The JSON search endpoint the client fetches: the ranked rows for `q`, or an empty list
 *  for an empty/no-match query (always 200). */
async function renderSearchJson(env: Env, q: string): Promise<Response> {
  if (!q) return jsonResponse({ results: [] });
  const index = await loadRecipeIndex(env);
  return jsonResponse({ results: rankByKeyword(index, q) });
}

// Debounced, in-place client search. Vanilla JS, served first-party at /cookbook/search.js.
// Renders rows from the JSON endpoint with `textContent` (never `innerHTML` for endpoint
// values); the only `innerHTML` use restores our OWN captured server-rendered index markup
// when the box is cleared. Stale responses are dropped via a sequence guard + AbortController.
const SEARCH_JS = `(function () {
  var input = document.getElementById("q");
  var results = document.getElementById("results");
  if (!input || !results) return;

  var startedWithQuery = input.value.trim() !== "";
  var initialIndex = startedWithQuery ? null : results.innerHTML;
  var timer = null;
  var controller = null;
  var seq = 0;

  function chip(text) {
    var s = document.createElement("span");
    s.className = "chip";
    s.textContent = text;
    return s;
  }

  function render(q, rows) {
    if (!rows.length) {
      var none = document.createElement("p");
      none.className = "meta";
      none.textContent = 'No recipes match "' + q + '".';
      results.replaceChildren(none);
      return;
    }
    var meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = rows.length + " result" + (rows.length === 1 ? "" : "s") + ' for "' + q + '"';
    var ul = document.createElement("ul");
    ul.className = "recipes";
    rows.forEach(function (r) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "/cookbook/" + encodeURIComponent(r.slug);
      a.textContent = r.title;
      li.appendChild(a);
      [r.protein, r.cuisine].forEach(function (v) {
        if (v) {
          li.appendChild(document.createTextNode(" "));
          li.appendChild(chip(v));
        }
      });
      if (r.description) {
        var d = document.createElement("div");
        d.className = "desc";
        d.textContent = r.description;
        li.appendChild(d);
      }
      ul.appendChild(li);
    });
    results.replaceChildren(meta, ul);
  }

  function run(q) {
    var mine = ++seq;
    if (controller) controller.abort();
    controller = new AbortController();
    fetch("/cookbook/search?q=" + encodeURIComponent(q), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (mine === seq) render(q, (data && data.results) || []);
      })
      .catch(function () {});
  }

  function clearToIndex() {
    seq++;
    if (controller) controller.abort();
    if (initialIndex !== null) results.innerHTML = initialIndex;
    else window.location.assign("/cookbook");
  }

  input.addEventListener("input", function () {
    var q = input.value.trim();
    if (timer) clearTimeout(timer);
    if (q === "") {
      clearToIndex();
      return;
    }
    timer = setTimeout(function () {
      run(q);
    }, 250);
  });

  if (input.form) {
    input.form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (timer) clearTimeout(timer);
      var q = input.value.trim();
      if (q === "") clearToIndex();
      else run(q);
    });
  }
})();
`;

/**
 * Handle a `/cookbook` request. `/cookbook` lists the corpus from the D1 index (or, with a
 * `?q=`, renders keyword search results); `/cookbook/search` is the JSON search endpoint;
 * `/cookbook/search.js` is the client script; `/cookbook/<slug>` renders one recipe's R2
 * body. Open + read-only. The render path can throw structured `ToolError`s (R2 down, D1
 * down, malformed YAML in a hand-edited recipe), so map them to a graceful 404/503 rather
 * than a 500 — there is no `runTool` boundary on this open HTML surface.
 */
export async function handleCookbook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const { pathname } = url;
  try {
    // Search routes are checked before the `/cookbook/<slug>` match (both "search" and
    // "search.js" would otherwise be read as recipe slugs).
    if (pathname === "/cookbook/search.js") return scriptResponse(SEARCH_JS);
    if (pathname === "/cookbook/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      return await renderSearchJson(env, q);
    }
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
