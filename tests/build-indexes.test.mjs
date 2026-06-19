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
  validateKitchenInventory,
  validateStore,
  validateDiscoveriesInbox,
  validateDiscoverySources,
  parseCheckToml,
  stableStringify,
  normalizeValue,
  deriveSlug,
  hasH2Section,
  validateCookingArtifacts,
  run,
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

test('builds recipe index from fixtures', async () => {
  const { recipes, errors, warnings } = await buildRecipeIndexes(FIXTURES);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []); // fixtures have all recommended fields

  assert.deepEqual(
    Object.keys(recipes).sort(),
    ['experimental-tofu', 'kimchi-fried-rice', 'salmon-with-rice']
  );

  const salmon = recipes['salmon-with-rice'];
  assert.equal(salmon.slug, 'salmon-with-rice');

  // Subjective fields are per-tenant (overlay/cooking_log) and SHALL NOT appear
  // in the shared index, even when a not-yet-migrated fixture still carries them.
  assert.equal(salmon.status, undefined);
  assert.equal(salmon.rating, undefined);
  assert.equal(salmon.last_cooked, undefined);
  assert.equal(recipes['experimental-tofu'].status, undefined);
});

test('flags an off-vocabulary protein (shared vocab from src/vocab.js is the build gate)', async () => {
  const dir = await tmpRecipes({ 'shrimp.md': recipe('title: Shrimp\nstatus: active\nprotein: shrimp') });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(
    errors.some((e) => /protein/.test(e) && /shrimp/.test(e) && /controlled vocabulary/.test(e)),
    errors.join('\n'),
  );
  await rm(dir, { recursive: true, force: true });
});

