#!/usr/bin/env node
// build-site.mjs — static site generator for the recipe corpus.
//
// Reads recipes/*.md (frontmatter via gray-matter, body via marked) and the
// component adjacency in _indexes/components.json, then emits a static site/:
// one index page, one page per recipe, plus copied client assets, a web app
// manifest and a content-hashed service worker. No framework, no bundler.
//
// Mirrors build-indexes.mjs: ESM, hand-rolled, deterministic (sorted iteration,
// stable formatting) so an unchanged corpus produces byte-identical output. All
// internal links and asset refs are relative, so the output is host-neutral and
// works unchanged from a /<repo>/ subpath. site/ is built in CI, never committed.
//
// Usage:
//   node scripts/build-site.mjs            # build _indexes-derived site/ from recipes/
//   node scripts/build-site.mjs --out DIR  # write to DIR instead of site/

import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS_DIR = path.join(REPO_ROOT, 'scripts', 'site-assets');
const EXCLUDED_STATUS = new Set(['rejected', 'archived']);
const STATIC_ASSETS = ['style.css', 'search.js', 'read-aloud.js', 'icon-192.svg', 'icon-512.svg'];
const FACET_AXES = ['protein', 'difficulty', 'cuisine', 'dietary'];
const DIFFICULTY_ORDER = { easy: 0, medium: 1, hard: 2 };
const THEME_COLOR = '#f4a259';

// --- pure helpers --------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function deriveSlug(filename) {
  return path.basename(filename, '.md');
}

// Case-insensitive title sort with slug tiebreak for total ordering.
export function compareByTitle(a, b) {
  const t = a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
  return t !== 0 ? t : a.slug.localeCompare(b.slug);
}

// Index order: active before draft, each group alphabetical by title.
export function orderRecipes(recipes) {
  const rank = (r) => (r.status === 'active' ? 0 : 1);
  return [...recipes].sort((a, b) => rank(a) - rank(b) || compareByTitle(a, b));
}

