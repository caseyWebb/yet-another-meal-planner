## REMOVED Requirements

### Requirement: meal_plan_ops carries open-world sides

**Reason**: `meal_plan.toml` moves from GitHub to DATA_KV (`state:<username>:meal_plan`). The `commit_changes` `meal_plan_ops` field is removed; meal plan writes go through `update_meal_plan` directly to KV. Open-world sides on planned rows are still supported — they move to the KV-native `update_meal_plan` tool interface.
**Migration**: Use `update_meal_plan` (KV-native) instead of the `meal_plan_ops` field of `commit_changes`.

## MODIFIED Requirements

### Requirement: Repo-data write tools

The system SHALL provide repo-data write tools split by persistence layer:

**GitHub-backed** (write via the atomic commit engine; these files remain in the data repo): `update_recipe`, `create_recipe`, overlay and note write tools (`add_recipe_note`, `update_recipe_note`, `remove_recipe_note`, `add_store_note`, `update_store_note`, `remove_store_note`), and the user-curated shared-corpus tools (`update_aliases`). `commit_changes` SHALL accept a batch of GitHub-only repo updates and persist them in one commit with a single summarizing message. `commit_changes` SHALL NOT accept `grocery_list_ops`, `pantry_operations`, or `meal_plan_ops` — those files no longer exist in GitHub.

**KV-backed** (write to DATA_KV; no git commit): `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, `update_stockup`, `update_staples`, `update_preferences`, `update_taste`, `update_diet_principles`, `update_kitchen`, `update_grocery_list`, `add_to_grocery_list`, `remove_from_grocery_list`. Each of these writes to the appropriate DATA_KV key (`profile:<username>` for profile fields via read-modify-write, `state:<username>:pantry` / `state:<username>:grocery_list` for session state) and returns without a `commit_sha`.

No tool in this capability SHALL write a Kroger cart or call an external service.

`update_pantry` SHALL treat an `add` operation as an **upsert**: if an item with the same name (case-insensitive) already exists in the pantry, the incoming fields SHALL be merged onto the existing entry (preserving the original `added_at`, refreshing `last_verified_at` to today, and overlaying all other supplied fields) rather than appending a duplicate. The `AppliedOp` result for an upserted add SHALL include `merged: true`; a fresh insert omits `merged` (or sets it `false`). If no matching entry exists, the item is appended as before.

Ready-to-eat, stockup, and staples retain their existing behavioral contracts (dedup, slug-keying, etc.) but are now persisted via KV write-through on `profile:<username>` rather than via GitHub commits.

#### Scenario: Recipe update persists via GitHub commit

- **WHEN** `update_recipe(slug, updates)` is called with valid objective frontmatter fields
- **THEN** the shared recipe content is committed to the GitHub data repo and the tool returns `{ slug, updated_fields }`

#### Scenario: Subjective edit writes the caller's overlay to KV, not GitHub

- **WHEN** a tenant rates a shared recipe or changes its status
- **THEN** the `overlay` field of `profile:<username>` in DATA_KV is updated via read-modify-write, and no git commit is made

#### Scenario: Pantry write goes to KV, no commit_sha

- **WHEN** `update_pantry` is called with valid operations
- **THEN** `state:<username>:pantry` in DATA_KV is updated and the tool returns `{ applied, conflicts }` without a `commit_sha`

#### Scenario: Profile field write updates KV bundle

- **WHEN** `update_taste(content)` is called
- **THEN** the `taste` field of `profile:<username>` in DATA_KV is updated via read-modify-write and no git commit is made

#### Scenario: commit_changes batch covers only GitHub-backed files

- **WHEN** `commit_changes` is called with `recipe_updates` and `cooking_log_ops`
- **THEN** those updates land in one GitHub commit and no `grocery_list_ops`, `pantry_operations`, or `meal_plan_ops` fields are accepted

#### Scenario: Ready-to-eat write targets KV profile bundle

- **WHEN** `add_draft_ready_to_eat` or `update_ready_to_eat` is called
- **THEN** the change is written to the `ready_to_eat` field of `profile:<username>` in DATA_KV, no git commit is made

#### Scenario: Pantry add for a new item inserts it

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "eggs", quantity: "12", category: "fridge" } }` and no item named "eggs" exists in KV
- **THEN** a new entry is appended to the pantry in KV and the result includes `{ op: "add", name: "eggs" }` without a `merged` flag

#### Scenario: Pantry add for an existing item merges, not duplicates

- **WHEN** `update_pantry` is called with `{ op: "add", item: { name: "olive oil", quantity: "low" } }` and an item named "olive oil" already exists in KV
- **THEN** the existing entry's `quantity` is updated to "low", `last_verified_at` is refreshed to today, `added_at` is unchanged, no duplicate row is created, and the result includes `{ op: "add", name: "olive oil", merged: true }`

#### Scenario: Staples add is deduped in KV

- **WHEN** `update_staples({ add: [{ name: "olive oil" }] })` is called and olive oil is already in the caller's staples in KV
- **THEN** no duplicate is written and `{ added: 0, removed: 0 }` is returned (no `commit_sha`)
