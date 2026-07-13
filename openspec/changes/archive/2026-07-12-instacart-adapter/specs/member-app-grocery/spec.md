## ADDED Requirements

### Requirement: The grocery launcher offers an honest branded Instacart Marketplace handoff

The grocery launcher's configured-adapter projection SHALL include a `Shop on Instacart` CTA only when the deployment reports the Instacart adapter configured. The CTA SHALL comply with Instacart's approved production design and copy contract: exact approved text, 46px height, 29.5px radius, an unmodified 22px full-color official logo, and an approved theme/color set. When the current grocery snapshot has underived planned recipes, the launcher SHALL present that incomplete-page warning and require explicit confirmation before enabling the branded CTA; confirmation SHALL bind to the deterministic sorted exact underived-slug set, and any different authoritative set returned by the handoff SHALL replace the warning and require fresh confirmation rather than navigate. The CTA SHALL remain the sole action that requests and opens the handoff. Activating it SHALL call `POST /api/grocery/instacart` and, on a `ready` result, open the returned HTTPS Instacart Marketplace URL as external navigation. If the grocery snapshot or adapter projection changes while that request is in flight, or if the launcher unmounts, the launcher SHALL abort or discard the response and SHALL NOT navigate to its stale URL. The surrounding copy SHALL say that the member chooses a retailer, reviews matches, adds products, and checks out on Instacart; it SHALL NOT promise a preferred/targeted retailer, prices, availability, delivery timing, cart mutation, checkout, or order success. The Instacart action SHALL remain separate from the Kroger order-review dialog and online-only.

#### Scenario: Configured launcher shows the approved CTA

- **WHEN** the grocery page loads with Instacart availability enabled
- **THEN** the launcher renders the compliant `Shop on Instacart` CTA and no account-link, retailer-picker, or preferred-retailer control

#### Scenario: Unconfigured launcher omits Instacart

- **WHEN** the deployment reports Instacart unavailable
- **THEN** the launcher contains no Instacart CTA while Kroger, satellite, walk, and manual-shop entries retain their existing behavior

#### Scenario: Ready result opens Marketplace without an order claim

- **WHEN** the CTA receives a `ready` result
- **THEN** it opens the returned Instacart URL and explains the Marketplace review flow without showing cart-populated, in-cart, price, savings, ETA, or order-success UI

#### Scenario: Incomplete snapshot requires confirmation before egress

- **WHEN** the current grocery snapshot reports one or more underived planned recipes
- **THEN** the launcher shows the incomplete-page warning before any handoff request, keeps `Shop on Instacart` disabled until the member confirms it, and then uses that branded CTA for the request and ready navigation

#### Scenario: Snapshot change cancels a stale handoff

- **WHEN** the grocery snapshot or Instacart adapter projection changes while a handoff request is in flight
- **THEN** the launcher cancels or discards that response, clears its busy state, remains on the grocery page, and never opens the returned stale URL

#### Scenario: Authoritative incomplete set requires exact fresh confirmation

- **WHEN** the member confirmed one sorted underived-slug set and the ready handoff returns a different set
- **THEN** the launcher replaces the warning with the authoritative set, clears confirmation, remains on the grocery page, and requires confirmation of that exact set before another handoff can navigate

#### Scenario: Leaving grocery cancels a stale handoff

- **WHEN** the member navigates to another SPA route while a handoff request is in flight
- **THEN** unmounting the launcher cancels or discards that response and releasing it cannot redirect away from the route the member chose

#### Scenario: Empty, incomplete, and error results are honest

- **WHEN** the handoff returns `empty`, non-empty `underived`, `not_configured`, or a structured upstream error
- **THEN** the UI renders the corresponding empty/incomplete/unavailable/retry state and never claims that a shopping page, cart, or order was created when it was not

### Requirement: Instacart launcher coverage uses typed fixtures and exact state assertions

The member-app Playwright suite SHALL cover configured and unconfigured launcher projection, approved CTA copy/geometry/logo/theme, exact-set preflight confirmation and authoritative underived-set mismatch, a ready external navigation, cancellation of held requests after a snapshot mutation and after SPA navigation unmount, empty/underived results, and each structured degradation class using fixtures typed against the shared operation result. The default suite SHALL make no Instacart network request and require no API key.

#### Scenario: App suite exercises the handoff without credentials

- **WHEN** `aubr test:app` runs in the default local environment
- **THEN** typed endpoint fixtures cover all launcher states and assert no external Instacart request is made

#### Scenario: Visual contract is regression-pinned

- **WHEN** the configured launcher screenshot is captured
- **THEN** the CTA's approved text, logo, height, radius, theme, and external-handoff copy are visible and regression-tested