function asArray(v) {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

// --- markdown body -> sectioned HTML ------------------------------------

// Split lexed tokens into H2-delimited groups. Returns [{ heading, tokens }];
// any leading content before the first H2 lands under a null heading.
export function groupByH2(tokens) {
  const groups = [];
  let current = { heading: null, tokens: [] };
  for (const tok of tokens) {
    if (tok.type === 'heading' && tok.depth === 2) {
      if (current.heading !== null || current.tokens.length) groups.push(current);
      current = { heading: tok.text, tokens: [] };
    } else {
      current.tokens.push(tok);
    }
  }
  if (current.heading !== null || current.tokens.length) groups.push(current);
  return groups;
}

// Render a list item's inline content. Tight items are a single `text` token
// carrying inline tokens; loose/complex items fall back to a full block render.
function renderItemInline(parser, item) {
  if (item.tokens.length === 1 && item.tokens[0].type === 'text' && item.tokens[0].tokens) {
    return parser.parseInline(item.tokens[0].tokens);
  }
  return parser.parse(item.tokens).trim().replace(/^<p>|<\/p>$/g, '');
}

function slugifyHeading(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Build the recipe body HTML and the count of instruction steps.
export function renderBody(content) {
  const parser = new marked.Parser();
  const tokens = marked.lexer(content);
  const groups = groupByH2(tokens);
  let stepCount = 0;
  const sections = [];

  for (const g of groups) {
    if (g.heading == null) continue; // ignore stray pre-section content
    const id = `sec-${slugifyHeading(g.heading)}`;
    const lc = g.heading.toLowerCase();
    const list = g.tokens.find((t) => t.type === 'list');

    if (lc === 'ingredients' && list) {
      const items = list.items.map(
        (it) =>
          `      <li><label><input type="checkbox"> <span>${renderItemInline(parser, it)}</span></label></li>`
      );
      sections.push(
        `    <section class="section-ingredients" aria-labelledby="${id}">\n` +
          `      <h2 id="${id}">${escapeHtml(g.heading)}</h2>\n` +
          `      <ul class="ingredients">\n${items.join('\n')}\n      </ul>\n` +
          `    </section>`
      );
    } else if (lc === 'instructions' && list) {
      stepCount = list.items.length;
      const items = list.items.map((it) => `        <li>${renderItemInline(parser, it)}</li>`);
      sections.push(
        `    <section class="section-instructions" aria-labelledby="${id}">\n` +
          `      <h2 id="${id}">${escapeHtml(g.heading)}</h2>\n` +
          `      <ol class="instructions">\n${items.join('\n')}\n      </ol>\n` +
          `    </section>`
      );
    } else {
      const inner = parser.parse(g.tokens).trim();
      sections.push(
        `    <section class="section-generic" aria-labelledby="${id}">\n` +
          `      <h2 id="${id}">${escapeHtml(g.heading)}</h2>\n` +
          `      ${inner}\n` +
          `    </section>`
      );
    }
  }
  return { sectionsHtml: sections.join('\n'), stepCount };
}

// --- component cross-links ----------------------------------------------

// Bidirectional links for a recipe given the components adjacency graph.
// Producers link to consumers; consumers link to the producer(s). Returns ''
// when the recipe has no component relationships.
export function renderComponents(recipe, components, titleOf) {
  const link = (slug) => `<a href="${escapeHtml(slug)}.html">${escapeHtml(titleOf(slug) || slug)}</a>`;
  const blocks = [];

  for (const c of asArray(recipe.produces_components)) {
    const consumers = (components[c]?.used_by || []).filter((s) => s !== recipe.slug);
    if (consumers.length) {
      blocks.push(`<p>Makes a component used in: ${consumers.sort().map(link).join(', ')}.</p>`);
    }
  }
  for (const c of asArray(recipe.uses_components)) {
    const producers = (components[c]?.produced_by || []).filter((s) => s !== recipe.slug);
    if (producers.length) {
      blocks.push(`<p>Builds on: ${producers.sort().map(link).join(', ')}.</p>`);
    }
  }
  if (!blocks.length) return '';
  return (
    `    <section class="components" aria-labelledby="sec-related">\n` +
    `      <h2 id="sec-related">Related recipes</h2>\n` +
    blocks.map((b) => `      ${b}`).join('\n') +
    `\n    </section>`
  );
}

// --- page shells ---------------------------------------------------------

function head(title, { extraStyle = '' } = {}) {
  return (
    `  <meta charset="utf-8">\n` +
    `  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `  <title>${escapeHtml(title)}</title>\n` +
    `  <meta name="theme-color" content="${THEME_COLOR}">\n` +
    `  <link rel="manifest" href="manifest.webmanifest">\n` +
    `  <link rel="icon" type="image/svg+xml" href="icon-192.svg">\n` +
    `  <link rel="apple-touch-icon" href="icon-192.svg">\n` +
    `  <link rel="stylesheet" href="style.css">` +
    (extraStyle ? `\n  <style>\n${extraStyle}\n  </style>` : '')
  );
}

const SW_REGISTER =
  `  <script>if ('serviceWorker' in navigator) ` +
  `addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));</script>`;

function timeLabel(min) {
  return min == null ? 'unknown' : `${min} min`;
}

function tagRow(tags) {
  return asArray(tags)
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('');
}

// --- recipe page ---------------------------------------------------------

export function renderRecipePage(recipe, components, titleOf) {
  const { sectionsHtml, stepCount } = renderBody(recipe.content);
  const componentsHtml = renderComponents(recipe, components, titleOf);
  const hasCook = /section-ingredients/.test(sectionsHtml) && /section-instructions/.test(sectionsHtml);

  const meta = [
    `<span>${escapeHtml(timeLabel(recipe.time_total))}</span>`,
    recipe.difficulty ? `<span class="cap">${escapeHtml(recipe.difficulty)}</span>` : '',
    recipe.cuisine ? `<span class="cap">${escapeHtml(recipe.cuisine)}</span>` : '',
    recipe.servings ? `<span>serves ${escapeHtml(recipe.servings)}</span>` : '',
  ].filter(Boolean).join('\n        ');

  const source = recipe.source
    ? `    <section class="source">\n      <p>Source: <a href="${escapeHtml(recipe.source)}" rel="noopener">${escapeHtml(recipe.source)}</a></p>\n    </section>`
    : '';

  const body =
    `    <p><a class="back" href="index.html">← All recipes</a></p>\n` +
    `    <article class="recipe">\n` +
    `      <header class="recipe-head">\n` +
    `        <h1>${escapeHtml(recipe.title)}</h1>\n` +
    `        <div class="meta">\n        ${meta}\n        </div>\n` +
    (asArray(recipe.tags).length ? `        <div class="tags">${tagRow(recipe.tags)}</div>\n` : '') +
    `      </header>\n` +
    `      <div class="recipe-body${hasCook ? ' has-cook' : ''}">\n` +
    sectionsHtml +
    (componentsHtml ? `\n${componentsHtml}` : '') +
    (source ? `\n${source}` : '') +
    `\n      </div>\n` +
    `    </article>`;

  return (
    `<!doctype html>\n<html lang="en">\n<head>\n${head(`${recipe.title} — Recipes`)}\n</head>\n` +
    `<body>\n` +
    `  <a class="skip-link" href="#main">Skip to recipe</a>\n` +
    `  <main id="main" class="page">\n${body}\n  </main>\n` +
    `  <footer class="site page"><p>Built from the grocery-agent recipe corpus.</p></footer>\n` +
    `  <script src="read-aloud.js" defer></script>\n` +
    SW_REGISTER + `\n` +
    `</body>\n</html>\n`
  );
}

// --- index page ----------------------------------------------------------

// Distinct facet values present in the corpus, in display order.
export function facetValues(recipes, axis) {
  const set = new Set();
  for (const r of recipes) for (const v of asArray(r[axis])) if (v != null) set.add(v);
  const vals = [...set];
  if (axis === 'difficulty') {
    vals.sort((a, b) => (DIFFICULTY_ORDER[a] ?? 99) - (DIFFICULTY_ORDER[b] ?? 99));
  } else {
    vals.sort((a, b) => a.localeCompare(b));
  }
  return vals;
}

function facetId(axis, value) {
  return `f-${axis}-${slugifyHeading(value)}`;
}

// Data-driven facet hiding rules. Generated per-build because the values depend
// on the corpus; injected inline in the index <head>. A checked facet radio
// hides every card lacking the matching value; rules across axes stack, giving
// AND semantics with zero JavaScript. (The empty-filter message is a JS
// enhancement — see search.js — because every facet value is corpus-derived, so
// no single axis is ever empty, and pure CSS cannot detect a multi-axis-empty
// intersection. With JS off a contradictory selection yields an empty grid, the
// documented flip side of the single-select-per-axis model.)
export function facetCss(recipes) {
  const lines = [];
  for (const axis of FACET_AXES) {
    for (const v of facetValues(recipes, axis)) {
      const attr = `[data-${axis}~="${escapeHtml(v)}"]`;
      lines.push(`    body:has(#${facetId(axis, v)}:checked) .recipes > li:not(${attr}) { display: none; }`);
    }
  }
  return lines.join('\n');
}

