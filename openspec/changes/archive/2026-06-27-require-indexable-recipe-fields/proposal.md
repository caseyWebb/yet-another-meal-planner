## Why

The recipe write path is permissive by construction: `create_recipe` takes an open
`frontmatter` bag and `validateFile` only shape/vocab-checks the fields that *happen to
be present* — every check is `if (fm.x != null) …`, so omitting a field is always
legal. The tool description is a suggestion, not a contract (it doesn't even mention
`ingredients_key`). The result is silent degradation: the agent imports recipes missing
`ingredients_key`, `description`, `course`, etc., and they become second-class corpus
citizens — excluded from semantic ranking, invisible to ingredient/pantry-overlap
retrieval, dropped from the main/side compose split — with **no error and no feedback**,
so the behavior repeats. Under the semantic meal-plan flow, where retrieval *is* the
selection mechanism, an under-populated recipe is effectively invisible.

The fix is to raise the floor of "valid" from *"parses"* to *"is fully indexable"*: a
recipe write should be **atomic with respect to indexability** — you should not be able
to create a recipe that is silently un-indexed.

## What Changes

- **A strict, blunt-uniform required-field contract.** Every *system-consumed* recipe
  field (anything a deterministic consumer reads — `filterRecipes`, the semantic
  candidate row, the retrospective JOIN, the embedding, side retrieval, discovery
  dedup) MUST be **present** on every recipe, using an explicit empty form where the
  value is genuinely empty. Fields nothing filters/ranks on stay free-form and optional,
  collected in an open `extra` passthrough (the same "defined surface + open bag" posture
  `preferences` already uses).
- **BREAKING — `protein`/`cuisine`/`time_total`/`source` become explicit-`null`, not
  omittable.** A no-protein dish carries `protein: null` (never omitted, never `"none"`),
  distinguishing *"the agent decided there's no protein focus"* from *"the agent forgot."*
  This retires the `stripEmptyVarietyDimensions` "none → absent" normalization.
- **BREAKING — `create_recipe` requires the full contract** (and its description is
  corrected to enumerate every required field, `ingredients_key` included). A write
  missing any required field — or carrying a present-but-empty `ingredients_key`,
  `course`, `title`, or `description` — is rejected `validation_failed`, before any commit.
- **`update_recipe` validates the merged result** against the contract (not the patch),
  so a one-field edit on a complete recipe stays cheap, but an edit that would strip a
  required field is rejected.
- **The build validator hard-fails** on any contract violation (no warn-and-default),
  drawing the required-field spec from a single shared source (sibling to `src/vocab.js`)
  so the write-time gate and the build-time gate cannot disagree.
- **`ingredients_key` and `perishable_ingredients` are normalized at write time** (through
  the alias table) so stored names are canonical and line up across recipes, rather than
  being normalized only at read/search time.
- **Data-repo CI runs the strict validator as a required check on `main`**; the existing
  deploy-gated-on-green-CI posture makes a non-compliant hand-authored (Obsidian) commit
  block the deploy until fixed. The agent keeps committing **directly to `main`** — the
  write-time gate makes it incapable of producing a violation, so no required-PR branch
  protection (which would handcuff the agent) is introduced; CI is the backstop for human
  edits only.
- **Operator backfill (out of band).** The existing corpus is brought into compliance by
  an operator-run pass before the hard-fail flips on (the data repo is single-tenant
  today). Tasks sequence the validator/CI to land *after* the corpus is compliant.

## Capabilities

### New Capabilities
- `recipe-metadata-contract`: the canonical required-field contract for recipe
  frontmatter — the system-consumed (required-present) vs free-form (`extra`) boundary,
  the per-field empty semantics (non-empty / explicit-`null` / may-be-`[]`), the
  conditional `side_search_terms` rule, and the single shared source-of-truth module both
  validators import.

### Modified Capabilities
- `data-validation`: write-time (Worker) and build-time (Node) validation enforce the
  required-field contract and **hard-fail** on a missing required field or an off-contract
  empty; the former present-conditional, absence-tolerant checks are replaced.
- `recipe-import`: `create_recipe` requires the full contract; explicit-`null`
  protein/cuisine/source/time_total replaces omit-for-no-focus; `ingredients_key`/
  `perishable_ingredients` are alias-normalized at write; the tool description enumerates
  the required set.
- `data-write-tools`: `update_recipe` validates the **merged** recipe against the contract;
  explicit-`null` is a legal objective value (no longer stripped to absent).
- `semantic-recipe-search`: `description` is now **mandatory** on every recipe, so the
  permanent "recipe with no description is facet-only" state is removed — only the
  *transient* pre-reconcile exclusion (imported-but-not-yet-embedded) remains.
- `build-automation`: the data-repo CI gate runs the strict recipe validator as a required
  status check on `main`; deploy stays gated on green CI, making a human-authored violation
  block the deploy. No required-PR protection is added (the agent commits direct to `main`).

## Impact

- **Affected code:** `src/vocab.js` (+ a new sibling required-field spec module, imported
  by both validators) and `src/vocab.d.ts`; `src/validate.ts` (replace present-conditional
  checks with contract enforcement); `src/serialize.ts` (retire `stripEmptyVarietyDimensions`'s
  none→absent; persist explicit `null`); `src/write-tools.ts` (`buildRecipeUpdate` merged-result
  validation, write-time normalization) and the `create_recipe` builder/description in
  `src/discovery-tools.ts`; `scripts/build-indexes.mjs` (hard-fail on contract violation).
- **Docs (lockstep):** `docs/SCHEMAS.md` (the required-field contract + explicit-`null`
  semantics), `docs/TOOLS.md` (`create_recipe`/`update_recipe` required params + rejection
  contract), `AGENT_INSTRUCTIONS.md` (import-skill required-field checklist).
- **CI/infra:** a data-repo workflow (or extension of the existing one) running
  `build-indexes.mjs --check` as a required check on `main`; branch posture documented
  (no required-PR; agent direct-to-main; CI as human-edit backstop).
- **Migration:** an operator-run corpus backfill (fan-out subagents) fills/repairs every
  recipe to the contract; the validator/CI hard-fail is enabled only after the corpus is
  compliant. No D1 schema migration is required (no new columns — `null`/`[]` ride existing
  columns and the `extra` blob).
- **Non-goals:** changing any controlled-vocabulary *values*; auto-deriving `description`
  (still agent-authored); touching per-tenant fields (`favorite`/`reject`/`last_cooked`);
  multi-tenant backfill orchestration (single-tenant today).
