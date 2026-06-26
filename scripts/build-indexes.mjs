#!/usr/bin/env node
// build-indexes.mjs — walk recipes/, validate (incl. per-tenant ready_to_eat.toml), emit _indexes/*.json.
//
// Content-agnostic: handles an empty corpus cleanly. Output is deterministic
// (sorted keys, dates normalized to YYYY-MM-DD strings) so an unchanged corpus
// produces byte-identical files and the regen Action commits nothing.
//
// Usage:
//   node scripts/build-indexes.mjs           # validate + write indexes
//   node scripts/build-indexes.mjs --check   # validate only, write nothing (pre-commit)

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import matter from 'gray-matter';
import { PROTEIN_VOCAB, CUISINE_VOCAB, EQUIPMENT_VOCAB } from '../src/vocab.js';
import { resolveD1Access, makeD1Client } from './d1-rest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `archived` is valid but tool-unwritten by design — the MANUAL history-preserving
// removal state (a recipe with cooking_log history can't be deleted, so it's
// hand-archived: file persists, history resolves, but it leaves active rotation).
// No tool and no scheduler set it (there is deliberately no auto-archive); the
// validator must still accept a hand-archived recipe. Mirrored in src/validate.ts.
const STATUS_ENUM = new Set(['active', 'draft', 'rejected', 'archived']);
// Subjective recipe fields are per-tenant (overlay + cooking_log), NOT shared
// corpus content. They are stripped from the shared index and merged at read time
// (multi-tenant-friend-group §6.1). `status`, when still present on a not-yet-
// migrated recipe, is validated leniently but never emitted to the shared index.
const SUBJECTIVE_FIELDS = ['rating', 'last_cooked', 'status'];
// Controlled vocabularies for the variety + makeability dimensions (coarse
// buckets — `fish` not `salmon`) so retrospective mixes and diet_principles rules
// stay reliable. PROTEIN_VOCAB / CUISINE_VOCAB / EQUIPMENT_VOCAB are imported from
// the single shared source (src/vocab.js) that the Worker write-time validator
// (src/validate.ts) also uses, so the build-time gate and the write-time gate
// cannot drift. Validated only WHEN PRESENT (absence keeps the warn-only
// recommended-field treatment). Extending a vocabulary is a deliberate edit in
// src/vocab.js. See docs/SCHEMAS.md.
// Recommended-but-optional fields whose absence signals an incomplete migration.
// last_cooked / rating / discovered_at are legitimately null by design and are NOT warned.
const RECOMMENDED_FIELDS = ['protein', 'time_total', 'ingredients_key'];
// Recipe bodies must carry these H2 sections so site generation can reliably
// locate the ingredient list (for checkboxes) and the step list (for read-aloud).
// Extra H2 sections (e.g. a future `## Notes`) are permitted and render generically.
const REQUIRED_SECTIONS = ['Ingredients', 'Instructions'];

// True when the markdown body contains an `## <name>` ATX H2 heading (any
// surrounding whitespace, case-sensitive on the canonical label).
export function hasH2Section(body, name) {
  const re = new RegExp(`^[ \\t]*##[ \\t]+${name}[ \\t]*$`, 'm');
  return re.test(body);
}

// --- pure helpers --------------------------------------------------------

export function deriveSlug(filename) {
  return path.basename(filename, '.md');
}

// Recursively convert Date instances (js-yaml/TOML dates) to YYYY-MM-DD strings.
export function normalizeValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeValue(v);
    return out;
  }
  return value;
}

// Normalize a recipe's open-vocabulary `course` to a lowercased, trimmed array of
// strings, accepting a bare string or an array. Returns [] for absent/empty. Shape
// and casing only — values are never checked against a set, so the facet stays open.
export function normalizeCourse(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((c) => String(c).trim().toLowerCase()).filter((c) => c.length > 0);
}

// Deterministic JSON: recursively sort object keys, 2-space indent, trailing newline.
export function stableStringify(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}

// Recursively collect files with the given extension. Recipes/ is flat today,
// but recursing lets recipes be foldered later while keeping slugs globally
// unique (basename-derived) — which is exactly when the duplicate-slug guard earns its keep.
async function listFiles(dir, ext, acc = []) {
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
    if (e.isDirectory()) await listFiles(full, ext, acc);
    else if (e.isFile() && e.name.endsWith(ext)) acc.push(full);
  }
  return acc.sort();
}

// --- recipe index --------------------------------------------------------