function facetFieldset(recipes, axis, legend) {
  const vals = facetValues(recipes, axis);
  if (!vals.length) return '';
  const opt = (id, value, label, checked) =>
    `        <label><input type="radio" name="facet-${axis}" id="${id}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
  const options = [opt(`f-${axis}-all`, '', 'All', true)]
    .concat(vals.map((v) => opt(facetId(axis, v), v, v, false)))
    .join('\n');
  return (
    `      <fieldset>\n        <legend>${escapeHtml(legend)}</legend>\n` +
    `        <div class="facet-options">\n${options}\n        </div>\n      </fieldset>`
  );
}

function cuisineDetails(recipes) {
  const vals = facetValues(recipes, 'cuisine');
  if (!vals.length) return '';
  const opt = (id, label, checked) =>
    `        <label><input type="radio" name="facet-cuisine" id="${id}"${checked ? ' checked' : ''}> ${escapeHtml(label)}</label>`;
  const options = [opt('f-cuisine-all', 'All', true)]
    .concat(vals.map((v) => opt(facetId('cuisine', v), v, false)))
    .join('\n');
  return (
    `      <details class="facet-cuisine">\n        <summary>Cuisine</summary>\n` +
    `        <div class="facet-options">\n${options}\n        </div>\n      </details>`
  );
}

function recipeCard(r) {
  const data = [
    `data-status="${escapeHtml(r.status)}"`,
    `data-protein="${escapeHtml(asArray(r.protein).join(' '))}"`,
    `data-difficulty="${escapeHtml(asArray(r.difficulty).join(' '))}"`,
    `data-cuisine="${escapeHtml(asArray(r.cuisine).join(' '))}"`,
    `data-dietary="${escapeHtml(asArray(r.dietary).join(' '))}"`,
  ].join(' ');
  const haystack = [
    r.title,
    ...asArray(r.tags),
    ...asArray(r.ingredients_key),
    r.cuisine,
    r.protein,
  ].filter(Boolean).join(' ').toLowerCase();

  const meta = [
    escapeHtml(timeLabel(r.time_total)),
    r.difficulty ? `<span class="cap">${escapeHtml(r.difficulty)}</span>` : '',
  ].filter(Boolean).join(' · ');

  return (
    `      <li ${data} data-search="${escapeHtml(haystack)}">\n` +
    `        <a class="card" href="${escapeHtml(r.slug)}.html">\n` +
    `          <h2>${escapeHtml(r.title)}</h2>\n` +
    (r.status === 'draft' ? `          <span class="draft-badge">Draft</span>\n` : '') +
    `          <p class="meta">${meta}</p>\n` +
    `          <p class="tags">${tagRow(r.tags)}</p>\n` +
    `        </a>\n      </li>`
  );
}

export function renderIndexPage(recipes) {
  const ordered = orderRecipes(recipes);
  const facets = [
    facetFieldset(recipes, 'protein', 'Protein'),
    facetFieldset(recipes, 'difficulty', 'Difficulty'),
    facetFieldset(recipes, 'dietary', 'Dietary'),
    cuisineDetails(recipes),
  ].filter(Boolean).join('\n');

  const cards = ordered.map(recipeCard).join('\n');

  return (
    `<!doctype html>\n<html lang="en">\n<head>\n${head('Recipes', { extraStyle: facetCss(recipes) })}\n</head>\n` +
    `<body>\n` +
    `  <a class="skip-link" href="#main">Skip to recipes</a>\n` +
    `  <header class="site page">\n    <h1>Recipes</h1>\n` +
    `    <p>${ordered.length} recipes to cook from.</p>\n  </header>\n` +
    `  <main id="main" class="page">\n` +
    `    <form class="filters" aria-label="Filter recipes">\n${facets}\n    </form>\n` +
    `    <ul class="recipes">\n${cards}\n    </ul>\n` +
    `    <p class="empty" role="status">No recipes match these filters.</p>\n` +
    `  </main>\n` +
    `  <footer class="site page"><p>Built from the grocery-agent recipe corpus. Filtering works without JavaScript.</p></footer>\n` +
    `  <script src="search.js" defer></script>\n` +
    SW_REGISTER + `\n` +
    `</body>\n</html>\n`
  );
}

// --- manifest + service worker ------------------------------------------

export function renderManifest() {
  return JSON.stringify(
    {
      name: 'Recipes',
      short_name: 'Recipes',
      start_url: '.',
      scope: './',
      display: 'standalone',
      background_color: '#f7f3ea',
      theme_color: THEME_COLOR,
      icons: [
        { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
        { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    null,
    2
  ) + '\n';
}

// Service worker: cache-first for assets, network-first for navigations, and a
// stale-cache sweep on activate keyed by the build's content hash.
export function renderServiceWorker(hash, precache) {
  const list = JSON.stringify(precache, null, 2);
  return `// sw.js — generated by build-site.mjs; cache name busts on content change.
const CACHE = 'recipes-${hash}';
const PRECACHE = ${list};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    // Network-first so freshly deployed recipes land; fall back to cache offline.
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('index.html')))
    );
    return;
  }
  // Cache-first for static assets.
  e.respondWith(caches.match(request).then((r) => r || fetch(request)));
});
`;
}

// --- load recipes --------------------------------------------------------

async function listRecipeFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return acc;
    throw err;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listRecipeFiles(full, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push(full);
  }
  return acc.sort();
}

export async function loadRecipes(recipesDir) {
  const files = await listRecipeFiles(recipesDir);
  const recipes = [];
  for (const file of files) {
    const { data, content } = matter(await readFile(file, 'utf8'));
    if (EXCLUDED_STATUS.has(data.status)) continue;
    recipes.push({ ...data, slug: deriveSlug(file), content });
  }
  return recipes;
}

// --- orchestration -------------------------------------------------------

export async function buildSite({ recipesDir, componentsPath, assetsDir = ASSETS_DIR } = {}) {
  recipesDir ??= path.join(REPO_ROOT, 'recipes');
  componentsPath ??= path.join(REPO_ROOT, '_indexes', 'components.json');

  const recipes = await loadRecipes(recipesDir);
  let components = {};
  try {
    components = JSON.parse(await readFile(componentsPath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const titleOf = (slug) => recipes.find((r) => r.slug === slug)?.title;
  const ordered = orderRecipes(recipes);

  // Collect every output file (path -> contents) before hashing for the SW.
  const files = new Map();
  files.set('index.html', renderIndexPage(recipes));
  for (const r of ordered) files.set(`${r.slug}.html`, renderRecipePage(r, components, titleOf));
  files.set('manifest.webmanifest', renderManifest());
  for (const name of STATIC_ASSETS) {
    files.set(name, await readFile(path.join(assetsDir, name), 'utf8'));
  }

  // Content hash over sorted (path, content) → deterministic cache-busting key.
  const hash = createHash('sha256');
  for (const name of [...files.keys()].sort()) hash.update(name).update('\0').update(files.get(name));
  const digest = hash.digest('hex').slice(0, 12);

  const precache = ['index.html', ...STATIC_ASSETS, 'manifest.webmanifest', ...ordered.map((r) => `${r.slug}.html`)].sort();
  files.set('sw.js', renderServiceWorker(digest, precache));

  return { files, recipeCount: recipes.length };
}

async function writeSite(files, outDir) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  for (const name of [...files.keys()].sort()) {
    await writeFile(path.join(outDir, name), files.get(name));
  }
}

async function main() {
  const outArg = process.argv.indexOf('--out');
  const outDir = outArg !== -1 ? path.resolve(process.argv[outArg + 1]) : path.join(REPO_ROOT, 'site');

  const { files, recipeCount } = await buildSite();
  await writeSite(files, outDir);
  console.log(`site built: ${recipeCount} recipe(s), ${files.size} file(s) → ${path.relative(REPO_ROOT, outDir) || outDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
