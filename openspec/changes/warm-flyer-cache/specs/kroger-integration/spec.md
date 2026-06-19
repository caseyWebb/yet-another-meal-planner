## MODIFIED Requirements

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

### Requirement: flyer_terms.toml curated config

The system SHALL read broad scan terms from a user-curated `flyer_terms.toml`. The agent SHALL treat it as edit-only-when-directed (the user-curated bucket) and SHALL NOT infer or write terms automatically. These broad terms drive the **background flyer warm** that populates the per-location cache `kroger_flyer` reads, rather than a live per-call scan. Its schema SHALL be documented in `docs/SCHEMAS.md`.

#### Scenario: Missing config degrades gracefully

- **WHEN** `flyer_terms.toml` is absent or empty
- **THEN** the warm sweep has no broad terms to scan, the per-location rollup is empty, and `kroger_flyer` returns an empty sale list rather than erroring
