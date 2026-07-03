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

The system SHALL provide `list_stores()`, `read_store(slug)`, `add_store(...)`, `update_store(slug, operations)`, and `remove_store(slug)`. `read_store` SHALL return identity only. `update_store` SHALL accept **identity operations only** (set `name` / `label` / `chain` / `address` / `domain` / `location_id`), operation-style like `update_pantry` / `update_kitchen`; it SHALL NOT carry aisle, item-location, or not-carried operations — those facets are removed and live in store notes. Stores are shared corpus; any MCP holder MAY create or edit one with no extra gate (the `update_discovery_sources` posture). `list_stores` SHALL report, per store, whether it has layout notes (`has_notes`) rather than a structured aisle layout. All mutations SHALL persist to D1 and return structured results and errors.

#### Scenario: List reports note-backed layout

- **WHEN** `list_stores` is called
- **THEN** it returns each store's `slug`, `name`, `label`, `domain`, and `has_notes` (whether layout-tagged store notes exist for it)

#### Scenario: Unknown slug is a structured error

- **WHEN** `read_store`, `update_store`, or `remove_store` is called with an unknown slug
- **THEN** a structured `not_found` is returned rather than a throw

#### Scenario: A removed layout op is rejected, not written

- **WHEN** `update_store` is called with a `set_aisles` / `add_item_location` / `add_doesnt_carry`-style operation
- **THEN** it returns a structured validation error or conflict and writes nothing

### Requirement: Attributed per-tenant store notes

The system SHALL store store notes as rows in the D1 `store_notes` table, authored by the writing tenant (the `author` column, set by the Worker — unspoofable), shared-by-default with an optional `private` flag. `add_store_note(slug, body, tags?, private?)` SHALL append a note; `read_store_notes(slug)` SHALL return the caller's own private notes plus every member's shared notes, attributed — mirroring `read_recipe_notes`. Store notes SHALL be the home of **both** freeform observations ("fish counter closes at 6 PM", "they have the Kerrygold I like") **and** store **layout**, captured by tag convention: `layout` (an aisle and its sections, led by the aisle number where one exists — the order of layout notes by aisle number is the walk path), `location` (where a non-obvious item hides), and `stock` (a not-carried entry). An author MAY edit or delete their **own** store notes via `update_store_note(slug, created_at, body?, tags?, private?)` and `remove_store_note(slug, created_at)`, addressing a note by its `created_at`; these SHALL operate only on the caller's own notes (matched by `author`) and SHALL NOT touch another tenant's notes. When two notes conflict (e.g. an aisle after a remodel), a reader SHALL prefer the most recent by `created_at`.

#### Scenario: Layout captured as a tagged note

- **WHEN** the agent records "Aisle 7: baking, spices, oils" during mapping
- **THEN** it is stored as a `layout`-tagged store note and surfaces via `read_store_notes` for every member, ordered into the walk path by its aisle number

#### Scenario: Shared note is group-visible

- **WHEN** a member adds a non-private note "fish counter closes at 6 PM"
- **THEN** `read_store_notes` returns it, attributed to its author, for every member

#### Scenario: Private note is owner-only

- **WHEN** a member adds a note with `private: true`
- **THEN** it is returned only to its author and never surfaced to other members

#### Scenario: Author corrects their own stale note

- **WHEN** the author of a `layout` note calls `update_store_note` (or `remove_store_note`) with that note's `created_at`
- **THEN** the note row is patched (or removed) in D1, touching no other tenant's notes

#### Scenario: Another tenant's note is not addressable

- **WHEN** a member calls `remove_store_note` / `update_store_note` with a `created_at` that matches only another tenant's note
- **THEN** the operation is a structured no-op / `not_found` and that note is unchanged

#### Scenario: Recency wins on conflict

- **WHEN** two non-private `layout` notes describe the same aisle differently
- **THEN** the agent treats the more recent (`created_at`) as current

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

### Requirement: Ready-to-eat adds before grouping (configured catalog)

