## MODIFIED Requirements

### Requirement: Per-location rollup shared across same-store tenants

The warm SHALL key each rollup by **store and location** (`flyer:{store}:{locationId}`), so tenants at the same store share one rollup and tenants at different stores each get an independent rollup. The Kroger warm SHALL write the `kroger` store namespace (`flyer:kroger:{locationId}`). The rollup layer — its `FlyerItem` shape (`{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }`), its merge/dedup, and the `isOnSale` noise floor — SHALL be **store-agnostic**, so first-party Kroger sales and satellite-scanned sales converge into the identical raw rollup shape and downstream reads treat them uniformly. The cache SHALL contain only public-derived store-wide sale data, never tenant-private state — it remains the deliberately cross-tenant data plane, now spanning all stores rather than Kroger alone. Each rollup SHALL store the products passing the noise floor with raw `regular`/`promo` preserved and the `matched_terms` that surfaced each, and SHALL record the contributing sweep/scan's timestamp exposed to readers as `as_of`. Because the rollup is an ephemeral cache regenerated each sweep, the store-namespacing SHALL require no data migration: the Kroger read path SHALL fall back to the legacy `flyer:{locationId}` key while the namespaced key is absent, so the deploy has no cold read-gap, and the first namespaced sweep converges the cache organically.

#### Scenario: Same store, multiple tenants share a rollup

- **WHEN** two tenants resolve to the same store and `locationId`
- **THEN** both flyer reads are served by the single `flyer:{store}:{locationId}` rollup

#### Scenario: Different stores get independent rollups

- **WHEN** two tenants resolve to different stores or locations
- **THEN** each is swept/scanned independently into its own `flyer:{store}:{locationId}` rollup with its own `as_of`

#### Scenario: Kroger and satellite sales converge at the same rollup layer

- **WHEN** a Kroger sweep and a satellite sale scan each contribute sale items for their store
- **THEN** both produce the same `FlyerItem` shape in their store-namespaced rollup, so a store-aware read serves them uniformly, distinguishable only by which store namespace they landed in

#### Scenario: The store-namespacing converges without a data migration

- **WHEN** the store-namespaced warm is deployed before the first namespaced Kroger sweep completes
- **THEN** the Kroger read path falls back to the legacy `flyer:{locationId}` key so reads have no cold gap, and the first namespaced sweep writes `flyer:kroger:{locationId}` and the fallback stops mattering — no data migration is performed
