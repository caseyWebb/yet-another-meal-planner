# repo-structure Specification

## Purpose

Defines the on-disk layout of the grocery-agent system: the code repository (the Worker source, build tooling, persona source, docs, and specs) and the operator's data repository (the deploy control plane). The authored corpus and all operational data live outside both repos — in Cloudflare R2 and D1 — so this capability also fixes where each kind of artifact lives.
## Requirements
### Requirement: Code repository layout

The code repository (`caseyWebb/groceries-agent`) SHALL hold the Worker source under `src/`, the build tooling under `scripts/`, the agent persona source `AGENT_INSTRUCTIONS.md` with its generated plugin bundle under `plugin/`, the operator admin SPA under `admin/` (sources in `admin/src/`, the committed build in `admin/dist/`), the D1 schema migrations under `migrations/d1/`, the reference docs under `docs/`, the OpenSpec workspace under `openspec/`, and the test suites under `test/` (Worker) and `tests/` (build tooling). Reusable CI workflows that operator data repos call SHALL live under `.github/workflows/`.

#### Scenario: Worker source and tooling are present

- **WHEN** the code repository is cloned and listed
- **THEN** `src/`, `scripts/`, `migrations/d1/`, `docs/`, `openspec/`, `test/`, and `tests/` are present, along with `AGENT_INSTRUCTIONS.md` and the generated `plugin/` bundle

#### Scenario: Generated trees are committed alongside their sources

- **WHEN** the persona or the admin SPA is built
- **THEN** `plugin/` is generated from `AGENT_INSTRUCTIONS.md` and `admin/dist/` from `admin/src/`, and both generated trees are committed

### Requirement: The authored corpus and operational data live outside the repos

The authored corpus — `recipes/*.md` and `guidance/**/*.md` — SHALL be stored in a Cloudflare **R2 bucket** (bound as `CORPUS`), read and written by the Worker. All operational and relational data — each member's profile, pantry, meal plan, grocery list, cooking log, favorite/reject overlay, and notes, plus the shared corpus (aliases, SKU cache, stores, RSS feeds, the discovery inbox) and the derived recipe index — SHALL live in Cloudflare **D1**, isolated per tenant by a `tenant` column. Neither the corpus nor operational data SHALL be stored in a git repository.

#### Scenario: Corpus resolves from R2, not a repo

- **WHEN** a recipe or guidance document is read
- **THEN** the Worker resolves it from the R2 `CORPUS` bucket, and no recipe/guidance markdown is committed to either repository

#### Scenario: Per-tenant state lives in D1

- **WHEN** a member's profile, session state, or disposition is read or written
- **THEN** it resolves to per-tenant D1 rows keyed by the resolved `tenant`, with no per-member files in any repository

### Requirement: One private data repository as the deploy control plane

The deployment SHALL use **one private** data repository on the operator's account (no GitHub org, no per-member repository). It SHALL hold the operator's `wrangler.jsonc` and thin `.github/workflows/` callers of the code repo's reusable workflows, and nothing else operational — no corpus, no member data, and no GitHub App. Members SHALL NOT be required to own or operate any infrastructure (no Worker, no Kroger app) and SHALL NOT be required to have a GitHub account — identity is an operator-issued invite code, and member lifecycle is managed in the Worker's Cloudflare Access-gated `/admin` panel.

#### Scenario: Data repo holds config and workflow callers only

- **WHEN** the data repository is inspected
- **THEN** it is private and contains `wrangler.jsonc` and thin workflow callers, with no corpus, no per-member subtree, and no GitHub App

#### Scenario: A member owns no infrastructure and needs no GitHub account

- **WHEN** a member is onboarded
- **THEN** they need only a Claude.ai account, a Kroger account, and an operator-issued invite code — no Worker deploy, no Kroger Developer app, and no GitHub account of their own

### Requirement: Canonical docs are committed at defined locations

The repository SHALL commit the canonical project docs. `AGENT_INSTRUCTIONS.md` SHALL reside at the repository root as the canonical grocery-agent persona source from which `plugin/` is generated. `CLAUDE.md` SHALL reside at the repository root as Claude Code development guidance for working in this repo, and SHALL point to `AGENT_INSTRUCTIONS.md` for the agent persona and conversational flows. The contributor guide `CONTRIBUTING.md` SHALL reside at the repository root; the reference docs `ARCHITECTURE.md`, `SCHEMAS.md`, and `TOOLS.md` SHALL reside under a `docs/` directory. Any references to the `docs/` reference docs SHALL resolve to their `docs/` paths.

#### Scenario: Root docs are present with their distinct roles

- **WHEN** Claude Code opens the repository directory
- **THEN** it finds `CLAUDE.md` at the repository root and reads it as repo-development context, and `AGENT_INSTRUCTIONS.md` at the root as the grocery-agent persona source

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

### Requirement: Data template tracked as an independent repository

The public data-repo template (`caseyWebb/groceries-agent-data-template`) SHALL be tracked as its own independent repository, NOT vendored into this code repo. This repository SHALL NOT carry a git submodule (or `.gitmodules` entry) for the template, and SHALL NOT keep hand-maintained copies of the data-repo caller workflows under `docs/`. The template repo's own `.github/workflows/` is the single canonical reference for the thin data-repo callers.

The explanatory content describing the data-repo callers — the mapping of each data-repo caller workflow to this repo's reusable workflow, and the rationale for running them in the private data repo — SHALL reside in `docs/SELF_HOSTING.md`, pointing at the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo as the canonical example.

#### Scenario: No template submodule is present

- **WHEN** the repository is inspected for submodules
- **THEN** no `.gitmodules` file exists and no `docs/data-template/` submodule is tracked

#### Scenario: No duplicated caller-workflow copies remain

- **WHEN** the repository is searched for hand-maintained data-repo workflow copies
- **THEN** `docs/data-repo-workflows/` does not exist, and the caller→reusable-workflow mapping and rationale are found in `docs/SELF_HOSTING.md`

#### Scenario: CI does not depend on the template

- **WHEN** `ci.yml` runs
- **THEN** typecheck and the test suites pass without fetching the template, because no built or tested source imports it
