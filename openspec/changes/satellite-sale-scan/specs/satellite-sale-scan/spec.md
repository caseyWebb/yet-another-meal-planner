## ADDED Requirements

### Requirement: The sale observation carries raw price facts, never a derived saving

The `sale` observation kind SHALL extend the `satellite` capability's observation discriminated union (keyed by item `kind`) as its first non-`recipe` member, carrying **only independently-checkable raw facts**: the observed `store`, `locationId`, `productId`, `description`, an optional `size`, and the raw `regular` and `promo` prices as observed, plus optional `brand`, `categories`, and product `url`. It SHALL NOT carry a `savings`, `savings_pct`, on-sale flag, or any other Worker-relevant derived value — the Worker SHALL re-derive "is this on sale" and the saving from the raw `{ regular, promo }`, using the same single source of truth as the Kroger flyer (`isOnSale`: `promo > 0 && promo < regular`, excluding a `promo == regular` echo), and SHALL apply the caller's `min_savings_pct` deal floor at READ, never storing it. A `sale` observation and a first-party Kroger scan of the same product SHALL derive an identical rollup item, indistinguishable downstream except by recorded provenance.

#### Scenario: Only raw price facts cross the sale wire

- **WHEN** a satellite observes a shelf/loyalty sale price
- **THEN** the pushed `sale` item carries `{ store, locationId, productId, description, size?, regular, promo, brand?, categories?, url? }` and no `savings`/`savings_pct`/on-sale field, and the Worker computes the saving itself

#### Scenario: The Worker re-derives the saving and the deal floor

- **WHEN** a `sale` observation is processed and later read
- **THEN** the Worker derives "on sale" as `promo > 0 && promo < regular`, derives `savings = regular - promo`, and applies the `min_savings_pct` cut at read time — trusting no saving from the wire (there is none)

### Requirement: The sale-scan task is operator-scope and instructs, never judges

The `sale-scan` task kind SHALL extend the `satellite-pull-channel` capability's task `kind` enumeration as its first concrete member, with `scope: "operator"` and `payload: { store, locationId, terms }`. It SHALL be **operator-scope** — public-derived, cross-tenant, keyed by `locationId`, the same posture as the Kroger flyer cache — and SHALL NEVER be tenant-scope: there is no per-tenant sale data, so a `sale-scan` row SHALL carry no owning tenant (consistent with the `satellite_tasks` scope/tenant CHECK). The payload SHALL instruct the satellite **what to observe** (a store, a location, a set of broad terms) and SHALL carry no derived conclusion or judgment (sensor-not-judge, inherited). A `sale-scan` task SHALL slot into the pull channel's open seam without changing the channel: the channel keeps treating `payload` as opaque and filtering claims by declared capability.

#### Scenario: A sale-scan task is operator-scope and cross-tenant

- **WHEN** a `sale-scan` task is enqueued
- **THEN** it is `scope: "operator"` with no owning tenant, claimable by any active satellite key that declares the `sale-scan` capability, consistent with the store-wide/public-derived posture of the flyer cache

#### Scenario: The concrete kind flows through the unchanged channel

- **WHEN** a satellite declaring `capabilities: ["sale-scan"]` claims work and reports its results
- **THEN** the pull channel delivers the `sale-scan` envelope and lands its `sale` observations through the shared raw-observation intake without any channel change, treating the payload as opaque

### Requirement: A Worker producer enqueues sale-scan tasks for non-Kroger stores

The Worker SHALL run a scan-plan producer as a job in the single `scheduled()` handler (a sibling of the flyer warm, NOT folded into the flyer-warm tick, because the producer spends no external subrequests — it only enqueues). The producer SHALL be refresh-gated by a KV cursor (mirroring `flyer:cursor`) so it starts a fresh cycle only when the refresh window is due and is a cheap no-op otherwise. On a due cycle it SHALL build the plan — the distinct set of **non-Kroger** `(store, locationId)` pairs derived from the union of tenants' preferred stores crossed with the shared `flyer_terms` — and SHALL enqueue one operator-scope `sale-scan` task per pair through the change-2 idempotent enqueue (`dedup_key = "sale-scan:{store}:{locationId}"`), so a re-run does not stack a second in-flight row per pair. The producer SHALL NOT scan in the Worker (the Worker has no API for these stores); it SHALL only enqueue, leaving the scan to the satellite. The producer SHALL prune terminal `sale-scan` rows past a small age each cycle so the recurring queue stays bounded, and SHALL write a `sale-scan-plan` `job_health` record like every other background job. All D1 access SHALL go through `src/db.ts`.

#### Scenario: The producer enqueues, never scans

- **WHEN** a due producer cycle runs with non-Kroger stores in the tenant directory
- **THEN** it enqueues one operator-scope `sale-scan` task per `(store, locationId)` (idempotent per that key) and issues no external store subrequest, because scanning is the satellite's job

