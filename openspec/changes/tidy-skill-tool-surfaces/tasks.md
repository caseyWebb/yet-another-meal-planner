## 1. Record the convention

- [ ] 1.1 Add the ownership boundary to `CLAUDE.md`: tool descriptions own capability/contract/guarantees + field-semantics; skills own when/how/choreography; the "could a cold caller use it safely?" test.
- [ ] 1.2 Add the channel-trigger principle to `CLAUDE.md`: an entry point exists on a channel iff a real trigger exists for it (granular tool ↔ single-edit trigger; `commit_changes` field ↔ multi-write flow; `user-invocable` ↔ real user trigger).
- [ ] 1.3 Note the don't-gut-the-skill guardrail: dedup may strip a contract/guarantee sentence from a skill, never a prerequisite line or orchestration step.

## 2. Move choreography out of tool descriptions (→ skills)

- [ ] 2.1 `commit_changes`: drop "use at end of session to keep the git log clean"; keep the field contract. (The standing batch rule from `grocery-list-batch-ops` is the canonical skill-side statement.)
- [ ] 2.2 `add_to_grocery_list`: keep `domain` meaning + enum; move the "so the in-store walk includes it" consequence to the store-walk skill section.
- [ ] 2.3 `place_order`: keep the `assumed_quantity` flag + its meaning; ensure the "reconcile by-the-each produce against the recipe before flush" step lives in the place-grocery-order skill only.

## 3. Move field-semantics into tool descriptions (← skills)

- [ ] 3.1 `create_recipe` / `import_recipe`: document `requires_equipment` (conservative tagging, over-tag hides recipes) and `perishable_ingredients` ("would the leftover rot" test, default []).
- [ ] 3.2 `read_recipe` / `list_recipes`: document `standalone` (complete one-pot meal) and `pairs_with` (remembered side slugs).
- [ ] 3.3 `read_meal_plan`: define "due" (`planned_for` ≤ today or unset); keep "surface due rows and ask which were cooked" in the skill.
- [ ] 3.4 The empty-throwing reads (`read_preferences`, `read_taste`, `read_diet_principles`): document that `not_found` on an uninitialized member is normal, not an error.

## 4. Remove pure duplicates (with the guardrail)

- [ ] 4.1 Remove the `retrospective` period enum from the `cooking-retrospective` skill body in `AGENT_INSTRUCTIONS.md`; confirm the skill keeps its prerequisite line and choreography.
- [ ] 4.2 Keep `docs/TOOLS.md` in sync with every description change in groups 2–3 (no drift).

## 5. Hide the library skills

- [ ] 5.1 Emit `user-invocable: false` from `renderLibrarySkill` in `scripts/build-plugin.mjs` (library skills only, not workflow skills).
- [ ] 5.2 Build-plugin unit test: the flag appears on `grocery-core` / depth library skills and is absent from workflow skills.
- [ ] 5.3 Optionally slim `LIBRARY_DESCRIPTION` now that the flag (not the prose) enforces non-invocation.

## 6. Verify + ship

- [ ] 6.1 `npm run typecheck`, `npm test`, `npm run test:tooling` green; rebuild the plugin (`npm run build:plugin`).
- [ ] 6.2 **Gate:** install the rebuilt bundle on claude.ai and confirm (a) the library skills no longer appear in `/` discovery and (b) a workflow still pulls in `grocery-core` by reference. If unsupported, keep groups 1–4 and park task 5.
- [ ] 6.3 Merge to `main` (after `grocery-list-batch-ops` lands); deploy the Worker so the connector serves the updated descriptions.
