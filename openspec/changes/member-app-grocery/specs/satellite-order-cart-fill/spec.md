## MODIFIED Requirements

### Requirement: The pull-list returns the tenant's resolved to-buy list keyed by canonical ingredient id

`POST /satellite/order/list` SHALL return the caller-tenant's freshly-resolved to-buy list — the shared set algebra over the current `active` grocery list **∪ the meal plan's server-derived ingredient needs** minus pantry on-hand (the same derivation the to-buy read and `place_order` use, so every flush surface sees the same set) — with each item carrying its **canonical ingredient id** (`item_id`, equal to the `grocery_list` `normalized_name` key a derived line would materialize under), its display `name`, `quantity`, `for_recipes`, and `assumed_quantity`, together with the tenant's **primary store slug and location id** and an issued **`order_list_id`**. Planned recipes whose ingredient list is not yet derived SHALL be reported alongside so the human at the helper knows the list may be incomplete. It SHALL be served **only** when the tenant's primary store is satellite-fulfilled; a Kroger/Worker-native primary SHALL receive a structured error directing to `place_order`. The list SHALL NOT be resolved against store product availability — product matching is the satellite's browser job.

#### Scenario: The pull-list carries canonical ids and the primary store

- **WHEN** a satellite-fulfilled tenant's helper calls the pull-list
- **THEN** it receives `{ order_list_id, store, location_id, items: [{ item_id, name, quantity, for_recipes, assumed_quantity }], partials }`, with `item_id` the canonical ingredient id and `store`/`location_id` the tenant's primary

#### Scenario: Plan-derived needs ride the pull-list without materialized rows

- **WHEN** a satellite-fulfilled tenant has a planned recipe whose derived ingredients are not on the grocery list and not in the pantry
- **THEN** the pull-list includes those ingredients as items (canonical `item_id`, the recipe's slug in `for_recipes`), and a carted disposition for one advances it via the existing insert-on-missing in-cart keying

#### Scenario: A Kroger primary is refused the pull-list

- **WHEN** a tenant whose primary is Kroger calls the pull-list
- **THEN** the Worker returns a structured error directing to `place_order`, and mints no order-list