#### Scenario: Empty plan no-ops

- **WHEN** no tenant has a non-Kroger preferred store (as in current production)
- **THEN** the producer's plan is empty and the cycle is a clean no-op, writing its health record without enqueuing anything

#### Scenario: Kroger stores are excluded from the producer

- **WHEN** the producer builds its plan
- **THEN** Kroger stores are excluded, because the Worker scans those itself via the flyer warm

### Requirement: Satellite sales converge into the store-namespaced rollup at the raw layer

Satellite `sale` observations SHALL enter the **same raw-observation layer** as first-party Kroger flyer data and converge into the **store-namespaced** rollup (`flyer:{store}:{locationId}`), reusing the same `FlyerItem` shape and merge/dedup helpers as the Kroger warm, so downstream reads treat Kroger and satellite sales uniformly. The raw-observation intake SHALL dispatch by observation `kind` — `recipe` to the existing recipe candidate path, `sale` to the store-rollup path — through shared intake logic (not a re-implementation). The `sale` arm SHALL validate + drop non-sales (`!isOnSale`) exactly as the Kroger scan does, build `FlyerItem`s with the Worker-re-derived `savings`, and **replace** the target store's rollup with the freshly-observed set stamped with a fresh `as_of`. Re-processing the same scan (a late or double report) SHALL be idempotent (arrival dedup by `productId` within the store). Satellite sale data SHALL be given no privileged path: it can set no field a Kroger scan could not and skips no derivation the Worker applies to Kroger data.

The sale arm SHALL be **task-scoped**: a `sale` observation is valid ONLY as the result of a claimed `sale-scan` task, and the rollup `(store, locationId)` SHALL be **authoritative from that claimed task's payload** (Worker-created by the producer, which excludes Kroger) — **never** from the observation (which carries `store`/`locationId` for provenance only), **never** the Worker-owned `kroger` namespace, and **never** via the plain push path. Specifically: a `sale` observation whose own `store`/`locationId` disagree with the claimed task's SHALL be rejected per-item; a `sale` observation arriving WITHOUT a claimed `sale-scan` task (the `/admin/api/ingest` push path — sale-scan is pull-channel-only) SHALL be rejected and write no rollup; and the sale arm SHALL NEVER write the `kroger` namespace, guarding after normalizing (trim + lowercasing) the resolved store so `"Kroger"` cannot bypass the check. A `sale-scan` `done` report SHALL converge the task's store rollup even when the observation set is empty or every item fails validation (a genuine "no sales today" scan clears stale sales); a `failed` report SHALL NOT converge. When a `done` report carried observations but zero survived validation, the Worker SHALL surface an operator-visible signal ("reported N items, 0 survived validation") rather than reporting a clean success for a silent zeroing.

#### Scenario: The claimed task's store is authoritative; a mismatched observation is rejected

- **WHEN** a satellite reports a `sale` batch for a claimed `sale-scan` task
- **THEN** the Worker validates + re-derives each item and replaces the **task's** `flyer:{store}:{locationId}` rollup with the observed sale set at a fresh `as_of`, rejecting per-item any `sale` whose own `store`/`locationId` disagree with the task's, and a later re-report of the same scan dedups to the same rows

#### Scenario: A sale on the push path or into the kroger namespace is rejected, never written

- **WHEN** a `sale` observation arrives on the `/admin/api/ingest` push path (no claimed task), or a claimed task's resolved store normalizes to `kroger`
- **THEN** the item is rejected per-item, no rollup is written, and the first-party `flyer:kroger:*` rollup is never overwritten by a sensor

#### Scenario: An empty or all-rejected done converges the store to empty and is surfaced

- **WHEN** a `sale-scan` `done` report has no surviving sales (empty observations, or every item fails validation)
- **THEN** the Worker replaces the task's store rollup with the empty set (clearing stale sales), and when items were reported but zero survived it surfaces an operator-visible "0 survived validation" signal; a `failed` report instead leaves the prior rollup untouched

#### Scenario: Kroger and satellite sales are indistinguishable to a reader

- **WHEN** a store's rollup is read
- **THEN** its `FlyerItem`s carry the same fields whether the source was the Kroger API or a satellite scan, distinguishable only by recorded provenance, never by shape or a privileged field

### Requirement: Sale observations are validated with plausibility bounds and provenance

