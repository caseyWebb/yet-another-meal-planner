# Tasks — route-show-me-asks

## 1. Tool descriptions

- [x] 1.1 `display_grocery_list`: lead with "the answer to a member's show-me / what's-on-my-list ask — renders the live interactive list"; `display_meal_plan` and `display_recipe` get the equivalent leading line for their surfaces (`packages/worker/src/grocery-widget.ts`, `meal-plan-widget.ts`, `recipe-card-widget.ts` — wherever each description string lives).
- [x] 1.2 `read_to_buy`, `read_meal_plan`, `read_recipe`: add the internal-read line — contents are for reasoning, never presented as the answer to a show-me ask (point at the matching display tool by name).

## 2. Instructions preamble

- [x] 2.1 Pass `instructions` at `McpServer` construction in `buildServer` (`packages/worker/src/tools.ts`): a few lines — show-me asks render the matching display tool; read tools are internal and never pasted as the answer; member-facing prose stays plain. No persona content.

## 3. Tests

- [x] 3.1 Description assertions: the three display descriptions contain the show-me lead; the three reads contain the internal-read line (extend `mcp-tool-gating.test.ts` or the harness's registered-tool enumeration).
- [x] 3.2 Initialize assertion: the server's initialize result carries the `instructions` preamble (contains the routing rule, does not contain persona markers like "terse" or "learn silently").

## 4. Docs + verification

- [x] 4.1 `docs/TOOLS.md`: update the affected six tool sections' opening lines to match; add one line to the registration-model section noting the initialize `instructions` routing preamble.
- [x] 4.2 `aube run typecheck`; worker suite; `openspec validate route-show-me-asks --strict`; archive the change (deltas sync into `openspec/specs/`).
