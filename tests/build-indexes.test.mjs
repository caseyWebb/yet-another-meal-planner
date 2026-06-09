// Tests for scripts/build-indexes.mjs — index shapes, determinism, validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRecipeIndexes,
  buildReadyToEatIndex,
  parseCheckToml,
  stableStringify,
  normalizeValue,
  deriveSlug,
  hasH2Section,
} from '../scripts/build-indexes.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'recipes');

async function tmpRecipes(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'grocery-test-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

// Bodies carry the required `## Ingredients` / `## Instructions` sections by
// default so a fixture exercises one validation axis at a time; pass `body` to
// override (e.g. to test the missing-section rule).
const SECTIONS = `\n## Ingredients\n\n- x\n\n## Instructions\n\n1. do it\n`;
const recipe = (fm, body = SECTIONS) => `---\n${fm}\n---\n${body}`;

// --- 4.2 index shapes from fixtures -------------------------------------

test('builds recipe + component indexes from fixtures', async () => {
  const { recipes, components, errors, warnings } = await buildRecipeIndexes(FIXTURES);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []); // fixtures have all recommended fields

  assert.deepEqual(
    Object.keys(recipes).sort(),
    ['experimental-tofu', 'kimchi-fried-rice', 'salmon-with-rice']
  );

  const salmon = recipes['salmon-with-rice'];
  assert.equal(salmon.slug, 'salmon-with-rice');
  assert.equal(salmon.status, 'active');
  assert.equal(salmon.produces_components[0], 'cooked-rice');

  // all statuses carried, including draft
  assert.equal(recipes['experimental-tofu'].status, 'draft');

  // component adjacency
  assert.deepEqual(components['cooked-rice'], {
    produced_by: ['salmon-with-rice'],
    used_by: ['kimchi-fried-rice'],
  });
});

test('ready_to_eat index has stable meal-keyed shape', () => {
  const { ready_to_eat } = buildReadyToEatIndex({
    dinner: { items: [{ name: 'x', status: 'active' }], variety_rules: { max_per_category_per_week: 2 } },
  });
  assert.deepEqual(ready_to_eat.dinner.items, [{ name: 'x', status: 'active' }]);
  assert.equal(ready_to_eat.dinner.variety_rules.max_per_category_per_week, 2);
});

// --- 4.3 determinism + date normalization -------------------------------

test('output is deterministic across runs', async () => {
  const a = await buildRecipeIndexes(FIXTURES);
  const b = await buildRecipeIndexes(FIXTURES);
  assert.equal(stableStringify(a.recipes), stableStringify(b.recipes));
  assert.equal(stableStringify(a.components), stableStringify(b.components));
});

test('date fields normalized to YYYY-MM-DD strings', async () => {
  const { recipes } = await buildRecipeIndexes(FIXTURES);
  const v = recipes['salmon-with-rice'].last_cooked;
  assert.equal(typeof v, 'string');
  assert.equal(v, '2025-04-15');
});

test('normalizeValue converts nested Date instances', () => {
  const out = normalizeValue({ a: new Date('2025-01-02T00:00:00Z'), b: [new Date('2025-03-04T00:00:00Z')] });
  assert.deepEqual(out, { a: '2025-01-02', b: ['2025-03-04'] });
});

test('deriveSlug strips .md and directory', () => {
  assert.equal(deriveSlug('recipes/foo/bar.md'), 'bar');
});

// --- 4.4 validation: each hard-fail trips, soft only warns --------------

test('hard-fail: invalid status enum', async () => {
  const dir = await tmpRecipes({ 'bad.md': recipe('title: Bad\nstatus: in-progress') });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('status')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: missing title', async () => {
  const dir = await tmpRecipes({ 'notitle.md': recipe('status: active') });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('title')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: duplicate slug across nested dirs', async () => {
  const dir = await tmpRecipes({
    'a/dup.md': recipe('title: A\nstatus: active'),
    'b/dup.md': recipe('title: B\nstatus: active'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('duplicate slug')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: unresolved component reference', async () => {
  const dir = await tmpRecipes({
    'user.md': recipe('title: User\nstatus: active\nuses_components: [ghost-component]'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('unresolved component')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: unparseable frontmatter', async () => {
  const dir = await tmpRecipes({ 'broken.md': '---\ntitle: [unclosed\n---\nbody\n' });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('parse')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('soft: missing recommended fields warns but does not fail', async () => {
  const dir = await tmpRecipes({ 'sparse.md': recipe('title: Sparse\nstatus: active') });
  const { errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('recommended')), warnings.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('producing a component with no consumer is allowed', async () => {
  const dir = await tmpRecipes({
    'producer.md': recipe('title: P\nstatus: active\nprotein: fish\ntime_total: 10\ningredients_key: [x]\nproduces_components: [extra-rice]'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
});

// --- required body sections (structural contract) -----------------------

test('hasH2Section detects ATX H2 headings, ignores other levels', () => {
  assert.ok(hasH2Section('## Ingredients\n- a', 'Ingredients'));
  assert.ok(hasH2Section('intro\n\n##   Instructions  \n1. go', 'Instructions'));
  assert.ok(!hasH2Section('### Ingredients', 'Ingredients')); // H3, not H2
  assert.ok(!hasH2Section('## Ingredients list', 'Ingredients')); // not an exact label
  assert.ok(!hasH2Section('no headings here', 'Ingredients'));
});

test('hard-fail: missing Ingredients section reports file + section', async () => {
  const dir = await tmpRecipes({
    'noing.md': recipe('title: NoIng\nstatus: active', '\n## Instructions\n\n1. go\n'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(
    errors.some((e) => e.includes('noing.md') && e.includes('## Ingredients')),
    errors.join('\n')
  );
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: missing Instructions section reports file + section', async () => {
  const dir = await tmpRecipes({
    'noinstr.md': recipe('title: NoInstr\nstatus: active', '\n## Ingredients\n\n- x\n'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(
    errors.some((e) => e.includes('noinstr.md') && e.includes('## Instructions')),
    errors.join('\n')
  );
  await rm(dir, { recursive: true, force: true });
});

test('extra H2 sections beyond the required two are allowed', async () => {
  const dir = await tmpRecipes({
    'notes.md': recipe(
      'title: Notes\nstatus: active\nprotein: fish\ntime_total: 10\ningredients_key: [x]',
      '\n## Ingredients\n\n- x\n\n## Instructions\n\n1. go\n\n## Notes\n\nMake ahead.\n'
    ),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
});

// --- TOML parse-check ----------------------------------------------------

test('hard-fail: unparseable TOML', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'grocery-toml-'));
  await writeFile(path.join(dir, 'broken.toml'), 'this = = invalid');
  const { errors } = await parseCheckToml(dir);
  assert.ok(errors.some((e) => e.includes('TOML')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});
