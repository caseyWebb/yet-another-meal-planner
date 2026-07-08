# recipe-title-audit Specification

## Purpose
TBD - created by archiving change clean-discovery-import-titles. Update Purpose after archive.
## Requirements
### Requirement: Existing titles converge through a bounded, one-shot-stamped re-audit

The system SHALL converge existing corpus recipe titles to the naming contract (`recipe-import`,
"Clean titles and globally-unique slugs") through a scheduled **title re-audit** pass — pipeline
convergence, never manual edits to production data. Each tick the pass SHALL take a bounded batch
of un-audited recipes (those with no `title_audit` stamp row), run the same guarded title-clean
judgment the discovery import uses (word-subset guard: the cleaned title may only remove words;
fail-open on any rejected/invalid output), rewrite **only** the recipe's frontmatter `title` in
the corpus store when the accepted clean title differs, validate the rewritten file against the
shared recipe contract before persisting, and stamp a one-shot `title_audit` row (`audited_at`,
a `kept`/`cleaned` outcome, and the before/after titles as the audit trail). A recipe whose model
call succeeds SHALL always be stamped — `cleaned` on an accepted rewrite, `kept` otherwise — so no
row can loop; only a transient infrastructure failure leaves a row un-stamped for a later tick.
The pass SHALL quiesce to a no-op (no model calls) once the backlog is drained, SHALL record a
`title-audit` job-health record per run (counts only, tenant-data-free), and SHALL ride the
internal `env.AI` budget with no external subrequests.

#### Scenario: The observed defect converges organically

- **WHEN** the re-audit reaches the recipe at slug `a-better-beer-can-chicken` titled "A Better Beer Can Chicken"
- **THEN** its frontmatter `title` is rewritten to "Beer Can Chicken", the file revalidates and persists, and a `title_audit` row records `cleaned` with the before/after titles

#### Scenario: An already-clean title is stamped kept, unchanged

- **WHEN** the re-audit processes a recipe whose title is already the clean dish name (e.g. "Vegan Meatballs" or a glossed foreign name like "Jatjuk (Pine Nut Porridge)")
- **THEN** the corpus file is not rewritten and the recipe is stamped `kept`, never to re-enter the backlog

#### Scenario: A guarded-out rewrite still stamps

- **WHEN** the model returns a cleaned title that introduces a word not in the current title
- **THEN** the rewrite is rejected by the word-subset guard, the file is untouched, and the recipe is stamped `kept` (the row does not loop)

#### Scenario: Work is bounded per tick and quiesces

- **WHEN** the backlog holds more recipes than the per-tick cap
- **THEN** one tick audits at most the cap and defers the rest; once every projected recipe carries a stamp, subsequent ticks make no model calls and report a drained backlog in the health summary

#### Scenario: A transient failure retries, not loops

- **WHEN** the title-clean model call fails with a transient infrastructure error for a recipe
- **THEN** that recipe is left un-stamped and is retried on a later tick, and the failure is reflected in the job's health record

### Requirement: The re-audit never renames a slug

The re-audit SHALL NOT rename a recipe's slug or move its corpus object: the slug is the recipe's
identity — the R2 object path and the soft join key for per-tenant and shared references
(favorites/rejections overlay, cooking log, meal-plan slots and grocery-list `for_recipes`,
recipe notes, discovery match attribution and log, derived facets/embeddings, `pairs_with`
references from other recipes, and cookbook/member-app URLs). Title convergence SHALL change the
display name only. Clean slugs apply to **new** imports via the import-time naming requirement
(`discovery-sweep`), not retroactively.

#### Scenario: A cleaned title keeps its flowery slug

- **WHEN** the re-audit rewrites "A Better Beer Can Chicken" to "Beer Can Chicken"
- **THEN** the recipe remains at slug `a-better-beer-can-chicken` (path `recipes/a-better-beer-can-chicken.md`), and every existing favorite, log entry, plan reference, note, and attribution keyed to that slug still resolves

### Requirement: New writes are born-stamped

Both recipe write paths (the discovery sweep's import and the manual `create_recipe`) SHALL stamp
a `title_audit` row at create (best-effort — a failed stamp must not fail an already-committed
import), so post-change writes never enter the re-audit backlog and the pass audits exactly the
pre-existing corpus. A recipe whose born-stamp write was lost MAY be re-audited later; because its
title is already clean, that re-audit stamps `kept` and is harmless.

#### Scenario: A fresh import does not re-enter the backlog

- **WHEN** the sweep imports a new recipe (its title already cleaned at import)
- **THEN** a `title_audit` row is stamped at create and the re-audit pass never spends a model call on it

### Requirement: A rewritten title propagates through the existing derived pipeline

A title rewrite SHALL reach the downstream projections through the existing reconciles with no
bespoke wiring: the index projection re-projects the new title on its next pass, and the
recipe-derived describe/embed pass regenerates the description and embedding because its content
hash covers the title. The re-audit SHALL NOT trigger facet reclassification (the facet gate hash
does not cover the title).

#### Scenario: Index and description refresh organically

- **WHEN** the re-audit rewrites a recipe's title
- **THEN** a subsequent projection pass indexes the new title, and a subsequent recipe-derived pass regenerates the recipe's description/embedding via its content-hash gate, with no manual invalidation

