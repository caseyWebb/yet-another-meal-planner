# kroger-integration Specification

## Purpose

Defines the read-side Kroger integration for the MCP server: the `client_credentials` API client (token caching, rate-limit backoff, structured upstream errors), location resolution to a `locationId`, the internal `kroger_search` product helper, and the curated read tools built on it (`kroger_prices`, `kroger_flyer`, `ready_to_eat_available`). Also defines the shared D1 `flyer_terms` table that drives broad serendipitous sale scans. No `authorization_code` grant, cart writes, or persistent storage — those are deferred to a later change.
## Requirements
### Requirement: Kroger client_credentials API client

The system SHALL provide a Kroger API client that authenticates with the `client_credentials` OAuth grant using a client ID and secret supplied as Worker secrets. The client SHALL cache the access token in isolate memory and re-mint it on expiry rather than minting per request. On `429` responses the client SHALL honor `Retry-After` when present and otherwise apply exponential backoff with jitter. The client SHALL bound the number of concurrent in-flight Kroger HTTP requests it issues to a small fixed limit, so that a caller fanning out many lookups (e.g. `kroger_flyer` across dozens of terms) cannot issue an unbounded request burst; requests beyond the limit SHALL wait for an in-flight request to complete before being issued. Upstream failures SHALL surface as structured errors (`upstream_unavailable`), never unhandled throws. The client SHALL NOT use the `authorization_code` grant or any persistent storage (those are deferred to a later change).

#### Scenario: Access token reused across calls

- **WHEN** two Kroger read tools run within one access-token lifetime
- **THEN** the client mints one `client_credentials` token and reuses it rather than requesting a new token per call

#### Scenario: Rate-limit backoff

- **WHEN** the Kroger API returns `429`
- **THEN** the client honors `Retry-After` (or backs off exponentially with jitter when absent) and retries before surfacing a structured error

#### Scenario: Concurrent requests are capped

- **WHEN** a single tool fans out more concurrent Kroger lookups than the client's concurrency limit
- **THEN** at most `limit` requests are in flight at any moment and the remainder are issued only as in-flight requests complete, never as one unbounded burst

#### Scenario: Upstream failure surfaces structured

- **WHEN** the Kroger API is unreachable or errors after retries are exhausted
- **THEN** the tool returns a structured `upstream_unavailable` error and does not throw

### Requirement: Location resolution

The system SHALL resolve `preferences.toml`'s `preferred_location` label to a Kroger `locationId` via the Locations API. A label already holding a pre-resolved `locationId` (no whitespace) SHALL be returned directly without a Locations API call. The system SHALL NOT cache the resolved `locationId` in isolate memory: the only isolate-shared Kroger state is the app-level `client_credentials` access token, which carries no tenant context. Because Cloudflare reuses an isolate across requests and tenants, isolate-shared per-tenant store context would leak one tenant's store to another; the resolution therefore holds no isolate-level location state. Every priced product call SHALL include a `locationId`, since the Products API returns pricing only when a location is supplied.

#### Scenario: Label resolved before priced calls

- **WHEN** a priced Kroger tool runs
- **THEN** the system resolves `preferred_location` to a `locationId` (via the Locations API, or directly when the label already holds a pre-resolved id) and uses it on the product search

#### Scenario: Resolution holds no isolate-level location state

- **WHEN** one tenant's request resolves a `locationId` and a different tenant's request is later served by the same isolate
- **THEN** the second request resolves its own `preferred_location` independently and never receives the first tenant's `locationId`, because no resolved location is cached in isolate memory

### Requirement: kroger_search internal product search

The system SHALL provide an internal `kroger_search` helper that queries the Products API by term and `locationId` (and curbside/delivery fulfillment), returning candidate products with `price { regular, promo }`, `size`, `brand`, fulfillment flags (curbside, delivery, `inStore`), and `aisleLocation { number, description, side? } | null`. This helper SHALL NOT be exposed as a raw MCP tool; the curated Kroger tools and the matching pipeline call it internally.

#### Scenario: Search returns priced candidates

