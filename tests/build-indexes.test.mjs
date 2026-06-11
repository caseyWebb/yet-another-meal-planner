// Tests for scripts/build-indexes.mjs — index shapes, determinism, validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRecipeIndexes,
  validateReadyToEatCatalog,
  parseCheckToml,
  stableStringify,
  normalizeValue,
  deriveSlug,
  hasH2Section,
  validateCookingArtifacts,
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
  assert.equal(salmon.produces_components[0], 'cooked-rice');

  // Subjective fields are per-tenant (overlay/cooking_log) and SHALL NOT appear
  // in the shared index, even when a not-yet-migrated fixture still carries them.
  assert.equal(salmon.status, undefined);
  assert.equal(salmon.rating, undefined);
  assert.equal(salmon.last_cooked, undefined);
  assert.equal(recipes['experimental-tofu'].status, undefined);

  // component adjacency
  assert.deepEqual(components['cooked-rice'], {
    produced_by: ['salmon-with-rice'],
    used_by: ['kimchi-fried-rice'],
  });
});

test('validateReadyToEatCatalog: clean catalog passes, malformed ones report', () => {
  const ok = {
    items: [
      { name: 'Frozen Lasagna', slug: 'frozen-lasagna', meal: 'dinner', status: 'active', rating: 4 },
      { name: 'Overnight Oats', slug: 'overnight-oats', meal: 'breakfast', status: 'draft' },
    ],
  };
  assert.deepEqual(validateReadyToEatCatalog(ok, 'users/alice/ready_to_eat.toml'), []);

  const bad = {
    items: [
      { name: 'a', slug: 'dup', meal: 'brunch' }, // bad meal
      { name: 'b', slug: 'dup', meal: 'lunch' }, // duplicate slug
      { name: 'c', meal: 'dinner' }, // missing slug
      { name: 'd', slug: 'd', meal: 'dinner', rating: 9 }, // bad rating
    ],
  };
  const errs = validateReadyToEatCatalog(bad, 'u/ready_to_eat.toml');
  assert.ok(errs.some((e) => /meal/.test(e)));
  assert.ok(errs.some((e) => /duplicate ready-to-eat slug/.test(e)));
  assert.ok(errs.some((e) => /missing required `slug`/.test(e)));
  assert.ok(errs.some((e) => /rating/.test(e)));
});

// --- 4.3 determinism + date normalization -------------------------------

test('output is deterministic across runs', async () => {
  const a = await buildRecipeIndexes(FIXTURES);
  const b = await buildRecipeIndexes(FIXTURES);
  assert.equal(stableStringify(a.recipes), stableStringify(b.recipes));
  assert.equal(stableStringify(a.components), stableStringify(b.components));
});

