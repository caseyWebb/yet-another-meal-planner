## MODIFIED Requirements

### Requirement: Attributed notes stored in D1

The system SHALL support recipe **notes**: free-form markdown annotations attached to a recipe (shared or personal), stored as rows in the D1 `recipe_notes` table — not as `users/<username>/` files in GitHub. Each note row SHALL carry an `author` (the writing **member's id**, resolved by the Worker from the authenticated caller on both the MCP and `/api` paths — not a spoofable input field; legacy rows carry the founding member's id, which equals the tenant id), a `created_at` timestamp, body text, an optional set of tags (e.g. `tweak`, `observation`), and a **visibility `tier`** — one of `public`, `friends`, or `private`, defaulting to `friends` under both deployment profiles. The legacy `private` flag column SHALL be retained and kept in sync at write time (`private = 1` exactly when `tier = 'private'`) so a rolled-back Worker never widens a private note's audience, but no read path SHALL consult it once the tier column exists. A member SHALL be able to attach multiple notes to the same recipe over time (append-mostly); writing a note SHALL NOT modify shared recipe content.

#### Scenario: A note is authored without touching shared content

- **WHEN** member A adds a note "subbed gochujang for sriracha, better" to a shared recipe
- **THEN** a `recipe_notes` row is inserted with `author = A` (the resolved member id), `tier = 'friends'` (the default), and a `created_at` timestamp, and the shared recipe's content is unchanged

#### Scenario: Multiple notes accrete

- **WHEN** member A adds a second note to a recipe they have already annotated
- **THEN** both rows are retained, each with its own `created_at`, rather than overwriting the first

#### Scenario: The legacy private column stays consistent for rollback

- **WHEN** a note is written with any `tier`
- **THEN** the stored row's `private` column equals 1 exactly when `tier = 'private'`, so a previous Worker version reading only `private` never surfaces a private note beyond its author

### Requirement: Notes surfaced across the friend group

