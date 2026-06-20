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

### Decision: Lazy migration on first access

No big-bang data migration script. Instead, each read tool (`read_user_profile`, `read_pantry`, etc.) checks the KV key first; on a miss, it reads the corresponding GitHub file(s), populates the KV key, and returns the result. Each write tool does the same before applying the update: read KV; if empty, seed from GitHub; apply update; write KV.

**Rationale:** Zero-downtime deploy. Users' existing GitHub-backed profiles migrate transparently on their first session after deploy. No CI job, no migration script, no operator action required. The GitHub files become stale over time (orphaned but harmless).

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

**Stale GitHub profile files post-migration** → Orphaned but harmless. They'll never be read again after the lazy migration populates KV. Could prune manually or via a future cleanup utility; not a correctness issue.

**First session after deploy hits GitHub for lazy migration** → One-time cost per user, per file type, on the first session after deploy. Subsequent sessions are fully KV-native.

## Migration Plan

1. Deploy the updated Worker (new KV read/write paths, lazy migration on miss)
2. Each tenant's profile migrates transparently on their first session — no operator action
3. Update `data-revoke.yml` to delete `profile:<username>` and `state:<username>:*` keys from DATA_KV on member revocation
4. (Optional, later) Prune stale `users/<username>/` GitHub files once all tenants have migrated

**Rollback:** Revert the Worker to the previous deploy. The GitHub files are still present and unchanged; the reverted Worker reads from GitHub again. KV entries written during the new deploy are ignored (the old Worker doesn't read them). Zero data loss.

## Open Questions

None — decisions above are complete based on the explore session.
