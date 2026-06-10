## Why

The "chicken and rice" miss persists in production — but not because the `query` fix failed. The recipe titled **"Chicken and Rice"** is tagged `[easy-dinners, one-pot, american, chicken]`: **"rice" is in the title, not the tags.** When the agent reached for `list_recipes({ tags: ["chicken", "rice"] })` (tag-AND), that recipe is *structurally unfindable* — tag-AND can never match a word that lives only in the title. The `query` param (title + tags) would have found it, but the `tags` filter is still on the tool surface, and the agent picked it.

The fix is to make the right thing the only thing: remove the `tags` filter footgun and route all name/keyword lookup through a single deterministic text search over title + tags. No embeddings, no vectors — just stricter search semantics that can't be bypassed by the wrong filter.

## What Changes

- **Remove the `tags` array filter from `list_recipes`.** **BREAKING** (a tool param is removed; unknown keys are stripped by the schema, so an old `tags` argument is ignored rather than erroring — it no longer narrows). Tag matching now happens only through `query` (substring over title + tags).
- **`query` becomes the single name/keyword search over title + tags**, with **stopword stripping**: a small fixed connective set (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`) is dropped before token-AND matching. So `"chicken and rice"` ≡ `"chicken rice"` → returns *all three* chicken-rice dishes (Chicken and Rice via title, Arroz Caldo + Galinhada Mineira via tags), instead of the connective `and` narrowing the result to the one title that contains it.
- **Keep** the structured filters `protein`, `cuisine`, `season`, `dietary`, `status`, `max_time_total`, `not_cooked_since`, `exclude_cooked_within_days`. Only the name-ish `tags` facet (redundant with text search and the source of the misuse) is removed.
- **Re-point name searches at `query`** in the tool description and `AGENT_INSTRUCTIONS.md` (there is no tag filter; use `query`).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `data-read-tools`: `list_recipes` drops the `tags` array filter; the `query` filter (introduced by `menu-generation-flow`) becomes the single title+tags text search and gains stopword stripping.

## Impact

- **Sequencing:** depends on `menu-generation-flow` (which introduced `query`) being **archived first**, so the `query` requirement is in the live spec for this change to modify. Apply/archive order: `menu-generation-flow` → `list-recipes-text-search`.
- **Code:** `worker/src/recipes.ts` (drop `tags` from `RecipeFilters`/`filterRecipes`; stopword strip in query tokenization), `worker/src/tools.ts` (drop `tags` from the schema; description), `worker/test/recipes.test.ts`.
- **Docs/instructions:** `docs/TOOLS.md` (`list_recipes` params), `AGENT_INSTRUCTIONS.md` (named-dish search via `query`).
- **Behavior:** named-dish lookup is deterministic and phrasing-robust; a title-only keyword can no longer be missed by a tag filter.
