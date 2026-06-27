// Single source of truth for the recipe required-field contract (blunt-uniform).
// Every system-consumed frontmatter field MUST be PRESENT on every recipe, using an
// explicit empty form (`null` / `[]`) where the value is genuinely empty. Fields that
// nothing filters or ranks on stay free-form and are NOT checked here — they pass
// through into the recipe's `extra` projection untouched.
//
// Imported by BOTH the Worker write-time validator (src/validate.ts) and the Node
// index-build validator (scripts/build-indexes.mjs), so the write-time gate and the
// build-time gate can never disagree about what a compliant recipe is.
//
// Plain JS (not .ts) on purpose, exactly like src/vocab.js: scripts/build-indexes.mjs
// runs UNCOMPILED under node, so it cannot import a .ts module. src/recipe-contract.d.ts
// gives the TypeScript side (Worker + vitest + tsc) its types.

import { PROTEIN_VOCAB, CUISINE_VOCAB, EQUIPMENT_VOCAB } from './vocab.js';

// Required strings — present AND non-empty (no valid empty form).
export const REQUIRED_NONEMPTY_STRINGS = ['title', 'description'];
// Required arrays — present AND non-empty (arrays of strings; `course` tolerates a bare
// string, normalized to a one-element array).
export const REQUIRED_NONEMPTY_ARRAYS = ['ingredients_key', 'course'];
// Required scalars — present, carrying a real value OR the explicit literal `null`.
export const REQUIRED_NULLABLE_SCALARS = ['protein', 'cuisine', 'time_total', 'source'];
// Required arrays — present but MAY be empty (`[]` is a legal value).
export const REQUIRED_ARRAYS = [
  'dietary',
  'season',
  'tags',
  'pairs_with',
  'perishable_ingredients',
  'requires_equipment',
];

// The complete required-field set (for docs / tool-description enumeration).
// `side_search_terms` is conditional (non-empty iff `course` includes `main`) and is
// validated specially below.
export const REQUIRED_FIELDS = [
  ...REQUIRED_NONEMPTY_STRINGS,
  ...REQUIRED_NONEMPTY_ARRAYS,
  ...REQUIRED_NULLABLE_SCALARS,
  ...REQUIRED_ARRAYS,
  'side_search_terms',
];

function isStringArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

// Lowercased, trimmed course list (mirrors build's normalizeCourse) for the
// main-detection the `side_search_terms` rule needs.
function courseList(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((c) => String(c).trim().toLowerCase()).filter((c) => c.length > 0);
}

/**
 * Validate a recipe's frontmatter object against the required-field contract.
 * Returns an array of human-readable error messages (each naming the offending field);
 * an EMPTY array means the recipe is compliant. Pure — no I/O. The Worker throws the
 * first message as `validation_failed`; the build pushes them all (prefixed with the
 * file path).
 */
export function validateRecipeContract(fm) {
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(fm, k);

  // Non-empty strings.
  for (const f of REQUIRED_NONEMPTY_STRINGS) {
    if (!has(f)) errors.push(`missing required field \`${f}\``);
    else if (typeof fm[f] !== 'string' || fm[f].trim() === '')
      errors.push(`\`${f}\` must be a non-empty string (got ${JSON.stringify(fm[f])})`);
  }

  // Non-empty arrays of strings.
  for (const f of REQUIRED_NONEMPTY_ARRAYS) {
    if (!has(f)) {
      errors.push(`missing required field \`${f}\``);
      continue;
    }
    if (f === 'course') {
      const shapeOk = typeof fm[f] === 'string' || isStringArray(fm[f]);
      if (!shapeOk)
        errors.push(`\`course\` must be a string or an array of strings (got ${JSON.stringify(fm[f])})`);
      else if (courseList(fm[f]).length === 0)
        errors.push('`course` must be non-empty (at least one course, e.g. `[main]`)');
    } else if (!isStringArray(fm[f]) || fm[f].length === 0) {
      errors.push(`\`${f}\` must be a non-empty array of strings (got ${JSON.stringify(fm[f])})`);
    }
  }

  // Explicit-`null` scalars — present, value or `null`.
  if (!has('protein')) errors.push('missing required field `protein` (use `null` for no protein focus)');
  else if (fm.protein !== null && !(typeof fm.protein === 'string' && PROTEIN_VOCAB.includes(fm.protein)))
    errors.push(
      `\`protein\` = ${JSON.stringify(fm.protein)} must be \`null\` or one of ${PROTEIN_VOCAB.join(' | ')} (never "none")`,
    );

  if (!has('cuisine')) errors.push('missing required field `cuisine` (use `null` if cuisine-agnostic)');
  else if (fm.cuisine !== null && !(typeof fm.cuisine === 'string' && CUISINE_VOCAB.includes(fm.cuisine)))
    errors.push(
      `\`cuisine\` = ${JSON.stringify(fm.cuisine)} must be \`null\` or one of ${CUISINE_VOCAB.join(' | ')}`,
    );

  if (!has('time_total')) errors.push('missing required field `time_total` (use `null` if unknown)');
  else if (fm.time_total !== null && typeof fm.time_total !== 'number')
    errors.push(`\`time_total\` must be a number or \`null\` (got ${JSON.stringify(fm.time_total)})`);

  if (!has('source')) errors.push('missing required field `source` (use `null` if hand-entered)');
  else if (fm.source !== null && typeof fm.source !== 'string')
    errors.push(`\`source\` must be a string or \`null\` (got ${JSON.stringify(fm.source)})`);

  // May-be-empty arrays.
  for (const f of REQUIRED_ARRAYS) {
    if (!has(f)) {
      errors.push(`missing required field \`${f}\` (use \`[]\` if none)`);
      continue;
    }
    if (!isStringArray(fm[f])) {
      errors.push(`\`${f}\` must be an array of strings (got ${JSON.stringify(fm[f])})`);
      continue;
    }
    if (f === 'requires_equipment') {
      for (const slug of fm[f]) {
        if (!EQUIPMENT_VOCAB.includes(slug))
          errors.push(
            `\`requires_equipment\` ${JSON.stringify(slug)} is not in the controlled vocabulary (one of ${EQUIPMENT_VOCAB.join(' | ')})`,
          );
      }
    }
  }

  // side_search_terms — present array; non-empty iff `course` includes `main`.
  if (!has('side_search_terms'))
    errors.push('missing required field `side_search_terms` (use `[]` for non-mains)');
  else if (!isStringArray(fm.side_search_terms))
    errors.push(`\`side_search_terms\` must be an array of strings (got ${JSON.stringify(fm.side_search_terms)})`);
  else if (courseList(fm.course).includes('main') && fm.side_search_terms.length === 0)
    errors.push('`side_search_terms` must be non-empty for a main course');

  return errors;
}
