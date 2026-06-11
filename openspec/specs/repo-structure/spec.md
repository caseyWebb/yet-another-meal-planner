# repo-structure Specification

## Purpose

Defines the canonical on-disk layout of the grocery-agent repository: the directory skeleton, stub data files, user-curated narrative stubs, canonical doc locations, and the README/gitignore. This establishes a stable structure that all downstream changes read from and write to.
## Requirements
### Requirement: Canonical directory layout

The repository SHALL contain the directory structure defined in PROJECT.md so that all downstream changes have a stable place to read from and write to. Directories that would otherwise be empty SHALL contain a `.gitkeep` (or equivalent placeholder) so the structure survives `git clone`.

The required directories are: `recipes/`, `ready_to_eat/`, `skus/`, `_indexes/`, `worker/`, `scripts/`, and `.github/workflows/`.

#### Scenario: Fresh clone yields the full skeleton

- **WHEN** a developer runs `git clone` on the repository and lists its contents
- **THEN** every directory above is present, including any that hold no committed data yet

#### Scenario: Empty generated directories are preserved

- **WHEN** the repository is cloned and `_indexes/` and `worker/` contain no real artifacts yet
- **THEN** each still exists in the working tree via a `.gitkeep` placeholder

### Requirement: Stub data files match SCHEMAS.md

The data repository SHALL include stub TOML data files for every data file named in SCHEMAS.md, placed where each is owned per the split (shared at the root, personal under `users/<username>/`). Each stub SHALL contain a header comment naming the file and its purpose, and SHALL include commented-out example entries that match the field names and shapes in SCHEMAS.md. Stub files SHALL parse as valid (empty or comment-only) TOML.

The **shared (root)** stubs are: `substitutions.toml`, `aliases.toml`, `ingredients.toml`, `skus/kroger.toml`, `ready_to_eat/breakfast.toml`, `ready_to_eat/lunch.toml`, and `ready_to_eat/dinner.toml`. The **per-user** (`users/<username>/`) stubs are: `pantry.toml`, `preferences.toml`, `feeds.toml`, and `stockup.toml`.

#### Scenario: Every stub TOML parses

- **WHEN** a TOML parser reads any stub data file in either repository
- **THEN** it parses without error, yielding an empty or comment-only document

#### Scenario: Stubs document their schema by example

- **WHEN** a developer opens a stub data file
- **THEN** it contains a header comment and commented-out example entries whose field names match the corresponding schema in SCHEMAS.md

#### Scenario: ingredients.toml is reserved and empty

- **WHEN** a developer opens the shared corpus `ingredients.toml`
- **THEN** it is present but contains only a header comment marking it RESERVED for Phase 7, with no active entries

#### Scenario: Data files live where they are owned

- **WHEN** the data repository root and a `users/<username>/` subtree are inspected
- **THEN** shared reference/catalog/SKU files live at the root and personal files (pantry, preferences, feeds, stockup) live under `users/<username>/`, with no duplication

### Requirement: User-curated narrative stubs

The repository SHALL include stub `taste.md` and `diet_principles.md` files. Each SHALL contain the section headings shown in SCHEMAS.md with placeholder content, establishing the structure the user will fill in later.

#### Scenario: Narrative stubs exist with headings

- **WHEN** a developer opens `taste.md` or `diet_principles.md`
- **THEN** the file exists and contains the section headings from SCHEMAS.md (e.g., Loves/Dislikes/Notes; Variety targets/Restrictions/Reasoning)

### Requirement: Canonical docs are committed at defined locations

