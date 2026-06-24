## Why

Roadmap slice 3 of `cloudflare-storage-architecture` (absorbs `finish-kv-migration`). `commit_changes` exists for one reason: batching multiple GitHub-backed writes into a single git commit. As per-tenant volatile state moved to KV and now D1, its KV-bound fields were never transactional, and its remaining fields each have a standalone home:

| `commit_changes` field | standalone home |
| --- | --- |
| `recipe_updates` (objective content) | `update_recipe` / `create_recipe` |
| `recipe_updates` (rating/status) | **`rate_recipe`** (new, this change) |
| `ready_to_eat_drafts` / `_updates` | `add_draft_ready_to_eat` / `update_ready_to_eat` |
| `config_updates` (prefs/taste/diet/aliases) | `update_preferences` / `update_taste` / `update_diet_principles` / `update_aliases` |
| `cooking_log_entries` | `log_cooked` (slice 2) — field already removed |

The one capability with no clean standalone home was recipe **rating/status** — but `update_recipe` already double-duties it (objective frontmatter → shared GitHub content; rating/status → the caller's overlay, via `splitRecipeUpdate`). Rather than leave that split inside `update_recipe`, this change takes the **clean-separation** option: a dedicated `rate_recipe` owns the subjective overlay write, and `update_recipe` becomes **purely objective** (shared content only). Then `commit_changes` is deleted.

Note: AGENT_INSTRUCTIONS still tells the agent to batch via `commit_changes` using `grocery_list_ops` / `pantry_operations` — fields the `unified-user-profile-kv` change already removed. So the persona is **already drifted**; this change rewrites those flows to the granular KV/D1 tools as part of retiring the batch tool.

## What Changes

- **NEW** `rate_recipe(slug, { rating?, status? })` — writes the caller's subjective disposition (rating, effective status) for a recipe to their overlay; validates `slug` against the D1 `recipes` table; no git commit. (Overlay still lives in the KV profile bundle at this slice; it moves to D1 in slice 4, where `rate_recipe`'s backend swaps.)
- **BREAKING** `update_recipe` becomes objective-only: it no longer accepts `rating`/`status`. Those keys are rejected with a structured error directing the caller to `rate_recipe`. `splitRecipeUpdate` and the overlay-write path are removed from `update_recipe`; it writes shared GitHub content and nothing else.
- **BREAKING** `commit_changes` is **removed** entirely. The atomic multi-GitHub-commit property is gone — editing N recipes in a turn is now N commits (rare, curatorial; acceptable). All its fields route to the standalone tools above.
- Dead code removed: `splitRecipeUpdate` (or reduced to nothing), the `commit_changes` registration/handler, and any remaining batch-only helpers.
- `AGENT_INSTRUCTIONS.md` reworked (+ plugin rebuild): remove the "persist multi-write turns in one `commit_changes`" guidance; fix the already-stale `grocery_list_ops`/`pantry_operations` flows to call `update_grocery_list` / `update_pantry`; route the cooked flow to `log_cooked`, recipe activation/rating to `rate_recipe`, and draft imports/`pairs_with` to `create_recipe`/`update_recipe`.

## Capabilities

### Modified Capabilities

- `data-write-tools`: new `rate_recipe` (subjective overlay writer); `update_recipe` is objective-only; `commit_changes` removed.

## Impact

- `src/write-tools.ts`: add `rate_recipe`; strip the overlay path from `update_recipe`; delete the `commit_changes` tool + `splitRecipeUpdate`.
- `docs/TOOLS.md`: remove `commit_changes`; add `rate_recipe`; `update_recipe` objective-only.
- `AGENT_INSTRUCTIONS.md` (9 `commit_changes` sites, several already stale) + `npm run build:plugin`.
- `test/write-tools.test.ts`: drop `commit_changes` tests; add `rate_recipe`; assert `update_recipe` rejects rating/status.

## Depends On

- `d1-recipe-index` (slice 1) — `rate_recipe` validates the slug against `recipes`.
- `d1-cooking-log` (slice 2) — `log_cooked` must exist (it is the home for `cooking_log_entries`) before `commit_changes` is deleted.
