## Context

Change 01 produced the repo skeleton: empty TOMLs, an empty `recipes/`, and stub directories for `_indexes/`, `scripts/`, and `.github/workflows/`. There is no JS toolchain yet and no generated index. This change adds the first executable code: a content-agnostic build pass that validates the corpus and emits the three index artifacts the Worker (Change 04+) will read.

It is deliberately buildable now, against an empty or fixture corpus, before Change 03 imports real recipes. The index shapes defined here become a contract the Worker depends on, so they are pinned precisely rather than left to emerge.

## Goals / Non-Goals

**Goals:**
- A single `scripts/build-indexes.mjs` that walks `recipes/` + `ready_to_eat/`, validates, and writes three deterministic index files.
- Stable, slug-keyed index shapes the Worker can read in one fetch.
- A validation gate with a clear hard-fail / warn split, runnable both locally (pre-commit) and in CI (Action).
- Zero-friction setup on a fresh clone.

**Non-Goals:**
- TypeScript for this script (deferred to the Worker in Change 04, where the MCP SDK makes it pay off).
- Deep schema validation of the user-data TOMLs (`pantry.toml`, etc.) — that's the Worker's concern; here they only get a parse-check.
- Real recipe content — fixtures stand in; the real corpus lands in Change 03.
- A Pages site / client-side search consuming the indexes (deferred; the shapes leave room).

## Decisions

**Plain ESM `.mjs`, not TypeScript.** One script, JSON throughout. A TS build step buys nothing yet and adds a compile to the hot path. The filename `build-indexes.mjs` is already fixed in `docs/PROJECT.md` and the roadmap. _Alternative considered:_ TS with `tsx` — rejected as premature; revisit if the script grows substantially.

**mise-managed Node 22 LTS + plain npm.** Matches the global rule that build tooling is mise-managed, not global. npm (no pnpm/yarn) keeps a single-script repo boring. _Alternative:_ pnpm — rejected, no monorepo/workspace need.

**`gray-matter` + `smol-toml` for parsing.** `gray-matter` is the de-facto frontmatter parser (bundles js-yaml); `smol-toml` is modern, spec-compliant, ESM-native. _Alternative:_ `@iarna/toml` — rejected as unmaintained.

**Date normalization to `YYYY-MM-DD` strings.** js-yaml parses `last_cooked: 2025-04-15` into a JS `Date`; naive `JSON.stringify` yields a timezone-shifted datetime that varies by runner TZ — silently breaking determinism. The script normalizes all date-typed frontmatter fields to date strings before serialization. This is the subtlest correctness point in the change.

**Deterministic output (sorted keys + normalized values).** Guarantees an unchanged corpus produces byte-identical files, so the Action commits nothing when there's no real change. Without it, every push churns an empty-diff commit. Paired with `[skip ci]` to break the regen→trigger loop.

**Slug = filename minus `.md`.** No `slug` field exists in the frontmatter schema, and filename-as-title is Obsidian-native. The script injects `slug` into each record and hard-fails on collisions.

**Indexes carry all statuses.** `recipes.json` and `ready_to_eat.json` include `draft`/`rejected` items with their `status` preserved, so the Worker can drive disposition flows and avoid re-surfacing drafts from a single index read rather than re-walking source files. Consumers filter per query.

**Three capabilities, not one.** `data-indexing` (output contract), `data-validation` (gate contract), `build-automation` (orchestration) are distinct behavioral surfaces and stay individually small, well under the spec cap.

**Configurable input dir.** The core walk takes an input directory (default `recipes/`) so a test can point it at `tests/fixtures/` without touching the real corpus. Keeps the walk pure and testable.

**Fixtures in `tests/fixtures/`, permanent.** Dummy recipes (one draft, one `produces`/`uses` component pair) live outside `recipes/` so the corpus stays empty for Change 03 and the fixtures remain regression assets.

**Pre-commit hook installed via npm `prepare` → `core.hooksPath`.** Committed `scripts/githooks/` dir; `prepare` runs on `npm install` and sets `core.hooksPath`, so a fresh clone is wired with one command and nothing is written into `.git/` by hand. The hook validates only — it never regenerates or stages indexes (that's the Action's job; a mutating hook would surprise the committer).

**Action uses default `GITHUB_TOKEN` with `contents: write`.** Sufficient to push the regen commit. A known property: commits made with `GITHUB_TOKEN` don't trigger downstream Actions — which is exactly what we want here, making `[skip ci]` belt-and-suspenders.

## Risks / Trade-offs

- **Non-deterministic dates break the no-churn guarantee** → Explicit date-string normalization plus a determinism test (run twice, assert byte-identical).
- **Concurrent pushes race on the regen commit** → Add workflow `concurrency` grouping per ref so overlapping runs serialize rather than collide.
- **`prepare` runs in CI too (`npm ci`)** → Setting `core.hooksPath` on the runner is harmless; the hook simply isn't invoked by the Action's git operations.
- **Component-ref validation strictness** → A `uses_components` pointing at a not-yet-existing producer hard-fails. Acceptable given the empty/fixture corpus; if Change 03 migration needs staged references, relax to a warning then.
- **Index shape churn later** → The Worker depends on these shapes. Changing them post-Change-04 is a breaking change; pinned precisely now to minimize that.

## Migration Plan

Additive only — no existing behavior changes. Sequence: add `mise.toml` + `package.json` → write `build-indexes.mjs` (walk, validate, emit) → add fixtures + tests → add hook + `prepare` wiring → add the Action → document failure modes in README. Rollback is deletion of the added files; the skeleton from Change 01 is unaffected.

## Open Questions

None outstanding — index shapes, validation taxonomy, fixture location, status scope, and hook-install mechanism were all resolved during exploration.
