## Context

The Worker today reads per-tenant profile data (preferences, taste, diet principles, kitchen, staples, overlay, pantry, meal plan, grocery list, ready-to-eat, stockup) from GitHub on every session — 5–9 individual GitHub API calls at 100–300ms each that fan out at the start of every meal-planning turn. The recipe index already moved to DATA_KV (the `recipe-index-kv` capability), cutting list_recipes to a single KV read. This change applies the same pattern to per-tenant state, which is a better fit for KV than GitHub: it has no meaningful git history, it changes frequently (pantry, grocery list) or rarely but atomically (taste, preferences), and it's always read together at session start.

The GitHub `users/<username>/` subtree retains only genuinely historical records: `cooking_log.toml` (append-only cook events that feed `retrospective` and derive `last_cooked`), `notes/<slug>.toml` (attributed recipe observations, cross-tenant read), and `store_notes/<slug>.toml` (attributed store layout, cross-tenant read).

## Goals / Non-Goals

**Goals:**
- Move all per-tenant operational state to DATA_KV as the source of truth
- New `read_user_profile()` tool returns the full profile bundle in one KV read
- Profile update tools write to KV; no git commit for operational state
- pantry, meal_plan, grocery_list tools read/write KV
- `profile_status` checks KV key presence
- `commit_changes` drops the ops fields for files that no longer live in GitHub

**Non-Goals:**
- Migrating cooking_log, notes, or store_notes — those stay in GitHub
- Adding KV conditional-put concurrency primitives (friend-group scale, single user per session)
- Formal data export tooling (out of scope; operator can use Cloudflare KV export)

## Decisions

### Decision: One bundle key for profile, individual keys for session state

`profile:<username>` holds preferences + taste + diet_principles + kitchen + staples + overlay + ready_to_eat + stockup as one JSON blob. The session state files that change frequently and are read independently get separate keys: `state:<username>:pantry`, `state:<username>:meal_plan`, `state:<username>:grocery_list`.

**Rationale:** Profile fields are always read together at session start (`read_user_profile()` returns all of them) and updated one at a time with low frequency. One key = one read. Bundling pantry/meal_plan/grocery_list with the profile would be wasteful — they change every session and are read independently by tools that don't need the rest of the profile.

**Alternative considered:** One key per profile field (e.g. `profile:<username>:taste`). Rejected — requires N parallel KV reads instead of one, and the session-start cost of 8 parallel KV reads vs. 1 is visible even at KV latencies.

### Decision: DATA_KV for both corpus artifacts and per-tenant state

No new KV namespace. DATA_KV holds `index:recipes` (shared corpus) plus `profile:<username>` and `state:<username>:*` (per-tenant). The namespace description in env.ts is updated to reflect the expanded scope.

**Rationale:** Adding a new KV binding requires a wrangler.jsonc change, a redeployment, and operator instructions updates — cost not justified by the conceptual cleanliness of separating corpus from profile. DATA_KV already carries the recipe index, which is also read at session start alongside profile data.

### Decision: JSON serialization for KV values

Profile bundle and session state keys are serialized as JSON. Markdown fields (`taste`, `diet_principles`) are stored as JSON strings within the bundle object.

**Rationale:** KV values are opaque strings. JSON is the natural serialization for structured data in a JS/TS Worker. TOML and markdown are the source formats in GitHub; in KV they're runtime working state with no human-browsable requirement.

### Decision: Explicit migration runner at deploy time

The original design used lazy migration (GitHub fallback on KV miss in each read helper). That approach was superseded: the transform logic (TOML→JSON coercion, GitHub file reads) would live in the runtime read path forever, every read would carry a `gh` client it never needs after the first session, and production code would permanently contain dead branches.

A deploy-time migration runner replaces it:

- **`migrations/0001-unified-user-profile-kv.mjs`**: reads each tenant's files directly from the **local data repo checkout** (no GitHub API — the data repo is already checked out as the deploy job's working directory), coerces TOML→JSON, writes `profile:<username>` and `state:<username>:*` keys to DATA_KV via the Cloudflare REST API. Idempotent: skips any tenant whose `profile:<username>` key already exists.
- **`scripts/run-migrations.mjs`**: discovers `migrations/*.mjs` files in filename order, reads the applied ledger from DATA_KV key `migrations:applied` (a JSON array of migration ids), runs any ids absent from the ledger, appends each id to the ledger after success. Gracefully skips when the DATA_KV namespace id is absent from the operator's `wrangler.jsonc` (brand-new operator pre-first-deploy — nothing to migrate).
- **`data-deploy.yml`**: adds `node _code/scripts/run-migrations.mjs --root .` after the `wrangler deploy` step and before `build-indexes`.
- **Ledger in KV** (`migrations:applied`): keeps the "what's applied" record co-located with the data it gates. Avoids reintroducing the commit-back fragility the pin-back step already documents as a footgun. Idempotent migration bodies guard against the "ran but ledger write failed" edge.

