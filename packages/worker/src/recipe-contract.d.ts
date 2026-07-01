// Types for the plain-JS single-source recipe required-field contract
// (src/recipe-contract.js). The runtime values live in the .js (a single shared
// no-compile module); this declaration gives the TypeScript side (Worker + vitest + tsc)
// its types.

export const REQUIRED_NONEMPTY_STRINGS: readonly string[];
export const REQUIRED_NONEMPTY_ARRAYS: readonly string[];
export const REQUIRED_NULLABLE_SCALARS: readonly string[];
export const REQUIRED_ARRAYS: readonly string[];
export const OPTIONAL_TIER_A: readonly string[];
export const OPTIONAL_TIER_B: readonly string[];
export const REQUIRED_FIELDS: readonly string[];

/**
 * Validate a recipe's frontmatter against the required-field contract. Returns an
 * array of error messages (each naming the offending field); empty means compliant.
 */
export function validateRecipeContract(fm: Record<string, unknown>): string[];
