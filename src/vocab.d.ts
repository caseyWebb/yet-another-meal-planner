// Types for the plain-JS single-source vocabulary module (src/vocab.js). The
// runtime values live in the .js so scripts/build-indexes.mjs can import them
// uncompiled; this declaration gives the TypeScript side its types.

export const PROTEIN_VOCAB: readonly string[];
export const CUISINE_VOCAB: readonly string[];
export const SEASON_VOCAB: readonly string[];
export const EQUIPMENT_VOCAB: readonly string[];