The repository SHALL commit the canonical project docs. `AGENT_INSTRUCTIONS.md` SHALL reside at the repository root and SHALL be the canonical grocery-agent operational instructions consumed by the Claude.ai project (pasted into its project instructions). `CLAUDE.md` SHALL reside at the repository root as Claude Code development guidance for working in this repo, and SHALL point to `AGENT_INSTRUCTIONS.md` for the agent persona and conversational flows. `ROADMAP.md` (renamed from `BUILD-SEQUENCE.md`) SHALL reside at the repository root. The reference docs `PROJECT.md`, `SCHEMAS.md`, and `TOOLS.md` SHALL reside under a `docs/` directory. Any references to these docs (including each root doc's pointer to the tool inventory) SHALL resolve to their `docs/` paths.

#### Scenario: Root docs are present with their distinct roles

- **WHEN** Claude Code opens the repository directory
- **THEN** it finds `CLAUDE.md` at the repository root and reads it as repo-development context, `AGENT_INSTRUCTIONS.md` at the root as the grocery-agent instruction source, and `ROADMAP.md` at the root

#### Scenario: Agent instructions are sourced from AGENT_INSTRUCTIONS.md

- **WHEN** the Claude.ai "Grocery Agent" project instructions are set or refreshed
- **THEN** their canonical source is `AGENT_INSTRUCTIONS.md`, not `CLAUDE.md`

#### Scenario: CLAUDE.md points to the agent instructions

- **WHEN** a reader opens `CLAUDE.md` looking for the agent persona or conversational flows
- **THEN** it directs them to `AGENT_INSTRUCTIONS.md` rather than containing that prose itself

#### Scenario: Reference docs live under docs/

- **WHEN** a developer looks for the project, schema, and tool references
- **THEN** `docs/PROJECT.md`, `docs/SCHEMAS.md`, and `docs/TOOLS.md` are present

#### Scenario: Doc references resolve

- **WHEN** a reader follows a root doc's pointer to the tool inventory (`docs/TOOLS.md`)
- **THEN** the referenced file exists at that path

### Requirement: README and gitignore

The repository SHALL include a `README.md` explaining the project and how to use the repo, and a `.gitignore` covering Node artifacts, OS files, editor files, and Cloudflare Worker secret files.

#### Scenario: README explains the project

- **WHEN** a developer opens `README.md`
- **THEN** it explains what the grocery agent is and how to use the repository

#### Scenario: gitignore excludes secrets and noise

- **WHEN** Worker secret files, `node_modules/`, OS files (e.g. `.DS_Store`), and editor files are present in the working tree
- **THEN** `.gitignore` prevents them from being committed

### Requirement: Single private data repository with per-user subtrees

The deployment SHALL use **one private** data repository on the operator's account (no GitHub org and no per-member repository). A single GitHub App installation on the operator's account, scoped to that repository, SHALL grant the Worker read and write access. The repository SHALL be **private** because it holds every member's personal state. Members SHALL NOT be required to own or operate any infrastructure (no Worker, no Kroger app) and SHALL NOT be required to have a GitHub account — the Worker writes on their behalf via the App, and identity is an operator-issued invite code.

#### Scenario: One private repo holds shared content plus every member's subtree

- **WHEN** the data repository is inspected
- **THEN** it is private and contains shared content/reference data at the root plus one `users/<username>/` subtree per member, all covered by a single GitHub App installation on the operator's account, with no org and no per-member repository

#### Scenario: A member owns no infrastructure and needs no GitHub account

- **WHEN** a member is onboarded
- **THEN** they need only a Claude.ai account, a Kroger account, and an operator-issued invite code — no Worker deploy, no Kroger Developer app, and no GitHub account of their own

### Requirement: Shared data at the repository root

The data repository **root** SHALL hold the data shared by all members: the recipe **content** under `recipes/`, the shared reference data (`aliases.toml`, `ingredients.toml`, and the default `substitutions.toml`), the shared `skus/kroger.toml` SKU cache, the `ready_to_eat/` catalogs, and the generated `_indexes/`. The root SHALL NOT contain any per-member subjective or personal data (that lives under `users/<username>/`).

#### Scenario: Root carries content and reference data

- **WHEN** the data repository root is inspected
- **THEN** it contains `recipes/`, the shared reference data and SKU cache, `ready_to_eat/`, and `_indexes/`, and no per-member pantry, overlay, or notes at the root

### Requirement: Per-user subtree layout

Each member's `users/<username>/` subtree SHALL hold only that member's personal state: `pantry.toml`, `preferences.toml`, `stockup.toml`, `grocery_list.toml`, the narrative `taste.md` and `diet_principles.md`, the agent-writable `cooking_log.toml` and `meal_plan.toml`, `feeds.toml`, the subjective-field `overlay.toml`, recipe notes under `notes/`, any personal (unshared) recipes, and any per-member `substitutions` override. It SHALL NOT duplicate shared root content. The Worker SHALL address a member's files by prefixing repo-relative paths with their `users/<username>/`, so one member's request can never reach another member's subtree.

#### Scenario: Per-user subtree carries personal state and overlay

- **WHEN** a member's `users/<username>/` subtree is inspected
- **THEN** it contains that member's pantry/preferences/taste/diet_principles/grocery_list/stockup/cooking_log/meal_plan/feeds, an `overlay.toml` of subjective recipe fields, a `notes/` directory, and any personal recipes — and does not duplicate shared root content

### Requirement: Data template vendored as a submodule

The repository SHALL vendor the public data-repo template (`caseyWebb/groceries-agent-data-template`) as a git submodule at `docs/data-template/`, providing an in-repo, versioned reference of the data-repo layout and the caller workflows it ships. The submodule SHALL pin a specific commit (not auto-track the template's default branch); refreshing the reference SHALL be a deliberate `git submodule update --remote` followed by committing the bumped pointer. Because the submodule is reference-only, the repository's build and test (`ci.yml`) SHALL NOT depend on it being checked out.

The repository SHALL NOT keep separate hand-maintained copies of the data-repo caller workflows under `docs/`; the submodule is the single in-repo reference. The explanatory content formerly in `docs/data-repo-workflows/README.md` — the mapping of each data-repo caller workflow to this repo's reusable workflow, and the rationale for running them in the private data repo — SHALL be preserved in `docs/SELF_HOSTING.md`, pointing at `docs/data-template/.github/workflows/` as the canonical example.

#### Scenario: Template is present as a submodule

- **WHEN** a developer initializes submodules (`git submodule update --init`) and inspects `docs/data-template/`
- **THEN** it contains the template's data layout and `.github/workflows/` caller workflows, tracked as a submodule via `.gitmodules`

#### Scenario: No duplicated caller-workflow copies remain

- **WHEN** the repository is searched for hand-maintained data-repo workflow copies
- **THEN** `docs/data-repo-workflows/` does not exist, and the caller→reusable-workflow mapping and rationale are found in `docs/SELF_HOSTING.md`

#### Scenario: CI does not require the submodule

- **WHEN** `ci.yml` runs on a checkout that has not fetched submodules
- **THEN** typecheck and the test suites still pass, because no built or tested source imports `docs/data-template/`

