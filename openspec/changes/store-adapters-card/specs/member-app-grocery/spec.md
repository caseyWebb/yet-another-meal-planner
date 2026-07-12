## ADDED Requirements

### Requirement: The grocery launcher is a projection of configured store adapters

The grocery page SHALL replace its independently-derived Kroger-only affordance with a fulfillment launcher that renders only the `launcher` entries returned by the shared store-adapter projection. It SHALL branch on each entry's `mode` and `enabled`/`disabled_reason` fields, not on raw profile preferences, Kroger token state, shared store rows, or satellite liveness. Kroger online order SHALL open Order Review only from an enabled `online_order` entry. A disabled entry SHALL remain visible with the projection's actionable reason; no unavailable path SHALL issue a fulfillment request.

The launcher SHALL keep the manual-shop fallback outside the adapter projection. Instacart SHALL have no launcher entry in this change. A Satellite entry with unavailable freshness SHALL be disabled, and an Offline walk entry SHALL identify the selected existing store without duplicating its identity.

#### Scenario: Kroger launcher state matches the Preferences card

- **WHEN** the projection reports Kroger connected with an exact preferred location and an enabled online-order entry
- **THEN** Grocery offers that Kroger order path and Profile shows the same connection/location from the same response

#### Scenario: Missing Kroger setup is actionable but inert

- **WHEN** the projection returns a Kroger entry disabled by `connect_kroger` or `choose_kroger_store`
- **THEN** the launcher shows the corresponding setup action/reason and does not open or post an order preview

#### Scenario: Unknown Satellite freshness disables launch

- **WHEN** a configured satellite entry has `session_fresh:null` and `satellite_freshness_unavailable`
- **THEN** the launcher shows the store as unavailable and sends no cart-fill request

#### Scenario: Instacart placeholder cannot leak into fulfillment

- **WHEN** the Profile card includes the `coming_soon` Instacart tab
- **THEN** the grocery launcher's entries contain no Instacart path

### Requirement: Store preference changes discard store-bound preview state

The Grocery page SHALL treat a successful standing-store change or Kroger disconnect as an invalidation boundary. It SHALL close an open Order Review, discard its local preview/disposition state, invalidate the shared adapter projection and enriched store-placement read, and preserve the underlying store-agnostic to-buy membership and grocery lifecycle rows. A subsequent Kroger Order Review SHALL start with a new preview under the current exact location.

#### Scenario: A store switch cannot commit an old preview

- **WHEN** the preferred location changes after a preview was resolved
- **THEN** that preview can no longer be committed, and the member must open a fresh preview resolved for the new location

#### Scenario: List membership survives a store switch

- **WHEN** the standing adapter changes from Kroger to an Offline store
- **THEN** the active/derived grocery set is unchanged while only placement and launcher presentation are re-derived
