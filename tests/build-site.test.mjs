// Tests for scripts/build-site.mjs — generation, ordering, sections, links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSite,
  loadRecipes,
  orderRecipes,
  renderBody,
  renderComponents,
  renderRecipePage,
  renderIndexPage,
  facetValues,
  facetCss,
  escapeHtml,
} from '../scripts/build-site.mjs';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'site-assets');

const fm = (o) =>
  '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n';
const body = '\n## Ingredients\n\n- a\n- b\n\n## Instructions\n\n1. one\n2. two\n';

async function tmpRecipes(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'site-test-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

// --- helpers -------------------------------------------------------------

test('escapeHtml escapes the five HTML-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('orderRecipes puts active before draft, alphabetical within group', () => {
  const out = orderRecipes([
    { title: 'Zebra', slug: 'zebra', status: 'active' },
    { title: 'Apple', slug: 'apple', status: 'draft' },
    { title: 'Mango', slug: 'mango', status: 'active' },
  ]);
  assert.deepEqual(out.map((r) => r.slug), ['mango', 'zebra', 'apple']);
});

test('facetValues sorts difficulty by easy/medium/hard, others alpha', () => {
  const recipes = [
    { difficulty: 'hard', cuisine: 'thai' },
    { difficulty: 'easy', cuisine: 'italian' },
    { difficulty: 'medium', cuisine: 'thai' },
  ];
  assert.deepEqual(facetValues(recipes, 'difficulty'), ['easy', 'medium', 'hard']);
  assert.deepEqual(facetValues(recipes, 'cuisine'), ['italian', 'thai']);
});

// --- body rendering ------------------------------------------------------

test('renderBody emits labeled sections, ul ingredients, ol instructions', () => {
  const { sectionsHtml, stepCount } = renderBody(body);
  assert.match(sectionsHtml, /<section class="section-ingredients" aria-labelledby="sec-ingredients">/);
  assert.match(sectionsHtml, /<ul class="ingredients">/);
  assert.match(sectionsHtml, /<input type="checkbox">/);
  assert.match(sectionsHtml, /<ol class="instructions">/);
  assert.equal(stepCount, 2);
});

test('renderBody renders extra H2 sections generically (no generator change)', () => {
  const { sectionsHtml } = renderBody(body + '\n## Notes\n\nMake **ahead**. See [x](http://y).\n');
  assert.match(sectionsHtml, /<section class="section-generic" aria-labelledby="sec-notes">/);
  assert.match(sectionsHtml, /<strong>ahead<\/strong>/);
  assert.match(sectionsHtml, /<a href="http:\/\/y">x<\/a>/);
});

// --- components ----------------------------------------------------------

test('renderComponents links producer→consumers and consumer→producer', () => {
  const components = { 'fresh-pasta': { produced_by: ['pasta'], used_by: ['pasta', 'lasagna'] } };
  const titleOf = (s) => ({ pasta: 'Pasta', lasagna: 'Lasagna' }[s]);
  const producer = renderComponents(
    { slug: 'pasta', produces_components: ['fresh-pasta'], uses_components: [] }, components, titleOf);
  assert.match(producer, /Makes a component used in: <a href="lasagna.html">Lasagna<\/a>/);
  assert.ok(!producer.includes('pasta.html')); // self excluded

  const consumer = renderComponents(
    { slug: 'lasagna', produces_components: [], uses_components: ['fresh-pasta'] }, components, titleOf);
  assert.match(consumer, /Builds on: <a href="pasta.html">Pasta<\/a>/);
});

test('renderComponents emits nothing when there are no relationships', () => {
  assert.equal(
    renderComponents({ slug: 'x', produces_components: [], uses_components: [] }, {}, () => 'X'),
    ''
  );
});

// --- recipe page surface -------------------------------------------------

test('recipe page hides rating/last_cooked, shows source, handles null time', () => {
  const recipe = {
    slug: 'r', title: 'R', status: 'active', time_total: null, difficulty: 'easy',
    cuisine: 'italian', tags: ['x'], rating: 5, last_cooked: '2025-01-01',
    source: 'https://example.com/r', content: body, produces_components: [], uses_components: [],
  };
  const html = renderRecipePage(recipe, {}, () => 'R');
  assert.ok(!html.includes('rating'));
  assert.ok(!html.includes('last_cooked'));
  assert.ok(!html.includes('2025-01-01'));
  assert.match(html, /unknown/); // null time placeholder
  assert.match(html, /href="https:\/\/example\.com\/r"/);
});

test('facetCss generates an AND-semantics hide rule per facet value', () => {
  const css = facetCss([{ protein: 'beef', difficulty: 'easy', cuisine: 'american', dietary: [] }]);
  assert.match(css, /body:has\(#f-protein-beef:checked\) \.recipes > li:not\(\[data-protein~="beef"\]\) \{ display: none; \}/);
  assert.match(css, /#f-difficulty-easy:checked/);
  assert.match(css, /#f-cuisine-american:checked/);
});

// --- full build ----------------------------------------------------------

test('buildSite excludes rejected/archived, emits page-per-recipe + assets', async () => {
  const dir = await tmpRecipes({
    'keep.md': fm({ title: 'Keep', status: 'active' }) + body,
    'draft.md': fm({ title: 'Draft', status: 'draft' }) + body,
    'gone.md': fm({ title: 'Gone', status: 'rejected' }) + body,
    'old.md': fm({ title: 'Old', status: 'archived' }) + body,
  });
  const { files, recipeCount } = await buildSite({ recipesDir: dir, componentsPath: '/nonexistent', assetsDir: ASSETS });
  assert.equal(recipeCount, 2);
  assert.ok(files.has('keep.html'));
  assert.ok(files.has('draft.html'));
  assert.ok(!files.has('gone.html'));
  assert.ok(!files.has('old.html'));
  assert.ok(files.has('index.html') && files.has('style.css') && files.has('sw.js') && files.has('manifest.webmanifest'));
  await rm(dir, { recursive: true, force: true });
});

test('buildSite output is deterministic across runs', async () => {
  const dir = await tmpRecipes({ 'a.md': fm({ title: 'A', status: 'active' }) + body });
  const one = await buildSite({ recipesDir: dir, componentsPath: '/nonexistent', assetsDir: ASSETS });
  const two = await buildSite({ recipesDir: dir, componentsPath: '/nonexistent', assetsDir: ASSETS });
  for (const k of one.files.keys()) assert.equal(one.files.get(k), two.files.get(k), `file ${k} differs`);
  await rm(dir, { recursive: true, force: true });
});

test('loadRecipes keeps body content and slug, drops excluded', async () => {
  const dir = await tmpRecipes({
    'a.md': fm({ title: 'A', status: 'active' }) + body,
    'b.md': fm({ title: 'B', status: 'rejected' }) + body,
  });
  const recipes = await loadRecipes(dir);
  assert.deepEqual(recipes.map((r) => r.slug), ['a']);
  assert.match(recipes[0].content, /## Ingredients/);
  await rm(dir, { recursive: true, force: true });
});

test('index page is host-neutral (no absolute internal refs)', () => {
  const html = renderIndexPage([{ slug: 'a', title: 'A', status: 'active', tags: [], time_total: 10, difficulty: 'easy', protein: 'beef', cuisine: 'american', dietary: [] }]);
  assert.ok(!/(href|src)="\/[^/]/.test(html));
  assert.match(html, /href="a\.html"/);
});
