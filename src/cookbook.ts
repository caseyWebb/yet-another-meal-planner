// The hosted cookbook (r2-corpus-store) — the static browse view of the SHARED recipe
// corpus, now served by the Worker instead of GitHub Pages (removing the GitHub Pro
// requirement and the data-repo build-site.yml dependency). It is built from the D1
// `recipes` index (the list) + the R2 corpus (each recipe's body), server-rendered on
// request, so it always reflects the latest reconcile with no separate build/deploy.
//
// Open (no auth), like `/health`: the corpus is shared group content, not tenant-private,
// and the old Pages site was likewise a browse view. An operator who wants it gated can
// front it with Cloudflare Access (an edge concern, not Worker code). `recipe_site_url`
// resolves `<origin>/cookbook`, the host the agent points members at.

import { marked } from "marked";
import type { Env } from "./env.js";
import { loadRecipeIndex } from "./recipe-index.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
}

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
`;

function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body>${bodyHtml}</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "max-age=300" },
  });
}

/** The cookbook index: every recipe in the D1 index, titled + linked, with a short blurb. */
async function renderIndex(env: Env): Promise<Response> {
  const index = await loadRecipeIndex(env);
  const recipes = Object.values(index).sort((a, b) =>
    String(a.title ?? a.slug).localeCompare(String(b.title ?? b.slug)),
  );
  const items = recipes
    .map((r) => {
      const chips = [r.protein, r.cuisine]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map((v) => `<span class="chip">${esc(v)}</span>`)
        .join("");
      const desc = typeof r.description === "string" ? `<div class="desc">${esc(r.description)}</div>` : "";
      return `<li><a href="/cookbook/${esc(r.slug)}">${esc(r.title ?? r.slug)}</a> ${chips}${desc}</li>`;
    })
    .join("\n");
  const body = `<h1>Cookbook</h1>
<p class="meta">${recipes.length} recipe${recipes.length === 1 ? "" : "s"}</p>
<ul class="recipes">${items || "<li>No recipes yet.</li>"}</ul>`;
  return page("Cookbook", body);
}

/** One recipe page: its R2 body rendered to HTML, with a title + meta line from frontmatter. */
async function renderRecipe(env: Env, slug: string): Promise<Response> {
  const store = createR2CorpusStore(env.CORPUS);
  const text = await store.getFile(`recipes/${slug}.md`);
  if (text === null) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const { frontmatter, body } = parseMarkdown(text, `recipes/${slug}.md`);
  const title = typeof frontmatter.title === "string" ? frontmatter.title : slug;
  const meta = [frontmatter.protein, frontmatter.cuisine, frontmatter.time_total ? `${frontmatter.time_total} min` : null]
    .filter((v): v is string | number => v != null && v !== "")
    .map((v) => esc(v))
    .join(" · ");
  const bodyHtml = await marked.parse(body);
  const source = typeof frontmatter.source === "string" ? frontmatter.source : null;
  const sourceLine = source ? `<p class="meta">Source: <a href="${esc(source)}">${esc(source)}</a></p>` : "";
  const html = `<nav><a href="/cookbook">← Cookbook</a></nav>
<h1>${esc(title)}</h1>
${meta ? `<p class="meta">${meta}</p>` : ""}
${sourceLine}
${bodyHtml}`;
  return page(title, html);
}

function notFoundHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title><style>${STYLE}</style></head>
<body><nav><a href="/cookbook">← Cookbook</a></nav><h1>Recipe not found</h1></body></html>`;
}

/**
 * Handle a `/cookbook` request. `/cookbook` lists the corpus from the D1 index;
 * `/cookbook/<slug>` renders one recipe's R2 body. Open + read-only.
 */
export async function handleCookbook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { pathname } = new URL(request.url);
  if (pathname === "/cookbook" || pathname === "/cookbook/") return renderIndex(env);
  const m = pathname.match(/^\/cookbook\/([^/]+)\/?$/);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    if (!SLUG_RE.test(slug)) {
      return new Response(notFoundHtml(), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return renderRecipe(env, slug);
  }
  return new Response("Not found", { status: 404 });
}
