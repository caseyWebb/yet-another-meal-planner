# recipe-notes Specification

## Purpose
TBD - created by archiving change multi-tenant-friend-group. Update Purpose after archive.
## Requirements
### Requirement: Attributed notes stored in D1

The system SHALL support recipe **notes**: free-form markdown annotations attached to a recipe (shared or personal), stored as rows in the D1 `recipe_notes` table — not as `users/<username>/` files in GitHub. Each note row SHALL carry an `author` (the writing tenant), a `created_at` timestamp, body text, an optional set of tags (e.g. `tweak`, `observation`), and a `private` flag. The `author` SHALL be set by the Worker from the authenticated caller (not a spoofable input field). A tenant SHALL be able to attach multiple notes to the same recipe over time (append-mostly); writing a note SHALL NOT modify shared recipe content.

#### Scenario: A note is authored without touching shared content

- **WHEN** tenant A adds a note "subbed gochujang for sriracha, better" to a shared recipe
- **THEN** a `recipe_notes` row is inserted with `author = A` and a `created_at` timestamp, and the shared recipe's content is unchanged

#### Scenario: Multiple notes accrete

- **WHEN** tenant A adds a second note to a recipe it has already annotated
- **THEN** both rows are retained, each with its own `created_at`, rather than overwriting the first

### Requirement: Notes surfaced across the friend group

`read_recipe_notes(slug)` SHALL return the caller's own notes (including their private ones) plus everyone's shared (non-private) notes for that recipe — each attributed to its `author` — in a **single D1 query**, with no GitHub read, so the corpus reads as a collaborative cookbook.

#### Scenario: read_recipe_notes is fully D1

- **WHEN** `read_recipe_notes(slug)` is called
- **THEN** notes (own-private + group-shared) come from a single `recipe_notes` query, with no GitHub read

#### Scenario: Group notes are visible to all members

- **WHEN** tenant B reads notes for a recipe that tenant A annotated (non-private)
- **THEN** B sees A's note attributed to A, alongside B's own notes on that recipe

#### Scenario: Group disposition and notes inform surfacing

- **WHEN** the agent surfaces a shared recipe a tenant has not tried
- **THEN** group signal (other tenants' notes and disposition — favorites from others in the group) is available to be surfaced

### Requirement: Group disposition aggregates from the D1 overlay table

`read_recipe_notes` SHALL compute the group's disposition signal for a recipe with a single query against the D1 `overlay` table (`SELECT tenant, favorite, reject FROM overlay WHERE recipe = ?`), scoped to the caller's group via the tenant directory — not by enumerating the tenant directory and reading each member's profile. A member with no `overlay` row for the recipe contributes nothing to the aggregate. There is no `rating` or `status` column in the overlay.

#### Scenario: "favorited by others" is one query

- **WHEN** `read_recipe_notes(slug)` is called
- **THEN** the disposition across the group comes from a single indexed `overlay` query for that recipe, with no per-tenant bundle reads

#### Scenario: A member with no overlay row contributes no signal

- **WHEN** a group member has never marked the recipe as a favorite or rejected it
- **THEN** they have no `overlay` row for it and contribute nothing to the aggregate (no error)

### Requirement: Per-note privacy

A note SHALL support a `private` flag. A private note SHALL be visible only to its authoring tenant and SHALL NOT be surfaced to any other tenant. Notes default to shared (non-private) since the system is collaborative within a trusted group.

#### Scenario: Private note stays with its author

- **WHEN** tenant A marks a note `private`
- **THEN** the note appears only in A's reads of that recipe and never in any other tenant's

#### Scenario: Default note is shared

- **WHEN** tenant A adds a note without setting `private`
- **THEN** the note is shared and surfaced to the group

### Requirement: An author may edit or delete their own notes

The system SHALL allow an author to edit or delete a note **they** authored, via `update_recipe_note(slug, created_at, body?, tags?, private?)` and `remove_recipe_note(slug, created_at)`, addressing the note by its `created_at` (a millisecond-precision ISO timestamp, distinct per write). These operations SHALL act **only** on `recipe_notes` rows whose `author` is the caller — a tenant SHALL NOT edit or delete another tenant's note — scoped by an `author = ?` predicate on the row write. Editing or deleting a note SHALL NOT modify shared recipe content or any other tenant's notes. This relaxes the prior append-only posture for the author's own notes while preserving authorship and cross-tenant immutability. (The same `update`/`remove` capability is provided for store notes under the `in-store-fulfillment` capability, backed by a shared note-mutation core.)

#### Scenario: Author edits their own note

- **WHEN** the author of a note calls `update_recipe_note` with that note's `created_at` and a new body
- **THEN** the note's `recipe_notes` row is updated (scoped to `author = caller`), leaving shared recipe content and other notes untouched, returning without a `commit_sha`

#### Scenario: Author deletes their own note

- **WHEN** the author calls `remove_recipe_note` with one of their notes' `created_at`
- **THEN** that `recipe_notes` row is deleted (scoped to `author = caller`), returning without a `commit_sha`

#### Scenario: Another tenant's note is not addressable

- **WHEN** a tenant calls `update_recipe_note` / `remove_recipe_note` with a `created_at` that matches only another tenant's note
- **THEN** the operation is a structured no-op / `not_found` and that note is unchanged