The Worker SHALL trust a satellite's `sale` outputs only after validation and SHALL NEVER trust its process. Beyond the shared contract's structural check, the Worker SHALL apply plausibility bounds **equal-or-stricter** than the first-party Kroger path: a sale is kept only when `0 < promo < regular`; `regular`/`promo` fall within a sane absolute ceiling; the re-derived markdown does not exceed a ceiling (~95% — a larger "discount" is a scan/parse error, not a sale); and `size` either parses via the existing unit-price parser or is null. A failing item SHALL be rejected **per-item** (with its disposition and reason) without sinking the batch. Each accepted item SHALL retain provenance (`productId`, and the product `url` when reported) so a claim is spot-checkable against the store's own page. A satellite whose `sale` observations repeatedly fail plausibility SHALL be quarantinable through the existing pull-channel attempt cap and observability, without a privileged bypass.

#### Scenario: An implausible sale is rejected per-item

- **WHEN** a `sale` observation reports `promo >= regular`, a >95% markdown, or an out-of-range price
- **THEN** that item is rejected with a reason and the rest of the batch still lands, rather than the whole batch failing

#### Scenario: Provenance is retained for spot-checkability

- **WHEN** a `sale` observation is accepted into a rollup
- **THEN** its `productId` (and product `url` when reported) is retained, so the sale claim can be verified against the store's page — the same provenance a later sensor-audit would sample

### Requirement: store_flyer reads the caller's store flyer, Kroger or satellite-scanned

The system SHALL provide `store_flyer(min_savings_pct?)` that resolves the caller's **primary fulfillment store** (its slug and location from the profile), reads that store's `flyer:{store}:{locationId}` rollup, applies the `min_savings_pct` deal floor at read (default 5%) and a staleness ceiling to a satellite-scanned store's rollup, and returns `{ items, as_of }` — the **same shape** `kroger_flyer` returns, indistinguishable to the reader whether the store is Kroger or satellite-scanned. When the rollup is absent (cold cache, a store not yet scanned) or older than the staleness ceiling, the tool SHALL return an empty `items` list (with `as_of` still surfaced), never an error. The tool SHALL issue no flyer **fan-out** subrequest (the background sweep already performed it); for a satellite store its `preferred_location` label IS the rollup `locationId` (no subrequest), while for a Kroger primary resolving that label to a numeric `locationId` may cost one Kroger Locations API call exactly like `kroger_flyer` — no flyer scan either way. `kroger_flyer` SHALL be retained with its existing `{ items, as_of }` contract for the Kroger path (now reading the Kroger-namespaced key); `store_flyer` supersedes it in the general menu-gen pre-pass so satellite-scanned sales are read the same way Kroger sales are.

#### Scenario: A satellite-scanned store is read like a Kroger store

- **WHEN** `store_flyer` runs for a caller whose primary store is a non-Kroger store with a warmed scan
- **THEN** it returns `{ items, as_of }` from `flyer:{store}:{locationId}` in the same shape as the Kroger flyer, with the deal floor applied at read

#### Scenario: A stale or cold scanned rollup reads as empty

- **WHEN** a satellite-scanned store's rollup is absent or older than the staleness ceiling
- **THEN** `store_flyer` returns an empty `items` list (surfacing `as_of`) rather than erroring or steering on stale sales

### Requirement: The satellite runs sale-scan over the pull channel with an operator-authored adapter

The satellite SHALL declare and run the `sale-scan` capability by consuming the pull channel: claiming operator-scope `sale-scan` tasks with its ingest key (declaring `capabilities: ["sale-scan"]`), running a **sale-scan adapter** for the store behind the operator's captured session, and reporting the resulting `sale` observations (or a terminal failure) over the results route — strictly outbound-only. A `sale-scan` adapter SHALL be a plugin over the shared SDK (the same tiered fetch, captured-session consumption, and logger the recipe adapter uses), emitting only the wire-contract `sale` shape; the satellite SHALL validate every emitted observation against the shared contract before it will report one, so an adapter cannot push a non-contract shape or a derived saving. Consistent with the initiative principle that the core ships the host + contract + SDK while users ship the ToS-hostile drivers, **no built-in named-retailer sale adapter SHALL ship**; a store's scan adapter SHALL be operator-authored and loaded from the mounted adapters directory. The satellite SHALL provide a `test` verb that dry-runs a sale adapter against a store/location and prints the `sale` observations it would report, validating them locally without reporting. Sale-scan SHALL be observe-only — it commits no irreversible action.

#### Scenario: An operator sale adapter is loaded and validated before reporting

- **WHEN** the operator drops a store-specific sale-scan adapter into the mounted directory and the satellite claims a `sale-scan` task for that store
- **THEN** the satellite runs the adapter behind the captured session, validates each emitted `sale` observation against the shared contract, and reports only the validated observations — never a non-contract shape or a derived saving

#### Scenario: test dry-runs a sale adapter before going live

- **WHEN** the operator runs the `test` verb against a store, location, and terms
- **THEN** the satellite scans and prints the `sale` observations it would report, validating them locally without reporting anything to the Worker