Before grouping the shopping list, if the user has a configured ready-to-eat catalog, the agent SHALL surface heat-and-eat items for buy-time addition — never adding unilaterally. Two passes:

1. **Restock favorites** (any grocery trip). Cross-reference `retrospective`'s `ready_to_eat_favorites` against pantry on-hand; for a favored item that is low or out, suggest a restock ("you're low on the frozen lasagna you keep grabbing — want it on the list?"). On agreement, add to the grocery list so it falls into the grouping step.
2. **On-sale discovery** (Kroger store trips only — needs flyer data). If this trip is to a Kroger store, scan `kroger_flyer` for on-sale heat-and-eat / grab-and-go items not already in the member's catalog, and draft 1–2 worthwhile candidates via `add_draft_ready_to_eat` (`source: "kroger-flyer"`). For a non-Kroger store there is no flyer — skip discovery.

Both passes SHALL be skipped for an empty catalog. Items added here are included in the grouped list.

#### Scenario: Favored but low RTE item is suggested at trip time

- **WHEN** `retrospective` shows a ready-to-eat favorite that is low or absent from the pantry before a grocery trip
- **THEN** the agent suggests adding it to the list, and adds it only on the user's agreement

#### Scenario: On-sale RTE discovery is Kroger-store-only

- **WHEN** the trip is to a non-Kroger store
- **THEN** the agent does NOT call `kroger_flyer` for on-sale RTE discovery — skip discovery for this trip

#### Scenario: Nothing added without agreement

- **WHEN** the agent surfaces a restock or on-sale RTE suggestion at trip time
- **THEN** nothing is written to the grocery list until the user says yes

### Requirement: Aisle-ordered shopping list with graceful degradation

The `shopping-list` skill SHALL read the grocery list and present it grouped, **display-first and read-only** until the user commits to walking. Grouping SHALL degrade gracefully: with no known store or layout, a **department**-grouped list from general knowledge; with a named or known store that has `layout` notes, an **aisle**-ordered walk inferred from those notes — item-to-aisle placement is agent judgment over the store's own section vocabulary (open-vocabulary, no manifest — the storage-guidance posture), with `location` notes pinpointing tricky items and a `location` note taking precedence over inferred placement. The list SHALL be filtered to the resolved store's `domain`: a named different-category store (e.g. "Lowe's" → `home-improvement`) SHALL show **only** that domain's items, department-grouped, with no voice offer. When no store is named and `primary` is not a store slug, the skill SHALL **ask** whether the user is shopping a specific store (then resolve it and read its `layout` notes) rather than probe every registered store's notes to guess; with no specific store it defaults to a department list. **Cold items — frozen, then refrigerated (dairy, meat) — SHALL be sequenced to be picked up last** so they stay cold (a final "grab on your way out" group when frozen falls mid-store); cold-vs-shelf-stable is agent judgment over the items. The **whole** list SHALL be displayed before any walk, with recipe attribution and buy amount on each line. The skill SHALL offer to enter voice step-by-step mode **only** when layout is known.

#### Scenario: Empty layout still yields a usable list

- **WHEN** the chosen store has no layout notes
- **THEN** the agent returns a sensibly department-grouped list rather than refusing, and does not offer voice mode

#### Scenario: Mapped store yields an aisle list from notes

- **WHEN** the chosen store has `layout` notes
- **THEN** the agent orders the list aisle-by-aisle from those notes and offers voice step-by-step mode

#### Scenario: Different-domain store filters the list

- **WHEN** the user names a store whose category is `home-improvement` (e.g. Lowe's)
- **THEN** only `home-improvement`-domain list items are shown, department-grouped, with no voice offer

#### Scenario: No store named — ask rather than probe

- **WHEN** no store is named and `primary` is not a store slug
- **THEN** the agent asks whether the user is shopping a specific store (resolving and reading its notes if named) rather than reading every registered store's notes to guess, and defaults to a department list if none

#### Scenario: Cold items are sequenced last

- **WHEN** the list includes frozen or refrigerated items
- **THEN** they are ordered to be picked up last — a final "grab on your way out" group when frozen falls mid-store — so they stay cold

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

