// Types for the plain-JS single-source vocabulary module (src/vocab.js). The runtime
// values live in the .js (a single shared no-compile module); this declaration gives the
// TypeScript side its types.

export const PROTEIN_VOCAB: readonly string[];
export const CUISINE_VOCAB: readonly string[];
export const SEASON_VOCAB: readonly string[];
export const EQUIPMENT_VOCAB: readonly string[];
/** Open suggestion list for the `course` dropdown — NOT enforced (course is shape-only). */
export const COURSE_SUGGESTIONS: readonly string[];
/** Canonicalize a `season` token: trim, lowercase, fold `autumn` -> `fall`. */
export function normalizeSeason(value: string): string;