// Returns { recipes, errors, warnings }.
export async function buildRecipeIndexes(recipesDir) {
  const errors = [];
  const warnings = [];
  const recipes = {};
  const seenSlugs = new Map(); // slug -> first filename

  const files = await listFiles(recipesDir, '.md');
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const slug = deriveSlug(file);
    let data, content;
    try {
      ({ data, content } = matter(await readFile(file, 'utf8')));
    } catch (err) {
      errors.push(`${rel}: frontmatter failed to parse — ${err.message}`);
      continue;
    }

    if (seenSlugs.has(slug)) {
      errors.push(`duplicate slug "${slug}": ${seenSlugs.get(slug)} and ${rel}`);
      continue;
    }
    seenSlugs.set(slug, rel);

    if (typeof data.title !== 'string' || data.title.trim() === '') {
      errors.push(`${rel}: missing required field "title"`);
    }
    // status is a per-tenant overlay field now; only validate it when a
    // not-yet-migrated recipe still carries one. Absence is fine (effective
    // status defaults to draft per tenant, resolved in the Worker at read time).
    if (data.status != null && !STATUS_ENUM.has(data.status)) {
      errors.push(`${rel}: invalid "status" (got ${JSON.stringify(data.status)})`);
    }
    const missing = RECOMMENDED_FIELDS.filter(
      (f) => data[f] == null || (Array.isArray(data[f]) && data[f].length === 0)
    );
    if (missing.length) warnings.push(`${rel}: missing recommended field(s): ${missing.join(', ')}`);

    // Controlled-vocabulary check: validated only when present.
    if (data.protein != null && !PROTEIN_VOCAB.includes(data.protein)) {
      errors.push(`${rel}: protein ${JSON.stringify(data.protein)} is not in the controlled vocabulary`);
    }
    if (data.cuisine != null && !CUISINE_VOCAB.includes(data.cuisine)) {
      errors.push(`${rel}: cuisine ${JSON.stringify(data.cuisine)} is not in the controlled vocabulary`);
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!hasH2Section(content, section)) {
        errors.push(`${rel}: missing required body section "## ${section}"`);
      }
    }

    // pairs_with is a PLATING edge (recipes eaten together on one plate), distinct
    // from the produces/uses PRODUCTION edges. Array of recipe slugs; slug
    // resolution is checked once all recipes are collected (below).
    if (data.pairs_with != null && !Array.isArray(data.pairs_with)) {
      errors.push(`${rel}: pairs_with must be an array of recipe slugs (got ${JSON.stringify(data.pairs_with)})`);
    }
    // course is an OPEN-vocabulary facet (main | side | dessert | breakfast | …) —
    // what kind of dish this is, classified at import. Shape-only check: a string or
    // an array of strings. The VALUE is never checked against a set (unlike
    // protein/cuisine), so the facet stays expandable without a code change. Absence
    // reads as [] and is never warned. (`standalone` is retired — no longer a
    // recognized field; a lingering value is ignored, never validated or projected.)
    if (
      data.course != null &&
      typeof data.course !== 'string' &&
      !(Array.isArray(data.course) && data.course.every((c) => typeof c === 'string'))
    ) {
      errors.push(`${rel}: course must be a string or an array of strings (got ${JSON.stringify(data.course)})`);
    }
    // description (semantic-meal-plan) is the AI-written brief summary that seeds the
    // recipe embedding and the compact candidate row — a non-empty string when present.
    if (data.description != null && (typeof data.description !== 'string' || data.description.trim() === '')) {
      errors.push(`${rel}: description must be a non-empty string (got ${JSON.stringify(data.description)})`);
    }
    // side_search_terms (semantic-meal-plan) are AI-memoized phrases describing the
    // kind of side that complements a main; the semantic side-retrieval query.
    if (
      data.side_search_terms != null &&
      (!Array.isArray(data.side_search_terms) ||
        data.side_search_terms.some((s) => typeof s !== 'string'))
    ) {
      errors.push(`${rel}: side_search_terms must be an array of strings (got ${JSON.stringify(data.side_search_terms)})`);
    }
    // perishable_ingredients is objective shared content (a normalized list of the
    // recipe's perishable ingredients, classified at import) consumed by the
    // menu-gen waste callout. Present-but-not-a-string-array is a hard failure
    // (like a non-boolean standalone); absence reads as [] and is never warned.
    if (
      data.perishable_ingredients != null &&
      (!Array.isArray(data.perishable_ingredients) ||
        data.perishable_ingredients.some((s) => typeof s !== 'string'))
    ) {
      errors.push(
        `${rel}: perishable_ingredients must be an array of ingredient names (got ${JSON.stringify(data.perishable_ingredients)})`,
      );
    }

    // requires_equipment is objective shared content (drives the makeability
    // gate). An array of EQUIPMENT_VOCAB slugs; an entry outside the vocab is a
    // hard failure (like protein/cuisine). Absence reads as [] (makeable by all).
    if (data.requires_equipment != null) {
      if (!Array.isArray(data.requires_equipment)) {
        errors.push(`${rel}: requires_equipment must be an array of equipment slugs (got ${JSON.stringify(data.requires_equipment)})`);
      } else {
        for (const slug of data.requires_equipment) {
          if (!EQUIPMENT_VOCAB.includes(slug)) {
            errors.push(`${rel}: requires_equipment ${JSON.stringify(slug)} is not in the controlled vocabulary`);
          }
        }
      }
    }

    // Emit objective content only — strip the per-tenant subjective fields so the
    // shared index never carries one tenant's rating/status/last_cooked. `standalone`
    // is a retired field (whether a main is already a rounded plate is inferred at
    // plan time, not persisted); strip any lingering value so it never reaches the index.
    const objective = { ...data };
    for (const f of SUBJECTIVE_FIELDS) delete objective[f];
    delete objective.standalone;
    recipes[slug] = normalizeValue({
      ...objective,
      slug,
      pairs_with: Array.isArray(data.pairs_with) ? data.pairs_with : [],
      perishable_ingredients: Array.isArray(data.perishable_ingredients) ? data.perishable_ingredients : [],
      requires_equipment: Array.isArray(data.requires_equipment) ? data.requires_equipment : [],
      course: normalizeCourse(data.course),
    });
  }

  // pairs_with plating-edge resolution: every referenced slug must be a real recipe.
  for (const [slug, r] of Object.entries(recipes)) {
    for (const target of r.pairs_with) {
      if (!(target in recipes)) {
        errors.push(`recipe "${slug}": pairs_with references unknown recipe "${target}"`);
      }
    }
  }

  return { recipes, errors, warnings };
}

