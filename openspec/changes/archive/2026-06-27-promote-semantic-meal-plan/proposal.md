## Why

The codebase carries two parallel meal-plan flows: the production **dump-and-reason** flow (`meal-plan` skill — loads the whole corpus via one faceted `list_recipes()` and reasons over it) and the **experimental** `semantic-meal-plan` skill (invoke-by-name — discovery-first, then distill→retrieve→compose over `search_recipes`). The experimental flow scales with corpus size instead of dumping `O(corpus)` tokens every menu turn, surfaces just-found discoveries first, and engineers recall through diverse specs. It has earned promotion. Keeping both is now pure carrying cost: duplicated persona prose, two spec capabilities for one job (`menu-generation` + `experimental-meal-planning`), a stale generated skill, and an A/B framing in the docs that no longer reflects intent.

This change retires the old flow and promotes the experimental one to be **the** meal-plan flow. It depends on `unify-recipe-search` (the promoted flow is written against `search_recipes`).

## What Changes

- **Promote** the experimental semantic flow to the canonical `meal-plan` skill and **retire** the dump-and-reason flow. In `AGENT_INSTRUCTIONS.md` the `### Semantic menu — experimental` section becomes the `### Menu request` / `skill: meal-plan` flow; the old `### Menu request` section is deleted.
- **Strip the experimental framing** entirely: "EXPERIMENTAL", "Invoke-by-name only", "the semantic-meal-plan A/B", "Exists to evaluate retrieval-based selection", and the A/B self-correction note all go. The promoted flow auto-routes on ordinary menu requests; there is no `semantic-meal-plan` skill name anymore.
- **Fold the deterministic named-dish / recipe-seeded path into the promoted flow.** "Let's make chicken and rice this week" / "I want to make X tonight" SHALL resolve via a vibe-less `search_recipes` query spec that enumerates **all** genuine matches and disambiguates before planning — preserving the exact-title guarantee the dump-and-reason flow had and the semantic flow lacked. Open-ended weeks still use `search_recipes` semantic retrieval.
- **Fix the cross-reference** at the import-recipe prose (`AGENT_INSTRUCTIONS.md` line ~62) that names `semantic-meal-plan`.
- **Regenerate** `plugin/` and **delete** the now-stale `plugin/grocery-agent/skills/semantic-meal-plan/` directory (the build does not prune it).
- **Update docs** (`TOOLS.md`, `ARCHITECTURE.md`, `SCHEMAS.md`) to describe retrieval-based selection as the default meal-plan engine, dropping the remaining "experimental" / A/B framing.

Out of scope: no Worker code or tool changes (the flow is persona prose; the tools it calls already exist). The D1 `meal_plan` storage layer and the `search_recipes` backend are untouched.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `menu-generation`: becomes the single, canonical meal-plan flow spec. The dump-and-reason requirements (whole-corpus `list_recipes()` pre-pass load, "holistic plate reasoning over one faceted load", discovery-as-side-channel) are replaced by the discovery-first distill→retrieve→compose model (migrated in from `experimental-meal-planning`): bounded context pre-pass without a corpus dump, discovery triage before retrieval sized to the gap, recall engineered through diverse `search_recipes` specs, exploration allowance, disposition-collapses-into-import. The flow-agnostic requirements (named-dish enumeration, capture-not-flush, order handoff, perishable waste callout, weather-aware selection, variety honoring, plate-rounding, side-pairing bootstrap) are kept and updated to `search_recipes`. The smoke-test requirement is updated to the new selection path.
- `experimental-meal-planning`: **retired** — all requirements removed. The "experimental and invoke-by-name" requirement is dropped outright; the substantive requirements (distill/retrieve/compose, recall engineering, aggressive in-session import, disposition collapse, exploration allowance, discovery-triage-precedes-retrieval) migrate into `menu-generation`.

## Impact

- **Agent persona:** `AGENT_INSTRUCTIONS.md` — delete the old `### Menu request` section, promote the `### Semantic menu` section to canonical with the named-dish fold-in, strip experimental markers, fix the line-62 cross-reference.
- **Generated bundle:** `aubr build:plugin` regenerates `plugin/grocery-agent/skills/`; the stale `semantic-meal-plan/` skill directory is deleted.
- **Specs:** delta file for `menu-generation` (large MODIFY/ADD/REMOVE) absorbing the migrated requirements. `experimental-meal-planning` is **retired by deleting the capability spec** at archive time — OpenSpec rejects a spec with zero requirements, so the capability is removed outright rather than emptied (its requirements migrated into `menu-generation`; the disposition is documented in design.md). `meal-planning` and `semantic-recipe-search` untouched.
- **Docs:** `docs/TOOLS.md`, `docs/ARCHITECTURE.md`, `docs/SCHEMAS.md`.
- **Dependency:** sequenced after `unify-recipe-search`; the promoted flow references `search_recipes`. No Worker code, no tests change (no tool behavior changes; meal-plan flow validation is conversational per the smoke-test requirement).
