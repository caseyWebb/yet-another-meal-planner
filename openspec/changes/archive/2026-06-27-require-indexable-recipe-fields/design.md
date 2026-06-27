## Context

The recipe write path is permissive: `create_recipe` takes `frontmatter: z.record(z.string(), z.unknown())`
(an open bag) and `validateFile` (`src/validate.ts`) checks only present fields
(`if (fm.x != null) …`), so omission is always legal. Tool descriptions are advisory and
don't even mention `ingredients_key`. The result is silent degradation: recipes import
missing system-consumed fields and become second-class (no embedding, no ingredient/
pantry-overlap match, dropped from the main/side compose split) with no feedback. Under
the semantic meal-plan flow, where retrieval *is* selection, an under-populated recipe is
effectively invisible.

The codebase already has the two halves of the fix: a shared single-source vocab module
(`src/vocab.js`, imported by both `src/validate.ts` and `scripts/build-indexes.mjs`) and a
"defined surface + open bag" precedent (`preferences`: a defined surface plus a `custom`
bag). This change applies that precedent to recipe frontmatter and routes enforcement
through the existing two-gate validation (Worker write-time + Node build-time).

## Goals / Non-Goals

**Goals:**
- Make a recipe write **atomic with respect to indexability** — a created/updated recipe
  is either fully contract-compliant or rejected, never silently un-indexed.
- One shared, blunt-uniform required-field contract enforced identically at write time and
  build time, defined once.
- Explicit-`null`/`[]` empty forms so "decided empty" is distinguishable from "forgot."
- Keep the agent committing directly to `main`; CI is the human-edit backstop.

**Non-Goals:**
- Changing any controlled-vocabulary *values* (`PROTEIN_VOCAB`/`CUISINE_VOCAB`/`EQUIPMENT_VOCAB`).
- Auto-deriving `description` (it stays agent-authored).
- Touching per-tenant fields (`favorite`/`reject`/`last_cooked`) or any D1 schema.
- Orchestrating a multi-tenant backfill (single-tenant data repo today; the operator runs
  the backfill out of band).

## Decisions

### D1: Blunt-uniform presence (all system-consumed fields required), not a targeted subset