// After d1-shared-corpus (slice 6 — the last), GitHub holds ONLY recipes/*.md. Every
// other corpus artifact (the store registry + store notes, recipe notes, aliases,
// feeds, the newsletter allowlist + discovery inbox, the SKU cache, flyer terms) is a
// D1 table, written and VALIDATED at the Worker's write tools (src/validate.ts). So the
// build no longer parses or validates any TOML — it validates recipe markdown and
// projects the recipe index, and nothing else. (Profile / session / cooking-log data
// likewise left GitHub for D1 in earlier slices.)

// --- orchestration -------------------------------------------------------

export async function run({ recipesDir, root = REPO_ROOT } = {}) {
  recipesDir ??= path.join(root, 'recipes');

  const { recipes, errors, warnings } = await buildRecipeIndexes(recipesDir);
  return { indexes: { recipes }, errors: [...errors], warnings: [...warnings] };
}

// --- D1 projection -------------------------------------------------------

// The recipe index is now the D1 `recipes` table (d1-recipe-index), not a KV blob
// or a committed _indexes/recipes.json. This is the build's projection of one
// validated recipe into a table row; it MUST stay in sync with the Worker's read
// reconstruction in src/recipe-index.ts (same column ↔ frontmatter map).
//
//   * scalar columns reconstructed verbatim: title, protein, cuisine, time_total,
//     description (the semantic-identity brief; its embedding is reconciled
//     Worker-side, not projected here — recipe_embeddings, migration 0007).
//   * source_url ⇄ the recipe's `source` frontmatter (renamed only at the column
//     boundary so discovery's source lookups are indexed).
//   * ingredients_key + the JSON-array columns (incl. side_search_terms) hold a JSON
//     value as TEXT.
//   * extra holds a JSON object of every OTHER objective field (lossless).
const RECIPE_SCALAR_COLUMNS = ['title', 'protein', 'cuisine', 'time_total', 'description'];
const RECIPE_JSON_COLUMNS = [
  'ingredients_key',
  'tags',
  'course',
  'season',
  'dietary',
  'pairs_with',
  'perishable_ingredients',
  'requires_equipment',
  'side_search_terms',
];
// Column order for the INSERT; `slug` (PK) and `source_url` (renamed) bookend the
// promoted facets, with `extra` last.
const RECIPE_COLUMNS = [
  'slug',
  ...RECIPE_SCALAR_COLUMNS,
  'source_url',
  ...RECIPE_JSON_COLUMNS,
  'extra',
];

