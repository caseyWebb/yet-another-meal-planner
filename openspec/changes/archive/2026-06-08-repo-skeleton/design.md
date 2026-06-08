## Context

This is the first change in the build sequence. PROJECT.md specifies the full repository layout and SCHEMAS.md specifies every data file's shape. The canonical docs (CLAUDE.md, PROJECT.md, SCHEMAS.md, TOOLS.md) already exist at the repo root from the initial commit. The only meaningful design questions are *where* the docs live and *how* empty directories and stub files are represented so the skeleton survives a clone and parses cleanly. No executable code ships in this change — index generation and validation are Change 02.

## Goals / Non-Goals

**Goals:**
- A fresh `git clone` produces the exact structure every downstream change depends on.
- Every stub data file parses as valid TOML and documents its schema by example.
- CLAUDE.md remains where Claude Code and Claude.ai project instructions expect it.

**Non-Goals:**
- No `scripts/build-indexes.mjs`, no GitHub Actions, no pre-commit hook (Change 02).
- No real recipe content (Change 03) — `recipes/` ships empty but present.
- No Worker source (Change 04) — `worker/` ships empty but present.
- No populated data (pantry inventory, real feeds, real SKUs) — stubs only.

## Decisions

**Docs location: `CLAUDE.md` and `ROADMAP.md` at the root, reference docs under `docs/`.** CLAUDE.md *must* be at the root for Claude Code and Claude.ai project-instruction consumption (PROJECT.md §"CLAUDE.md and harness portability"). The reference docs — `PROJECT.md`, `SCHEMAS.md`, and `TOOLS.md` — move into `docs/` to keep the root uncluttered and group the human-reference material in one place. This also aligns with the existing reference in CLAUDE.md, which already points readers to `docs/TOOLS.md`. `BUILD-SEQUENCE.md` is renamed to `ROADMAP.md` and kept at the root as a top-level entry point alongside README.md. *Alternative considered:* keep all docs at the root to avoid moving files — rejected because it clutters the root and would contradict CLAUDE.md's existing `docs/TOOLS.md` reference.

**README.md vs PROJECT.md: keep separate.** README.md is a concise top-level entry point (what the project is, a short architecture summary, how to use the repo) that links out to `docs/PROJECT.md`. PROJECT.md remains the canonical detailed proposal. *Alternative considered:* promote PROJECT.md to README.md — rejected because the ~39KB proposal is reference material, not a front door, and the build sequence treats README and PROJECT as distinct deliverables.

**Empty-directory preservation: `.gitkeep` placeholders.** Git does not track empty directories. `_indexes/`, `worker/`, `scripts/`, and `.github/workflows/` have no committed content in this change but must exist on clone. A `.gitkeep` in each is the conventional, zero-dependency way to do this. `recipes/` and `ready_to_eat/` get content (recipes later, TOML stubs now) so `ready_to_eat/` needs no keep; `recipes/` ships with a `.gitkeep` until Change 03. *Alternative considered:* a placeholder README in each directory — rejected as more noise than a single hidden keep file.

**Stub files are comment-only valid TOML, not empty files.** Each stub carries a header comment and commented-out example entries mirroring SCHEMAS.md, so a developer (or the agent) opening the file sees the intended shape without consulting SCHEMAS.md, while a TOML parser still reads it cleanly. This directly enables Change 02's validation to run against parseable files from day one. *Alternative considered:* truly empty files — rejected because they teach nothing and risk a parser treating a zero-byte file inconsistently.

**`ingredients.toml` ships reserved/empty.** SCHEMAS.md marks it RESERVED for Phase 7. It is created now (so the structure is complete) but contains only a header comment, no active or example entries that would imply it's in use.

## Risks / Trade-offs

- **Stub examples drift from SCHEMAS.md over time** → Keep examples minimal (one or two commented entries per file) and treat SCHEMAS.md as the source of truth; Change 02's validator will catch real (uncommented) files that violate the schema.
- **`.gitkeep` files linger after directories fill** → Harmless; they can be removed in the change that adds real content (e.g. Change 03 removes `recipes/.gitkeep`). Not worth gating on.
- **Choosing root over `docs/` could clutter the root listing** → Accepted; four docs plus standard files is a readable root, and CLAUDE.md is pinned to root regardless.

## Open Questions

- None blocking. The docs-location and placeholder conventions above are settled for this change.
