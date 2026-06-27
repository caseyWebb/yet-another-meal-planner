## 1. Promote the flow in AGENT_INSTRUCTIONS.md

- [x] 1.1 Delete the old dump-and-reason `### Menu request` section (the `skill: meal-plan` block, ~lines 88–143).
- [x] 1.2 Rename the `### Semantic menu — experimental` section to `### Menu request` and repoint its skill comment to `skill: meal-plan` (carry over the `needs:` and rewrite the `description:` to a default-routing menu/shop description — drop "EXPERIMENTAL", "Invoke ONLY when explicitly asked", and the A/B language).
- [x] 1.3 Strip every experimental/A/B marker from the promoted body: "Retrieval-based meal planning…", "Invoke-by-name only.", "the semantic-meal-plan A/B", "Exists to evaluate retrieval-based selection", and the closing "Self-correction note" A/B framing (keep its substance — widen `k`/add a spec on a recall gap — as plain guidance).
- [x] 1.4 Fold the deterministic named-dish / recipe-seeded entry point into the promoted flow: a vibe-less `search_recipes` `query` spec (with `include_unmakeable: true`) that enumerates all genuine matches and disambiguates before the pantry walk, for "make X tonight" / "let's make X this week". Open-ended weeks keep vibe-bearing retrieval.
- [x] 1.5 Fix the import-recipe cross-reference (~line 62) that names `semantic-meal-plan` → the (now canonical) meal-plan flow.
- [x] 1.6 Confirm the promoted flow's tool calls are all `search_recipes` (no residual `recipe_semantic_search`/`list_recipes`), consistent with the `unify-recipe-search` change.

## 2. Regenerate the plugin bundle

- [x] 2.1 Run `aubr build:plugin` to regenerate `plugin/grocery-agent/skills/` from the edited `AGENT_INSTRUCTIONS.md`.
- [x] 2.2 Delete the stale `plugin/grocery-agent/skills/semantic-meal-plan/` directory (the build does not prune removed skills).
- [x] 2.3 Verify `plugin/grocery-agent/skills/meal-plan/SKILL.md` is the promoted retrieval flow and carries no "experimental"/invoke-by-name framing; confirm no other generated skill references `semantic-meal-plan`.

## 3. Docs

- [x] 3.1 `docs/TOOLS.md`: drop the "experimental, semantic-meal-plan" framing on the retrieval entry; describe retrieval-based selection as the default meal-plan engine.
- [x] 3.2 `docs/ARCHITECTURE.md`: update the "semantic recipe selection (semantic-meal-plan)" section to describe the default `menu-generation` flow; remove the A/B / experimental framing.
- [x] 3.3 `docs/SCHEMAS.md`: drop "for semantic-meal-plan" qualifiers on `description`/`side_search_terms`; they back the default flow.

## 4. Verify

- [x] 4.1 `openspec validate "promote-semantic-meal-plan"` passes.
- [x] 4.2 Grep the repo (excluding `openspec/changes/archive/`) for residual `semantic-meal-plan` / "experimental" meal-plan references and confirm none remain outside this change's own delta files and archived history.
- [x] 4.3 Review the `menu-generation` delta against the prior living spec to confirm no flow-agnostic requirement (capture-not-flush, order handoff, sale-steering, full proposal assembly, to-buy assembly, variety honoring, weather-aware, conversational disposition) was dropped in the consolidation.
- [x] 4.4 `aubr typecheck` + `aubr test` + `aubr test:tooling` green (no code changed, but confirm the plugin build and tooling tests pass).
