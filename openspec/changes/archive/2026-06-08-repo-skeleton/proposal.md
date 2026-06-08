## Why

The grocery agent is built as flat files in git: every other change in the build sequence (index generation, the Worker, Kroger integration, conversational flows) assumes a specific directory layout and a set of well-formed data files already exists. Nothing can be built or validated until that substrate is in place. This change establishes the canonical repository structure so a fresh `git clone` produces the skeleton everything else builds on.

## What Changes

- Create the full directory tree from PROJECT.md: `recipes/`, `ready_to_eat/`, `skus/`, `_indexes/`, `worker/`, `scripts/`, `.github/workflows/`.
- Create stub TOML data files with header comments and commented-out example entries matching SCHEMAS.md: `pantry.toml`, `preferences.toml`, `substitutions.toml`, `aliases.toml`, `feeds.toml`, `stockup.toml`, `ingredients.toml` (reserved/empty for Phase 7), `skus/kroger.toml`, and `ready_to_eat/{breakfast,lunch,dinner}.toml`.
- Create stub user-curated narrative files: `taste.md` and `diet_principles.md`.
- Add `README.md` explaining the project and how to use the repo.
- Add `.gitignore` covering Node, OS, editor, and Cloudflare Worker secret files.
- Place the canonical docs: `CLAUDE.md` stays at the repo root (Claude Code / Claude.ai consume it there); `PROJECT.md`, `SCHEMAS.md`, and `TOOLS.md` move into a `docs/` directory.
- Rename `BUILD-SEQUENCE.md` → `ROADMAP.md`, kept at the repo root as a top-level entry point.
- Add `.gitkeep` (or equivalent) to otherwise-empty generated/source directories so the structure survives a clone.

This change is **data and structure only** — no executable code, no Worker, no Action. Index generation and validation are Change 02.

## Capabilities

### New Capabilities
- `repo-structure`: Defines the canonical directory layout, the set of stub data files and their header/example content, the placement of canonical docs, and the `.gitignore` and `README.md` requirements such that a fresh clone yields the complete skeleton.

### Modified Capabilities
<!-- None — this is the first change; no existing specs. -->

## Impact

- **New files/directories:** the entire repo skeleton (directories, stub TOML/markdown files, README, .gitignore).
- **Docs placement:** `CLAUDE.md` stays at root (required for Claude Code/Claude.ai project-instruction consumption); the reference docs move under `docs/`. CLAUDE.md already references `docs/TOOLS.md`, so this aligns existing references.
- **Downstream:** unblocks Change 02 (index generation + validation), which walks these directories and validates the stub files parse.
- **No code, dependencies, or external services** introduced by this change.
