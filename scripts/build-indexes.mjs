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

import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import matter from 'gray-matter';
import { parse as parseToml } from 'smol-toml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_ENUM = new Set(['active', 'draft', 'rejected', 'archived']);
// Subjective recipe fields are per-tenant (overlay + cooking_log), NOT shared
// corpus content. They are stripped from the shared index and merged at read time
// (multi-tenant-friend-group §6.1). `status`, when still present on a not-yet-
// migrated recipe, is validated leniently but never emitted to the shared index.
const SUBJECTIVE_FIELDS = ['rating', 'last_cooked', 'status'];
// Controlled vocabularies for the variety dimensions (coarse buckets — `fish`
// not `salmon`) so retrospective mixes and diet_principles rules stay reliable.
// Validated only WHEN PRESENT (absence keeps the warn-only recommended-field
// treatment). Extending a vocabulary is a deliberate edit here. See docs/SCHEMAS.md.
const PROTEIN_VOCAB = new Set([
  'chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'shellfish', 'egg', 'tofu',
  'vegetarian', 'vegan', 'mixed',
]);
const CUISINE_VOCAB = new Set([
  'american', 'brazilian', 'cajun', 'caribbean', 'chinese', 'cuban', 'filipino',
  'french', 'german', 'greek', 'indian', 'italian', 'japanese', 'korean',
  'mediterranean', 'mexican', 'moroccan', 'southwestern', 'spanish', 'thai',
  'vietnamese',
]);
const COOKING_LOG_TYPES = new Set(['recipe', 'ready_to_eat', 'ad_hoc']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Recommended-but-optional fields whose absence signals an incomplete migration.
// last_cooked / rating / discovered_at are legitimately null by design and are NOT warned.
const RECOMMENDED_FIELDS = ['protein', 'time_total', 'ingredients_key'];
const READY_TO_EAT_MEALS = new Set(['breakfast', 'lunch', 'dinner']);
const READY_TO_EAT_STATUSES = new Set(['active', 'draft', 'rejected']);
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

// --- recipe + components index ------------------------------------------

// Returns { recipes, components, errors, warnings }.
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
    if (data.protein != null && !PROTEIN_VOCAB.has(data.protein)) {
      errors.push(`${rel}: protein ${JSON.stringify(data.protein)} is not in the controlled vocabulary`);
    }
    if (data.cuisine != null && !CUISINE_VOCAB.has(data.cuisine)) {
      errors.push(`${rel}: cuisine ${JSON.stringify(data.cuisine)} is not in the controlled vocabulary`);
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!hasH2Section(content, section)) {
        errors.push(`${rel}: missing required body section "## ${section}"`);
      }
    }

    // pairs_with is a PLATING edge (recipes eaten together on one plate), distinct
    // from the produces/uses PRODUCTION edges. Array of recipe slugs; slug
    // resolution is checked once all recipes are collected (below). standalone is
    // the optional already-rounded-plate gate — a boolean when present, unset by
    // default (never backfilled), so absence is not warned.
    if (data.pairs_with != null && !Array.isArray(data.pairs_with)) {
      errors.push(`${rel}: pairs_with must be an array of recipe slugs (got ${JSON.stringify(data.pairs_with)})`);
    }
    if (data.standalone != null && typeof data.standalone !== 'boolean') {
      errors.push(`${rel}: standalone must be a boolean (got ${JSON.stringify(data.standalone)})`);
    }

    // Emit objective content only — strip the per-tenant subjective fields so the
    // shared index never carries one tenant's rating/status/last_cooked.
    const objective = { ...data };
    for (const f of SUBJECTIVE_FIELDS) delete objective[f];
    recipes[slug] = normalizeValue({
      ...objective,
      slug,
      uses_components: data.uses_components ?? [],
      produces_components: data.produces_components ?? [],
      pairs_with: Array.isArray(data.pairs_with) ? data.pairs_with : [],
    });
  }

  // Components adjacency + uses-must-resolve validation.
  const components = {};
  const ensure = (c) => (components[c] ??= { produced_by: [], used_by: [] });
  for (const [slug, r] of Object.entries(recipes)) {
    for (const c of r.produces_components) ensure(c).produced_by.push(slug);
    for (const c of r.uses_components) ensure(c).used_by.push(slug);
  }
  for (const [c, edges] of Object.entries(components)) {
    edges.produced_by.sort();
    edges.used_by.sort();
    if (edges.used_by.length && edges.produced_by.length === 0) {
      errors.push(`unresolved component reference "${c}": used by ${edges.used_by.join(', ')} but no recipe produces it`);
    }
  }

  // pairs_with plating-edge resolution: every referenced slug must be a real recipe.
  for (const [slug, r] of Object.entries(recipes)) {
    for (const target of r.pairs_with) {
      if (!(target in recipes)) {
        errors.push(`recipe "${slug}": pairs_with references unknown recipe "${target}"`);
      }
    }
  }

  return { recipes, components, errors, warnings };
}

