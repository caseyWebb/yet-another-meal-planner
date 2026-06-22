## Why

Per-tenant profile data (preferences, taste, diet principles, kitchen, staples, pantry, meal plan, grocery list, overlay, ready-to-eat, stockup) lives in GitHub today even though none of it has long-term archival value and all of it is read on every session. Every meal-planning session opens with 5–9 GitHub API calls (100–300ms each) to load data that almost never changed since the last session. Moving it to DATA_KV eliminates those round-trips and reduces the nominal meal-plan pre-pass from a fan-out of individual profile reads to a single fast KV get.

## What Changes

- **NEW** `read_user_profile()` tool — returns the full profile bundle from DATA_KV in one call, replacing the batch of individual profile reads at the start of every session
- **REMOVED** `read_preferences`, `read_taste`, `read_diet_principles`, `read_kitchen`, `read_staples` — subsumed by `read_user_profile()`
- Per-tenant profile bundle (`profile:<username>`) stored in DATA_KV as the source of truth: preferences, taste, diet_principles, kitchen, staples, overlay, ready_to_eat, stockup
- Per-tenant session state stored as individual DATA_KV keys: `state:<username>:pantry`, `state:<username>:meal_plan`, `state:<username>:grocery_list`
- `profile_status` checks KV key presence instead of GitHub directory listing
- All profile/pantry/meal-plan/grocery-list update tools write to KV instead of GitHub commits — no git commit for operational state
- **BREAKING** `commit_changes` drops `grocery_list_ops`, `pantry_updates`, and `meal_plan_ops` — those files no longer exist in GitHub
- `list_recipes` and `read_recipe` overlay merge reads from KV profile bundle instead of `overlay.toml` in GitHub
- `read_recipe_notes` group ratings enumerates TENANT_KV for tenant IDs, reads overlay section from each `profile:<username>` KV key
- DATA_KV scoped description updated: it holds both shared corpus artifacts (`index:recipes`) and per-tenant profile/state (`profile:<username>`, `state:<username>:*`)
- GitHub `users/<username>/` subtree retains only genuinely historical records: `cooking_log.toml`, `notes/<slug>.toml`, `store_notes/<slug>.toml`

## Capabilities

### New Capabilities

- `user-profile-kv`: KV-native unified user profile — the `profile:<username>` bundle schema, `read_user_profile()` tool, write-through pattern for profile updates, and `profile_status` derivation from KV

### Modified Capabilities

- `data-read-tools`: `read_preferences`, `read_taste`, `read_diet_principles`, `read_kitchen`, `read_staples` removed; overlay source for `list_recipes`/`read_recipe` changes from GitHub to KV
- `data-write-tools`: profile update tools write to KV (no commit); `commit_changes` drops pantry/grocery-list/meal-plan ops
- `grocery-list`: `grocery_list.toml` moves from GitHub to DATA_KV (`state:<username>:grocery_list`)
- `meal-planning`: `meal_plan.toml` moves from GitHub to DATA_KV (`state:<username>:meal_plan`)
- `guided-onboarding`: `profile_status` checks KV; `configure-grocery-profile` reads `read_user_profile()` instead of the individual read tools

## Impact

- `src/tools.ts`: remove individual profile read tool registrations; add `read_user_profile`; update overlay, pantry, meal-plan, grocery-list reads to KV
- `src/write-tools.ts`, `src/grocery-tools.ts`, `src/pantry-write.ts`, `src/staples.ts`, `src/kitchen.ts`, `src/overlay.ts`: writes go to KV instead of GitHub commit engine
- `src/profile-status.ts`: rewrite to check KV key instead of GitHub directory listing
- `src/commit.ts`: remove pantry/grocery-list/meal-plan file handling
- `src/env.ts`: update DATA_KV JSDoc
- `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`: remove individual read tools, add `read_user_profile`, update per-tenant data model
- `AGENT_INSTRUCTIONS.md`: meal-plan pre-pass batch uses `read_user_profile()`; configure flow updated
