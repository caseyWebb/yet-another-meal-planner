## MODIFIED Requirements

### Requirement: Fulfillment mode and preferred store

`preferences.toml [stores].primary` SHALL accept either `kroger` (online mode — `place_order`, retaining `preferred_location` for the Kroger API) or a store slug. A store-slug primary SHALL default to **walk mode** (the in-store flush) and MAY be marked **satellite-fulfilled** (`preferences.toml [stores].fulfillment = "satellite"`) when the tenant runs a satellite cart-fill for that store — in which case the flush is the **satellite cart-fill**: the agent directs the user to open their local cart-fill helper rather than building a walk list or calling `place_order`. The agent SHALL select the flush from the resolved mode and SHALL NOT assume Kroger. Naming a store for a single trip SHALL override the standing preference for that trip only, without rewriting it. Mode is a property of the preference and trip, not the chain — a store MAY be online-capable, walk-capable, and/or satellite-fulfilled.

#### Scenario: Walk-mode primary picks the in-store flush

- **WHEN** `primary` is a mapped store slug (not marked satellite-fulfilled) and the user asks to shop
- **THEN** the agent runs the in-store walk, not `place_order`

#### Scenario: Satellite-fulfilled primary picks the cart-fill flush

- **WHEN** `primary` is a store slug marked satellite-fulfilled and the user asks to shop
- **THEN** the agent directs the user to open their local cart-fill helper and refresh, and does NOT call `place_order` or build an in-store walk list

#### Scenario: Per-trip override leaves the preference intact

- **WHEN** the standing `primary` is `kroger` but the user says "I'm going to the West 7th Tom Thumb, give me a list"
- **THEN** the agent builds an in-store list for that store and does not change the stored `primary`
