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
import { parse as parseToml } from 'smol-toml';
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
const COOKING_LOG_TYPES = new Set(['recipe', 'ready_to_eat', 'ad_hoc']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

// Ready-to-eat and kitchen inventory moved to DATA_KV (the profile:<username>
// bundle); they are no longer GitHub-backed, so the build validates neither.
// Both are validated at write time by the Worker (src/validate.ts via
// update_ready_to_eat / update_kitchen).

// --- shared store-registry validation ------------------------------------

// Stores are shared (stores/<slug>.toml), keyed by location — no aggregate index.
// Structural-validate one already-parsed store; returns an array of errors. The
// registry holds IDENTITY only: `slug`+`name` required; `domain` a string when
// present. Layout lives in attributed store notes (store_notes/<slug>.toml), not
// here — legacy `aisles`/`item_locations`/`doesnt_carry` keys are tolerated and
// ignored. An absent stores/ tree never reaches here (the walk skips it).
export function validateStore(parsed, rel) {
  const errors = [];
  if (typeof parsed.slug !== 'string' || !parsed.slug) {
    errors.push(`${rel}: store is missing required \`slug\``);
  }
  if (typeof parsed.name !== 'string' || !parsed.name) {
    errors.push(`${rel}: store is missing required \`name\``);
  }
  if (parsed.domain != null && typeof parsed.domain !== 'string') {
    errors.push(`${rel}: \`domain\` must be a string (got ${JSON.stringify(parsed.domain)})`);
  }
  return errors;
}

// --- shared discovery-source validation ----------------------------------

// The email discoveries inbox (root discoveries_inbox.toml) is shared and
// agent/email-written: each [[entries]] holds candidates, every candidate needs a
// `url`. Absent file is valid (no discoveries yet).
export function validateDiscoveriesInbox(parsed, rel) {
  const errors = [];
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  for (const e of entries) {
    const cands = Array.isArray(e.candidates) ? e.candidates : [];
    for (const c of cands) {
      if (typeof c.url !== 'string' || !c.url) {
        errors.push(`${rel}: inbox candidate is missing required \`url\``);
      }
    }
  }
  return errors;
}

// The inbound-newsletter allowlist (root discovery_sources.toml) is shared config:
// every [[members]]/[[senders]] entry needs a valid `address`. Absent file is valid.
export function validateDiscoverySources(parsed, rel) {
  const errors = [];
  for (const key of ['members', 'senders']) {
    const rows = Array.isArray(parsed[key]) ? parsed[key] : [];
    for (const r of rows) {
      if (typeof r.address !== 'string' || !r.address.includes('@')) {
        errors.push(`${rel}: \`${key}\` entry needs a valid \`address\` (got ${JSON.stringify(r.address)})`);
      }
    }
  }
  return errors;
}

// --- cooking-log + meal-plan validation ---------------------------------

// Validate cooking_log.toml against the recipe set. Pure: takes the already-parsed
// object (or null when the file is absent) plus the recipes map. Returns
// { errors, warnings }. (meal_plan.toml moved to DATA_KV — validated by the Worker
// at write time, not here.)
export function validateCookingArtifacts({ recipes, cookingLog }) {
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

  const { recipes, errors: rErr, warnings } = await buildRecipeIndexes(recipesDir);
  const { parsed, errors: tErr } = await parseCheckToml(root);

  // Shared store registry (stores/<slug>.toml) — structural-validate each store.
  // (ready_to_eat.toml / kitchen.toml moved to DATA_KV — no longer build-validated.)
  const storeErr = [];
  for (const [file, obj] of parsed) {
    if (file.startsWith(`${path.join(root, 'stores')}${path.sep}`) && file.endsWith('.toml')) {
      storeErr.push(...validateStore(obj, path.relative(REPO_ROOT, file)));
    }
  }

  // Shared discovery sources (root-only, single files): inbox + sender allowlist.
  const discErr = [];
  const inbox = parsed.get(path.join(root, 'discoveries_inbox.toml'));
  if (inbox) discErr.push(...validateDiscoveriesInbox(inbox, 'discoveries_inbox.toml'));
  const sources = parsed.get(path.join(root, 'discovery_sources.toml'));
  if (sources) discErr.push(...validateDiscoverySources(sources, 'discovery_sources.toml'));

  const cookingLog = parsed.get(path.join(root, 'cooking_log.toml')) ?? null;
  const { errors: cErr, warnings: cWarn } = validateCookingArtifacts({ recipes, cookingLog });

  return {
    indexes: { recipes },
    errors: [...rErr, ...tErr, ...storeErr, ...discErr, ...cErr],
    warnings: [...warnings, ...cWarn],
  };
}

// --- D1 projection -------------------------------------------------------

// The recipe index is now the D1 `recipes` table (d1-recipe-index), not a KV blob
// or a committed _indexes/recipes.json. This is the build's projection of one
// validated recipe into a table row; it MUST stay in sync with the Worker's read
// reconstruction in src/recipe-index.ts (same column ↔ frontmatter map).
//
//   * scalar columns reconstructed verbatim: title, protein, cuisine, time_total.
//   * source_url ⇄ the recipe's `source` frontmatter (renamed only at the column
//     boundary so discovery's source lookups are indexed).
//   * ingredients_key + the JSON-array columns hold a JSON value as TEXT.
//   * extra holds a JSON object of every OTHER objective field (lossless).
const RECIPE_SCALAR_COLUMNS = ['title', 'protein', 'cuisine', 'time_total'];
const RECIPE_JSON_COLUMNS = [
  'ingredients_key',
  'tags',
  'course',
  'season',
  'dietary',
  'pairs_with',
  'perishable_ingredients',
  'requires_equipment',
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

  // One atomic request: `DELETE FROM recipes` then an INSERT per recipe, sent as a
  // single semicolon-joined multi-statement SQL string with one flat positional
  // `params` array (D1's REST /query binds `?N` across the whole request and runs it
  // atomically). Replace-all: a removed recipe loses its row; deterministic input →
  // deterministic table. An empty corpus sends just the DELETE (valid empty table).
  const colCount = RECIPE_COLUMNS.length;
  const statements = ['DELETE FROM recipes'];
  const params = [];
  recipes.forEach((recipe, i) => {
    const base = i * colCount;
    const placeholders = RECIPE_COLUMNS.map((_, j) => `?${base + j + 1}`).join(', ');
    statements.push(`INSERT INTO recipes (${RECIPE_COLUMNS.join(', ')}) VALUES (${placeholders})`);
    params.push(...recipeToRow(recipe));
  });
  try {
    await d1.query(statements.join('; '), params);
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
