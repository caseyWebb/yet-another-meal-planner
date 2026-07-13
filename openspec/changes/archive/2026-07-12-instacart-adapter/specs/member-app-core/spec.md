## MODIFIED Requirements

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile, SHALL edit structured preferences via the existing merge-patch operation (dietary avoid/limit; rotation; stores; brand tiers; the per-meal `cadence` map; the `weekly_budget`), SHALL edit the `taste` and `diet_principles` markdown fields, and SHALL render the derived taste read from the existing retrospective aggregation. Kroger connection/location state and every Store-card adapter summary SHALL come from the shared store-adapter projection rather than being re-derived from the assembled profile. All whole-document writes on this page are conditional (see the write-classes requirement).

The Preferences tab's **Planning card** SHALL expose the household planning knobs the shipped schema backs:

- **Per-meal weekly cadence steppers** — Breakfast / Lunch / Dinner, an integer 0–7 each, each writing a per-key merge patch (`{cadence: {<meal>: n}}`) so adjusting one meal preserves the others, with the − and + controls disabled at 0 and 7.
- The resurface-after and novelty-boost sliders.
- A **weekly grocery budget** control whose unset state is first-class: clearing the field writes `weekly_budget: null`, a numeric value writes `Math.max(0, Math.round(n))`, and the control SHALL NEVER write `0` to mean "off".

The retired `lunch_strategy` and `ready_to_eat_default_action` preferences SHALL have no control.

The Preferences tab's **Store card** SHALL render adapter tabs in the stable order Kroger / Instacart / Satellites / Offline. Kroger SHALL show projection-backed connection state and preferred name/address, Connect/Reconnect via the existing login-URL endpoint, online-only Disconnect, and a ZIP-search location modal. Satellites SHALL show the projection's secret-free read-only unavailable summary and no no-op member-surface link. Offline SHALL list the existing grocery stores and allow standing selection without duplicating store CRUD or the aisle-map editor. Instacart SHALL show only the shared projection's operator-configured availability and Marketplace-handoff explanation; it SHALL expose no member account link, retailer preference/override, credential, price, availability, or ETA state, and its unavailable state SHALL say `Not configured` rather than imply future account linking.

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its learned summary
- **THEN** cuisine/protein mixes and cadence come from the existing retrospective operation

#### Scenario: A per-meal cadence set persists

- **WHEN** a member changes one meal's weekly cadence
- **THEN** a per-key cadence merge preserves other meals and survives reload

#### Scenario: Setting and clearing the weekly budget

- **WHEN** a member sets and then clears a weekly budget
- **THEN** the clear writes `weekly_budget: null`, never zero

#### Scenario: No retired-preference control renders

- **WHEN** preferences render
- **THEN** no lunch-strategy or ready-to-eat default-action control appears

#### Scenario: Store tabs share the adapter projection

- **WHEN** a member opens each Store tab and then Grocery
- **THEN** connection, preferred-store, Offline, Satellite, Instacart, and launcher state come from the same projection

#### Scenario: Instacart tab reflects operator configuration only

- **WHEN** the member opens Instacart with complete valid operator configuration or with the adapter disabled
- **THEN** the tab reports `Available` or `Not configured` and offers no member account, retailer, price, availability, or ETA control

#### Scenario: Kroger picker selects an exact store

- **WHEN** a member selects one result for a valid ZIP
- **THEN** the exact provider identity becomes the projection-backed location

#### Scenario: Offline does not duplicate the aisle-map change

- **WHEN** a member opens Offline
- **THEN** existing store identities and standing selection render without duplicate CRUD or map editor