`read_recipe_notes(slug)` SHALL be reachable only for recipes inside the caller's visibility lens (a slug outside the lens returns the same structured `not_found` a nonexistent slug returns), and SHALL return, in a **single D1 query** joined against the `members` table, every note on the recipe the caller may see under the tier rules: the caller's **own** notes (every tier), every **`public`** note, and every **`friends`** note whose author's household is the caller's own household or a friend household (under the self-hosted profile, the implicit all-to-all graph makes every deployment member's `friends` notes visible — exactly the pre-tier shared-note behavior). Each returned note SHALL carry its `author` (member id), the author's **`handle`** (joined from `members`, falling back to the author id when no member row resolves), `created_at`, `body`, `tags`, and `tier`, plus a derived deprecated `private` boolean (`tier === 'private'`). Another member's `private` note SHALL never be returned.

#### Scenario: read_recipe_notes is fully D1

- **WHEN** `read_recipe_notes(slug)` is called for a lens-visible recipe
- **THEN** the tier-filtered notes (with author handles) come from a single `recipe_notes`-joined-`members` query, with no GitHub read

#### Scenario: Friends-tier notes are visible across friend households

- **WHEN** member B of household H2 reads notes for a visible recipe that member A of household H1 annotated at `tier = 'friends'`, and H1 and H2 are friends
- **THEN** B sees A's note attributed with A's handle and `tier: "friends"`, alongside B's own notes on that recipe

#### Scenario: Friends-tier notes are hidden outside the friend graph

- **WHEN** under the SaaS profile member C's household has no friendship with A's household, and C reads notes for a recipe both can see (e.g. a curated recipe) that A annotated at `tier = 'friends'`
- **THEN** A's note is absent from C's read

#### Scenario: Self-hosted reproduces the pre-tier shared behavior

- **WHEN** a deployment runs the self-hosted profile and a member reads notes on a visible recipe
- **THEN** every other member's `friends`-tier notes are returned (implicit all-to-all), exactly as the pre-tier default-shared notes were

#### Scenario: Group disposition and notes inform surfacing

- **WHEN** the agent surfaces a shared recipe a member has not tried
- **THEN** group signal (other members' visible notes and disposition — favorites from others in the group) is available to be surfaced

### Requirement: Per-note privacy

A note SHALL carry a visibility `tier` — `public | friends | private` — replacing the binary private flag (there is deliberately **no household tier**: household members are inside the friends tier by definition, and a household-only note is not expressible). The tiers SHALL mean:

- **`private`** — visible only to the authoring **member** (member-level, not tenant-level: a legacy private note authored before the identity split belongs to the founding member and remains visible only to that member after other members join the household).
- **`friends`** — visible to every member of the author's household and of households holding an accepted friendship with it (everyone in the deployment under the self-hosted profile's implicit all-to-all graph). This is the default for a new note under both profiles.
- **`public`** — visible to anyone who can see the recipe, bounded by the recipe's own lens: a note SHALL never render where its recipe isn't visible, and a public note reaches the anonymous /cookbook surface only where the recipe itself is anonymously visible.

Note visibility SHALL be a **live lens**, computed at read time with no materialized per-viewer state: creating or severing a friendship, or changing a note's tier, re-evaluates visibility immediately in both directions — a friends-tier note authored while friendless becomes visible to every future friend; a severed edge immediately hides the note.

#### Scenario: Private note stays with its authoring member

- **WHEN** member A marks a note `tier = 'private'`
- **THEN** the note appears only in A's reads of that recipe — not in any other member's, including members of A's own household

#### Scenario: Default note is friends-tier

- **WHEN** a member adds a note without setting a tier
- **THEN** the note is stored at `tier = 'friends'` and surfaces to the author's household and friend households

#### Scenario: A new friendship retroactively reveals friends notes

- **WHEN** households H1 and H2 become friends after member A of H1 authored a `friends` note
- **THEN** the very next notes read by an H2 member on that (now-visible) recipe includes A's note, with no backfill or reconcile step

#### Scenario: A severed friendship immediately hides friends notes

- **WHEN** H1 and H2 sever their friendship
- **THEN** the next notes read by an H2 member no longer includes H1 members' `friends` notes (their `public` notes on still-visible recipes remain)

#### Scenario: The recipe lens bounds every tier

- **WHEN** a recipe is outside a caller's visibility lens
- **THEN** none of its notes are reachable by that caller at any tier, and the notes read returns the same `not_found` a nonexistent slug produces

### Requirement: An author may edit or delete their own notes

The system SHALL allow an author to edit or delete a note **they** authored, via `update_recipe_note(slug, created_at, body?, tags?, tier?, private?)` and `remove_recipe_note(slug, created_at)`, addressing the note by its `created_at` (a millisecond-precision ISO timestamp, distinct per write). Passing `tier` re-tiers the note — tier changes ride this same operation and take effect on the next read (the live lens); the legacy `private` boolean is accepted as a deprecated alias (`true` → `private`, `false` → `friends`) with `tier` winning when both are passed. Unlike note creation (lens-gated — see `data-write-tools`), edit and delete SHALL remain reachable for a recipe that has left the caller's lens: they address only the caller's own existing rows (no read oracle, no new annotation), and an author must always be able to re-tier — e.g. privatize — or remove their own note after a friendship sever shrinks their lens. These operations SHALL act **only** on `recipe_notes` rows whose `author` is the calling member — a member SHALL NOT edit or delete another member's note — scoped by an `author = ?` predicate on the row write. Editing or deleting a note SHALL NOT modify shared recipe content or any other member's notes. (The same `update`/`remove` capability is provided for store notes under the `in-store-fulfillment` capability, backed by a shared note-mutation core; store notes keep the binary `private` flag and are not tiered.)

#### Scenario: Author edits their own note

- **WHEN** the author of a note calls `update_recipe_note` with that note's `created_at` and a new body
- **THEN** the note's `recipe_notes` row is updated (scoped to `author = caller`), leaving shared recipe content and other notes untouched, returning without a `commit_sha`

#### Scenario: Author re-tiers their own note

- **WHEN** the author calls `update_recipe_note` with `tier: "public"` on their `friends` note
- **THEN** the row's tier becomes `public` (and `private` stays 0), and the note is visible to the recipe's whole audience on the next read

#### Scenario: Author deletes their own note

- **WHEN** the author calls `remove_recipe_note` with one of their notes' `created_at`
- **THEN** that `recipe_notes` row is deleted (scoped to `author = caller`), returning without a `commit_sha`

#### Scenario: Another member's note is not addressable

- **WHEN** a member calls `update_recipe_note` / `remove_recipe_note` with a `created_at` that matches only another member's note
- **THEN** the operation is a structured no-op / `not_found` and that note is unchanged

## ADDED Requirements

### Requirement: Public-tier notes render on the anonymous cookbook surface

The anonymous `/cookbook/<slug>` recipe page SHALL render the recipe's `public`-tier notes — and **only** that tier, selected tier-scoped in the D1 query so no other tier's content ever leaves the database for the anonymous surface — attributed by author handle, with note bodies rendered through the same raw-HTML-dropping markdown renderer and Content-Security-Policy posture the recipe body uses. The section SHALL appear only when the recipe is anonymously visible (out-of-lens pages already 404 indistinguishably) and at least one public note exists. No other anonymous surface SHALL expose notes.

#### Scenario: A public note appears on the anonymous page

- **WHEN** an anonymous visitor opens `/cookbook/<slug>` for an anonymously-visible recipe carrying a `public` note
- **THEN** the page shows the note's body and author handle in the notes section

#### Scenario: Friends and private notes never reach the anonymous surface

- **WHEN** an anonymously-visible recipe carries only `friends` and `private` notes
- **THEN** the anonymous page renders no notes section, and the query that produced the page selected no non-public note rows

#### Scenario: A public note on a lens-scoped recipe stays off the anonymous site

- **WHEN** a member marks a note `public` on a recipe that is not anonymously visible (e.g. a household-only recipe under SaaS)
- **THEN** the note appears to every member who can see the recipe, but the anonymous site serves no page for the recipe at all — the note reaches the anonymous surface only if the recipe later becomes anonymously visible

#### Scenario: Note markup is neutralized

- **WHEN** a public note body contains raw HTML or script
- **THEN** the anonymous page renders it inert (raw HTML dropped by the renderer), under the unchanged CSP

### Requirement: Legacy private-flag rows migrate by pure mapping

The tier column SHALL be introduced by a numbered D1 migration that maps every existing row **purely** — `private = 1` → `tier = 'private'`, everything else → `tier = 'friends'` — with no other data change, no row deletion, and no operator input. Reads SHALL treat a NULL tier (possible only for rows written during a rollback window) as this same mapping computed on the fly, so unmigrated rows behave identically to migrated ones and converge organically.

#### Scenario: Pre-migration rows map exactly

- **WHEN** the migration runs over existing `recipe_notes` rows
- **THEN** every `private = 1` row reads as `tier = 'private'`, every other row as `tier = 'friends'`, and the post-migration tier counts equal the pre-migration private/shared counts

#### Scenario: A NULL-tier row behaves as its mapping

- **WHEN** a read encounters a row whose `tier` is NULL and whose `private` is 0
- **THEN** the row is treated as `friends` in the same query, with no error and no visibility difference from a migrated row