// --- ready-to-eat catalog validation -------------------------------------

// Ready-to-eat is per-tenant (users/<id>/ready_to_eat.toml) — no aggregate index.
// Structural-validate one already-parsed catalog; returns an array of errors.
export function validateReadyToEatCatalog(parsed, rel) {
  const errors = [];
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const slugs = new Set();
  for (const it of items) {
    if (typeof it.name !== 'string' || !it.name) errors.push(`${rel}: ready-to-eat item missing required \`name\``);
    if (typeof it.slug !== 'string' || !it.slug) {
      errors.push(`${rel}: ready-to-eat item missing required \`slug\``);
      continue;
    }
    if (slugs.has(it.slug)) errors.push(`${rel}: duplicate ready-to-eat slug \`${it.slug}\``);
    slugs.add(it.slug);
    if (!READY_TO_EAT_MEALS.has(it.meal)) {
      errors.push(`${rel}: \`meal\` = ${JSON.stringify(it.meal)} is not one of breakfast | lunch | dinner`);
    }
    if (it.status != null && !READY_TO_EAT_STATUSES.has(it.status)) {
      errors.push(`${rel}: \`status\` = ${JSON.stringify(it.status)} is not one of active | draft | rejected`);
    }
    if (it.rating != null && (!Number.isInteger(it.rating) || it.rating < 1 || it.rating > 5)) {
      errors.push(`${rel}: ready-to-eat \`rating\` = ${JSON.stringify(it.rating)} must be an integer 1–5`);
    }
  }
  return errors;
}

// --- cooking-log + meal-plan validation ---------------------------------

// Validate cooking_log.toml + meal_plan.toml against the recipe set, and
// soft-check that frontmatter last_cooked agrees with the log. Pure: takes the
// already-parsed objects (or null when a file is absent) plus the recipes map.
// Returns { errors, warnings }.
export function validateCookingArtifacts({ recipes, cookingLog, mealPlan }) {
  // Accept a quoted ISO string OR a bare TOML date (smol-toml parses those as
  // Date). Returns the YYYY-MM-DD string, or null when not a valid date.
  const isoOf = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string' && ISO_DATE_RE.test(v)) return v;
    return null;
  };

  const errors = [];
  const warnings = [];
  const slugs = new Set(Object.keys(recipes));

  const entries = cookingLog && Array.isArray(cookingLog.entries) ? cookingLog.entries : [];
  const maxLogDate = new Map(); // slug -> latest cooked date
  entries.forEach((e, i) => {
    const where = `cooking_log.toml entry ${i + 1}`;
    const date = isoOf(e.date);
    if (date === null) errors.push(`${where}: invalid or missing date (${JSON.stringify(e.date)})`);
    if (!COOKING_LOG_TYPES.has(e.type)) {
      errors.push(`${where}: invalid type (${JSON.stringify(e.type)})`);
      return;
    }
    if (e.type === 'recipe') {
      if (typeof e.recipe !== 'string' || e.recipe.length === 0) {
        errors.push(`${where}: recipe entry is missing "recipe" (slug)`);
      } else if (!slugs.has(e.recipe)) {
        errors.push(`${where}: recipe entry references unknown slug "${e.recipe}"`);
      } else if (date !== null) {
        const prev = maxLogDate.get(e.recipe);
        if (prev === undefined || date > prev) maxLogDate.set(e.recipe, date);
      }
    } else if (typeof e.name !== 'string' || e.name.length === 0) {
      errors.push(`${where}: ${e.type} entry is missing "name"`);
    }
  });

  const planned = mealPlan && Array.isArray(mealPlan.planned) ? mealPlan.planned : [];
  planned.forEach((p, i) => {
    const where = `meal_plan.toml planned ${i + 1}`;
    if (typeof p.recipe !== 'string' || p.recipe.length === 0) {
      errors.push(`${where}: missing "recipe" (slug)`);
    } else if (!slugs.has(p.recipe)) {
      errors.push(`${where}: references unknown slug "${p.recipe}"`);
    }
    if (p.planned_for != null && isoOf(p.planned_for) === null) {
      errors.push(`${where}: invalid planned_for (${JSON.stringify(p.planned_for)})`);
    }
  });

  // (The former frontmatter `last_cooked` vs. max-log-date soft-check is gone:
  // last_cooked is no longer a shared-recipe field — it is a per-tenant value
  // derived from each tenant's own cooking_log at read time, so the shared index
  // build cannot and need not reconcile it.)
  void maxLogDate;

  return { errors, warnings };
}

