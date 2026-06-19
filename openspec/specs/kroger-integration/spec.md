# kroger-integration Specification

## Purpose

Defines the read-side Kroger integration for the MCP server: the `client_credentials` API client (token caching, rate-limit backoff, structured upstream errors), location resolution to a `locationId`, the internal `kroger_search` product helper, and the curated read tools built on it (`kroger_prices`, `kroger_flyer`, `ready_to_eat_available`). Also defines the user-curated `flyer_terms.toml` config that drives broad serendipitous sale scans. No `authorization_code` grant, cart writes, or persistent storage — those are deferred to a later change.
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

The system SHALL resolve `preferences.toml`'s `preferred_location` label to a Kroger `locationId` via the Locations API and cache it in isolate memory. Every priced product call SHALL include a `locationId`, since the Products API returns pricing only when a location is supplied.

#### Scenario: Label resolved before priced calls

- **WHEN** a priced Kroger tool runs and no `locationId` is cached
- **THEN** the system resolves `preferred_location` to a `locationId` via the Locations API and uses it on the product search

#### Scenario: Resolved location reused

- **WHEN** subsequent priced calls run within the isolate
- **THEN** the cached `locationId` is reused without re-resolving

### Requirement: kroger_search internal product search

The system SHALL provide an internal `kroger_search` helper that queries the Products API by term and `locationId` (and curbside/delivery fulfillment), returning candidate products with `price { regular, promo }`, `size`, `brand`, and fulfillment flags. This helper SHALL NOT be exposed as a raw MCP tool; the curated Kroger tools and the matching pipeline call it internally.

#### Scenario: Search returns priced candidates

- **WHEN** `kroger_search` is called with a term and the resolved `locationId`
- **THEN** it returns candidate products each carrying `price { regular, promo }`, `size`, `brand`, and curbside/delivery fulfillment flags

### Requirement: kroger_prices for an ingredient list

The system SHALL provide `kroger_prices(ingredients)` returning, per ingredient, the current `{ regular, promo }` price, on-sale flag, and curbside/delivery availability at the resolved location.

#### Scenario: Prices returned per ingredient

- **WHEN** `kroger_prices` is called with a list of ingredient strings
- **THEN** it returns one priced result per ingredient including current price, on-sale state, and curbside/delivery availability

### Requirement: kroger_flyer synthesized sale scan

The system SHALL provide `kroger_flyer(min_savings_pct?)` that returns a synthesized sale list by reading a **pre-warmed per-location flyer cache**, never by issuing live Kroger searches. The tool SHALL resolve the caller's `preferred_location` to a `locationId`, read the materialized rollup at KV key `flyer:{locationId}`, apply the `min_savings_pct` threshold (a parameter defaulting to 5%) at read time over the cached candidates, and return `{ items, as_of }` — where each item is a fulfillable, genuinely-discounted product deduplicated by `productId` and carrying every broad term that surfaced it (`matched_terms`), and `as_of` is the completion timestamp of the sweep that produced the rollup (or null when no rollup exists). The tool SHALL NOT issue any external Kroger subrequest on this path. The cached rollup SHALL store every product passing the **noise floor** — fulfillable (curbside or delivery) AND on sale (`promo > 0 && promo < regular`, excluding Kroger's `promo == regular` echo) — with raw `regular`/`promo` preserved, so the `min_savings_pct` deal judgment is applied at read and remains caller-tunable. The tool SHALL NOT accept ad-hoc `terms` or an `against_stockup` flag: the former live fan-out and per-tenant/precise scanning are removed from this tool and re-homed to the place-groceries flow. When the rollup is absent (cold cache, or a store not yet swept), the tool SHALL return an empty `items` list rather than erroring. The result is explicitly non-exhaustive and MAY be minutes-to-hours stale; `as_of` conveys its age, and the order path re-prices live at fulfillment.

#### Scenario: Flyer is served from the warmed cache without live fetch

- **WHEN** `kroger_flyer` runs for a caller whose store has a warmed rollup
- **THEN** it returns that location's cached flyer items plus an `as_of` timestamp, issuing no external Kroger subrequest

#### Scenario: Discount floor applied at read time

- **WHEN** the caller passes a `min_savings_pct` (or omits it, defaulting to 5%)
- **THEN** only cached products marked down by at least that fraction of the regular price are returned, the deal judgment staying with the caller over the noise-floor rollup

#### Scenario: Cold or missing cache degrades gracefully

- **WHEN** the rollup at `flyer:{locationId}` is absent (fresh deploy, or a store not yet swept)
- **THEN** `kroger_flyer` returns an empty `items` list and a null `as_of` rather than erroring

#### Scenario: Ad-hoc terms and stockup scanning are not accepted

- **WHEN** the agent wants to check a salmon substitute or a stockup item against current sales
- **THEN** it does so through the place-groceries flow, not `kroger_flyer`, which no longer performs any live scan or accepts `terms` / `against_stockup`

#### Scenario: Each product carries all matching broad terms

- **WHEN** a product was surfaced by more than one broad term during the sweep
- **THEN** it appears once in the rollup with `matched_terms` listing every broad term that surfaced it, rather than collapsing to the first

### Requirement: ready_to_eat_available by curbside/delivery fulfillment

The system SHALL provide `ready_to_eat_available()` that cross-references the **caller's** per-tenant `users/<username>/ready_to_eat.toml` catalog against current Kroger availability, where "available" means the item is fulfillable via curbside or delivery (`fulfillment.curbside || fulfillment.delivery`) at the resolved location. The system SHALL NOT claim live in-store stock, which the public API does not expose. When the caller has no catalog file (or an empty one), the tool SHALL return an empty availability result rather than erroring.

#### Scenario: Availability partitioned by fulfillment

- **WHEN** `ready_to_eat_available` runs
- **THEN** the caller's catalog items fulfillable via curbside or delivery are returned as available and the rest as unavailable

#### Scenario: Empty or absent catalog returns empty

- **WHEN** `ready_to_eat_available` runs for a caller whose `users/<username>/ready_to_eat.toml` is absent or empty
- **THEN** the tool returns an empty availability result without error

### Requirement: flyer_terms.toml curated config

The system SHALL read broad scan terms from a user-curated `flyer_terms.toml`. The agent SHALL treat it as edit-only-when-directed (the user-curated bucket) and SHALL NOT infer or write terms automatically. These broad terms drive the **background flyer warm** that populates the per-location cache `kroger_flyer` reads, rather than a live per-call scan. Its schema SHALL be documented in `docs/SCHEMAS.md`.

#### Scenario: Missing config degrades gracefully

- **WHEN** `flyer_terms.toml` is absent or empty
- **THEN** the warm sweep has no broad terms to scan, the per-location rollup is empty, and `kroger_flyer` returns an empty sale list rather than erroring

