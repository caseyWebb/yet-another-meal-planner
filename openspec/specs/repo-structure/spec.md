# repo-structure Specification

## Purpose

Defines the canonical on-disk layout of the grocery-agent repository: the directory skeleton, stub data files, user-curated narrative stubs, canonical doc locations, and the README/gitignore. This establishes a stable structure that all downstream changes read from and write to.
## Requirements
### Requirement: Canonical directory layout

The repository SHALL contain the directory structure described in `docs/ARCHITECTURE.md` so that all downstream changes have a stable place to read from and write to. Directories that would otherwise be empty SHALL contain a `.gitkeep` (or equivalent placeholder) so the structure survives `git clone`.

The required directories are: `recipes/`, `skus/`, `_indexes/`, `worker/`, `scripts/`, and `.github/workflows/`. There is no shared `ready_to_eat/` directory — ready-to-eat is per-tenant D1 state (the `ready_to_eat` table).

#### Scenario: Fresh clone yields the full skeleton

- **WHEN** a developer runs `git clone` on the repository and lists its contents
- **THEN** every directory above is present, including any that hold no committed data yet

#### Scenario: Empty generated directories are preserved

- **WHEN** the repository is cloned and `_indexes/` and `worker/` contain no real artifacts yet
- **THEN** each still exists in the working tree via a `.gitkeep` placeholder

### Requirement: Stub data files match SCHEMAS.md

The data repository SHALL include stub TOML data files for every data file named in SCHEMAS.md, placed where each is owned per the split (shared at the root, personal under `users/<username>/`). Each stub SHALL contain a header comment naming the file and its purpose, and SHALL include commented-out example entries that match the field names and shapes in SCHEMAS.md. Stub files SHALL parse as valid (empty or comment-only) TOML.

The **shared (root)** stubs are: `substitutions.toml`, `aliases.toml`, and `skus/kroger.toml`. The **per-user** (`users/<username>/`) stubs are: `pantry.toml`, `preferences.toml`, `feeds.toml`, `stockup.toml`, and `ready_to_eat.toml`.

#### Scenario: Every stub TOML parses

- **WHEN** a TOML parser reads any stub data file in either repository
- **THEN** it parses without error, yielding an empty or comment-only document

#### Scenario: Stubs document their schema by example

- **WHEN** a stub data file is opened
- **THEN** it carries a header comment and commented-out example entries matching the field names and shapes in SCHEMAS.md

### Requirement: User-curated narrative stubs

The repository SHALL include stub `taste.md` and `diet_principles.md` files. Each SHALL contain the section headings shown in SCHEMAS.md with placeholder content, establishing the structure the user will fill in later.

#### Scenario: Narrative stubs exist with headings

- **WHEN** a developer opens `taste.md` or `diet_principles.md`
- **THEN** the file exists and contains the section headings from SCHEMAS.md (e.g., Loves/Dislikes/Notes; Variety targets/Restrictions/Reasoning)

### Requirement: Canonical docs are committed at defined locations