The read-path helpers in `src/user-kv.ts` (`getProfileBundle`, `getPantryState`, `getMealPlanState`, `getGroceryListState`) drop their `gh` parameter and GitHub fallback entirely. A KV miss returns `null`/`[]` — no GitHub read. All callers lose the `gh` argument.

**Rationale:** The transform is a migration concern, not a read concern. After the runner executes (seconds into the deploy job), the runtime path is a pure KV read with no GitHub dependency and no dead code.

**Ordering:** Migration runs **after** `wrangler deploy`. A small window exists where the new Worker code is live but KV hasn't been populated yet. At friend-group scale this is seconds and is unlikely to affect any active session; the alternative (before-deploy) requires more conditional logic for the cold-start case and was judged not worth the complexity delta.

### Decision: Write-through (read-modify-write) for profile bundle updates

Profile update tools read the current `profile:<username>` bundle, update the relevant field, and write the whole bundle back. No partial-key KV structure.

**Rationale:** Profile writes are rare (one area at a time during configure-grocery-profile; infrequent after that), and the bundle is small (~5–20KB). The race window (two concurrent profile writes from the same user overwriting each other) is negligible at friend-group scale with a single user per session. KV doesn't support native conditional puts, so implementing a retry loop would add complexity for a scenario that won't occur in practice.

### Decision: Cross-tenant overlay reads enumerate TENANT_KV

`read_recipe_notes` currently reads group ratings from each member's `overlay.toml` via a GitHub directory walk. After this change it enumerates `tenant:*` keys from TENANT_KV to get all tenant IDs, then reads the `overlay` field from each `profile:<username>` KV key.

**Rationale:** TENANT_KV already holds the authoritative tenant directory (`tenant:<id>` keys, written by `onboard.yml`). Enumerating it is the correct way to discover all tenants. N KV reads (N = friend group size, typically 1–6) is still faster than GitHub directory + N file reads.

## Risks / Trade-offs

**No git history for profile edits** → Accepted. Git history of preference.toml or taste.md was never surfaced to users and adds no value for operational state. `cooking_log.toml` preserves the meaningful historical record.

**Read-modify-write race on profile bundle** → Low risk at single-user-per-session scale. If two concurrent writes to different profile fields collide, one update is lost. Mitigation: the next write or configure-grocery-profile session re-reads and catches the inconsistency naturally.

**Revoke leaves orphaned KV keys** → `revoke.yml` must be updated to delete `profile:<username>` and `state:<username>:*` keys from DATA_KV. The current revoke only removes TENANT_KV entries. Add the DATA_KV cleanup to the `data-revoke.yml` workflow.

**Stale GitHub profile files post-migration** → Orphaned but harmless. The runtime path no longer reads them. Manual pruning of `users/<username>/` files (everything except `cooking_log.toml`, `notes/`, `store_notes/`) is a one-time cleanup after migration completes — not a correctness issue, not automated.

**Brief empty-read window after deploy** → The new Worker is live for the seconds it takes the migration runner to complete. Reads during that window return empty KV results (not GitHub data). At friend-group scale this is acceptable; active mid-session users are unlikely.

**Brand-new operator without a provisioned namespace** → The migration runner gracefully skips when `DATA_KV` has no namespace id in `wrangler.jsonc` (pre-first-deploy). A new operator has no `users/` files to migrate anyway.

## Migration Plan

1. `wrangler deploy` — new Worker code goes live (KV read/write paths, no GitHub fallback)
2. Migration runner (`scripts/run-migrations.mjs`) fires in the same deploy job — reads `users/*/` from the data repo checkout, writes `profile:<username>` and `state:<username>:*` keys to DATA_KV for each tenant; records `0001-unified-user-profile-kv` in the `migrations:applied` ledger
3. `build-indexes` fires (existing step) — recipe index published to DATA_KV
4. Stale GitHub profile files (`preferences.toml`, `taste.md`, etc. under `users/*/`) are now inert; prune manually at leisure

**Rollback:** Revert the Worker to the previous deploy. The GitHub files are still present and unchanged; the reverted Worker reads from GitHub again. KV entries written during the new deploy are ignored (the old Worker doesn't read them). Zero data loss.

## Open Questions

None — decisions above are complete based on the explore session.
