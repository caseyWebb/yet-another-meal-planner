// Tests for scripts/build-indexes.mjs — index shapes, determinism, validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRecipeIndexes,
  stableStringify,
  normalizeValue,
  deriveSlug,
  hasH2Section,
  recipeToRow,
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

// A minimal CONTRACT-COMPLIANT frontmatter (every system-consumed field present in its
// explicit empty form). Tests override one axis at a time via `fm({...})`; pass a key
// as `undefined` to OMIT it (to exercise the missing-required-field hard fail).
const BASE = {
  title: 'X',
  description: 'A simple test dish.',
  ingredients_key: '[x]',
  course: '[main]',
  protein: 'null',
  cuisine: 'null',
  time_total: 'null',
  source: 'null',
  dietary: '[]',
  season: '[]',
  tags: '[]',
  pairs_with: '[]',
  perishable_ingredients: '[]',
  requires_equipment: '[]',
  side_search_terms: '["a crisp green salad"]',
};
function fm(overrides = {}) {
  const merged = { ...BASE, ...overrides };
  return Object.entries(merged)
    .filter(([, v]) => v !== undefined) // `undefined` omits the line entirely
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

// --- 4.2 index shapes from fixtures -------------------------------------

test('builds recipe index from fixtures', async () => {
  const { recipes, errors, warnings } = await buildRecipeIndexes(FIXTURES);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []); // the warn-only tier is retired — nothing warns

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

test('flags an off-vocabulary protein (shared contract is the build gate)', async () => {
  const dir = await tmpRecipes({ 'shrimp.md': recipe(fm({ protein: 'shrimp' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(
    errors.some((e) => /protein/.test(e) && /shrimp/.test(e)),
    errors.join('\n'),
  );
  await rm(dir, { recursive: true, force: true });
});

test('accepts the coarse buckets (shellfish / thai) the shared vocab defines', async () => {
  const dir = await tmpRecipes({
    'curry.md': recipe(fm({ protein: 'shellfish', cuisine: 'thai' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
});

// --- 4.3 determinism + date normalization -------------------------------

test('output is deterministic across runs', async () => {
  const a = await buildRecipeIndexes(FIXTURES);
  const b = await buildRecipeIndexes(FIXTURES);
  assert.equal(stableStringify(a.recipes), stableStringify(b.recipes));
});

test('subjective date field last_cooked is stripped from the shared index', async () => {
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

// --- 4.4 validation: the required-field contract hard-fails -------------

test('tolerates a lingering status (the lifecycle is retired, never validated)', async () => {
  // status is not in the contract — any value passes the build (it is stripped from
  // the index, never enforced).
  const dir = await tmpRecipes({ 'ok.md': recipe(fm({ status: 'in-progress' })) });
  const { errors, recipes } = await buildRecipeIndexes(dir);
  assert.equal(errors.length, 0, errors.join('\n'));
  // and it never reaches the shared index
  assert.ok(!JSON.stringify(recipes).includes('in-progress'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: missing title', async () => {
  const dir = await tmpRecipes({ 'notitle.md': recipe(fm({ title: undefined })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('title')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: a missing required field (ingredients_key) fails the build', async () => {
  const dir = await tmpRecipes({ 'sparse.md': recipe(fm({ ingredients_key: undefined })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(
    errors.some((e) => e.includes('sparse.md') && e.includes('ingredients_key')),
    errors.join('\n'),
  );
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: an empty non-empty field (ingredients_key: []) fails the build', async () => {
  const dir = await tmpRecipes({ 'empty.md': recipe(fm({ ingredients_key: '[]' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('ingredients_key')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: an omitted explicit-null scalar (protein) fails the build', async () => {
  const dir = await tmpRecipes({ 'noprotein.md': recipe(fm({ protein: undefined })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('protein')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: a `none` protein is rejected (must be explicit null)', async () => {
  const dir = await tmpRecipes({ 'none.md': recipe(fm({ protein: 'none' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /protein/.test(e) && /none/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('explicit null protein/cuisine/time_total/source pass', async () => {
  const dir = await tmpRecipes({ 'nulls.md': recipe(fm()) }); // BASE uses null scalars
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: duplicate slug across nested dirs', async () => {
  const dir = await tmpRecipes({
    'a/dup.md': recipe(fm({ title: 'A' })),
    'b/dup.md': recipe(fm({ title: 'B' })),
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

// --- pairs_with (plating edge) + course facet ---------------------------

test('resolved pairs_with passes and is carried into the index as an array', async () => {
  const dir = await tmpRecipes({
    'curry.md': recipe(fm({ title: 'Curry', pairs_with: '[steamed-rice]' })),
    'steamed-rice.md': recipe(fm({ title: 'Steamed Rice', course: '[side]', side_search_terms: '[]' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['curry'].pairs_with, ['steamed-rice']);
  // An empty pairs_with stays an empty array in the index.
  assert.deepEqual(recipes['steamed-rice'].pairs_with, []);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: pairs_with references an unknown recipe', async () => {
  const dir = await tmpRecipes({
    'main.md': recipe(fm({ title: 'Main', pairs_with: '[ghost-side]' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /pairs_with references unknown recipe "ghost-side"/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('course: scalar is normalized to a lowercased, trimmed array', async () => {
  const dir = await tmpRecipes({
    'roast.md': recipe(fm({ title: 'Roast', course: 'Main' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['roast'].course, ['main']);
  await rm(dir, { recursive: true, force: true });
});

test('course: array is lowercased and trimmed (dual-use)', async () => {
  const dir = await tmpRecipes({
    'grain-salad.md': recipe(fm({ title: 'Grain Salad', course: '["Main", " Side "]' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['grain-salad'].course, ['main', 'side']);
  await rm(dir, { recursive: true, force: true });
});

test('course: an off-convention value passes (open vocabulary)', async () => {
  // A non-main course needs no side_search_terms.
  const dir = await tmpRecipes({
    'chimichurri.md': recipe(fm({ title: 'Chimichurri', course: '[sauce]', side_search_terms: '[]' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['chimichurri'].course, ['sauce']);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: course absent', async () => {
  const dir = await tmpRecipes({ 'bad.md': recipe(fm({ course: undefined })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /course/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: course present but empty', async () => {
  const dir = await tmpRecipes({ 'bad.md': recipe(fm({ course: '[]' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /course/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: course present but not a string/array', async () => {
  const dir = await tmpRecipes({ 'bad.md': recipe(fm({ course: '3' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /course.*must be a string or an array of strings/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

// --- side_search_terms (conditional on course) --------------------------

test('hard-fail: a main with empty side_search_terms', async () => {
  const dir = await tmpRecipes({ 'main.md': recipe(fm({ course: '[main]', side_search_terms: '[]' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /side_search_terms/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('a non-main with empty side_search_terms passes', async () => {
  const dir = await tmpRecipes({ 'side.md': recipe(fm({ course: '[side]', side_search_terms: '[]' })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
});

test('retired standalone field is ignored: no fail, not projected', async () => {
  const dir = await tmpRecipes({
    'chili.md': recipe(fm({ title: 'Chili', protein: 'beef', standalone: 'yes-please' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.equal(recipes['chili'].standalone, undefined);
  await rm(dir, { recursive: true, force: true });
});

test('free-form fields pass through untouched (no presence expectation)', async () => {
  const dir = await tmpRecipes({
    'ff.md': recipe(fm({ meal_preppable: 'true', veg_forward: 'false' })),
  });
  const { recipes, errors, warnings } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(recipes['ff'].meal_preppable, true);
  await rm(dir, { recursive: true, force: true });
});

// --- perishable_ingredients (menu-gen waste callout input) --------------

test('valid perishable_ingredients array passes and is carried into the index', async () => {
  const dir = await tmpRecipes({
    'tacos.md': recipe(fm({ title: 'Tacos', perishable_ingredients: '[cilantro, lime]' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['tacos'].perishable_ingredients, ['cilantro', 'lime']);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: perishable_ingredients present as a bare string', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe(fm({ title: 'Bad', perishable_ingredients: 'cilantro' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /perishable_ingredients/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: perishable_ingredients absent', async () => {
  const dir = await tmpRecipes({ 'p.md': recipe(fm({ perishable_ingredients: undefined })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /perishable_ingredients/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

// --- requires_equipment (makeability gate input) ------------------------

test('in-vocabulary requires_equipment passes and is carried into the index', async () => {
  const dir = await tmpRecipes({
    'sous-vide-steak.md': recipe(fm({ title: 'Sous Vide Steak', requires_equipment: '[sous-vide-circulator]' })),
  });
  const { recipes, errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(recipes['sous-vide-steak'].requires_equipment, ['sous-vide-circulator']);
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: off-vocabulary requires_equipment', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe(fm({ title: 'Bad', requires_equipment: '[panini-press]' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /requires_equipment.*panini-press.*not in the controlled vocabulary/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: non-array requires_equipment', async () => {
  const dir = await tmpRecipes({
    'bad.md': recipe(fm({ title: 'Bad', requires_equipment: 'blender' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /requires_equipment.*must be an array/.test(e)), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('hard-fail: requires_equipment absent', async () => {
  const dir = await tmpRecipes({ 're.md': recipe(fm({ requires_equipment: undefined })) });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => /requires_equipment/.test(e)), errors.join('\n'));
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
    'noing.md': recipe(fm({ title: 'NoIng' }), '\n## Instructions\n\n1. go\n'),
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
    'noinstr.md': recipe(fm({ title: 'NoInstr' }), '\n## Ingredients\n\n- x\n'),
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
      fm({ title: 'Notes', protein: 'fish', time_total: '10' }),
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
    'bad-protein.md': recipe(fm({ title: 'P', protein: 'salmon' })),
    'bad-cuisine.md': recipe(fm({ title: 'C', protein: 'fish', cuisine: 'martian' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.ok(errors.some((e) => e.includes('bad-protein.md') && e.includes('protein')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('bad-cuisine.md') && e.includes('cuisine')), errors.join('\n'));
  await rm(dir, { recursive: true, force: true });
});

test('in-vocabulary protein/cuisine pass', async () => {
  const dir = await tmpRecipes({
    'ok.md': recipe(fm({ title: 'Ok', protein: 'fish', cuisine: 'japanese' })),
  });
  const { errors } = await buildRecipeIndexes(dir);
  assert.deepEqual(errors, []);
  await rm(dir, { recursive: true, force: true });
});

// --- cooking-log validation ---------------------------------------------
// The cooking log left GitHub for the D1 `cooking_log` table (d1-cooking-log), so
// the build no longer validates it (validateCookingArtifacts was removed). Its
// structural checks live on in the Worker's log_cooked tool, which additionally
// resolves recipe slugs against the D1 `recipes` table at write time. The backfill
// from cooking_log.toml → D1 is exercised by tests/cooking-log-backfill.test.mjs.

// --- D1 projection (recipeToRow) ----------------------------------------
// The recipe index is the D1 `recipes` table now (d1-recipe-index): build-indexes
// projects rows via recipeToRow and writes NO _indexes/recipes.json. These assert
// the row mapping that src/recipe-index.ts reconstructs from. Column order:
// [slug, title, protein, cuisine, time_total, source_url,
//  ingredients_key, tags, course, season, dietary, pairs_with,
//  perishable_ingredients, requires_equipment, side_search_terms, extra]
// description is NOT a column — it is a Worker-derived field (recipe_derived, migration 0013).
const COL = {
  slug: 0,
  title: 1,
  protein: 2,
  cuisine: 3,
  time_total: 4,
  source_url: 5,
  ingredients_key: 6,
  tags: 7,
  course: 8,
  season: 9,
  dietary: 10,
  pairs_with: 11,
  perishable_ingredients: 12,
  requires_equipment: 13,
  side_search_terms: 14,
  extra: 15,
};

test('recipeToRow: scalar facets land in their columns, source → source_url', () => {
  const row = recipeToRow({
    slug: 'salmon-with-rice',
    title: 'Salmon with Rice',
    protein: 'fish',
    cuisine: 'japanese',
    time_total: 30,
    source: 'https://example.test/salmon',
  });
  assert.equal(row.length, 16);
  assert.equal(row[COL.slug], 'salmon-with-rice');
  assert.equal(row[COL.title], 'Salmon with Rice');
  assert.equal(row[COL.protein], 'fish');
  assert.equal(row[COL.cuisine], 'japanese');
  assert.equal(row[COL.time_total], 30);
  assert.equal(row[COL.source_url], 'https://example.test/salmon');
});

test('recipeToRow: array facets are JSON-stringified into their columns', () => {
  const row = recipeToRow({
    slug: 'r',
    title: 'R',
    ingredients_key: ['salmon', 'rice'],
    tags: ['weeknight'],
    course: ['main'],
    season: [],
    dietary: ['pescatarian'],
    pairs_with: ['steamed-greens'],
    perishable_ingredients: ['salmon'],
    requires_equipment: ['blender'],
    side_search_terms: ['a crisp acidic green salad'],
  });
  assert.deepEqual(JSON.parse(row[COL.ingredients_key]), ['salmon', 'rice']);
  assert.deepEqual(JSON.parse(row[COL.tags]), ['weeknight']);
  assert.deepEqual(JSON.parse(row[COL.course]), ['main']);
  assert.deepEqual(JSON.parse(row[COL.season]), []);
  assert.deepEqual(JSON.parse(row[COL.dietary]), ['pescatarian']);
  assert.deepEqual(JSON.parse(row[COL.pairs_with]), ['steamed-greens']);
  assert.deepEqual(JSON.parse(row[COL.perishable_ingredients]), ['salmon']);
  assert.deepEqual(JSON.parse(row[COL.requires_equipment]), ['blender']);
  assert.deepEqual(JSON.parse(row[COL.side_search_terms]), ['a crisp acidic green salad']);
});

test('recipeToRow: unpromoted objective fields go to extra; promoted ones do not', () => {
  const row = recipeToRow({
    slug: 'r',
    title: 'R',
    protein: 'beef',
    source: 'https://x.test',
    description: 'a derived blurb that must NOT land in extra',
    style: 'one-pot',
    servings: 6,
    difficulty: 'easy',
    discovered_at: null,
    meal_preppable: true,
  });
  const extra = JSON.parse(row[COL.extra]);
  assert.deepEqual(extra, {
    style: 'one-pot',
    servings: 6,
    difficulty: 'easy',
    discovered_at: null,
    meal_preppable: true,
  });
  // Promoted fields (slug/title/protein/source) are NOT duplicated into extra.
  assert.ok(!('slug' in extra));
  assert.ok(!('title' in extra));
  assert.ok(!('protein' in extra));
  assert.ok(!('source' in extra));
  // description is Worker-derived now (recipe_derived) — dropped, never shunted into extra.
  assert.ok(!('description' in extra));
});

test('recipeToRow: absent facets are NULL, not "undefined"; empty extra is null', () => {
  const row = recipeToRow({ slug: 'plain', title: 'Plain' });
  assert.equal(row[COL.protein], null);
  assert.equal(row[COL.cuisine], null);
  assert.equal(row[COL.time_total], null);
  assert.equal(row[COL.source_url], null);
  assert.equal(row[COL.ingredients_key], null);
  assert.equal(row[COL.tags], null);
  assert.equal(row[COL.extra], null);
});

test('recipeToRow round-trips a real built recipe (fixtures → row → reconstructed objective fields)', async () => {
  const { recipes } = await buildRecipeIndexes(FIXTURES);
  // Use a fixture with a non-null `source` so the source_url column round-trips.
  const salmon = recipes['experimental-tofu'];
  const row = recipeToRow(salmon);
  // Reconstruct the way src/recipe-index.ts does (extra + columns), proving the
  // projection is lossless for the objective fields.
  const reconstructed = { ...(row[COL.extra] ? JSON.parse(row[COL.extra]) : {}) };
  reconstructed.slug = row[COL.slug];
  if (row[COL.title] !== null) reconstructed.title = row[COL.title];
  if (row[COL.protein] !== null) reconstructed.protein = row[COL.protein];
  if (row[COL.cuisine] !== null) reconstructed.cuisine = row[COL.cuisine];
  if (row[COL.time_total] !== null) reconstructed.time_total = row[COL.time_total];
  if (row[COL.source_url] !== null) reconstructed.source = row[COL.source_url];
  for (const [col, key] of [
    [COL.ingredients_key, 'ingredients_key'],
    [COL.tags, 'tags'],
    [COL.course, 'course'],
    [COL.season, 'season'],
    [COL.dietary, 'dietary'],
    [COL.pairs_with, 'pairs_with'],
    [COL.perishable_ingredients, 'perishable_ingredients'],
    [COL.requires_equipment, 'requires_equipment'],
    [COL.side_search_terms, 'side_search_terms'],
  ]) {
    if (row[col] !== null) reconstructed[key] = JSON.parse(row[col]);
  }
  // description is a Worker-derived field now (not projected), so the lossless round-trip is
  // over the non-derived objective fields — compare against the recipe minus its description.
  const { description: _derived, ...salmonObjective } = salmon;
  assert.deepEqual(reconstructed, salmonObjective);
});

test('build run() does not write _indexes/recipes.json (the index is D1 now)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'grocery-noindex-'));
  await mkdir(path.join(root, 'recipes'), { recursive: true });
  await writeFile(path.join(root, 'recipes', 'r.md'), recipe(fm({ title: 'R' }), SECTIONS));
  // run() validates + builds the index map but writes no files; the projection to
  // D1 is a separate step (skipped without CLOUDFLARE_API_TOKEN). Assert the legacy
  // artifact is never produced under _indexes/.
  await run({ root });
  let exists = true;
  try {
    await stat(path.join(root, '_indexes', 'recipes.json'));
  } catch {
    exists = false;
  }
  assert.equal(exists, false);
  await rm(root, { recursive: true, force: true });
});
