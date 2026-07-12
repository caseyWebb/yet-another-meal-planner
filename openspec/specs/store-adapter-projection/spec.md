# store-adapter-projection Specification

## Purpose
TBD - created by archiving change store-adapters-card. Update Purpose after archive.
## Requirements
### Requirement: One household adapter projection drives every member store surface

The Worker SHALL expose one session-gated, household-scoped store-adapter projection from a named shared operation. The projection SHALL contain both adapter-card data and grocery-launcher entries, and the Profile and Grocery pages SHALL consume those fields without independently deriving adapter eligibility from raw preferences, token state, store rows, or satellite records. The operation SHALL read preferences and store identity through existing data layers, inspect only Kroger refresh-token presence, and SHALL NOT touch `env.DB` directly, perform an external request, or return any credential.

The projection SHALL use stable adapter/mode discriminants and deterministic ordering. Its launcher SHALL include only configured standing paths: Kroger online order when Kroger is selected/linked or has a standing location, the configured satellite store when `primary=<slug>` and `fulfillment="satellite"`, and the selected Offline store walk when `primary=<slug>` without the satellite marker. The manual-shop fallback SHALL remain a grocery action rather than a store adapter, and an unavailable Instacart adapter SHALL produce no launcher entry.

#### Scenario: Profile and Grocery receive identical adapter truth

- **WHEN** a household has a linked Kroger account, a selected Kroger location, shared Offline stores, and a satellite-marked standing store
- **THEN** one adapter projection contains the card summaries and corresponding launcher entries, and both member pages render that response rather than recomputing eligibility

#### Scenario: Projection is secret-free and externally inert

- **WHEN** the adapter projection is read
- **THEN** it performs no Kroger or satellite network request and returns neither OAuth tokens nor a satellite helper URL/session token

#### Scenario: Launcher ordering is deterministic

- **WHEN** the same configured adapters are read repeatedly regardless of underlying D1 row order
- **THEN** the launcher order is Kroger first, then satellite stores sorted by display name and slug, then the selected Offline walk entry

### Requirement: Kroger location search returns a bounded exact choice

The member API SHALL provide `GET /api/profile/kroger-locations?zip=<zip>` as a session-gated online read over the public client-credentials Kroger Locations client. It SHALL require exactly five US ZIP digits, request no more than ten nearby locations, preserve Kroger's nearest-first order, and normalize each result to `{ location_id, name, address, zip }`. It SHALL return an empty `locations` array for a successful zero-result search and a structured `validation_failed` or `upstream_unavailable` error for invalid input or provider failure. It SHALL NOT use member OAuth, write preferences, persist a search result, or fabricate numeric distance.

#### Scenario: One ZIP returns several selectable locations

- **WHEN** Kroger returns several nearby locations for a valid ZIP
- **THEN** the endpoint returns up to ten normalized results in provider nearest-first order, preserving each exact `location_id`

#### Scenario: Invalid ZIP never reaches Kroger

- **WHEN** the endpoint receives a ZIP that is not exactly five digits
- **THEN** it returns structured `validation_failed` and makes no external request

#### Scenario: Closing a search does not change the preference

- **WHEN** a member searches a different ZIP but closes the modal without selecting a result
- **THEN** neither `location_zip` nor the standing preferred location changes

### Requirement: A selected Kroger location is exact and backward-compatible

Selecting a Kroger search result SHALL use the existing conditional preferences merge-patch and atomically set `stores.primary="kroger"`, clear a stale `stores.fulfillment`, set `stores.location_zip` to the selected search ZIP, keep `stores.preferred_location` as the exact provider `location_id` string, and set additive `preferred_location_name` and `preferred_location_address` display fields. The projection SHALL render those display fields without a Kroger request. Existing preferences whose `preferred_location` contains a legacy label or ZIP SHALL remain readable and order-resolvable; they SHALL converge to the exact-id/display shape only after an explicit member selection.

#### Scenario: Selecting a result writes one coherent preference

- **WHEN** a member selects the third location returned for a ZIP under the current preferences ETag
- **THEN** one conditional patch stores that result's exact id/name/address/ZIP, clears satellite fulfillment, and the refreshed projection marks that location preferred

#### Scenario: A legacy preferred label remains usable

- **WHEN** a household still stores a label-shaped `preferred_location` without additive display fields
- **THEN** the projection shows the label tolerantly and the existing Kroger resolver continues to resolve it until the member explicitly picks an exact result

### Requirement: Kroger connect and disconnect expose truthful credential state

The existing `GET /api/profile/kroger-login-url` SHALL remain the canonical session-bound login/reconnect URL mint. The member API SHALL add `DELETE /api/profile/kroger-connection`, which SHALL delete the resolved tenant's durable Kroger refresh token and evict that tenant's isolate-held user access token and in-flight refresh state before returning `{ linked: false }`. Disconnect SHALL be idempotent, SHALL preserve the standing preferred location, and SHALL affect no other tenant.

Both login-URL minting and disconnect SHALL be online-only direct operations outside the persisted mutation queue. A disconnected projection SHALL never report Kroger linked merely because a prior access token had been cached.

#### Scenario: Disconnect removes durable and isolate credential state

