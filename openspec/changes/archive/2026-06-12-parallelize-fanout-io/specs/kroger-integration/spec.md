## MODIFIED Requirements

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

### Requirement: kroger_flyer synthesized sale scan

The system SHALL provide `kroger_flyer(filter)` that synthesizes a sale list by scanning two term sources and returning genuinely-discounted, fulfillable products deduplicated by `productId`: **precise** terms derived from caller context (stockup, menu ingredients, substitution candidates) and **broad** curated terms read from `flyer_terms.toml`. A product SHALL be kept only when it is fulfillable (curbside or delivery), on sale (`promo > 0 && promo < regular`, excluding Kroger's `promo == regular` non-sale echo), AND marked down by at least `min_savings_pct` of the regular price — a `filter` parameter defaulting to 5%, so penny / near-zero markdowns are excluded while the caller owns the "what counts as a deal" threshold. Each kept product SHALL carry **every** scanned term that surfaced it (`matched_terms`), not only the first, so the caller can distinguish a stockup/menu match from a broad-category match. The result is explicitly non-exhaustive (the public API exposes no flyer/circular endpoint and no sort-by-discount); each term returns a bounded relevance-ranked page that MAY be paginated a few pages deep.

#### Scenario: Only genuine discounts are returned

- **WHEN** `kroger_flyer` runs
- **THEN** it keeps only fulfillable products on sale and marked down by at least `min_savings_pct` (default 5%) of the regular price, deduplicated by `productId`, dropping `promo == regular` echoes and penny markdowns

#### Scenario: Each product carries all matching terms

- **WHEN** a product is surfaced by more than one scanned term (e.g. a precise stockup term and a broad category term)
- **THEN** it appears once with `matched_terms` listing every term that surfaced it, rather than collapsing to the first term

#### Scenario: Broad terms drive serendipitous discovery

- **WHEN** `flyer_terms.toml` contains broad category terms (e.g. `"fruit"`, `"frozen meals"`)
- **THEN** those terms are scanned in addition to precise context terms, surfacing sales beyond the caller's known item list

#### Scenario: Caller widens the discount floor

- **WHEN** the caller passes a `min_savings_pct` below (or above) the 5% default
- **THEN** the scan keeps products meeting that threshold instead, moving the deal judgment to the caller
