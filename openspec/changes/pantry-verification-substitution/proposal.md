## Why

A menu request must begin by reconciling a recipe's ingredients against the pantry — what's on hand, what to buy, what might have drifted — but no tool does this yet. The matching pipeline that exists (`match_ingredient_to_kroger_sku`) was built for clean LLM-supplied terms and SKU resolution, not raw recipe lines, and it explicitly defers substitution to a `propose_substitutions` tool that has never been built. This change builds the pantry side of the menu-request foundation so the agent can walk a recipe deterministically instead of eyeballing the pantry file. (Change 08 in `ROADMAP.md`; decisions stamped 2026-06-09.)

## What Changes

- **New `parseRecipeIngredient()`** — turns a free-text, price-annotated recipe line (`1.25 lbs. boneless, skinless chicken thighs (4-5 thighs) ($4.59)`) into a clean ingredient name by stripping the quantity/unit, trailing/leading prep descriptors, `(...)` parentheticals, and the `($x.xx)` price annotation, then feeding the existing `normalizeIngredient()` + `aliases.toml` step from the `ingredient-matching` capability. Detects an `optional` marker. Shared by both verify tools and reusable by `place_order`'s `menu_needs` path.
- **New `verify_pantry_for_recipe(slug)`** — parses a recipe's `## Ingredients` and walks each against the pantry. Returns **facts, not freshness verdicts**: `in_pantry` (exact matches, each with age metadata), `possible_matches` (fuzzy candidates the agent confirms), `not_in_pantry` (to-buy), `optional` (non-blocking), and `inventory_substitutes_available`. **No `have_stale` bucket** — the tool surfaces `last_verified_at` / `days_since_verified` / `category` / `prepared_from` and the agent decides which items warrant a "still good?" prompt (resolved via the existing `mark_pantry_verified`).
- **New `verify_pantry_for_candidates(slugs)`** — same walk aggregated over multiple candidate recipes (open-ended menu requests), deduped by parsed name, with each `not_in_pantry` / `possible_matches` / `inventory_substitutes_available` entry carrying `for_recipes` attribution.
- **New `propose_substitutions(ingredient, mode)`** — deterministic application of `substitutions.toml` rules. `inventory` mode surfaces acceptable alternatives present in the pantry; `sale` mode fetches current Kroger flyer/price data **internally** and surfaces alternatives on sale. Empty until `substitutions.toml` is seeded — expected, not a fault.
- **Matching never guesses (decided):** exact normalized match → `in_pantry`; anything inexact → `possible_matches` for the agent to confirm or reject. No silent false-misses, no silent false-positives. A confirmed fuzzy match is the natural place to *suggest* seeding an `aliases.toml` entry (suggest only — that file is edit-when-directed).
- **Presence-only:** verify reports have-it / don't-have-it, never quantity sufficiency; netting required amounts stays with `place_order` partials (order-placement capability).
- **`suggest_sequencing` is explicitly out of scope** — it moves to Change 13, which seeds the component vocabulary it walks. The menu-request flow tolerates its absence until then.
- **`docs/TOOLS.md` / `docs/PROJECT.md`** are already reconciled to the new verify contract. **`CLAUDE.md`** menu-request orchestration (confirm `possible_matches`, ask before adding missing optionals, suggest alias seeding, inventory-substitution timing) is updated as part of this change.

## Capabilities

### New Capabilities
- `pantry-verification`: The recipe-ingredient parser (`parseRecipeIngredient`) and the two verify tools (`verify_pantry_for_recipe`, `verify_pantry_for_candidates`) — their return shape (`in_pantry` with age metadata / `possible_matches` / `not_in_pantry` / `optional` / `inventory_substitutes_available`), the exact-vs-fuzzy matching contract, the no-`have_stale` facts-not-verdicts freshness model, optional-ingredient handling, presence-only scope, and candidate aggregation with `for_recipes` attribution.
- `ingredient-substitution`: `propose_substitutions(ingredient, mode)` — deterministic `substitutions.toml` rule application, `inventory` vs `sale` modes, sale-mode internal Kroger fetch, and the dormant-until-seeded behavior. Fulfils the forward reference from the `ingredient-matching` spec (the matcher never substitutes; this tool is the sole substitution owner under user confirmation).

### Modified Capabilities
<!-- None. The verify tools are new (not changes to read_pantry in data-read-tools); ingredient-matching's normalizeIngredient is reused as-is (no behavior change) and its existing forward reference to propose_substitutions is fulfilled, not modified; mark_pantry_verified already exists in data-write-tools. -->

## Impact

- **New Worker code** (`worker/src/`): `parseRecipeIngredient()` (likely a new module reusing `matching.ts`'s `normalizeIngredient`); the two verify tools and `propose_substitutions` registered in `tools.ts`; a fuzzy-candidate matcher for `possible_matches`.
- **Reuses:** `ingredient-matching` (`normalizeIngredient` + `aliases.toml`), `kroger-integration` (`kroger_flyer`/prices for sale-mode), the recipe-site `## Ingredients` H2 structural contract (guarantees a parseable section), `data-write-tools` (`mark_pantry_verified`), and the Change 04 structured-error convention.
- **Config consumed (read-only here):** `substitutions.toml` and `aliases.toml` — both empty user-curated files that light up the substitution and alias layers as they are seeded over time.
- **Docs:** `docs/TOOLS.md` and `docs/PROJECT.md` already reconciled; `CLAUDE.md` menu-request orchestration updated in this change.
- **Out of scope:** `suggest_sequencing` (Change 13), quantity/partial reconciliation (order-placement), and deterministic shelf-life staleness (Change 12 adds a `past_typical_fresh_life` hint later without changing the verify return shape).
- **Dependencies:** Change 07 and all prior changes (01–07) are archived.
