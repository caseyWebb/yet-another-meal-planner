## ADDED Requirements

### Requirement: The grocery launcher offers an honest branded Instacart Marketplace handoff

The grocery launcher's configured-adapter projection SHALL include a `Shop on Instacart` CTA only when the deployment reports the Instacart adapter configured. The CTA SHALL comply with Instacart's approved production design and copy contract: exact approved text, 46px height, 29.5px radius, an unmodified 22px full-color official logo, and an approved theme/color set. Activating it SHALL call `POST /api/grocery/instacart` and, on a `ready` result, open the returned HTTPS Instacart Marketplace URL as external navigation. The surrounding copy SHALL say that the member chooses a retailer, reviews matches, adds products, and checks out on Instacart; it SHALL NOT promise a preferred/targeted retailer, prices, availability, delivery timing, cart mutation, checkout, or order success. The Instacart action SHALL remain separate from the Kroger order-review dialog and online-only.

#### Scenario: Configured launcher shows the approved CTA

- **WHEN** the grocery page loads with Instacart availability enabled
- **THEN** the launcher renders the compliant `Shop on Instacart` CTA and no account-link, retailer-picker, or preferred-retailer control

#### Scenario: Unconfigured launcher omits Instacart

- **WHEN** the deployment reports Instacart unavailable
- **THEN** the launcher contains no Instacart CTA while Kroger, satellite, walk, and manual-shop entries retain their existing behavior

#### Scenario: Ready result opens Marketplace without an order claim

- **WHEN** the CTA receives a `ready` result
- **THEN** it opens the returned Instacart URL and explains the Marketplace review flow without showing cart-populated, in-cart, price, savings, ETA, or order-success UI

#### Scenario: Empty, incomplete, and error results are honest

- **WHEN** the handoff returns `empty`, non-empty `underived`, `not_configured`, or a structured upstream error
- **THEN** the UI renders the corresponding empty/incomplete/unavailable/retry state and never claims that a shopping page, cart, or order was created when it was not

### Requirement: Instacart launcher coverage uses typed fixtures and exact state assertions

The member-app Playwright suite SHALL cover configured and unconfigured launcher projection, approved CTA copy/geometry/logo/theme, a ready external navigation, empty/underived results, and each structured degradation class using fixtures typed against the shared operation result. The default suite SHALL make no Instacart network request and require no API key.

#### Scenario: App suite exercises the handoff without credentials

- **WHEN** `aubr test:app` runs in the default local environment
- **THEN** typed endpoint fixtures cover all launcher states and assert no external Instacart request is made

#### Scenario: Visual contract is regression-pinned

- **WHEN** the configured launcher screenshot is captured
- **THEN** the CTA's approved text, logo, height, radius, theme, and external-handoff copy are visible and regression-tested
