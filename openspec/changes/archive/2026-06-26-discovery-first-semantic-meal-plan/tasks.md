## 1. Build: register the discovery depth tier

- [x] 1.1 Add `'discovery'` to `DEPTH_TIERS` in `scripts/build-plugin.mjs`.
- [x] 1.2 Update build-tooling tests/fixtures in `tests/` to cover the new tier (a flow declaring `needs: discovery`, the emitted `grocery-discovery` library skill, and the prerequisite line listing it).
- [x] 1.3 Run `node scripts/build-plugin.mjs --check` and `aubr test:tooling` — both pass.

## 2. Source: extract the shared `grocery-discovery` tier

- [x] 2.1 Add a `<!-- persona: discovery -->` block to `AGENT_INSTRUCTIONS.md` (in the persona region, before `## Common flows`) holding the reusable mechanics: cheap-first triage, `parse_recipe` → classify → `create_recipe`, the `description` / `side_search_terms` / `protein` / `cuisine` / `course` / `perishable_ingredients` / `requires_equipment` field guidance, `existing_slug` dedup, and the disposition taxonomy (accept / maybe-next-time / skip / `reject_discovery`).
- [x] 2.2 Add `discovery` to the `needs:` list on the `import-recipe` marker; thin its body to reference the tier for the classify/create field detail while keeping its trigger frontmatter and the paywalled/`parse_recipe`-error paste branch.
- [x] 2.3 Add `discovery` to the `needs:` list on the `semantic-meal-plan` marker (now `cart, corpus, discovery`).
- [x] 2.4 Confirm `meal-plan` is untouched — no `needs` change, no body edit.

## 3. Source: redesign `semantic-meal-plan`

- [x] 3.1 Move discovery triage/import ahead of the `recipe_semantic_search` step: keep the step-1 parallel context load, but triage + auto-import the discovery pools and let accepted picks claim plan slots before retrieval.
- [x] 3.2 Size the `recipe_semantic_search` step to the **remaining** nights (gap-fill), and ensure sides are composed for accepted-discovery mains as well as retrieved mains in the same pass.
- [x] 3.3 Decouple import from plan: remove the "put it on the menu directly from the parse implies plan" coupling; importing is autonomous, plan placement is the accepted subset.
- [x] 3.4 Add the "maybe next time" outcome — imported-but-unplanned, surfaced as a light "saved … for later" line in the proposal (step 7), not a per-candidate prompt.
- [x] 3.5 Reconcile the disposition prose with the tier so the flow points at the shared taxonomy rather than restating classification fields.

## 4. Regenerate and verify

- [x] 4.1 Run `aubr build:plugin` (with `$GROCERY_MCP_URL` set) to regenerate `plugin/grocery-agent/`; confirm `grocery-discovery/SKILL.md` is emitted and both importing flows' prerequisite lines load it.
- [x] 4.2 Run `aubr typecheck` and the full `aubr test` / `aubr test:tooling` suites — all green.
- [x] 4.3 `npx openspec validate "discovery-first-semantic-meal-plan"` passes.

## 5. Docs lockstep

- [x] 5.1 Confirm `docs/TOOLS.md` and `docs/SCHEMAS.md` need no change (no tool/data-shape change); update `docs/ARCHITECTURE.md` only if it enumerates the persona tiers and would otherwise drift.
