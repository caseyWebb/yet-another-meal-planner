# plan-presents-as-card

## Why

A member's "plan my week" rendered prose: the `plan` skill's own choreography drives `propose_meal_plan` (the data tool) and narrates — skills outrank descriptions, so the plugin path itself routes past the card — and `propose_meal_plan`'s description (the natural name-match for a planning ask) carries no redirect for skill-less hosts. The interactive week card is the intended presentation surface: its dials refine client-side at zero model cost and its Commit writes the plan itself.

## What Changes

- **The `plan` skill presents the week as the card**: step 3 renders `display_meal_plan` with the authored entries (the card IS the proposal; a card Commit saves the plan, so the chat-save step is skipped when it fires); `propose_meal_plan` remains the fallback for hosts with no card and for silent reasoning. Persona-only choreography change — same six skills, same markers, plugin republished by the deploy.
- **`propose_meal_plan`'s description gains the member-facing redirect**: agent-internal planning engine; a member-initiated plan/see ask renders `display_meal_plan` (same request shape) instead; use the data form only to reason over a proposal without showing it.
- `docs/TOOLS.md` follows both.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `consumer-facing-descriptions` — the show-me routing requirement extends to engine/widget twins: the data twin's description names the widget twin for member-initiated asks.
- `meal-plan-widget` — a member-initiated planning ask presents as the card wherever the host renders widgets; the data tool stays contract-unchanged and agent-internal.

## Impact

- `packages/plugin/AGENT_INSTRUCTIONS.md` (plan skill description + steps 3/6) → plugin republish on deploy; census unchanged (6 skills).
- `packages/worker/src/meal-plan-proposal-tool.ts` (description string only — the tool contract is untouched per `meal-plan-widget`).
- Tests: description assertion added to `route-show-me.test.ts`; `build-plugin.mjs --check` + census test re-run.
- Docs: `docs/TOOLS.md` `propose_meal_plan` section lead.
- No migrations, bindings, routes, or worker behavior changes.
