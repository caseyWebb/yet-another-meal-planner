## MODIFIED Requirements

### Requirement: Write the Kroger cart and persist learned mappings

For the resolved set, `place_order` SHALL add items to the Kroger cart via `PUT /v1/cart/add`
and SHALL upsert learned ingredient→SKU mappings to the D1 `sku_cache` table. Each committed
mapping SHALL carry the resolved candidate's aisle placement (`aisle_number` /
`aisle_description` / `aisle_side`, with a capture timestamp) when the Kroger product response
provides one. The commit SHALL cover **every** resolved line — including lines resolved from
the cache, whose revalidation carries fresh placement data — and SHALL skip a line only when
its already-cached row is identical across the learned fields (SKU, brand, size, aisle);
a differing row SHALL be refreshed in place, so placements and mappings converge organically
with each order rather than freezing at first capture. The cart write and the SKU-cache upsert
SHALL be **independent best-effort** operations — neither is transactional with the other, and
a failure of one SHALL NOT corrupt the other. `place_order` SHALL return honest partial status
and SHALL NOT report a populated cart when the cart write failed.

#### Scenario: Resolved items added and mappings cached

- **WHEN** the resolved set is non-empty and the cart write succeeds
- **THEN** the items are added via `PUT /v1/cart/add` and the SKU mappings — with any
  available aisle placement — are upserted to the D1 `sku_cache` table

#### Scenario: A cache-hit line refreshes its placement

- **WHEN** a line resolves from an existing `sku_cache` row whose stored aisle data is absent
  or differs from the revalidated product's current `aisleLocation`
- **THEN** the commit upserts that row in place with the fresh placement (and `last_used`),
  rather than skipping it because the key was already cached

#### Scenario: An identical mapping is not rewritten

- **WHEN** a line resolves from a cached row whose SKU, brand, size, and aisle all match the
  fresh resolution
- **THEN** the commit skips that row — no write churn for unchanged mappings

#### Scenario: Honest partial failure

- **WHEN** the SKU-cache commit succeeds but the cart write fails (or vice versa)
- **THEN** `place_order` reports the true status of each operation and never claims the cart
  is populated when it is not