test('subjective date field last_cooked is stripped from the shared index', async () => {
  // Date normalization itself is covered by the normalizeValue unit test below;
  // here we assert the per-tenant last_cooked never lands in the shared index.
  const { recipes } = await buildRecipeIndexes(FIXTURES);
  assert.equal(recipes['salmon-with-rice'].last_cooked, undefined);
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

// --- pairs_with (plating edge) + standalone gate ------------------------

test('resolved pairs_with passes and is carried into the index as an array', async () => {
  const dir = await tmpRecipes({
    'curry.md': recipe('title: Curry\nstatus: active\npairs_with: [steamed-rice]'),
    'steamed-rice.md': recipe('title: Steamed Rice\nstatus: active'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.ok(!errors.some((e) => e.includes('pairs_with')), errors.join('\n'));
  assert.deepEqual(recipes['curry'].pairs_with, ['steamed-rice']);
  // A recipe with no pairs_with defaults to an empty array in the index.
  assert.deepEqual(recipes['steamed-rice'].pairs_with, []);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: pairs_with references an unknown recipe', async () => {
  const dir = await tmpRecipes({
    'main.md': recipe('title: Main\nstatus: active\npairs_with: [ghost-side]'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /pairs_with references unknown recipe "ghost-side"/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: non-boolean standalone', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe('title: Bad\nstatus: active\nstandalone: yes-please'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /standalone must be a boolean/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('standalone: true passes and is carried into the index', async () => {
  const dir = await tmpRecipes({
    'chili.md': recipe('title: Chili\nstatus: active\nprotein: beef\ntime_total: 60\ningredients_key: [beef]\nstandalone: true'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.equal(recipes['chili'].standalone, true);
  await rm(dir, { recursive: true, force: true });
});

test('absent pairs_with / standalone do not warn', async () => {
  const dir = await tmpRecipes({
    'plain.md': recipe('title: Plain\nstatus: active\nprotein: chicken\ntime_total: 30\ningredients_key: [chicken]'),
  });
  const { recipes, errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => /pairs_with|standalone/.test(w)), warnings.join('\n'));
  // standalone stays unset (not coerced to false) when absent.
  assert.equal(recipes['plain'].standalone, undefined);
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

// --- controlled vocabulary (protein / cuisine) --------------------------

test('hard-fail: out-of-vocabulary protein and cuisine', async () => {
  const dir = await tmpRecipes({
    'bad-protein.md': recipe('title: P\nstatus: active\nprotein: salmon\ntime_total: 10\ningredients_key: [x]'),
    'bad-cuisine.md': recipe('title: C\nstatus: active\nprotein: fish\ncuisine: martian\ntime_total: 10\ningredients_key: [x]'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('bad-protein.md') && e.includes('protein')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('bad-cuisine.md') && e.includes('cuisine')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('in-vocabulary protein/cuisine pass; absent protein only warns', async () => {
  const dir = await tmpRecipes({
    'ok.md': recipe('title: Ok\nstatus: active\nprotein: fish\ncuisine: japanese\ntime_total: 10\ningredients_key: [x]'),
    'noprotein.md': recipe('title: NoP\nstatus: active\ntime_total: 10\ningredients_key: [x]'),
  });
  const { errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('noprotein.md') && w.includes('protein')), warnings.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

// --- cooking-log + meal-plan validation ---------------------------------

const recipesFixture = { 'arroz-caldo': { last_cooked: '2026-06-09' }, salmon: { last_cooked: null } };

test('cooking artifacts: valid log + plan produce no errors', () => {
  const { errors } = validateCookingArtifacts({
    recipes: recipesFixture,
    cookingLog: { entries: [{ date: '2026-06-09', type: 'recipe', recipe: 'arroz-caldo' }, { date: '2026-06-08', type: 'ready_to_eat', name: 'lasagna' }] },
    mealPlan: { planned: [{ recipe: 'salmon', planned_for: '2026-06-12' }] },
  });
  assert.deepEqual(errors, []);
});

test('cooking artifacts: hard-fail on unknown type, unresolved slugs, bad dates', () => {
  const { errors } = validateCookingArtifacts({
    recipes: recipesFixture,
    cookingLog: {
      entries: [
        { date: '2026-06-09', type: 'ate_out', name: 'diner' }, // unknown type
        { date: '2026-06-09', type: 'recipe', recipe: 'ghost' }, // unresolved slug
        { date: 'nope', type: 'ad_hoc', name: 'x' }, // bad date
      ],
    },
    mealPlan: { planned: [{ recipe: 'ghost' }, { recipe: 'salmon', planned_for: 'soon' }] },
  });
  assert.ok(errors.some((e) => e.includes('invalid type')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('unknown slug "ghost"') && e.includes('cooking_log')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('invalid or missing date')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('meal_plan') && e.includes('unknown slug "ghost"')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('planned_for')), errors.join('\n'));
});

test('cooking artifacts: last_cooked is no longer cross-checked against the log', () => {
  // last_cooked is a per-tenant value derived at read time, not a shared-recipe
  // field, so the shared build no longer reconciles frontmatter against the log —
  // even an apparent "drift" produces no warning.
  const { errors, warnings } = validateCookingArtifacts({
    recipes: { stale: { last_cooked: '2026-06-01' } },
    cookingLog: { entries: [{ date: '2026-06-10', type: 'recipe', recipe: 'stale' }] },
    mealPlan: null,
  });
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => w.includes('last_cooked')), warnings.join('\n'));
});

test('cooking artifacts: accepts a bare TOML date (Date) as well as a string', () => {
  const { errors, warnings } = validateCookingArtifacts({
    recipes: { x: { last_cooked: '2026-06-09' } },
    cookingLog: { entries: [{ date: new Date('2026-06-09T00:00:00Z'), type: 'recipe', recipe: 'x' }] },
    mealPlan: null,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

// --- TOML parse-check ----------------------------------------------------

test('hard-fail: unparseable TOML', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'grocery-toml-'));
  await writeFile(path.join(dir, 'broken.toml'), 'this = = invalid');
  const { errors } = await parseCheckToml(dir);
  assert.ok(errors.some((e) => e.includes('TOML')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});