- **WHEN** a linked member disconnects Kroger
- **THEN** the tenant refresh key and cached user token state are removed, the response reports unlinked, and the next projection is unlinked while retaining the chosen store

#### Scenario: Repeated disconnect converges

- **WHEN** the same member calls disconnect again after the credential is gone
- **THEN** the endpoint returns `{ linked: false }` without error or cross-tenant effect

#### Scenario: Offline disconnect cannot replay later

- **WHEN** a member attempts disconnect while offline and later reconnects
- **THEN** no disconnect request was persisted or automatically replayed, and the UI requires a fresh explicit action online

### Requirement: Satellite adapters degrade closed until per-store freshness exists

Until the D22 satellite-reported per-store session-freshness boolean ships, the projection SHALL represent a configured satellite store with `session_fresh: null`, adapter state `freshness_unavailable`, and a disabled `satellite_cart_fill` launcher entry whose reason is `satellite_freshness_unavailable`. It SHALL NOT infer retailer-session freshness from node push recency, sale scans, order-list history, ingest-key use, or any other Worker-visible liveness signal. Until a member Satellites route ships, the summary SHALL state that management is unavailable and link only to authoring guidance; it SHALL NOT expose a no-op member-surface link, helper URL, or session token.

#### Scenario: A live node is not mistaken for a fresh retailer session

- **WHEN** a configured satellite has recent pushes but no D22 per-store session observation
- **THEN** its summary remains `freshness_unavailable` and its launcher entry remains disabled

#### Scenario: Missing freshness never becomes re-run-login speculation

- **WHEN** the projection has no freshness boolean
- **THEN** it reports unknown/unavailable rather than `session_fresh`, `expired`, or a specific re-run-login conclusion

### Requirement: Offline reuses the store registry and Instacart remains a placeholder

The Offline adapter SHALL present grocery-domain rows from the existing shared `stores` registry, including identity and whether each row is the standing `stores.primary`; it SHALL NOT create an adapter entity or table. This change SHALL allow standing Offline selection through the class (a) preferences patch but SHALL NOT add shared-store CRUD, map-status derivation, an aisle-map editor, or store-walk state. If the selected slug no longer exists, the stored preference SHALL remain unchanged, the card SHALL mark it unavailable, and no enabled Offline launcher entry SHALL be emitted.

The Instacart adapter SHALL render as `coming_soon` with no account state, retailer source, connect control, endpoint, or launcher entry until the required feasibility spike and separate Instacart change land.

#### Scenario: Offline rows are existing stores, not copies

- **WHEN** the shared registry contains two grocery stores and one non-grocery store
- **THEN** the Offline tab lists the two grocery rows from that registry and creates no parallel row or adapter record

#### Scenario: Deleted preferred Offline store is not silently replaced

- **WHEN** `stores.primary` names a slug absent from the shared registry
- **THEN** the projection reports the standing selection unavailable and emits no enabled walk entry instead of choosing another store

#### Scenario: Instacart is honest before its integration exists

- **WHEN** a member opens the Instacart tab in this change
- **THEN** it shows a coming-later explanation and offers no action that implies account linking or retailer availability

### Requirement: Store-dependent state invalidates at the preference boundary

After a successful Kroger-location or standing Offline selection, the member app SHALL invalidate the adapter projection and store-dependent enriched placement data immediately, while leaving stored grocery rows and the store-agnostic to-buy set unchanged. Any open order preview SHALL close and discard its resolved prices, candidates, and local dispositions. The next preview SHALL resolve again using the new exact store context; already-sent cart state and in-flight rows SHALL NOT be rewritten.

Disconnect SHALL invalidate the adapter projection and close any open Kroger preview without clearing grocery rows. Tab selection, modal input, and uncommitted per-trip selection SHALL remain pure client state.

#### Scenario: Preferred location changes during an open preview

- **WHEN** a member selects a new Kroger location while an order preview exists
- **THEN** the preview closes, placement refetches for the new store, list membership is unchanged, and fresh product/price resolution occurs only when the member opens the next preview

#### Scenario: Disconnect does not mutate the list

- **WHEN** a member disconnects Kroger with active or in-cart grocery rows
- **THEN** the launcher refreshes to its disconnected state and an open preview closes, but every grocery row retains its prior lifecycle state

### Requirement: Adapter operations have explicit offline classifications

The adapter projection SHALL be an online read excluded from persisted query-cache allowlists because credential state must not be served as stale truth. Kroger ZIP search SHALL be an online-only external read. Login-URL mint and disconnect SHALL be online-only effectful operations. Preferred Kroger/Offline selection SHALL remain a class (a) `If-Match` preferences write that is disabled offline and never queued. This change SHALL add no class (b) write. An offline adapter surface SHALL render a disabled/hint state from connectivity, not fire automatically on reconnect.

#### Scenario: Adapter reads are absent from persisted member data

- **WHEN** a member uses every adapter tab online and the persisted query cache is inspected
- **THEN** no adapter projection, location result, login URL, or credential state is present

#### Scenario: Preference selection is not queued with a stale ETag

- **WHEN** a member tries to choose a Kroger or Offline preferred store while offline
- **THEN** the control is disabled or fails fast, no mutation is dehydrated, and reconnect does not apply the choice automatically