test('accepts the coarse buckets (shellfish / thai) the shared vocab defines', async () => {
  const dir = await tmpRecipes({
    'curry.md': recipe('title: Curry\nstatus: active\nprotein: shellfish\ncuisine: thai'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
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

// --- pairs_with (plating edge) + course facet ---------------------------

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

test('course: scalar is normalized to a lowercased, trimmed array', async () => {
  const dir = await tmpRecipes({
    'roast.md': recipe('title: Roast\nstatus: active\ncourse: Main'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['roast'].course, ['main']);
  await rm(dir, { recursive: true, force: true });
});

test('course: array is lowercased and trimmed (dual-use)', async () => {
  const dir = await tmpRecipes({
    'grain-salad.md': recipe('title: Grain Salad\nstatus: active\ncourse: ["Main", " Side "]'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['grain-salad'].course, ['main', 'side']);
  await rm(dir, { recursive: true, force: true });
});

test('course: an off-convention value passes (open vocabulary)', async () => {
  const dir = await tmpRecipes({
    'chimichurri.md': recipe('title: Chimichurri\nstatus: active\ncourse: [sauce]'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['chimichurri'].course, ['sauce']);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: course present but not a string/array', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe('title: Bad\nstatus: active\ncourse: 3'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /course must be a string or an array of strings/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('absent pairs_with / course do not warn; course defaults to empty', async () => {
  const dir = await tmpRecipes({
    'plain.md': recipe('title: Plain\nstatus: active\nprotein: chicken\ntime_total: 30\ningredients_key: [chicken]'),
  });
  const { recipes, errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => /pairs_with|course/.test(w)), warnings.join('\n'));
  assert.deepEqual(recipes['plain'].course, []);
  await rm(dir, { recursive: true, force: true });
});

test('retired standalone field is ignored: no fail, not projected', async () => {
  const dir = await tmpRecipes({
    // a now-retired field with any value — must not fail the build, must not appear in the index
    'chili.md': recipe('title: Chili\nstatus: active\nprotein: beef\ntime_total: 60\ningredients_key: [beef]\nstandalone: yes-please'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.equal(recipes['chili'].standalone, undefined);
  await rm(dir, { recursive: true, force: true });
});

// --- perishable_ingredients (menu-gen waste callout input) --------------

test('valid perishable_ingredients array passes and is carried into the index', async () => {
  const dir = await tmpRecipes({
    'tacos.md': recipe('title: Tacos\nstatus: active\nperishable_ingredients: [cilantro, lime]'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.ok(!errors.some((e) => e.includes('perishable_ingredients')), errors.join('\n'));
  assert.deepEqual(recipes['tacos'].perishable_ingredients, ['cilantro', 'lime']);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: perishable_ingredients present as a bare string', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe('title: Bad\nstatus: active\nperishable_ingredients: cilantro'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(
    errors.some((e) => /perishable_ingredients must be an array of ingredient names/.test(e)),
    errors.join('\n'),
  );
  await rm(dir, { recursive: true, force: true });
});

test('absent perishable_ingredients does not warn and defaults to empty', async () => {
  const dir = await tmpRecipes({
    'plain.md': recipe('title: Plain\nstatus: active\nprotein: chicken\ntime_total: 30\ningredients_key: [chicken]'),
  });
  const { recipes, errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => /perishable_ingredients/.test(w)), warnings.join('\n'));
  assert.deepEqual(recipes['plain'].perishable_ingredients, []);
  await rm(dir, { recursive: true, force: true });
});

// --- requires_equipment (makeability gate input) ------------------------

test('in-vocabulary requires_equipment passes and is carried into the index', async () => {
  const dir = await tmpRecipes({
    'sous-vide-steak.md': recipe('title: Sous Vide Steak\nstatus: active\nrequires_equipment: [sous-vide-circulator]'),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.ok(!errors.some((e) => /requires_equipment/.test(e)), errors.join('\n'));
  assert.deepEqual(recipes['sous-vide-steak'].requires_equipment, ['sous-vide-circulator']);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: off-vocabulary requires_equipment', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe('title: Bad\nstatus: active\nrequires_equipment: [panini-press]'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /requires_equipment "panini-press" is not in the controlled vocabulary/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: non-array requires_equipment', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe('title: Bad\nstatus: active\nrequires_equipment: blender'),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /requires_equipment must be an array/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('absent requires_equipment defaults to [] and does not warn', async () => {
  const dir = await tmpRecipes({
    'plain.md': recipe('title: Plain\nstatus: active\nprotein: chicken\ntime_total: 30\ningredients_key: [chicken]'),
  });
  const { recipes, errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => /requires_equipment/.test(w)), warnings.join('\n'));
  assert.deepEqual(recipes['plain'].requires_equipment, []);
  await rm(dir, { recursive: true, force: true });
});

// --- kitchen inventory structural validation ----------------------------

test('validateKitchenInventory: clean inventory passes, off-vocab owned reports', () => {
  assert.deepEqual(
    validateKitchenInventory({ owned: ['pressure-cooker', 'blender'], notes: { ovens: 2 } }, 'users/alice/kitchen.toml'),
    [],
  );
  // Absent owned is valid (unknown inventory).
  assert.deepEqual(validateKitchenInventory({ notes: { free_text: 'cast iron' } }, 'u/kitchen.toml'), []);
  // Empty file is valid.
  assert.deepEqual(validateKitchenInventory({}, 'u/kitchen.toml'), []);
  const offVocab = validateKitchenInventory({ owned: ['air-fryer'] }, 'u/kitchen.toml');
  assert.ok(offVocab.some((e) => /`owned` slug "air-fryer" is not in the controlled vocabulary/.test(e)), offVocab.join('\n'));
  const nonArray = validateKitchenInventory({ owned: 'blender' }, 'u/kitchen.toml');
  assert.ok(nonArray.some((e) => /`owned` must be an array/.test(e)), nonArray.join('\n'));
});

test('validateStore: identity-only — requires slug+name, domain a string, tolerates legacy layout keys', () => {
  const ok = { slug: 'west-7th-tom-thumb', name: 'Tom Thumb', label: 'West 7th', domain: 'grocery' };
  assert.deepEqual(validateStore(ok, 'stores/west-7th-tom-thumb.toml'), []);

  // Missing required slug/name.
  const noId = validateStore({}, 'stores/x.toml');
  assert.ok(noId.some((e) => /missing required `slug`/.test(e)), noId.join('\n'));
  assert.ok(noId.some((e) => /missing required `name`/.test(e)), noId.join('\n'));

  // domain must be a string when present.
  const badDomain = validateStore({ slug: 's', name: 'S', domain: 3 }, 'stores/s.toml');
  assert.ok(badDomain.some((e) => /`domain` must be a string/.test(e)), badDomain.join('\n'));

  // Layout is notes now: legacy aisles/item_locations/doesnt_carry keys are tolerated, not validated.
  const legacy = validateStore(
    {
      slug: 's',
      name: 'S',
      aisles: [{ sections: ['ok'] }, { number: 2, sections: [3] }],
      item_locations: [{ aisle: '1' }],
      doesnt_carry: 'harissa',
    },
    'stores/s.toml',
  );
  assert.deepEqual(legacy, []);
});

test('run: an absent stores/ tree is valid (no store error)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'grocery-store-'));
  await mkdir(path.join(root, 'recipes'), { recursive: true });
  await writeFile(path.join(root, 'recipes', 'r.md'), recipe('title: R', SECTIONS));
  const { errors } = await run({ root });
  assert.deepEqual(errors, []);
  await rm(root, { recursive: true, force: true });
});

test('run: a malformed store in stores/ fails the build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'grocery-store-'));
  await mkdir(path.join(root, 'recipes'), { recursive: true });
  await writeFile(path.join(root, 'recipes', 'r.md'), recipe('title: R', SECTIONS));
  await mkdir(path.join(root, 'stores'), { recursive: true });
  // Missing required `name`.
  await writeFile(path.join(root, 'stores', 'bad.toml'), 'slug = "bad"\n');
  const { errors } = await run({ root });
  assert.ok(errors.some((e) => /stores\/bad\.toml: store is missing required `name`/.test(e)), errors.join('\n'));
  await rm(root, { recursive: true, force: true });
});

// --- shared discovery-source structural validation ----------------------

test('validateDiscoveriesInbox: clean inbox passes, candidate missing url reports', () => {
  const ok = {
    entries: [
      {
        from: 'news@seriouseats.com',
        candidates: [{ title: 'Chili', url: 'https://x.test/chili' }],
      },
    ],
  };
  assert.deepEqual(validateDiscoveriesInbox(ok, 'discoveries_inbox.toml'), []);
  // Empty/absent-shaped file is valid.
  assert.deepEqual(validateDiscoveriesInbox({}, 'discoveries_inbox.toml'), []);
  const bad = { entries: [{ from: 'x@y.com', candidates: [{ title: 'No URL' }] }] };
  const errs = validateDiscoveriesInbox(bad, 'discoveries_inbox.toml');
  assert.ok(errs.some((e) => /missing required `url`/.test(e)), errs.join('\n'));
});

test('validateDiscoverySources: valid addresses pass, bad ones report', () => {
  const ok = {
    members: [{ address: 'alice@example.com' }],
    senders: [{ address: 'news@seriouseats.com', name: 'SE' }],
  };
  assert.deepEqual(validateDiscoverySources(ok, 'discovery_sources.toml'), []);
  assert.deepEqual(validateDiscoverySources({}, 'discovery_sources.toml'), []);
  const bad = { senders: [{ address: 'not-an-email' }] };
  const errs = validateDiscoverySources(bad, 'discovery_sources.toml');
  assert.ok(errs.some((e) => /`senders` entry needs a valid `address`/.test(e)), errs.join('\n'));
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

test('cooking artifacts: free-text sides on a planned row pass and are not slug-resolved', () => {
  const { errors } = validateCookingArtifacts({
    recipes: recipesFixture,
    cookingLog: { entries: [] },
    // "roasted broccoli" resolves to no slug — must NOT be treated as a recipe reference.
    mealPlan: { planned: [{ recipe: 'salmon', planned_for: '2026-06-12', sides: ['roasted broccoli'] }] },
  });
  assert.deepEqual(errors, []);
});

test('cooking artifacts: hard-fail on non-array sides', () => {
  const { errors } = validateCookingArtifacts({
    recipes: recipesFixture,
    cookingLog: { entries: [] },
    mealPlan: { planned: [{ recipe: 'salmon', sides: 'roasted broccoli' }] },
  });
  assert.ok(errors.some((e) => /sides must be an array of side names/.test(e)), errors.join('\n'));
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
