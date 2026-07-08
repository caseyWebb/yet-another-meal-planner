// Single source of truth for the recipe required-field contract (derive-recipe-facets).
//
// The descriptive recipe facets are DERIVED on the cron (see the recipe-facet-derivation
// capability), so the AUTHORED frontmatter contract governs only the hard gates and the
// identity a human authors or corrects: `title`, `source`, `time_total`, `dietary`,
// `requires_equipment`, `pairs_with`. The descriptive facets are OPTIONAL in frontmatter —
// absent → the classify pass supplies them; present → an authored override (Tier B) or a
// pre-migration legacy value (Tier A). They are validated WHEN PRESENT (so an off-vocab
// authored override is still rejected) and ignored when absent.
//
// ONE function serves both callers (the spec's single-source requirement):
//   - AUTHORED frontmatter (write tool + reconcile) omits the derived keys → relaxed.
//   - The CLASSIFIER's output (src/discovery-classify.ts `toFrontmatter`) sets EVERY key →
//     fully validated (vocab + course non-empty + the side_search_terms main rule), so the
//     classifier's contract backstop is preserved.
//
// Imported by the Worker write-time validator (src/validate.ts), the reconcile
// (src/recipe-projection.ts), and the classifier (src/discovery-classify.ts).
//
// Plain JS (not .ts) with a src/recipe-contract.d.ts sidecar — kept JS to stay a single
// shared module with no compile step; the .d.ts gives the TypeScript side its types.

import { PROTEIN_VOCAB, CUISINE_VOCAB, SEASON_VOCAB, EQUIPMENT_VOCAB } from './vocab.js';

// Required AUTHORED strings — present AND non-empty.
export const REQUIRED_NONEMPTY_STRINGS = ['title'];
// Required AUTHORED arrays — present AND non-empty. (None: `course`/`ingredients_key` are
// derived now; kept exported as an empty set for back-compat with the contract enumeration.)
export const REQUIRED_NONEMPTY_ARRAYS = [];
// Required AUTHORED scalars — present, a real value OR the explicit literal `null`.
export const REQUIRED_NULLABLE_SCALARS = ['time_total', 'source'];
// Required AUTHORED arrays — present but MAY be empty (`[]` is a legal value).
export const REQUIRED_ARRAYS = ['dietary', 'pairs_with', 'requires_equipment'];

// Optional DERIVED facets — validated WHEN PRESENT, never required. Tier B carries an
// optional authored override (vocab-validated); Tier A is derived-only (an authored value is
// a pre-migration legacy fallback). The classifier's output sets every key, so its output is
// fully validated by these same rules.
export const OPTIONAL_TIER_B = ['protein', 'cuisine', 'course', 'season', 'tags'];
export const OPTIONAL_TIER_A = ['ingredients_key', 'ingredients_full', 'perishable_ingredients', 'side_search_terms', 'meal_preppable'];

// The complete required AUTHORED-field set (for docs / tool-description enumeration).
export const REQUIRED_FIELDS = [
  ...REQUIRED_NONEMPTY_STRINGS,
  ...REQUIRED_NULLABLE_SCALARS,
  ...REQUIRED_ARRAYS,
];

function isStringArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

// Lowercased, trimmed course list (mirrors the projection's normalizeFacetCourse) for the
// main-detection the `side_search_terms` rule needs.
function courseList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((c) => String(c).trim().toLowerCase()).filter((c) => c.length > 0);
}

/**
 * Validate a recipe's frontmatter object against the contract. Returns an array of
 * human-readable error messages (each naming the offending field); an EMPTY array means
 * compliant. Pure — no I/O. The Worker throws the first message as `validation_failed`; the
 * reconcile records it.
 *
 * Required AUTHORED fields hard-fail when absent. Optional DERIVED facets are validated only
 * when present (`hasOwnProperty`) — so authored frontmatter that omits them is relaxed while
 * the classifier's full output (every key set) is strictly validated.
 */
