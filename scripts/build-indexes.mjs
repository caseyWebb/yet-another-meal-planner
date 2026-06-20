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
import JSON5 from 'json5';
import { PROTEIN_VOCAB, CUISINE_VOCAB, EQUIPMENT_VOCAB } from '../src/vocab.js';

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

// --- kitchen inventory validation ----------------------------------------

// Kitchen inventory is per-tenant (users/<id>/kitchen.toml) — no aggregate index.
// `owned` is the gating list: an array of EQUIPMENT_VOCAB slugs (the gate's left
// operand, kept vocabulary-clean here AND in the Worker write subset). `[notes]`
// is freeform and only parse-checked. An absent file is valid (unknown inventory).
export function validateKitchenInventory(parsed, rel) {
  const errors = [];
  if (parsed.owned != null) {
    if (!Array.isArray(parsed.owned)) {
      errors.push(`${rel}: kitchen \`owned\` must be an array of equipment slugs (got ${JSON.stringify(parsed.owned)})`);
    } else {
      for (const slug of parsed.owned) {
        if (typeof slug !== 'string' || !EQUIPMENT_VOCAB.includes(slug)) {
          errors.push(`${rel}: kitchen \`owned\` slug ${JSON.stringify(slug)} is not in the controlled vocabulary`);
        }
      }
    }
  }
  return errors;
}

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
    // sides is an optional array of FREE-TEXT open-world side names (no slug) riding
    // on the main's row — shape-only, never slug-resolved. Present-but-not-a-string-
    // array is a hard failure (like a non-array perishable_ingredients).
    if (p.sides != null && (!Array.isArray(p.sides) || p.sides.some((s) => typeof s !== 'string'))) {
      errors.push(`${where}: sides must be an array of side names (got ${JSON.stringify(p.sides)})`);
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

  // Ready-to-eat is per-tenant — structural-validate every ready_to_eat.toml the
  // walk found (root during single-user bootstrap, users/<id>/ once migrated). No index.
  const rteErr = [];
  for (const [file, obj] of parsed) {
    if (file === path.join(root, 'ready_to_eat.toml') || file.endsWith(`${path.sep}ready_to_eat.toml`)) {
      rteErr.push(...validateReadyToEatCatalog(obj, path.relative(REPO_ROOT, file)));
    }
    // Kitchen inventory is per-tenant (users/<id>/kitchen.toml) — vocab-check owned.
    if (file === path.join(root, 'kitchen.toml') || file.endsWith(`${path.sep}kitchen.toml`)) {
      rteErr.push(...validateKitchenInventory(obj, path.relative(REPO_ROOT, file)));
    }
    // Shared store registry (stores/<slug>.toml) — structural-validate each store.
    if (file.startsWith(`${path.join(root, 'stores')}${path.sep}`) && file.endsWith('.toml')) {
      rteErr.push(...validateStore(obj, path.relative(REPO_ROOT, file)));
    }
  }

  // Shared discovery sources (root-only, single files): inbox + sender allowlist.
  const discErr = [];
  const inbox = parsed.get(path.join(root, 'discoveries_inbox.toml'));
  if (inbox) discErr.push(...validateDiscoveriesInbox(inbox, 'discoveries_inbox.toml'));
  const sources = parsed.get(path.join(root, 'discovery_sources.toml'));
  if (sources) discErr.push(...validateDiscoverySources(sources, 'discovery_sources.toml'));

  const cookingLog = parsed.get(path.join(root, 'cooking_log.toml')) ?? null;
  const mealPlan = parsed.get(path.join(root, 'meal_plan.toml')) ?? null;
  const { errors: cErr, warnings: cWarn } = validateCookingArtifacts({ recipes, cookingLog, mealPlan });

  return {
    indexes: { recipes },
    errors: [...rErr, ...tErr, ...rteErr, ...discErr, ...cErr],
    warnings: [...warnings, ...cWarn],
  };
}

async function writeIndexes(indexes, outDir) {
  await writeFile(path.join(outDir, 'recipes.json'), stableStringify(indexes.recipes));
}

// Publish the recipe index to DATA_KV. Auto-detects eligibility: both
// CLOUDFLARE_API_TOKEN and the DATA_KV namespace id (read from the data repo's
// wrangler.jsonc) must be present. Warns and skips rather than failing when
// either is absent — this keeps `--check` mode and pre-first-deploy runs clean.
async function publishToKv(indexes, root) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.log('KV publish skipped: CLOUDFLARE_API_TOKEN not set');
    return;
  }

  // Read the DATA_KV namespace id from the data repo's wrangler.jsonc.
  let namespaceId;
  try {
    const wranglerPath = path.join(root, 'wrangler.jsonc');
    const wranglerConfig = JSON5.parse(await readFile(wranglerPath, 'utf8'));
    namespaceId = (wranglerConfig.kv_namespaces ?? []).find((b) => b.binding === 'DATA_KV')?.id;
  } catch {
    // wrangler.jsonc absent or unreadable
  }
  if (!namespaceId) {
    console.warn('warn: DATA_KV namespace id not in wrangler.jsonc — skipping KV publish (run deploy first to provision)');
    return;
  }

  // Resolve account id from the token (the namespace id alone is not enough for the REST API).
  let accountId;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const { result } = await res.json();
    accountId = result?.[0]?.id;
  } catch (err) {
    console.warn(`warn: KV publish failed — could not resolve Cloudflare account: ${err.message}`);
    return;
  }
  if (!accountId) {
    console.warn('warn: KV publish failed — no Cloudflare account found for this token');
    return;
  }

  const value = stableStringify(indexes.recipes);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/index%3Arecipes`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`warn: KV publish failed — ${res.status}: ${body}`);
    return;
  }
  console.log(`KV index:recipes published to DATA_KV (${namespaceId.slice(0, 8)}…)`);
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
    `indexes written: ${Object.keys(indexes.recipes).length} recipe(s), ${warnings.length} warning(s)`
  );
  await publishToKv(indexes, root);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
