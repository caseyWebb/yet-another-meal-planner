#!/usr/bin/env node
// build-indexes.mjs — walk recipes/ + ready_to_eat/, validate, emit _indexes/*.json.
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
// Recommended-but-optional fields whose absence signals an incomplete migration.
// last_cooked / rating / discovered_at are legitimately null by design and are NOT warned.
const RECOMMENDED_FIELDS = ['protein', 'time_total', 'ingredients_key'];
const MEALS = ['breakfast', 'lunch', 'dinner'];

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
    let data;
    try {
      ({ data } = matter(await readFile(file, 'utf8')));
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
    if (!STATUS_ENUM.has(data.status)) {
      errors.push(`${rel}: invalid or missing "status" (got ${JSON.stringify(data.status)})`);
    }
    const missing = RECOMMENDED_FIELDS.filter(
      (f) => data[f] == null || (Array.isArray(data[f]) && data[f].length === 0)
    );
    if (missing.length) warnings.push(`${rel}: missing recommended field(s): ${missing.join(', ')}`);

    recipes[slug] = normalizeValue({
      ...data,
      slug,
      uses_components: data.uses_components ?? [],
      produces_components: data.produces_components ?? [],
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

  return { recipes, components, errors, warnings };
}

// --- ready-to-eat index --------------------------------------------------

// Takes a map of meal -> parsed TOML (already parse-checked). Returns { ready_to_eat }.
export function buildReadyToEatIndex(parsedByMeal) {
  const ready_to_eat = {};
  for (const meal of MEALS) {
    const parsed = parsedByMeal[meal];
    if (!parsed) continue;
    ready_to_eat[meal] = normalizeValue({
      items: parsed.items ?? [],
      variety_rules: parsed.variety_rules ?? {},
    });
  }
  return { ready_to_eat };
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

export async function run({ recipesDir, readyToEatDir, root = REPO_ROOT } = {}) {
  recipesDir ??= path.join(root, 'recipes');
  readyToEatDir ??= path.join(root, 'ready_to_eat');

  const { recipes, components, errors: rErr, warnings } = await buildRecipeIndexes(recipesDir);
  const { parsed, errors: tErr } = await parseCheckToml(root);

  const parsedByMeal = {};
  for (const meal of MEALS) {
    const p = parsed.get(path.join(readyToEatDir, `${meal}.toml`));
    if (p) parsedByMeal[meal] = p;
  }
  const { ready_to_eat } = buildReadyToEatIndex(parsedByMeal);

  return {
    indexes: { recipes, components, ready_to_eat },
    errors: [...rErr, ...tErr],
    warnings,
  };
}

async function writeIndexes(indexes, outDir) {
  await writeFile(path.join(outDir, 'recipes.json'), stableStringify(indexes.recipes));
  await writeFile(path.join(outDir, 'components.json'), stableStringify(indexes.components));
  await writeFile(path.join(outDir, 'ready_to_eat.json'), stableStringify(indexes.ready_to_eat));
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const { indexes, errors, warnings } = await run();

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

  const outDir = path.join(REPO_ROOT, '_indexes');
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
