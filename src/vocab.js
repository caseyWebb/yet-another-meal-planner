// Single source of truth for the recipe controlled vocabularies (variety +
// makeability dimensions). Imported by the Worker write-time validator
// (src/validate.ts, src/kitchen.ts) and the recipe-index reconcile
// (src/recipe-projection.ts, via src/recipe-contract.js), so the write-time gate and the
// reconcile gate can never disagree about what a legal value is.
//
// Plain JS (not .ts) with a src/vocab.d.ts sidecar that gives the TypeScript side
// (Worker + vitest + tsc) its types — kept JS as a single shared no-compile module.
//
// Coarse buckets by design (`fish` not `salmon`, `shellfish` not `shrimp`) so
// variety reasoning stays reliable. Extending a vocabulary is a deliberate edit
// HERE (and a docs/SCHEMAS.md update) — nowhere else.

export const PROTEIN_VOCAB = Object.freeze([
  "chicken",
  "beef",
  "pork",
  "lamb",
  "turkey",
  "fish",
  "shellfish",
  "egg",
  "tofu",
  "vegetarian",
  "vegan",
  "mixed",
]);

export const CUISINE_VOCAB = Object.freeze([
  "american",
  "brazilian",
  "cajun",
  "caribbean",
  "chinese",
  "cuban",
  "filipino",
  "french",
  "german",
  "greek",
  "indian",
  "italian",
  "japanese",
  "korean",
  "mediterranean",
  "mexican",
  "moroccan",
  "peruvian",
  "southwestern",
  "spanish",
  "thai",
  "vietnamese",
]);

// The four meteorological seasons — a CONTROLLED vocabulary like protein/cuisine.
// A recipe's `season` array draws from this set (or is `[]` for year-round); an
// off-vocab token is rejected at write AND build time (the contract below).
export const SEASON_VOCAB = Object.freeze(["spring", "summer", "fall", "winter"]);

// Canonicalize a `season` token: trim, lowercase, and fold the `autumn` synonym to
// `fall`. Used by the read-side season match (src/retrospective.ts) so a recipe stored
// before the vocab gate still compares correctly. Note: validation is STRICT (exact
// SEASON_VOCAB membership) — this normalizer is for matching legacy values on read,
// NOT a write-time coercion.
export function normalizeSeason(value) {
  const s = String(value).trim().toLowerCase();
  return s === "autumn" ? "fall" : s;
}

// Equipment a dish is genuinely IMPOSSIBLE without — the "no recipe-preserving
// workaround exists" test, deliberately small (it doubles as the onboarding
// checklist). Drives the makeability gate.
export const EQUIPMENT_VOCAB = Object.freeze([
  "pressure-cooker",
  "sous-vide-circulator",
  "blender",
  "ice-cream-maker",
]);

// The `course` facet is OPEN (shape-validated only — the contract never checks it
// against a set, see src/recipe-contract.js / docs/ARCHITECTURE.md), so this is a
// SUGGESTION list, NOT a controlled vocabulary: it seeds the authoring vault's
// `course` dropdown (scripts/build-vault.mjs) with the conventional values while the
// field stays open (an author may still type a new course). Because nothing enforces
// it, adding/removing an entry only changes the vault's offered options — it never
// rejects a recipe. Kept here so the vault generates ALL its dropdown options from one
// module; do not wire it into validateRecipeContract (that would make `course` closed).
export const COURSE_SUGGESTIONS = Object.freeze([
  "main",
  "side",
  "breakfast",
  "lunch",
  "dessert",
  "snack",
  "appetizer",
  "soup",
  "salad",
  "sauce",
  "drink",
]);
