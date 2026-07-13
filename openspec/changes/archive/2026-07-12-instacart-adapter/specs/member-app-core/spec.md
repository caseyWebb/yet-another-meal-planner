## MODIFIED Requirements

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile, SHALL edit structured preferences via the existing merge-patch operation (dietary avoid/limit; rotation; stores; brand tiers; the per-meal `cadence` map; the `weekly_budget`), SHALL edit the `taste` and `diet_principles` markdown fields, and SHALL render the derived taste read from the existing retrospective aggregation. Kroger connection/location state and every Store-card adapter summary SHALL come from the shared store-adapter projection rather than being re-derived from the assembled profile. All whole-document writes on this page are conditional (see the write-classes requirement).

The Preferences tab's **Planning card** SHALL expose the household planning knobs the shipped schema backs:

- **Per-meal weekly cadence steppers** — Breakfast / Lunch / Dinner, an integer 0–7 each, each writing a per-key merge patch (`{cadence: {<meal>: n}}`) so adjusting one meal preserves the others, with the − and + controls disabled at 0 and 7. (The mock's richer per-night "typical week" grid is out of scope — it needs storage the shipped schema does not carry.)
- The resurface-after and novelty-boost sliders (schema-faithful).
- A **weekly grocery budget** control whose unset state is first-class: clearing the field writes `weekly_budget: null` (deleting the key), a numeric value writes `Math.max(0, Math.round(n))` formatted on blur, and the control SHALL NEVER write `0` to mean "off"; an unset budget SHALL show helper copy that the budget line won't render.

The retired `lunch_strategy` and `ready_to_eat_default_action` preferences (D8/D21; per-meal cadence and meal vibes subsume them) SHALL have no control.

The Preferences tab's **Store card** SHALL render adapter tabs in the stable order Kroger / Instacart / Satellites / Offline. Kroger SHALL show projection-backed connection state and preferred name/address, Connect/Reconnect via the existing login-URL endpoint, online-only Disconnect, and a gear-triggered modal that submits a ZIP search, presents all bounded nearest-first results, and conditionally writes the selected exact location. Satellites SHALL show the projection's secret-free read-only unavailable summary and the adapter-authoring guide only until a real member Satellites route ships; it SHALL NOT render a no-op member-surface link. Offline SHALL list the existing grocery stores and allow standing selection, without implementing store CRUD or the aisle-map editor in this change. Instacart SHALL show only the shared projection's operator-configured availability and Marketplace-handoff explanation; it SHALL expose no member account link, retailer preference/override, credential, price, availability, or ETA state, and its unavailable state SHALL say `Not configured` rather than imply future account linking.

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation over the real cooking log — no new aggregation is introduced

#### Scenario: A per-meal cadence set persists

- **WHEN** a member steps one meal's weekly cadence up or down on the Planning card
- **THEN** the change is written as a per-key `{cadence: {<meal>: n}}` merge patch, the other meals' counts are preserved, and a reload shows the persisted value

#### Scenario: Setting and clearing the weekly budget (a clear is not a zero)

- **WHEN** a member sets a numeric weekly budget and then clears the field
- **THEN** the numeric value is written as `weekly_budget` (rounded, non-negative) and the clear writes `weekly_budget: null` — an UNSET state, not `0` — so a reload renders the empty control with its "no budget line" helper copy

#### Scenario: No retired-preference control renders

- **WHEN** the profile page's preferences tab renders
- **THEN** it offers no `lunch_strategy` or ready-to-eat default-action control — those preferences are retired and subsumed by the per-meal cadence steppers and meal vibes

#### Scenario: Store tabs share the adapter projection

- **WHEN** a member opens each Store tab and then visits Grocery
- **THEN** connection, preferred-store, Offline, Satellite, and launcher state all come from the same projection response

#### Scenario: Instacart tab reflects operator configuration only

- **WHEN** the member opens Instacart with complete valid operator configuration or with the adapter disabled
- **THEN** the tab reports `Available` or `Not configured` from the shared projection and offers no member account, retailer, price, availability, or ETA control

#### Scenario: Kroger picker selects an exact store

- **WHEN** a member searches a valid ZIP, chooses one of multiple Kroger results, and the conditional preferences write succeeds
- **THEN** the Store card refreshes to that result's exact name/address and no standalone ZIP preference control remains

#### Scenario: Offline does not duplicate the aisle-map change

- **WHEN** a member opens Offline in this change
- **THEN** existing shared store identities and standing selection render, but no duplicate store entity, shared-store CRUD form, or aisle-map editor is present
