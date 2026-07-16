## MODIFIED Requirements

<!-- NOTE (serial-surface): this block modifies the "Shared corpus artifacts live in D1 and R2"
requirement ADDED by deployment-profiles-and-visibility-lens, which lands and archives before
this change. The text below was copied from that change's ratified delta; re-verify against the
archived living spec at implementation time. -->

### Requirement: Shared corpus artifacts live in D1 and R2

The shared corpus artifacts — ingredient aliases, the store registry, store notes, recipe notes, RSS feeds, the newsletter sender/member allowlist, the discovery inbox, the SKU resolution cache, flyer terms, and the recipe visibility grants (`recipe_imports`) — SHALL be stored in D1 tables, written and validated by Worker operations, and read by query. Authored recipe and guidance markdown SHALL live in the R2 corpus bucket, read and written through the corpus store; no shared-corpus data SHALL live in GitHub and the Worker SHALL make no GitHub API call on any data path. Attributed notes (`store_notes`, `recipe_notes`) SHALL carry an `author` (the writing member's id); recipe notes carry a visibility `tier` (`public | friends | private`, default `friends`) while store notes keep the binary `private` flag. `read_recipe_notes` SHALL return the caller's own notes plus the notes the tier rules admit (per the `recipe-notes` capability) via a single query, joined with the D1 overlay ratings — and SHALL be reachable only for recipes inside the caller's visibility lens: a notes read for a slug outside the caller's lens SHALL return the same structured `not_found` a nonexistent slug returns.

#### Scenario: Corpus enumeration finds only D1 and R2

- **WHEN** the corpus storage is enumerated
- **THEN** structured shared artifacts (including `recipe_imports`) are D1 tables, authored markdown is in the R2 corpus bucket, and no data path reads or writes GitHub

#### Scenario: Notes are lens-bound

- **WHEN** `read_recipe_notes(slug)` is called for a recipe outside the caller's visibility lens
- **THEN** it returns the same structured `not_found` a nonexistent slug produces, and no note content is disclosed

#### Scenario: Attribution and tier preserved

- **WHEN** a member writes a `private`-tier note on a recipe inside their lens
- **THEN** it is stored with their `author` and `tier = 'private'`, and no other member — including their own household — sees it in `read_recipe_notes`