// Frontmatter keys that map to their OWN column (so they are excluded from `extra`).
// `source` is the frontmatter name of the `source_url` column; `slug` is the PK.
const PROMOTED_FIELDS = new Set([
  'slug',
  'source',
  ...RECIPE_SCALAR_COLUMNS,
  ...RECIPE_JSON_COLUMNS,
]);

// Project one recipe entry into its positional bind values (RECIPE_COLUMNS order).
// JSON columns are stringified; `extra` carries the leftover objective fields.
export function recipeToRow(recipe) {
  const extra = {};
  for (const [k, v] of Object.entries(recipe)) {
    if (!PROMOTED_FIELDS.has(k)) extra[k] = v;
  }
  const scalar = (v) => (v === undefined ? null : v);
  const jsonCol = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
  return [
    recipe.slug,
    ...RECIPE_SCALAR_COLUMNS.map((c) => scalar(recipe[c] ?? null)),
    scalar(recipe.source ?? null),
    ...RECIPE_JSON_COLUMNS.map((c) => jsonCol(recipe[c])),
    Object.keys(extra).length ? JSON.stringify(extra) : null,
  ];
}

// Project the validated recipe set into the D1 `recipes` table, replacing its
// contents WHOLESALE in one transaction (DELETE then batched INSERT) — a derived
// index is rebuilt whole, so replace-all matches the old whole-blob semantics and a
// removed recipe loses its row. Auto-detects eligibility via the shared D1-access
// resolver (CLOUDFLARE_API_TOKEN + the DB database id from the data repo's
// wrangler.jsonc). Warns and SKIPS rather than failing when access can't be
// resolved — keeping `--check` mode and pre-first-provision runs clean, exactly as
// the old KV publish did.
async function projectToD1(indexes, root) {
  const access = await resolveD1Access(root);
  if (!access.ok) {
    console.warn(`warn: D1 projection skipped — ${access.reason}`);
    return;
  }
  const d1 = makeD1Client(access);
  // Deterministic row order (sorted slug) so the projection is reproducible.
  const recipes = Object.values(indexes.recipes).sort((a, b) => a.slug.localeCompare(b.slug));

  // The D1 REST /query endpoint rejects bound params alongside multiple statements
  // ("params with multiple statements is not supported"), so DELETE + INSERTs can't
  // be one parameterised request. Run the DELETE on its own (no params), then one
  // parameterised INSERT per recipe — the same single-statement-per-call shape the
  // data backfills use. Replace-all: a removed recipe loses its row; deterministic
  // input → deterministic table. An empty corpus is just the DELETE (valid empty
  // table). Not a single transaction (REST has no multi-statement param batch); a
  // brief mid-rebuild window is acceptable for a derived, idempotently-rebuilt index.
  const placeholders = RECIPE_COLUMNS.map((_, j) => `?${j + 1}`).join(', ');
  const insertSql = `INSERT INTO recipes (${RECIPE_COLUMNS.join(', ')}) VALUES (${placeholders})`;
  try {
    await d1.exec('DELETE FROM recipes');
    for (const recipe of recipes) {
      await d1.query(insertSql, recipeToRow(recipe));
    }
  } catch (err) {
    console.warn(`warn: D1 projection failed — ${err.message}`);
    return;
  }
  console.log(`D1 recipes projected (${recipes.length} row(s), db ${access.databaseId.slice(0, 8)}…)`);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  // --root <dir> builds a SEPARATE data checkout (the data repo's CI runs these
  // code-repo scripts against its own content). Defaults to this repo for dev.
  const rootArg = process.argv.indexOf('--root');
  const root = rootArg !== -1 ? path.resolve(process.argv[rootArg + 1]) : REPO_ROOT;
  const { indexes, errors, warnings } = await run({ root });

  for (const w of warnings) console.warn(`warn: ${w}`);

  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`\nvalidation failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
    process.exit(1);
  }

  if (checkOnly) {
    console.log(`validation passed: 0 errors, ${warnings.length} warning(s) (--check, no write)`);
    return;
  }

  // The recipe index is no longer a committed _indexes/recipes.json file — it is the
  // D1 `recipes` table, projected below. (_indexes/ stays for the site's
  // components.json, which a different build target owns.)
  console.log(
    `recipes validated: ${Object.keys(indexes.recipes).length} recipe(s), ${warnings.length} warning(s)`
  );
  await projectToD1(indexes, root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
