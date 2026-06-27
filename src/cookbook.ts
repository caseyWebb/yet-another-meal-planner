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
import { loadRecipeIndex } from "./recipe-index.js";
import { createR2CorpusStore } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";

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

/**
 * Handle a `/cookbook` request. `/cookbook` lists the corpus from the D1 index;
 * `/cookbook/<slug>` renders one recipe's R2 body. Open + read-only. The render path can
 * throw structured `ToolError`s (R2 down, D1 down, malformed YAML in a hand-edited
 * recipe), so map them to a graceful 404/503 rather than a 500 — there is no `runTool`
 * boundary on this open HTML surface.
 */
export async function handleCookbook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const { pathname } = new URL(request.url);
  try {
    if (pathname === "/cookbook" || pathname === "/cookbook/") return await renderIndex(env);
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
