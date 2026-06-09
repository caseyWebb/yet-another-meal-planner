## Why

Changes 01–08 built the entire deterministic substrate — repo reads/writes, Kroger reads, the matching pipeline, order placement, the live Claude.ai connection, and pantry verification — but nothing yet wires them into the actual menu-request flow that is the point of the system. Change 09 is the milestone where the agent stops being plumbing and produces a real, actionable weekly menu proposal: pantry confirmation, Kroger context, taste/preferences, and discovery reasoning assembled into one conversation that ends with intent captured to `grocery_list.toml`.

One concrete gap blocks this: the Change 08 smoke test showed that matching a user's *named* dish ("let's make chicken and rice") to the corpus is pure LLM judgment over a status/protein/tag-filtered list with no free-text search — the agent under-counted matches and silently skipped the recipe literally titled "Chicken and Rice." A deterministic title/tag match is needed so a named dish can't be silently missed before the menu flow even begins.

## What Changes

- **`list_recipes` gains a deterministic free-text `query` param** that matches against recipe title and tags (token-AND, case-insensitive substring), so naming a dish reliably surfaces every genuine corpus match. Independently unit-testable. `docs/TOOLS.md` contract synced.
- **AGENT_INSTRUCTIONS.md gains the full menu-generation orchestration**: the context pre-pass (parallel `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, `read_taste` alongside the Change 08 pantry verification), reasoning over freeform constraints ("comfort food one night," "something Italian," "I'm feeling lazy"), meal-prep callouts, sale-based substitutions surfaced with the proposal, ready-to-eat opportunity buys, staples restock, and stockup alerts.
- **Named-dish handling is specified**: when the user names a dish, the agent uses `query`, enumerates *all* genuine matches, and disambiguates/confirms before walking the pantry — no vibe-matching a couple.
- **Capture, not flush**: an agreed menu's to-buy items land in `grocery_list.toml` via `commit_changes` only; the Kroger cart is untouched (population stays with `place_order`/06b, on explicit order).
- **A concrete conversational smoke-test script + rubric** replaces the unfalsifiable "produces a useful proposal" done-criterion — fixed seeded requests (open-ended, recipe-seeded, freeform-constraint) each with a checklist of what the response MUST surface.
- **Out of scope (unchanged):** `suggest_sequencing` stays deferred to Change 13; AGENT_INSTRUCTIONS.md step 3 remains "sequencing arrives with Change 13," and the flow tolerates an absent sequencing result.

## Capabilities

### New Capabilities
- `menu-generation`: the agent-side orchestration of a menu request end-to-end — context pre-pass, named-dish enumeration, full proposal assembly (constraints, meal-prep, sale substitutions, ready-to-eat, staples/stockup), capture-not-flush to `grocery_list.toml`, and the smoke-test rubric that validates it.

### Modified Capabilities
- `data-read-tools`: `list_recipes` adds a `query` filter param with deterministic title/tag matching semantics.

## Impact

- **Code:** `worker/src/recipes.ts` (`RecipeFilters` + `filterRecipes` query logic), `worker/src/tools.ts` (`recipeFiltersShape` + tool description), `worker/test/recipes.test.ts` (query unit tests).
- **Docs:** `docs/TOOLS.md` (`list_recipes` params/notes), `AGENT_INSTRUCTIONS.md` (menu-request orchestration — already sketched in "Common flows → Menu request," now made operational).
- **Depends on:** the `split-agent-instructions` change landing first (it creates `AGENT_INSTRUCTIONS.md` from the current `CLAUDE.md`). 09 edits the agent prose in its new home.
- **Data:** menu agreements append to `grocery_list.toml` (existing write path); no schema changes.
- **No new tools, no new external services, no new dependencies** — the only new code is the `list_recipes` query param. Everything else 09 orchestrates already exists.
