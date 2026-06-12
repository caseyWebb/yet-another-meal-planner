## 1. Record the convention

- [x] 1.1 Add the ownership boundary to `CLAUDE.md`: tool descriptions own capability/contract/guarantees + field-semantics; skills own when/how/choreography; the "could a cold caller use it safely?" test.
- [x] 1.2 Add the channel-trigger principle to `CLAUDE.md`: an entry point exists on a channel iff a real trigger exists for it (granular tool ↔ single-edit trigger; `commit_changes` field ↔ multi-write flow; `user-invocable` ↔ real user trigger).
- [x] 1.3 Note the don't-gut-the-skill guardrail: dedup may strip a contract/guarantee sentence from a skill, never a prerequisite line or orchestration step.

## 2. Move choreography out of tool descriptions (→ skills)

- [x] 2.1 `commit_changes`: drop "use at end of session to keep the git log clean"; keep the field contract. (Done in `grocery-list-batch-ops` — verified the description now leads with "the DEFAULT for any turn that makes more than one repo write".)
- [x] 2.2 `add_to_grocery_list`: keep `domain` meaning + enum; move the "so the in-store walk includes it" consequence to the store-walk skill section. (Skill already covers it at AGENT_INSTRUCTIONS:252 — trimmed from the tool.)
- [x] 2.3 `place_order`: keep the `assumed_quantity` flag + its meaning; ensure the "reconcile by-the-each produce against the recipe before flush" step lives in the place-grocery-order skill only. (Skill covers it at AGENT_INSTRUCTIONS:228 — trimmed from the tool.)

## 3. Move field-semantics into tool descriptions (← skills)

- [x] 3.1 `create_recipe` / `import_recipe`: document `requires_equipment` (already present) and `perishable_ingredients` ("would the leftover rot" test, default []) — added to `create_recipe`.
- [x] 3.2 `read_recipe` / `list_recipes`: document `standalone` (complete one-pot meal) and `pairs_with` (remembered side slugs) — added to `read_recipe` (the read that returns the frontmatter).
- [x] 3.3 `read_meal_plan`: define "due" (`planned_for` ≤ today or unset); keep "surface due rows and ask which were cooked" in the skill. (Already defined inline in the tool description — verified; skill keeps the choreography.)
- [x] 3.4 The empty-throwing reads (`read_preferences`, `read_taste`, `read_diet_principles`): document that `not_found` on an uninitialized member is normal, not an error.

## 4. Remove pure duplicates (with the guardrail)

- [x] 4.1 Remove the `retrospective` period enum from the `cooking-retrospective` skill body in `AGENT_INSTRUCTIONS.md`; confirm the skill keeps its prerequisite line and choreography. (Enum canonical in the tool; skill keeps prereq + "summarize the patterns that matter".)
- [x] 4.2 Keep `docs/TOOLS.md` in sync with every description change in groups 2–3 (no drift). (Verified: `perishable_ingredients`/`requires_equipment` already documented; the developer-facing `assumed_quantity` reconcile note remains accurate — TOOLS.md is the full contract, the runtime tool description defers choreography to the skill. No edit needed.)

## 5. Hide the library skills

- [x] 5.1 Emit `user-invocable: false` from `renderLibrarySkill` in `scripts/build-plugin.mjs` (library skills only, not workflow skills).
- [x] 5.2 Build-plugin unit test: the flag appears on `grocery-core` / depth library skills and is absent from workflow skills.
- [x] 5.3 Optionally slim `LIBRARY_DESCRIPTION` — left as-is: "Not invoked on its own" stays a useful model hint and is now enforced by the flag.

## 6. Verify + ship

- [x] 6.1 `npm run typecheck`, `npm test`, `npm run test:tooling` green; rebuild the plugin (`npm run build:plugin`) → v0.1.153.
- [ ] 6.2 **Gate:** install the rebuilt bundle on claude.ai and confirm (a) the library skills no longer appear in `/` discovery and (b) a workflow still pulls in `grocery-core` by reference. If unsupported, keep groups 1–4 and park task 5.
- [ ] 6.3 Merge to `main` (after `grocery-list-batch-ops` lands); deploy the Worker so the connector serves the updated descriptions.
