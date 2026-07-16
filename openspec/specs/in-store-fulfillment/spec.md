# in-store-fulfillment Specification

## Purpose
TBD - created by archiving change in-store-fulfillment. Update Purpose after archive.
## Requirements
### Requirement: Shared store registry and schema

The system SHALL maintain a shared D1 `stores` table, one row per **specific store location** (not per chain), holding objective **identity** read by every member. Each store SHALL carry: `slug` (required, kebab-case location id), `name` (required, e.g. "Tom Thumb"), `label` (optional human handle, e.g. "West 7th"), `chain` (optional), `address` (optional), `location_id` (optional chain-specific external id, e.g. Kroger's locationId), and `domain` (free string, default `grocery`). Store **layout** — aisle order, where-it-hides item locations, and not-carried entries — SHALL NOT be structured fields of this table; it lives in attributed store notes (see "Attributed per-tenant store notes"). The column schema SHALL be documented in `docs/SCHEMAS.md`. Store identity is objective and **unattributed** (like recipe content). There SHALL be no `_indexes/stores.json` — the set is small and read directly from D1. An empty `stores` table SHALL be valid (no stores registered yet).

#### Scenario: Store conforms to identity schema

- **WHEN** a store is written to the `stores` table
- **THEN** it carries a `slug` and `name` (plus optional `label`/`chain`/`address`/`domain`/`location_id`), no structured layout fields, and it passes structural validation

#### Scenario: Absent registry is valid

- **WHEN** the `stores` table has no rows
- **THEN** `list_stores` returns an empty set and validation does not fail

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

### Requirement: Fulfillment mode and preferred store

`preferences.toml [stores].primary` SHALL accept either `kroger` (online mode — `place_order`, retaining `preferred_location` for the Kroger API) or a store slug. A store-slug primary SHALL default to **walk mode** (the in-store flush) and MAY be marked **satellite-fulfilled** (`preferences.toml [stores].fulfillment = "satellite"`) when the tenant runs a satellite cart-fill for that store — in which case the flush is the **satellite cart-fill**: the agent directs the user to open their local cart-fill helper rather than building a walk list or calling `place_order`. The agent SHALL select the flush from the resolved mode and SHALL NOT assume Kroger. Naming a store for a single trip SHALL override the standing preference for that trip only, without rewriting it. Mode is a property of the preference and trip, not the chain — a store MAY be online-capable, walk-capable, and/or satellite-fulfilled.

#### Scenario: Walk-mode primary picks the in-store flush

- **WHEN** `primary` is a mapped store slug (not marked satellite-fulfilled) and the user asks to shop
- **THEN** the agent runs the in-store walk, not `place_order`

#### Scenario: Satellite-fulfilled primary picks the cart-fill flush

- **WHEN** `primary` is a store slug marked satellite-fulfilled and the user asks to shop
- **THEN** the agent directs the user to open their local cart-fill helper and refresh, and does NOT call `place_order` or build an in-store walk list

#### Scenario: Per-trip override leaves the preference intact

- **WHEN** the standing `primary` is `kroger` but the user says "I'm going to the West 7th Tom Thumb, give me a list"
- **THEN** the agent builds an in-store list for that store and does not change the stored `primary`

### Requirement: Aisle-ordered shopping list with graceful degradation

The `shopping-list` skill SHALL read the grocery list and present it grouped, **display-first
and read-only** until the user commits to walking. Grouping SHALL degrade gracefully: with no
known store or layout, a **department**-grouped list from general knowledge; with a named or
known store that has `layout` notes, an **aisle**-ordered walk inferred from those notes —
item-to-aisle placement is agent judgment over the store's own section vocabulary
(open-vocabulary, no manifest — the storage-guidance posture), with `location` notes
pinpointing tricky items and a `location` note taking precedence over inferred placement.
When the resolved store is the caller's **Kroger primary**, the skill SHALL prefer captured
per-SKU aisle placements (the to-buy read's aisle enrichment, sourced from the SKU cache at
that location) for the lines that have them — real store data over inference — with store-note
`location` pins still taking precedence, and lines without a captured placement degrading
per-line to the judgment path above. The list SHALL be filtered to the resolved store's
`domain`: a named different-category store (e.g. "Lowe's" → `home-improvement`) SHALL show
**only** that domain's items, department-grouped, with no voice offer. When no store is named
and `primary` is not a store slug, the skill SHALL **ask** whether the user is shopping a
specific store (then resolve it and read its `layout` notes) rather than probe every
registered store's notes to guess; with no specific store it defaults to a department list.
**Cold items — frozen, then refrigerated (dairy, meat) — SHALL be sequenced to be picked up
last** so they stay cold (a final "grab on your way out" group when frozen falls mid-store);
cold-vs-shelf-stable is agent judgment over the items. The **whole** list SHALL be displayed
before any walk, with recipe attribution and buy amount on each line. The skill SHALL offer to
enter voice step-by-step mode **only** when layout is known.

#### Scenario: Empty layout still yields a usable list

- **WHEN** the chosen store has no layout notes
- **THEN** the agent returns a sensibly department-grouped list rather than refusing, and does
  not offer voice mode

#### Scenario: Mapped store yields an aisle list from notes

- **WHEN** the chosen store has `layout` notes
- **THEN** the agent orders the list aisle-by-aisle from those notes and offers voice
  step-by-step mode

#### Scenario: Kroger primary walks captured placements

- **WHEN** the resolved store is the caller's Kroger primary and some to-buy lines carry
  captured aisle placements
- **THEN** those lines are ordered by their captured aisles (store-note `location` pins still
  winning), uncaptured lines fall back to judgment-grouped placement, and voice mode may be
  offered

#### Scenario: Different-domain store filters the list

- **WHEN** the user names a store whose category is `home-improvement` (e.g. Lowe's)
- **THEN** only `home-improvement`-domain list items are shown, department-grouped, with no
  voice offer

#### Scenario: No store named — ask rather than probe

- **WHEN** no store is named and `primary` is not a store slug
- **THEN** the agent asks whether the user is shopping a specific store (resolving and reading
  its notes if named) rather than reading every registered store's notes to guess, and
  defaults to a department list if none

#### Scenario: Cold items are sequenced last

- **WHEN** the list includes frozen or refrigerated items
- **THEN** they are ordered to be picked up last — a final "grab on your way out" group when
  frozen falls mid-store — so they stay cold

### Requirement: The in-store walk — voice-first pacing, completion, and first-visit mapping

The voice walk (entered from `shopping-list` when layout is known) and the `map-grocery-store` flow SHALL both run hands-free / voice-first, pacing one aisle at a time and advancing on "got it". The voice walk SHALL handle "can't find it" by disambiguating sold-out (transient, no write) vs. moved (offer a `location` note) vs. not-carried (offer a `stock` note), writing only on confirmation. The `map-grocery-store` skill SHALL be **offered (never pushed)** when shopping an unmapped store, running **alongside** the trip (not a separate session): the user reads each end-cap aisle sign, the agent appends a `layout` note per aisle **as it goes** — each committed immediately, never batched to the end — and when an aisle matches a list item the agent reminds the user to grab it and offers a `location` note. When the called-out aisle numbers jump, the agent SHALL gently check whether an aisle was skipped (never forcing it). Because the mapping walk follows the store's physical order, the agent SHALL **flag** frozen/refrigerated aisles as "grab last" rather than reorder. Before either flow completes, the agent SHALL sweep the list for items never matched to an aisle and surface them (a skipped aisle's items show here) before advancing anything to `received`. On completion **both** flows SHALL advance picked `grocery`-kind items directly `active → received`, restock the pantry, and offer storage tips for fresh perishables — reusing the existing receive behavior, with no `in_cart` / `ordered` stage.

#### Scenario: Mapping persists per aisle, not batched

- **WHEN** the user names an aisle's sections during `map-grocery-store`
- **THEN** a `layout` note for that aisle is committed immediately, surviving a session that ends before the trip is done

#### Scenario: Aisle match prompts a grab

- **WHEN** an aisle being mapped matches an item on the current list
- **THEN** the agent reminds the user to grab it and offers to record its `location`

#### Scenario: First-visit mapping is offered, not pushed

- **WHEN** the user shops an unmapped store for the first time
- **THEN** the agent offers to map it alongside the trip and, if declined, proceeds with a degraded department list

#### Scenario: A skipped aisle is flagged during mapping

- **WHEN** the aisle numbers called out during mapping jump (e.g. 5 then 7)
- **THEN** the agent gently checks whether an aisle was skipped before continuing, without forcing it

#### Scenario: Un-grabbed items are swept before completion

- **WHEN** a walk (mapped or mapping) is about to complete with list items never matched to any aisle
- **THEN** the agent surfaces those items and asks whether to double back, before advancing anything to `received`

#### Scenario: Cold items are flagged grab-last during mapping

- **WHEN** the mapping walk reaches a frozen or refrigerated aisle
- **THEN** the agent reminds the user to grab those last (cold chain) rather than reordering the physical walk

#### Scenario: Can't-find is disambiguated before any write

- **WHEN** the user says "can't find it" during the voice walk
- **THEN** the agent asks whether the item is sold out, moved, or not carried, and only on "moved" or "not carried" offers to write a note

#### Scenario: Completion reuses the received behavior

- **WHEN** either flow finishes
- **THEN** picked `grocery`-kind items are removed from the list, their pantry entries restocked, and storage tips offered for fresh perishables

### Requirement: Every in-store completion converges on the shared shop commit

The member store walk, member Log a manual shop action, and agent voice walk SHALL complete through the same named shop-commit operation and receipt. Thin `/api` and MCP `commit_shop` adapters SHALL authenticate/validate then invoke that operation without implementing receive, pantry, spend, or deletion logic. Agent voice pacing SHALL set each confirmed picked row through the canonical checked operation, retain one client-minted session id for the trip, sweep unmatched items before completion, read the fresh eligible set, and call `commit_shop`. Storage tips SHALL remain a post-receipt conversational action.

#### Scenario: Member and agent produce the same receipt semantics
- **WHEN** identical checked sets are completed from the member walk and an agent voice walk in separate shops
- **THEN** both paths use the same eligibility, verified restock, estimated spend, deletion, conflict, and replay rules

#### Scenario: Voice got-it writes checked truth
- **WHEN** the member tells the voice walk they got an item
- **THEN** the agent writes the canonical row's `checked_at` rather than holding a separate server walk-session list

### Requirement: Offline stores reuse the shared registry and private nickname boundary

The product SHALL call existing generic non-connected store rows **Offline stores** while retaining the shared store registry and note operations as the single backing model. Offline adapter/card/launcher identity SHALL come only from grocery-domain rows in the existing shared `stores` registry; no adapter or duplicate store table SHALL be created. Shared `name`/`label`/address SHALL remain public store identity. A household nickname SHALL live only in conditional household preferences and SHALL never update shared identity.

#### Scenario: Offline presentation is a rename

- **WHEN** an existing generic grocery store is shown in Preferences or the Grocery launcher
- **THEN** it appears as an Offline store backed by the same slug/registry row and no copy is created

#### Scenario: Nickname stays household-private

- **WHEN** one household nicknames a shared store "The big Kroger"
- **THEN** only that household's projection uses the nickname and the shared store name/label seen by others is unchanged

### Requirement: Aisle maps are effective projections of attributed contributions

The system SHALL project a caller-visible aisle map from existing `layout`-tagged `store_notes`, returning an `effective` winning entry per normalized aisle, the caller's complete `mine` contribution, and a strong ETag over all caller-visible participating notes. Store notes SHALL gain additive recency metadata; effective recency SHALL be `updated_at` falling back to `created_at`, with a deterministic note-id tie-break. Existing note updates SHALL advance recency while retaining immutable/addressable `created_at`.

The member whole-document aisle editor SHALL require `If-Match` and SHALL reconcile only the caller's layout contribution: create/update/remove/collapse that author's layout notes atomically while preserving all other authors' notes plus every location/stock/general note. Shared SHALL remain the default, private entries SHALL remain caller-only, and removing a winning own entry SHALL reveal the next visible contribution. An ETag mismatch SHALL return the fresh projection without writing.

#### Scenario: Whole-document save cannot overwrite another author
- **WHEN** a member replaces their map contribution while another household has layout notes for the same store
- **THEN** only the caller's layout notes change and the other household's attributed rows remain byte-for-byte owned by it

#### Scenario: Concurrent map edit conflicts
- **WHEN** visible layout notes change after the member loaded the editor
- **THEN** the stale `If-Match` save writes nothing and returns the fresh effective/mine document

#### Scenario: Newer correction wins without deleting history
- **WHEN** an author corrects their aisle contribution after another visible conflicting observation
- **THEN** its advanced observation time becomes effective by recency while the other attributed note remains stored

### Requirement: Effective maps degrade honestly

Map summary SHALL be `unknown` when no effective aisle is visible, `stale` when effective entries exist but the newest observation is older than 180 days, and `mapped` otherwise. Stale maps SHALL remain usable with an age warning; unknown maps SHALL not block a walk. Private layout notes SHALL affect only their author's map/status.

Offline placement SHALL prefer an exact caller-visible item location note, then an exact normalized match between the grocery line's server-derived presentation section and an effective map section, then no aisle. It SHALL perform no Worker fuzzy/LLM guess. Effective aisles SHALL sort by parseable aisle order then label, cold items SHALL remain in a final Grab last group, and unresolved items SHALL trail under Anywhere / Not mapped.

#### Scenario: Unknown map still walks
- **WHEN** an Offline store has no visible parseable layout notes
- **THEN** the walk remains available and every unresolved line appears in the trailing Not mapped group

#### Scenario: Stale map is warned but used
- **WHEN** the newest effective aisle observation is more than 180 days old
- **THEN** matching lines retain its deterministic route placement and the UI labels the map potentially out of date

#### Scenario: Missing exact section is not guessed
- **WHEN** a line's presentation section matches no effective map section and has no exact location note
- **THEN** it is Not mapped rather than assigned by substring, model, or client inference

