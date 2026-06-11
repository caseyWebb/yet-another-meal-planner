## Why

The agent regularly surfaces recipes a member physically can't make — there's no record of what's in the kitchen to cook *with*. The `cook` skill papers over this by asking about equipment on every cook (a deliberate Change 15 stopgap), but suggestion and search have no signal at all, so a member without a pressure cooker still gets pressure-cooker recipes proposed. This change gives recipes a small, honest record of the equipment they genuinely require, gives each member a record of what they own, and uses the two together to deterministically keep unmakeable recipes out of browse and search — while leaving an explicit named request able to surface (flagged) and `cook` able to stop asking for what it already knows.

## What Changes

- **New per-tenant `users/<username>/kitchen.toml`** — what a member owns to cook *with*. Two structurally-separated regions: `owned` (controlled-vocab equipment slugs that **gate**) and `notes` (free-text — oven count, pan sizes, sheet trays — that informs `cook` parallelization and never gates).
- **New recipe frontmatter `requires_equipment`** — a controlled-vocabulary array of the equipment a dish is genuinely *impossible* without. Objective shared content (flows into `_indexes/recipes.json`), validated like `protein`/`cuisine` (off-vocab = hard build failure; **absent = `[]` = the common case**).
- **New `EQUIPMENT_VOCAB`** in `build-indexes.mjs` — the curated "no recipe-preserving workaround exists" list. Deliberately small (it doubles as the onboarding checklist).
- **New `read_kitchen` / `update_kitchen` tools** — parallel to the pantry read/write tools; agent-editable on user direction.
- **`list_recipes` gains a deterministic makeability gate** — joins the caller's `kitchen.toml` (as it already joins overlay + cooking-log) and, by default, drops recipes whose `requires_equipment ⊄ owned`. A new `include_unmakeable` param returns them instead, annotated with `missing_equipment`, for the named-dish enumeration path. **An empty/absent `kitchen.toml` makes the gate a no-op** (unknown ≠ doesn't-own) so an un-onboarded member never sees a gutted corpus.
- **Add-recipe path classifies equipment** — the `import-recipe` flow's classification step assigns `requires_equipment` with a conservative rubric (default empty; tag only the truly-irreplaceable); `create_recipe`/`update_recipe` accept and persist the field (the latter is the lazy backfill path for the existing corpus). `import_recipe` optionally surfaces the schema.org `tool` array as a *hint*.
- **Onboarding seeds it** — `configure-grocery-profile` gains a sixth area: a finite equipment checklist driven by the vocab, persisted via `update_kitchen`. Skippable.
- **`cook` consumes it** — reads `kitchen.toml`, asks only for what's absent, and reasons over `notes` for parallelization suggestions instead of a cold round of questions.

## Capabilities

### New Capabilities
- `kitchen-equipment`: the per-tenant `kitchen.toml` schema (the `owned`/`notes` split), the `read_kitchen`/`update_kitchen` tools, and the **makeability rule** itself (the `requires_equipment ⊆ owned` subset test, empty-inventory no-op semantics, and the `include_unmakeable` / named-request escape).

### Modified Capabilities
- `shared-corpus`: adds the `requires_equipment` recipe-frontmatter field as objective shared content (index inclusion), and `create_recipe`/`update_recipe` accepting/persisting it.
- `data-validation`: adds the `EQUIPMENT_VOCAB` controlled-vocabulary check for `requires_equipment` (off-vocab = hard build failure), defaults the field to empty (warn-only, like `pairs_with`), and structurally validates `kitchen.toml` (parses; `owned` entries are vocab slugs) in both the Node validator and the Worker write-time subset.
- `data-read-tools`: `list_recipes` joins the caller's `kitchen.toml` and applies the default makeability gate, with the `include_unmakeable` opt-out returning `missing_equipment`-annotated rows.
- `recipe-import`: the classification step assigns `requires_equipment` under the conservative rubric; `import_recipe` may surface the schema.org `tool` list as a non-authoritative hint.
- `guided-onboarding`: `configure-grocery-profile` gains the equipment-checklist area, persisted via `update_kitchen`, and skippable.

## Impact

- **Data schema**: new `users/<username>/kitchen.toml`; new `requires_equipment` key in recipe frontmatter and in `_indexes/recipes.json`. No forced migration — absent `requires_equipment` reads as `[]` (surfaces for everyone); recipes needing vital gear are backfilled lazily via `update_recipe`.
- **Worker (`src/`)**: new `read_kitchen`/`update_kitchen` tools; `list_recipes` gains the kitchen join + gate + `include_unmakeable` param; `create_recipe`/`update_recipe` pass `requires_equipment` through (loose array, matching the existing `protein`/`cuisine` write-side posture — vocab enforced at build).
- **Tooling (`scripts/`)**: `EQUIPMENT_VOCAB` + `requires_equipment` validation + index field + `kitchen.toml` structural validation in `build-indexes.mjs`; Worker write-time subset in `src/validate.ts`.
- **Agent (`AGENT_INSTRUCTIONS.md` → generated plugin skills)**: `configure-grocery-profile`, `import-recipe`, and `cook` skills updated; plugin rebuilt.
- **Docs**: `docs/SCHEMAS.md` (kitchen.toml + frontmatter field) and `docs/TOOLS.md` (new tools + `list_recipes` gate) in the same pass.
- **No breaking changes**: every new field/file is additive with a safe default.
