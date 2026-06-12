## Why

The plugin ships skills (generated from `AGENT_INSTRUCTIONS.md`) **and** an MCP connector whose tool descriptions live in `src/`. Both land in the agent's context at runtime, so any fact stated in both is paid twice — and worse, some arg-contract facts (field semantics like `requires_equipment`, `perishable_ingredients`, `standalone`, `pairs_with`; the "`not_found` on empty is normal" signal) live **only** in the skills, invisible to any off-script or cold use of the MCP. Separately, the three persona **library skills** (`grocery-core`, `grocery-cart`, `grocery-corpus`) are meant to load only by reference, yet they still surface in the user's slash-command discovery — three "Internal shared rules… Not invoked on its own" entries a user should never pick. Both problems are the same shape: an entry point or a fact sitting on the wrong surface.

## What Changes

- Establish a single **ownership boundary** for description content (recorded in `CLAUDE.md` as a maintenance convention): a tool description owns *what the tool does, its params/enums/returns, and its guarantees — including negative ones* ("never auto-applies", "rejects `last_cooked`", "no freshness verdict") — plus the **data-model field semantics it reads/writes**. A skill owns *when in a flow to call it, sequencing, how to act on the result, and what to ask the user first*. Test: could a different agent, with no skills loaded, use the tool correctly and safely from its description alone?
- Apply the boundary across the tool/skill surfaces (the dedup map):
  - Move pure choreography out of tool descriptions into the skills (e.g. `commit_changes` "use at end of session"; `place_order`'s produce-reconciliation step; `add_to_grocery_list`'s walk-consequence sentence).
  - Move arg-contract/field-semantics that currently live only in skills **into** the tool descriptions (`requires_equipment`, `perishable_ingredients` on `create_recipe`/`import_recipe`; `standalone`/`pairs_with` on `read_recipe`/`list_recipes`; "due" definition on `read_meal_plan`; "`not_found` on empty is normal" on the empty-throwing reads).
  - Delete a pure duplicate (the `retrospective` period enum from the skill; canonical home is the tool, which `meal-plan` also calls).
  - Apply the **don't-gut-the-skill guardrail**: only strip a pure contract/guarantee sentence from a skill — never a line doing prerequisite-loading or orchestration.
- Mark the three library skills `user-invocable: false` (emitted by `renderLibrarySkill` in `scripts/build-plugin.mjs`) so they drop out of user discovery while remaining model-loadable by reference — **gated on a live test that claude.ai honors the flag** (worst case is benign: the flag is ignored and the libraries stay visible as today).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `consumer-facing-descriptions`: add the tool-vs-skill ownership boundary that governs which surface owns a given fact (capability/contract/field-semantics → tool; when/how/choreography → skill), plus the dedup guardrail.
- `agent-plugin-distribution`: library skills are marked `user-invocable: false` (hidden from user discovery, still reference-loadable), strengthening the existing "minimal description so it never self-triggers" mechanism.

## Impact

- **Code**: tool-description strings across `src/write-tools.ts`, `src/grocery-tools.ts`, `src/cooking-tools.ts`, `src/notes-tools.ts`, `src/order-tools.ts`, `src/tools.ts` (no behavior change — description text only). `scripts/build-plugin.mjs` `renderLibrarySkill` emits the `user-invocable: false` frontmatter.
- **Agent instructions**: targeted edits to `AGENT_INSTRUCTIONS.md` flow/policy text (regenerates skills via `npm run build:plugin`).
- **Maintenance convention**: `CLAUDE.md` gains the ownership-boundary rule and the channel-trigger principle so future tools/skills are filed consistently.
- **Verification**: a one-time live test on claude.ai that `user-invocable: false` hides the library skills from `/` AND that a workflow still pulls in `grocery-core` by reference. Build-plugin unit test asserts the flag is emitted on library skills only.
- **Sequencing**: lands after `grocery-list-batch-ops`, so the standing batch rule is the canonical skill-side statement that `commit_changes`' slimmed description points to.
- No Worker behavior change; no schema change; no breaking changes.