// --- toml parse-check (whole repo) --------------------------------------

async function walkToml(dir, acc) {
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
    if (e.isDirectory()) await walkToml(full, acc);
    else if (e.isFile() && e.name.endsWith('.toml')) acc.push(full);
  }
  return acc;
}

// Parse-checks every tracked .toml. Returns { parsed: Map<path,obj>, errors }.
export async function parseCheckToml(root) {
  const errors = [];
  const parsed = new Map();
  const files = (await walkToml(root, [])).sort();
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    try {
      parsed.set(file, parseToml(await readFile(file, 'utf8')));
    } catch (err) {
      errors.push(`${rel}: TOML failed to parse — ${err.message}`);
    }
  }
  return { parsed, errors };
}

// --- orchestration -------------------------------------------------------

export async function run({ recipesDir, root = REPO_ROOT } = {}) {
  recipesDir ??= path.join(root, 'recipes');

  const { recipes, components, errors: rErr, warnings } = await buildRecipeIndexes(recipesDir);
  const { parsed, errors: tErr } = await parseCheckToml(root);

  // Ready-to-eat is per-tenant — structural-validate every ready_to_eat.toml the
  // walk found (root during single-user bootstrap, users/<id>/ once migrated). No index.
  const rteErr = [];
  for (const [file, obj] of parsed) {
    if (file === path.join(root, 'ready_to_eat.toml') || file.endsWith(`${path.sep}ready_to_eat.toml`)) {
      rteErr.push(...validateReadyToEatCatalog(obj, path.relative(REPO_ROOT, file)));
    }
  }

  const cookingLog = parsed.get(path.join(root, 'cooking_log.toml')) ?? null;
  const mealPlan = parsed.get(path.join(root, 'meal_plan.toml')) ?? null;
  const { errors: cErr, warnings: cWarn } = validateCookingArtifacts({ recipes, cookingLog, mealPlan });

  return {
    indexes: { recipes, components },
    errors: [...rErr, ...tErr, ...rteErr, ...cErr],
    warnings: [...warnings, ...cWarn],
  };
}

async function writeIndexes(indexes, outDir) {
  await writeFile(path.join(outDir, 'recipes.json'), stableStringify(indexes.recipes));
  await writeFile(path.join(outDir, 'components.json'), stableStringify(indexes.components));
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

  const outDir = path.join(root, '_indexes');
  await stat(outDir); // _indexes/ exists (Change 01 skeleton)
  await writeIndexes(indexes, outDir);
  console.log(
    `indexes written: ${Object.keys(indexes.recipes).length} recipe(s), ` +
    `${Object.keys(indexes.components).length} component(s), ${warnings.length} warning(s)`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