- **WHEN** `kroger_search` is called with a term and the resolved `locationId`
- **THEN** it returns candidate products each carrying `price { regular, promo }`, `size`, `brand`, curbside/delivery/`inStore` fulfillment flags, and `aisleLocation`

### Requirement: kroger_prices for an ingredient list

The system SHALL provide `kroger_prices({ ingredients, location_id? })` returning, per ingredient, the current `{ regular, promo }` price, on-sale flag, curbside/delivery availability, a top-level `inStore` flag, and `aisleLocation { number, description, side? } | null` at the resolved location. The optional `location_id` parameter overrides the profile's `preferred_location`-derived Kroger locationId for the duration of the call.

#### Scenario: Prices returned per ingredient

- **WHEN** `kroger_prices` is called with a list of ingredient strings
- **THEN** it returns one priced result per ingredient including current price, on-sale state, curbside/delivery availability, `inStore` flag, and `aisleLocation`

### Requirement: flyer_terms D1 table — curated scan terms

The system SHALL read broad scan terms from the shared D1 `flyer_terms` table. The agent SHALL treat the term list as edit-only-when-directed (the user-curated bucket) and SHALL NOT infer or write terms automatically. These broad terms drive the **background flyer warm** that populates the per-location cache `kroger_flyer` reads, rather than a live per-call scan. The column schema for the `flyer_terms` table SHALL be documented in `docs/SCHEMAS.md`.

#### Scenario: Missing config degrades gracefully

- **WHEN** the `flyer_terms` table is empty
- **THEN** the warm sweep has no broad terms to scan, the per-location rollup is empty, and `kroger_flyer` returns an empty sale list rather than erroring

### Requirement: flyer synthesized sale scan

The system SHALL provide one flyer read tool, `flyer(min_savings_pct?)`, registered only when Kroger is configured (`mcp-tool-gating`), that resolves the caller's **primary fulfillment store** (its slug and location from the profile — `stores.primary` + `stores.preferred_location`), reads that store's background-warmed `flyer:{store}:{locationId}` rollup (Kroger reads fall back to the legacy un-namespaced key while a deploy's first namespaced sweep is pending), applies the `min_savings_pct` deal floor at read (default 5%, over the noise-floor rollup so the deal judgment stays caller-tunable), and returns `{ items, as_of }` — fulfillable, genuinely-discounted products deduplicated by `productId`, each carrying its `matched_terms`, with `as_of` the producing sweep's completion timestamp (or null when no rollup exists). Kroger and satellite-scanned sales SHALL be indistinguishable to the reader except by which store they came from; a **satellite-scanned** store's rollup older than the operator staleness ceiling SHALL read as empty (with `as_of` still surfaced) rather than steering on stale sales. The tool SHALL issue no flyer **fan-out** subrequest (the background sweep already performed it); a satellite store's `preferred_location` label IS its rollup `locationId` (no subrequest), while a Kroger primary may cost one Kroger Locations API resolve. A cold/absent/unresolvable store SHALL return `{ items: [], as_of: null }`, never an error. There is exactly one flyer tool — no separate Kroger-specific and store-generic reads — and it accepts no ad-hoc `terms` / `against_stockup` (specific-purchase checks live in the order flow, which re-prices live).

#### Scenario: The flyer is served from the warmed cache

- **WHEN** `flyer` runs for a caller whose primary store has a warmed rollup
- **THEN** it returns that store's cached items above the deal floor plus `as_of`, issuing no flyer fan-out subrequest

#### Scenario: A satellite-scanned store reads identically

- **WHEN** `flyer` runs for a caller whose primary store is a non-Kroger store with a warmed scan
- **THEN** it returns `{ items, as_of }` in the same shape as a Kroger read, and a rollup older than the staleness ceiling reads as empty with `as_of` surfaced

#### Scenario: Cold or missing cache degrades gracefully

- **WHEN** the primary store's rollup is absent (fresh deploy, or a store not yet swept) or the store is unresolvable
- **THEN** `flyer` returns `{ items: [], as_of: null }` rather than erroring

#### Scenario: One flyer tool on the surface

- **WHEN** a Kroger-configured deployment's member tool list is enumerated
- **THEN** it carries `flyer` and neither `kroger_flyer` nor `store_flyer`