export function validateRecipeContract(fm) {
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(fm, k);

  // --- Required AUTHORED fields ---

  // title — required, non-empty string.
  if (!has('title')) errors.push('missing required field `title`');
  else if (typeof fm.title !== 'string' || fm.title.trim() === '')
    errors.push(`\`title\` must be a non-empty string (got ${JSON.stringify(fm.title)})`);

  // time_total — required, number or null.
  if (!has('time_total')) errors.push('missing required field `time_total` (use `null` if unknown)');
  else if (fm.time_total !== null && typeof fm.time_total !== 'number')
    errors.push(`\`time_total\` must be a number or \`null\` (got ${JSON.stringify(fm.time_total)})`);

  // source — required, string or null.
  if (!has('source')) errors.push('missing required field `source` (use `null` if hand-entered)');
  else if (fm.source !== null && typeof fm.source !== 'string')
    errors.push(`\`source\` must be a string or \`null\` (got ${JSON.stringify(fm.source)})`);

  // dietary, pairs_with — required arrays of strings (may be []).
  for (const f of ['dietary', 'pairs_with']) {
    if (!has(f)) errors.push(`missing required field \`${f}\` (use \`[]\` if none)`);
    else if (!isStringArray(fm[f]))
      errors.push(`\`${f}\` must be an array of strings (got ${JSON.stringify(fm[f])})`);
  }

  // requires_equipment — required array of EQUIPMENT_VOCAB slugs (may be []). A hard gate.
  if (!has('requires_equipment')) errors.push('missing required field `requires_equipment` (use `[]` if none)');
  else if (!isStringArray(fm.requires_equipment))
    errors.push(`\`requires_equipment\` must be an array of strings (got ${JSON.stringify(fm.requires_equipment)})`);
  else
    for (const slug of fm.requires_equipment) {
      if (!EQUIPMENT_VOCAB.includes(slug))
        errors.push(
          `\`requires_equipment\` ${JSON.stringify(slug)} is not in the controlled vocabulary (one of ${EQUIPMENT_VOCAB.join(' | ')})`,
        );
    }

  // --- Optional DERIVED facets — validated WHEN PRESENT (Tier A/B) ---

  // protein / cuisine — a controlled-vocab value or `null`, when present.
  if (has('protein') && fm.protein !== null && !(typeof fm.protein === 'string' && PROTEIN_VOCAB.includes(fm.protein)))
    errors.push(
      `\`protein\` = ${JSON.stringify(fm.protein)} must be \`null\` or one of ${PROTEIN_VOCAB.join(' | ')} (never "none")`,
    );
  if (has('cuisine') && fm.cuisine !== null && !(typeof fm.cuisine === 'string' && CUISINE_VOCAB.includes(fm.cuisine)))
    errors.push(`\`cuisine\` = ${JSON.stringify(fm.cuisine)} must be \`null\` or one of ${CUISINE_VOCAB.join(' | ')}`);

  // course — a non-empty array of strings (open vocab), when present.
  if (has('course')) {
    const shapeOk = typeof fm.course === 'string' || isStringArray(fm.course);
    if (!shapeOk)
      errors.push(`\`course\` must be a string or an array of strings (got ${JSON.stringify(fm.course)})`);
    else if (courseList(fm.course).length === 0)
      errors.push('`course` must be non-empty when present (at least one course, e.g. `[main]`)');
  }

  // season — a SEASON_VOCAB array, when present (`autumn` rejected in favor of `fall`).
  if (has('season')) {
    if (!isStringArray(fm.season))
      errors.push(`\`season\` must be an array of strings (got ${JSON.stringify(fm.season)})`);
    else
      for (const s of fm.season) {
        if (!SEASON_VOCAB.includes(s))
          errors.push(
            `\`season\` ${JSON.stringify(s)} is not in the controlled vocabulary (one of ${SEASON_VOCAB.join(' | ')}; use \`fall\`, not \`autumn\`)`,
          );
      }
  }

  // tags — an array of strings, when present.
  if (has('tags') && !isStringArray(fm.tags))
    errors.push(`\`tags\` must be an array of strings (got ${JSON.stringify(fm.tags)})`);

  // ingredients_key — a non-empty array of strings, when present.
  if (has('ingredients_key') && (!isStringArray(fm.ingredients_key) || fm.ingredients_key.length === 0))
    errors.push(`\`ingredients_key\` must be a non-empty array of strings when present (got ${JSON.stringify(fm.ingredients_key)})`);

  // ingredients_full — a non-empty array of strings, when present (the classifier sets every
  // key, so a classify is REQUIRED to produce it; superset-of-ingredients_key is deliberately
  // NOT enforced — the two are independent outputs).
  if (has('ingredients_full') && (!isStringArray(fm.ingredients_full) || fm.ingredients_full.length === 0))
    errors.push(`\`ingredients_full\` must be a non-empty array of strings when present (got ${JSON.stringify(fm.ingredients_full)})`);

  // perishable_ingredients — an array of strings, when present.
  if (has('perishable_ingredients') && !isStringArray(fm.perishable_ingredients))
    errors.push(`\`perishable_ingredients\` must be an array of strings (got ${JSON.stringify(fm.perishable_ingredients)})`);

  // side_search_terms — an array of strings, when present; non-empty iff `course` includes `main`.
  if (has('side_search_terms')) {
    if (!isStringArray(fm.side_search_terms))
      errors.push(`\`side_search_terms\` must be an array of strings (got ${JSON.stringify(fm.side_search_terms)})`);
    else if (courseList(fm.course).includes('main') && fm.side_search_terms.length === 0)
      errors.push('`side_search_terms` must be non-empty for a main course');
  }

  // meal_preppable — a boolean, when present.
  if (has('meal_preppable') && typeof fm.meal_preppable !== 'boolean')
    errors.push(`\`meal_preppable\` must be a boolean when present (got ${JSON.stringify(fm.meal_preppable)})`);

  return errors;
}
