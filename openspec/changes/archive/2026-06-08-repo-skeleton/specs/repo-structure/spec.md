## ADDED Requirements

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

The repository SHALL include stub TOML data files for every data file named in SCHEMAS.md. Each stub SHALL contain a header comment naming the file and its purpose, and SHALL include commented-out example entries that match the field names and shapes in SCHEMAS.md. Stub files SHALL parse as valid (empty or comment-only) TOML.

The required data files are: `pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `feeds.toml`, `stockup.toml`, `ingredients.toml`, `skus/kroger.toml`, `ready_to_eat/breakfast.toml`, `ready_to_eat/lunch.toml`, and `ready_to_eat/dinner.toml`.

#### Scenario: Every stub TOML parses

- **WHEN** a TOML parser reads any stub data file
- **THEN** it parses without error, yielding an empty or comment-only document

#### Scenario: Stubs document their schema by example

- **WHEN** a developer opens a stub data file
- **THEN** it contains a header comment and commented-out example entries whose field names match the corresponding schema in SCHEMAS.md

#### Scenario: ingredients.toml is reserved and empty

- **WHEN** a developer opens `ingredients.toml`
- **THEN** it is present but contains only a header comment marking it RESERVED for Phase 7, with no active entries

### Requirement: User-curated narrative stubs

The repository SHALL include stub `taste.md` and `diet_principles.md` files. Each SHALL contain the section headings shown in SCHEMAS.md with placeholder content, establishing the structure the user will fill in later.

#### Scenario: Narrative stubs exist with headings

- **WHEN** a developer opens `taste.md` or `diet_principles.md`
- **THEN** the file exists and contains the section headings from SCHEMAS.md (e.g., Loves/Dislikes/Notes; Variety targets/Restrictions/Reasoning)

### Requirement: Canonical docs are committed at defined locations

The repository SHALL commit the canonical project docs. `CLAUDE.md` SHALL reside at the repository root so Claude Code and Claude.ai project instructions consume it natively. `ROADMAP.md` (renamed from `BUILD-SEQUENCE.md`) SHALL reside at the repository root. The reference docs `PROJECT.md`, `SCHEMAS.md`, and `TOOLS.md` SHALL reside under a `docs/` directory. Any references to these docs (including CLAUDE.md's pointer to the tool inventory) SHALL resolve to their `docs/` paths.

#### Scenario: CLAUDE.md and ROADMAP.md are at the root

- **WHEN** Claude Code opens the repository directory
- **THEN** it finds `CLAUDE.md` at the repository root and reads it as project context, and `ROADMAP.md` is present at the root

#### Scenario: Reference docs live under docs/

- **WHEN** a developer looks for the project, schema, and tool references
- **THEN** `docs/PROJECT.md`, `docs/SCHEMAS.md`, and `docs/TOOLS.md` are present

#### Scenario: Doc references resolve

- **WHEN** a reader follows CLAUDE.md's pointer to the tool inventory (`docs/TOOLS.md`)
- **THEN** the referenced file exists at that path

### Requirement: README and gitignore

The repository SHALL include a `README.md` explaining the project and how to use the repo, and a `.gitignore` covering Node artifacts, OS files, editor files, and Cloudflare Worker secret files.

#### Scenario: README explains the project

- **WHEN** a developer opens `README.md`
- **THEN** it explains what the grocery agent is and how to use the repository

#### Scenario: gitignore excludes secrets and noise

- **WHEN** Worker secret files, `node_modules/`, OS files (e.g. `.DS_Store`), and editor files are present in the working tree
- **THEN** `.gitignore` prevents them from being committed
