# in-store-fulfillment — delta

## MODIFIED Requirements

### Requirement: Store CRUD tools

The member MCP surface SHALL carry the mid-walk, hands-busy **capture pair only**: `add_store(...)` (register a new store location, identity only) and `add_store_note` (the notes requirement below). Store listing, identity reads, identity edits (`set_identity`-style operations over `name` / `label` / `chain` / `address` / `domain` / `location_id`), and store removal SHALL be served by the member/admin web surfaces over the same shared store operations — there are no `list_stores`, `read_store`, `update_store`, or `remove_store` MCP tools. The shared operations keep their contracts: identity-only rows in the shared D1 `stores` registry, no aisle/item-location/not-carried operations (layout lives in store notes), structured results and errors (`not_found` on an unknown slug, `slug_exists` on a duplicate registration, `validation_failed` on an invalid slug or empty name). Stores are shared corpus; any member may capture one with no extra gate.

#### Scenario: Mid-walk capture registers a store

- **WHEN** the agent calls `add_store` with a kebab-case location slug and a name during a shopping conversation
- **THEN** the store row is created in the shared registry (identity only, D1-backed) and structured errors report a duplicate slug or invalid input

#### Scenario: Store maintenance has no member chat tools

- **WHEN** the member MCP tool surface is enumerated
- **THEN** `add_store` is the only store-registry tool; listing, reads, identity edits, and removal live on the member/admin surfaces over the same operations

#### Scenario: A removed layout op is rejected, not written

- **WHEN** any store-identity write surface receives a `set_aisles` / `add_item_location` / `add_doesnt_carry`-style operation
- **THEN** it returns a structured validation error or conflict and writes nothing

### Requirement: Attributed per-tenant store notes

The system SHALL store store notes as rows in the D1 `store_notes` table, authored by the writing tenant (the `author` column, set by the Worker — unspoofable), shared-by-default with an optional `private` flag. `add_store_note(slug, body, tags?, private?)` SHALL append a note and is the **only** store-note MCP tool — reading a store's notes and editing/removing one's own notes are member-app surfaces over the same shared note operations (`update`/`remove` remain author-scoped: matched by `author`, never touching another tenant's notes). Store notes SHALL be the home of **both** freeform observations ("fish counter closes at 6 PM", "they have the Kerrygold I like") **and** store **layout**, captured by tag convention: `layout` (an aisle and its sections, led by the aisle number where one exists — the order of layout notes by aisle number is the walk path), `location` (where a non-obvious item hides), and `stock` (a not-carried entry). The read operation SHALL return the caller's own private notes plus every member's shared notes, attributed — mirroring the recipe-notes visibility rule. When two notes conflict (e.g. an aisle after a remodel), a reader SHALL prefer the most recent by `created_at`.

#### Scenario: Layout captured as a tagged note

- **WHEN** the agent records "Aisle 7: baking, spices, oils" via `add_store_note` during mapping
- **THEN** it is stored as a `layout`-tagged store note and surfaces through the shared read for every member, ordered into the walk path by its aisle number

#### Scenario: Private note is owner-only

- **WHEN** a member adds a note with `private: true`
- **THEN** it is returned only to its author and never surfaced to other members

#### Scenario: Author corrects their own stale note from the member app

- **WHEN** the author of a `layout` note edits or removes it (addressed by `created_at`) on the member store surface
- **THEN** the note row is patched or removed in D1 (scoped to `author = caller`), touching no other tenant's notes

#### Scenario: Note maintenance has no member chat tools

- **WHEN** the member MCP tool surface is enumerated
- **THEN** `add_store_note` is the only store-note tool; reads and edit/remove live on the member surfaces over the same operations

### Requirement: Offline stores reuse the shared registry and private nickname boundary

The product SHALL call existing generic non-connected store rows **Offline stores** while retaining the shared store registry and note operations as the single backing model. Offline adapter/card/launcher identity SHALL come only from grocery-domain rows in the existing shared `stores` registry; no adapter or duplicate store table SHALL be created. Shared `name`/`label`/address SHALL remain public store identity. A household nickname SHALL live only in conditional household preferences and SHALL never update shared identity.

#### Scenario: Offline presentation is a rename

- **WHEN** an existing generic grocery store is shown in Preferences or the Grocery launcher
- **THEN** it appears as an Offline store backed by the same slug/registry row and no copy is created

#### Scenario: Nickname stays household-private

- **WHEN** one household nicknames a shared store "The big Kroger"
- **THEN** only that household's projection uses the nickname and the shared store name/label seen by others is unchanged
