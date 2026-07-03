## RENAMED Requirements

- FROM: `### Requirement: The satellite declares its capabilities; recipe-scrape and sale-scan are defined`
- TO: `### Requirement: The satellite declares its capabilities; recipe-scrape, sale-scan, and order-fill are defined`

## MODIFIED Requirements

### Requirement: The satellite declares its capabilities; recipe-scrape, sale-scan, and order-fill are defined

A satellite SHALL declare one or more **capabilities** it runs, and every push or claim SHALL carry the `capability` it reports/claims under. **Three** capabilities are defined: `recipe-scrape` (extract functional recipe facts from an authenticated source, delivered by the satellite **pushing** observations), `sale-scan` (observe in-store/loyalty sale prices at a store the Worker has no API for, delivered by the satellite **claiming** operator-scope work over the pull channel and reporting `sale` observations), and `order-fill` (fill the cart at a store the Worker has no API for, delivered by the satellite's local helper making **direct** tenant-scoped request/response calls — a pull-list request and a receipt post — neither a push batch nor a claimed task). The capability set SHALL remain a closed, extensible enumeration so a later capability can be added without redefining the envelope. The Worker SHALL reject a batch whose declared `capability` it does not implement, and the pull channel SHALL hand a satellite only task kinds matching its declared capabilities. Delivery is **per-capability**: recipe-scrape is the self-directed **push**, sale-scan is Worker-directed **pull**, and order-fill is human-directed **direct request/response** (it carries no capability-tagged batch envelope and claims no task; its two endpoints are authed by the tenant-bound ingest key). So a `sale` observation SHALL be accepted only over the pull channel as a claimed `sale-scan` task's result, a `sale` item arriving on the `/admin/api/ingest` push path SHALL be rejected, and an `order` observation SHALL be accepted only on the order-receipt endpoint against an issued order-list (rejected on the push and pull-results paths).

#### Scenario: A recipe-scrape batch declares its capability

- **WHEN** a satellite pushes recipes it extracted
- **THEN** the batch declares `capability: "recipe-scrape"` and the Worker processes it

#### Scenario: A sale pushed on the recipe-scrape push path is rejected

- **WHEN** a `sale` observation is pushed to `/admin/api/ingest` (with any declared capability) rather than reported for a claimed `sale-scan` task
- **THEN** the Worker rejects the `sale` item and writes no rollup, because sale-scan is pull-channel-only (recipe items in the same batch are unaffected)

#### Scenario: A sale-scan satellite claims and reports under its capability

- **WHEN** a satellite that declares `sale-scan` claims a `sale-scan` task and reports its scan
- **THEN** it claims and reports under the `sale-scan` capability, and the Worker processes the `sale` observations it returns

#### Scenario: An order-fill satellite drives cart-fill via direct request/response

- **WHEN** a satellite that declares `order-fill` fills a tenant's store cart
- **THEN** its local helper requests the pull-list and posts the receipt over the two direct `/satellite/order/*` endpoints (authed by the tenant-bound ingest key), carrying no capability-tagged batch envelope and claiming no task

#### Scenario: An order observation off the receipt endpoint is rejected

- **WHEN** an `order` observation arrives on the `/admin/api/ingest` push path or as a pull-channel result
- **THEN** the Worker rejects it, because order-fill is served only by the order-receipt endpoint against an issued order-list

#### Scenario: An unknown capability is rejected

- **WHEN** a batch declares a `capability` the Worker does not implement
- **THEN** the Worker rejects the batch (nothing persisted) rather than guessing how to process it

### Requirement: The push wire contract is capability-tagged with observation items as a discriminated union

The push payload SHALL be a **capability-tagged batch envelope** carrying the reported `capability`, the human-readable `source` provenance, the machine's `satellite_version`, the targeted `contract_version`, and an array of **observation items**. The observation items SHALL be a **discriminated union keyed by an item `kind`**: `kind: "recipe"` for `recipe-scrape` (functional recipe facts), `kind: "sale"` for `sale-scan` (raw store/product/`{ regular, promo }` price facts), and `kind: "order"` for `order-fill` (a per-item cart-fill disposition — `carted`/`substituted`/`unavailable`, with the matched or substitute store product — keyed to the canonical ingredient id the pull-list carried), so a later item kind can be added without breaking a consumer that handles only the existing kinds. An `order` observation is delivered over the order-receipt endpoint rather than the capability-tagged push batch, so the batch envelope's `capability` enumeration is unchanged by it (as `sale` is delivered over the pull channel, not the push path). The `contract_version` SHALL be `"v2"`. The batch envelope SHALL carry no more than `MAX_BATCH_ITEMS` observation items. The wire contract SHALL be defined once in the shared, runtime-agnostic contract package that both the Worker and the satellite import, so the shape can never drift between the two runtimes.

#### Scenario: A v2 batch is a capability-tagged discriminated union

- **WHEN** a satellite constructs a push
- **THEN** it sends `{ capability, source, satellite_version, contract_version: "v2", observations: [{ kind: "recipe", ... }, ...] }` validated against the shared contract before sending

#### Scenario: A sale observation is a defined member of the union

- **WHEN** a satellite reports a `sale` observation
- **THEN** it is a `{ kind: "sale", store, locationId, productId, description, regular, promo, ... }` member of the same discriminated union, validated against the shared contract, and a consumer that handles only `recipe` continues to validate and process `recipe` batches unchanged

#### Scenario: An order observation is a defined member of the union

- **WHEN** a satellite reports an `order` observation on the receipt endpoint
- **THEN** it is a `{ kind: "order", item_id, disposition, product? }` member of the same discriminated union, validated against the shared contract, and a consumer that handles only `recipe`/`sale` is unaffected

#### Scenario: A new observation kind does not break existing consumers

- **WHEN** the discriminated union gains a new `kind` in a later capability
- **THEN** a consumer that handles only the prior kinds continues to validate and process batches of those kinds unchanged

### Requirement: Irreversible actions stay human-gated against ground truth

No satellite report SHALL, by itself, cause an **irreversible action**. Any irreversible action derived from satellite data SHALL remain gated on a **human verifying the ground truth** (e.g. the store's own UI) before it commits. This requirement is **realized by the `order-fill` capability**, which stops short of the irreversible step — it fills a store cart but never completes checkout — and it SHALL bind every capability: a capability MAY observe and prepare, but the irreversible commit stays with a human.

#### Scenario: A satellite cannot commit an irreversible action alone

- **WHEN** satellite data would drive an irreversible action
- **THEN** the action is not committed by the satellite or automatically by the Worker; it is prepared and left for a human to verify against ground truth and complete

#### Scenario: Cart-fill prepares but does not commit

- **WHEN** the order-fill capability fills a store cart
- **THEN** it stops at the store's review page and the purchase is completed by the human in the store's own UI, so no satellite report alone commits an order
