## MODIFIED Requirements

### Requirement: Canonical directory layout

The repository SHALL contain the directory structure defined in PROJECT.md so that all downstream changes have a stable place to read from and write to. Directories that would otherwise be empty SHALL contain a `.gitkeep` (or equivalent placeholder) so the structure survives `git clone`.

The required directories are: `recipes/`, `skus/`, `_indexes/`, `worker/`, `scripts/`, and `.github/workflows/`. There is no shared `ready_to_eat/` directory — ready-to-eat is per-tenant state under `users/<username>/` (see "Per-user subtree layout").

#### Scenario: Fresh clone yields the full skeleton

- **WHEN** a developer runs `git clone` on the repository and lists its contents
- **THEN** every directory above is present, including any that hold no committed data yet

#### Scenario: Empty generated directories are preserved

- **WHEN** the repository is cloned and `_indexes/` and `worker/` contain no real artifacts yet
- **THEN** each still exists in the working tree via a `.gitkeep` placeholder

### Requirement: Stub data files match SCHEMAS.md

The data repository SHALL include stub TOML data files for every data file named in SCHEMAS.md, placed where each is owned per the split (shared at the root, personal under `users/<username>/`). Each stub SHALL contain a header comment naming the file and its purpose, and SHALL include commented-out example entries that match the field names and shapes in SCHEMAS.md. Stub files SHALL parse as valid (empty or comment-only) TOML.

The **shared (root)** stubs are: `substitutions.toml`, `aliases.toml`, `ingredients.toml`, and `skus/kroger.toml`. The **per-user** (`users/<username>/`) stubs are: `pantry.toml`, `preferences.toml`, `feeds.toml`, `stockup.toml`, and `ready_to_eat.toml`.

#### Scenario: Every stub TOML parses

- **WHEN** a TOML parser reads any stub data file in either repository
- **THEN** it parses without error, yielding an empty or comment-only document

#### Scenario: Stubs document their schema by example

- **WHEN** a stub data file is opened
- **THEN** it carries a header comment and commented-out example entries matching the field names and shapes in SCHEMAS.md

### Requirement: Shared data at the repository root

The data repository **root** SHALL hold the data shared by all members: the recipe **content** under `recipes/`, the shared reference data (`aliases.toml`, `ingredients.toml`, and the default `substitutions.toml`), the shared `skus/kroger.toml` SKU cache, and the generated `_indexes/`. The root SHALL NOT contain any per-member subjective or personal data — including ready-to-eat catalogs, which are per-tenant (that lives under `users/<username>/`).

#### Scenario: Root carries content and reference data

- **WHEN** the data repository root is inspected
- **THEN** it contains `recipes/`, the shared reference data and SKU cache, and `_indexes/`, and no per-member pantry, overlay, notes, or ready-to-eat catalog at the root

### Requirement: Per-user subtree layout

Each member's `users/<username>/` subtree SHALL hold only that member's personal state: `pantry.toml`, `preferences.toml`, `stockup.toml`, `grocery_list.toml`, `ready_to_eat.toml`, the narrative `taste.md` and `diet_principles.md`, the agent-writable `cooking_log.toml` and `meal_plan.toml`, `feeds.toml`, the subjective-field `overlay.toml`, recipe notes under `notes/`, any personal (unshared) recipes, and any per-member `substitutions` override. It SHALL NOT duplicate shared root content. The Worker SHALL address a member's files by prefixing repo-relative paths with their `users/<username>/`, so one member's request can never reach another member's subtree.

#### Scenario: Per-user subtree carries personal state and overlay

- **WHEN** a member's `users/<username>/` subtree is inspected
- **THEN** it contains that member's pantry/preferences/taste/diet_principles/grocery_list/stockup/ready_to_eat/cooking_log/meal_plan/feeds, an `overlay.toml` of subjective recipe fields, a `notes/` directory, and any personal recipes — and does not duplicate shared root content
