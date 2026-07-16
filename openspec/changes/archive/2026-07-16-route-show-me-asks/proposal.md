# route-show-me-asks

## Why

A bare "what's on my list?" renders prose instead of the grocery card: the show-me routing rule (display tools are canonical for member-facing asks; reads are agent-internal) lives only in the `yamp-core` library skill, which loads exclusively through a workflow skill's prerequisite line — and a pure read-ask deliberately triggers no workflow skill. Members on hosts without the plugin (ChatGPT, a bare connector) never see any skill at all. The rule must live where every host reads it: the tool descriptions, with a minimal server-instructions preamble as claude.ai belt-and-braces.

## What Changes

- **Display/read tool descriptions carry the routing rule as contract.** Each widget-bearing display tool's description leads with "the answer to a show-me ask" (`display_grocery_list` for "what's on / show me my list", `display_meal_plan` for the plan, `display_recipe` for a recipe); each paired reasoning read (`read_to_buy`, `read_meal_plan`, `read_recipe`) states it is an internal read whose contents are never presented as the answer to a show-me request.
- **The MCP server's initialize `instructions` gain a minimal routing preamble** (a few lines: show-me asks render the display tool; reads are internal; member-facing prose stays plain) — deliberately NOT the persona.
- **The persona-not-in-instructions clause is scoped, not bent**: `agent-plugin-distribution`'s requirement that the persona never ride the `instructions` field is amended to name the narrow exception — a tool-routing preamble is not the persona and is permitted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `consumer-facing-descriptions` — show-me routing is added to the description/skill fact-allocation contract (it is a description-owned guarantee by the capability's own litmus test).
- `mcp-server` — the initialize result's `instructions` field carries the minimal routing preamble.
- `agent-plugin-distribution` — the persona-exclusion clause names the routing-preamble exception.

## Impact

- `packages/worker/src/tools.ts` (+ the grocery/meal-plan/recipe widget and read tool description strings; the `McpServer` construction gains `instructions`).
- Tests: description-content assertions for the three pairs; an initialize-result assertion for the preamble.
- Docs: `docs/TOOLS.md` (the affected tool sections' opening lines; a line in the registration-model section for the instructions preamble).
- No persona/plugin rebuild required (no `AGENT_INSTRUCTIONS.md` change — the core skill keeps its copy of the rule for hosts that do load it; the two are complementary halves, not duplicates: the description owns the contract, the skill owns the flow choreography around it).
- No migrations, no bindings, no new routes.
