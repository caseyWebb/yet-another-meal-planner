# kroger-integration — delta

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: kroger_flyer synthesized sale scan

**Reason**: Unified with `store_flyer` into the single `flyer` tool (this delta's ADDED requirement) — two same-shaped flyer reads were exactly the overlapping-tool confusion the surface cull removes. The warmed-cache mechanics (noise floor at warm, deal floor at read, namespaced keys with legacy fallback, no live fan-out) carry over verbatim.
**Migration**: Call `flyer`. Hard removal, no dispatch alias, behind the coordinated plugin publish; the warm job, `flyer_terms`, and rollup keys are untouched.
