## ADDED Requirements

### Requirement: Every in-store completion converges on the shared shop commit

The member store walk, member Log a manual shop action, and agent voice walk SHALL complete through the same named shop-commit operation and receipt. Thin `/api` and MCP `commit_shop` adapters SHALL authenticate/validate then invoke that operation without implementing receive, pantry, spend, or deletion logic. Agent voice pacing SHALL set each confirmed picked row through the canonical checked operation, retain one client-minted session id for the trip, sweep unmatched items before completion, read the fresh eligible set, and call `commit_shop`. Storage tips SHALL remain a post-receipt conversational action.

#### Scenario: Member and agent produce the same receipt semantics
- **WHEN** identical checked sets are completed from the member walk and an agent voice walk in separate shops
- **THEN** both paths use the same eligibility, verified restock, estimated spend, deletion, conflict, and replay rules

#### Scenario: Voice got-it writes checked truth
- **WHEN** the member tells the voice walk they got an item
- **THEN** the agent writes the canonical row's `checked_at` rather than holding a separate server walk-session list

### Requirement: Offline stores reuse the shared registry and private nickname boundary

The product SHALL call existing generic non-connected store rows **Offline stores** while retaining the stable `list_stores`/`read_store`/CRUD and store-note tool names. Offline adapter/card/launcher identity SHALL come only from grocery-domain rows in the existing shared `stores` registry; no adapter or duplicate store table SHALL be created. Shared `name`/`label`/address SHALL remain public store identity. A household nickname SHALL live only in conditional household preferences and SHALL never update shared identity.

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