The repository SHALL commit the canonical project docs. `AGENT_INSTRUCTIONS.md` SHALL reside at the repository root and SHALL be the canonical grocery-agent operational instructions consumed by the Claude.ai project (pasted into its project instructions). `CLAUDE.md` SHALL reside at the repository root as Claude Code development guidance for working in this repo, and SHALL point to `AGENT_INSTRUCTIONS.md` for the agent persona and conversational flows. The contributor guide `CONTRIBUTING.md` SHALL reside at the repository root; the reference docs `ARCHITECTURE.md`, `SCHEMAS.md`, and `TOOLS.md` SHALL reside under a `docs/` directory. Any references to the `docs/` reference docs (including each root doc's pointer to the tool inventory) SHALL resolve to their `docs/` paths.

#### Scenario: Root docs are present with their distinct roles

- **WHEN** Claude Code opens the repository directory
- **THEN** it finds `CLAUDE.md` at the repository root and reads it as repo-development context, and `AGENT_INSTRUCTIONS.md` at the root as the grocery-agent instruction source

#### Scenario: Agent instructions are sourced from AGENT_INSTRUCTIONS.md

- **WHEN** the Claude.ai "Grocery Agent" project instructions are set or refreshed
- **THEN** their canonical source is `AGENT_INSTRUCTIONS.md`, not `CLAUDE.md`

#### Scenario: CLAUDE.md points to the agent instructions

- **WHEN** a reader opens `CLAUDE.md` looking for the agent persona or conversational flows
- **THEN** it directs them to `AGENT_INSTRUCTIONS.md` rather than containing that prose itself

#### Scenario: Canonical docs live at their defined locations

- **WHEN** a developer looks for the architecture, contributor, schema, and tool references
- **THEN** `CONTRIBUTING.md` is present at the repository root, and `docs/ARCHITECTURE.md`, `docs/SCHEMAS.md`, and `docs/TOOLS.md` are present under `docs/`

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

The data repository **root** SHALL hold the data shared by all members: the recipe **content** under `recipes/`, the shared reference data (`aliases.toml` and the default `substitutions.toml`), the shared `skus/kroger.toml` SKU cache, the curated `guidance/` umbrella (with the `guidance/ingredient_storage/` and `guidance/cooking_techniques/` domain subtrees), and the generated `_indexes/`. The root SHALL NOT contain any per-member subjective or personal data — including ready-to-eat catalogs, which are per-tenant (that lives under `users/<username>/`). The legacy root-level `storage_guidance/` tree is relocated under `guidance/ingredient_storage/` and SHALL NOT remain at the root.

#### Scenario: Root carries content and reference data

- **WHEN** the data repository root is inspected
- **THEN** it contains `recipes/`, the shared reference data and SKU cache, the `guidance/` tree (with `ingredient_storage/` and `cooking_techniques/` subtrees), and `_indexes/`, and no per-member pantry, overlay, notes, or ready-to-eat catalog at the root, and no root-level `storage_guidance/`

### Requirement: Per-user subtree layout

Each member's `users/<username>/` subtree holds only **authored markdown** for that member: the narrative `taste.md` and `diet_principles.md`, recipe notes under `notes/`, and any personal (unshared) recipes. All operational and profile state — `pantry`, `preferences`, `stockup`, `grocery_list`, `ready_to_eat`, `cooking_log`, `meal_plan`, `feeds`, and the `overlay` (favorite/reject disposition) — is now **D1-backed** (per-tenant D1 rows), NOT stored as `.toml` files in the `users/<username>/` subtree. The subtree SHALL NOT duplicate shared root content. Per-tenant isolation is enforced in D1 (every per-tenant row carries the resolved `tenant`), not by a GitHub path prefix.

#### Scenario: Per-user subtree carries only authored markdown

- **WHEN** a member's `users/<username>/` subtree is inspected
- **THEN** it contains only that member's narrative files (`taste.md`, `diet_principles.md`), a `notes/` directory, and any personal recipes; pantry/preferences/overlay/session state/cooking log are not present as TOML files — they live in D1

### Requirement: Data template tracked as an independent repository

The public data-repo template (`caseyWebb/groceries-agent-data-template`) SHALL be tracked as its own independent repository, NOT vendored into this code repo. This repository SHALL NOT carry a git submodule (or `.gitmodules` entry) for the template, and SHALL NOT keep hand-maintained copies of the data-repo caller workflows under `docs/`. The template repo's own `.github/workflows/` is the single canonical reference for the thin data-repo callers.

The explanatory content describing the data-repo callers — the mapping of each data-repo caller workflow to this repo's reusable workflow, and the rationale for running them in the private data repo — SHALL be preserved in `docs/SELF_HOSTING.md`, pointing at the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo as the canonical example.

#### Scenario: No template submodule is present

- **WHEN** the repository is inspected for submodules
- **THEN** no `.gitmodules` file exists and no `docs/data-template/` submodule is tracked

#### Scenario: No duplicated caller-workflow copies remain

- **WHEN** the repository is searched for hand-maintained data-repo workflow copies
- **THEN** `docs/data-repo-workflows/` does not exist, and the caller→reusable-workflow mapping and rationale are found in `docs/SELF_HOSTING.md`

#### Scenario: CI does not depend on the template

- **WHEN** `ci.yml` runs
- **THEN** typecheck and the test suites pass without fetching the template, because no built or tested source imports it