Every field a deterministic consumer reads is required-present, even where empty is
benign. **Why over a targeted "only the harmful-if-missing fields" subset:** LLM
compliance is far more reliable against a bright-line rule ("every system-consumed field is
always present") than a per-field "is this one required?" map — and reliable agent
authoring is the actual problem being solved. "Missing field = bug" becomes unambiguous
forever, and the verbosity cost is ~zero because the agent is generating the recipe anyway.

### D2: Three empty-form shapes, with explicit `null`/`[]`

- Non-empty (`title`, `description`, `ingredients_key`, `course`) — no valid empty form.
- Explicit-`null` scalars (`protein`, `cuisine`, `time_total`, `source`) — present, value or `null`.
- May-be-empty arrays (`dietary`, `season`, `tags`, `pairs_with`, `perishable_ingredients`, `requires_equipment`).
- `side_search_terms` — present always; non-empty iff `course` includes `main`.

**Why explicit `null` for protein/cuisine over the current omit-for-no-focus:** today
absence conflates "no protein focus" with "forgot," and `stripEmptyVarietyDimensions`
actively erases the signal (`none`→absent). `protein: null` records the decision, so the
validator can demand presence without losing the legitimate no-focus case. This **retires**
the none→absent normalization in `src/serialize.ts`.

### D3: One shared contract module, two gates (mirror `vocab.js`)

Add a sibling to `src/vocab.js` (plain `.js`, since `build-indexes.mjs` imports uncompiled)
declaring the required-field set and each field's shape. `src/validate.ts` and
`scripts/build-indexes.mjs` both import it; `src/vocab.d.ts`-style typing covers the TS
side. **Why:** identical write-time and build-time verdicts by construction — the same
guarantee the vocab sets already enjoy. Alternative (duplicated lists + a parity test) is
the documented fallback only if a shared import proves infeasible.

### D4: `update_recipe` validates the merged result, not the patch

`buildRecipeUpdate` already computes `merged = { ...frontmatter, ...updates }`; the contract
check runs on `merged`. **Why:** a one-field edit on a compliant recipe stays cheap (no need
to resend all fields), while an edit that strips/empties a required field is caught. The
required-ness is a property of the stored recipe, not of every patch.

### D5: Write-time gate is the prevention; data-repo CI is the backstop; no required-PR

The Worker validator (sharing the contract) makes the agent **incapable** of committing a
violation, so the agent keeps writing directly to `main`. Data-repo CI runs
`build-indexes.mjs --check` as a required status check to catch hand-authored (Obsidian)
drift; the existing deploy-gated-on-green-CI posture blocks a deploy on a human violation.
**Why not required-PR branch protection:** "require a pull request before merging" blocks
*all* direct pushes including the commit engine's, and "require status checks" only gates PR
merges (not the synchronous direct push), so required-PR would handcuff the agent without
adding a guarantee the write-time gate doesn't already provide.

### D6: Normalize `ingredients_key`/`perishable_ingredients` at write, not only at read

`perishable_ingredients` is already alias-normalized in `buildRecipeUpdate`;
`ingredients_key` is normalized only at *search* time (`src/tools.ts`). Move
`ingredients_key` normalization to the write builders so storage is canonical and overlap
lines up across recipes. **Why:** the field is now mandatory and load-bearing for
pantry-overlap; normalizing once at write is cheaper and avoids per-query drift.

## Risks / Trade-offs

- **Existing corpus fails the moment the gate flips on** → Sequence: ship the shared
  contract + a `--check`-only path first, run the operator backfill to compliance, *then*
  enable the build hard-fail and the required CI check. The backfill is fan-out subagents on
  the single-tenant data repo.
- **Hand-authoring in Obsidian gets more verbose** → Mitigate with a documented template/
  snippet in `docs/SCHEMAS.md`; the build's error names the exact missing field, and the
  deploy gate (not a push block) means a human can still land a WIP and fix it before deploy.
- **Explicit-`null` churns existing recipes that relied on omission** → The backfill writes
  the explicit forms; the retired none→absent normalization is removed in the same pass so
  old and new behavior don't coexist.
- **Contract drift between the two validators** → Eliminated by the single shared module
  (D3); a parity test guards the fallback copy path if ever needed.
- **A future system-consumed field is added without being made required** → Documented rule
  in `recipe-metadata-contract`: promoting a field to a queryable/consumed column requires
  adding it to the shared contract in the same change.

## Migration Plan

1. Land the shared contract module + `src/validate.ts`/`build-indexes.mjs` enforcement in
   **`--check`/report mode** (or behind the same code path that the backfill can run
   against), plus the `create_recipe`/`update_recipe` description and serialize changes.
2. Operator runs the fan-out backfill on the data repo (fill/repair every recipe to the
   contract; derive `ingredients_key`, write explicit `null`/`[]`, author missing
   `description`/`course`).
3. Verify corpus compliance: `build-indexes.mjs --root <data-repo> --check` exits zero.
4. Enable the build hard-fail and add the required CI status check on the data repo's
   `main` (no required-PR protection).
5. Update docs in lockstep (`docs/SCHEMAS.md`, `docs/TOOLS.md`, `AGENT_INSTRUCTIONS.md`).

**Rollback:** the change is additive at the schema level (no D1 migration; `null`/`[]` ride
existing columns and `extra`). Reverting the validator code restores the permissive
behavior; backfilled recipes remain valid under the old rules (extra explicit fields are
harmless).

## Open Questions

- Does the build expose a clean **report-only** mode for step 1, or does the backfill run
  against the Worker write path? (Leaning on `build-indexes.mjs --check` since it already
  validates without writing.)
- Should the shared contract module also drive a generated **frontmatter template** emitted
  by `create_recipe` errors / docs, to make compliance copy-pasteable? (Nice-to-have, not
  required for correctness.)
