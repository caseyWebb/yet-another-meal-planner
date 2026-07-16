# satellite-sale-scan — delta

## REMOVED Requirements

### Requirement: store_flyer reads the caller's store flyer, Kroger or satellite-scanned

**Reason**: Unified into the single `flyer` tool (the `kroger-integration` delta's ADDED requirement), which carries this requirement's behavior verbatim — primary-store resolution, the `flyer:{store}:{locationId}` rollup read, the read-time deal floor, the satellite staleness ceiling reading as empty with `as_of` surfaced, no flyer fan-out subrequest, and graceful cold-cache degradation. The satellite scan producer, rollup keys, and freshness rules of this capability are unchanged.
**Migration**: Call `flyer`. Hard removal, no dispatch alias, behind the coordinated plugin publish.
