# instacart-adapter Specification

## Purpose

Define the optional operator-configured Instacart Marketplace handoff, including deterministic to-buy mapping, tenant-isolated URL caching, shared transports, structured degradation, and the boundary that keeps handoff separate from order lifecycle and spend.
## Requirements
### Requirement: Instacart is an optional operator-authenticated Marketplace adapter

The system SHALL treat Instacart Developer Platform as an optional deployment adapter authenticated by the operator's API key in an HTTP Bearer header. The adapter SHALL be configured only when both the secret key and a valid deployment environment (`development` or `production`) are present; the environment SHALL select the fixed official origin and SHALL NOT accept an arbitrary origin. No member OAuth, callback route, account link, token storage, preferred retailer, or retailer override SHALL exist. When configuration is absent or invalid, the shared operation SHALL return `{ status: "unavailable", code: "not_configured" }` before any D1 write or external request, and member-facing capability reads SHALL expose only availability, never the key.

#### Scenario: Missing configuration degrades without egress

- **WHEN** a tenant invokes the Instacart operation without a complete valid operator configuration
- **THEN** it returns structured `not_configured`, makes no Instacart request, writes no cache row, and reveals no secret or partial configuration

#### Scenario: Authentication is operator API-key Bearer auth

- **WHEN** a configured operation creates a shopping-list page
- **THEN** it calls the fixed origin for the selected environment with `Authorization: Bearer <operator-api-key>` and does not read or store any member Instacart credential

#### Scenario: No member account-link route exists

- **WHEN** the adapter is enabled
- **THEN** no `/oauth/instacart/*` callback, account-link state, or new `run_worker_first` route is introduced

### Requirement: The handoff maps the current derived to-buy set to the current shopping-list contract

The shared operation SHALL source lines from the same derived to-buy operation used by `read_to_buy`: active explicit rows union server-derived meal-plan needs minus pantry coverage, on canonical ingredient ids with in-flight suppression. It SHALL send `POST /idp/v1/products/products_link` with `link_type: "shopping_list"`, an explicit bounded expiry, and one `line_items` entry per to-buy line. Each entry SHALL use a generic, quantity-free `name`, a human `display_text`, and `line_item_measurements: [{ quantity: <positive package count>, unit: "package" }]`; it SHALL NOT send deprecated top-level line-item `quantity`/`unit`, fabricate recipe measurements, or send retailer keys, Kroger SKUs/product ids, UPCs, price, availability, aisle, brand, or health filters. An empty to-buy set SHALL return `status: "empty"` without external I/O, and the operation SHALL report `underived` recipe slugs rather than silently implying completeness.

#### Scenario: Explicit and plan-derived lines map once

- **WHEN** the to-buy view contains an explicit line, a plan-derived line, and one line present in both sources
- **THEN** the request contains one line item per canonical to-buy line, including the merged line only once, with its positive package count represented only in `line_item_measurements`

#### Scenario: Deprecated and unrelated product fields are absent

- **WHEN** a line also has Kroger mapping, price, aisle, brand, or recipe provenance data
- **THEN** the Instacart line item contains none of those fields and contains no top-level `quantity` or `unit`

#### Scenario: Empty list does not create a page

- **WHEN** the derived to-buy set is empty
- **THEN** the operation returns `status: "empty"`, item count zero, and makes no cache write or Instacart request

#### Scenario: Underived recipes stay visible

- **WHEN** the current plan includes a recipe whose complete ingredient list has not been derived
- **THEN** its slug is returned in `underived` so the MCP or member surface can warn that the Marketplace list may be incomplete

### Requirement: Generated shopping-list URLs are cached by tenant and exact content

The system SHALL persist generated handoff URLs in a D1 table accessed only through `src/db.ts`, keyed by `(tenant, content_hash)` with `url`, `created_at`, and `expires_at`. The content hash SHALL cover a versioned, deterministic serialization of every field sent to `products_link`, with line ordering canonicalized by ingredient key. A tenant SHALL reuse its unexpired URL while content is unchanged and SHALL generate a new page after the payload changes or the cache expires. Identical content in two tenants SHALL never permit either tenant to read the other's URL. A newly returned URL SHALL be accepted only when it is HTTPS and hosted on `instacart.com` or a subdomain; invalid responses SHALL not be cached.

#### Scenario: Unchanged content reuses one URL

- **WHEN** the same tenant requests a handoff twice with the same canonical payload before expiry
- **THEN** the second result returns the cached URL with `reused: true` and performs no second Instacart request

#### Scenario: Content change creates a new page

- **WHEN** a line, display label, or package measurement changes for the tenant
- **THEN** the content hash changes and the operation requests and caches a new shopping-list URL

#### Scenario: Expired content creates a new page

- **WHEN** the matching cache row is expired or inside the configured safety window
- **THEN** it is not returned and the operation requests a new URL, updating the tenant's cache row

#### Scenario: Equal lists remain tenant-isolated

- **WHEN** two tenants produce byte-identical canonical payloads
- **THEN** their cache reads and writes remain separated by tenant and neither receives a URL created for the other

#### Scenario: Invalid response URL is rejected

- **WHEN** the upstream response omits `products_link_url` or returns a non-HTTPS/non-Instacart URL
- **THEN** the operation returns `invalid_response` and persists no URL

### Requirement: One operation serves MCP and member API with structured failures

The MCP tool `create_instacart_handoff` and session-gated `POST /api/grocery/instacart` SHALL call one shared operation and return the same discriminated result contract. The MCP tool SHALL register only when the Instacart configuration resolves (`mcp-tool-gating`); the shared operation SHALL retain its structured `unavailable`/`not_configured` result for the member API and for any race where configuration disappears between registration and call. The member mutation SHALL be online-only and SHALL NOT enter offline replay. The operation SHALL map validation, 401, 403, 429, network/5xx, and invalid-response failures to stable closed error codes with an honest retryability flag; it SHALL not reflect the API key or unsafe upstream response content in output or logs and SHALL not automatically retry page creation.

#### Scenario: Tool and endpoint share behavior

- **WHEN** the same tenant and to-buy state invoke the MCP tool and member endpoint on a configured deployment
- **THEN** both use the same mapping/cache/external-call operation and return the same result shape

#### Scenario: An unconfigured deployment advertises no handoff tool

- **WHEN** the deployment has no Instacart API key
- **THEN** `create_instacart_handoff` is absent from the tool list, while the member endpoint still returns the structured `not_configured` result

#### Scenario: Production permission failure is distinguishable

- **WHEN** Instacart returns 401 or 403 for a configured key
- **THEN** the operation returns `unauthorized` or `forbidden` without leaking the key or raw upstream body and without writing a cache row

#### Scenario: Rate limit and upstream outage are retryable

- **WHEN** Instacart returns 429, a 5xx response, a timeout, or a network failure
- **THEN** the operation returns the corresponding structured retryable error and does not claim that a handoff page exists

#### Scenario: Handoff is not queued offline

- **WHEN** the member app is offline or a handoff request is interrupted
- **THEN** it is not persisted for replay and the member must explicitly retry online

### Requirement: Nearby retailers cannot target or strengthen the handoff

The initial adapter SHALL NOT call or expose nearby-retailer discovery. If a later change retains `GET /idp/v1/retailers`, its output SHALL be informational only: it SHALL NOT be stored as a preference, included in the shopping-list request/hash, described as item availability, or used to claim that the returned Marketplace URL opens at that retailer.

#### Scenario: No retailer is selected before handoff

- **WHEN** a member creates an Instacart handoff
- **THEN** yamp sends no retailer identifier and tells the member that retailer selection occurs on Instacart Marketplace

#### Scenario: Future nearby results remain informational

- **WHEN** a future surface displays retailers returned for a postal code
- **THEN** choosing or viewing one does not alter the handoff payload or persist a preferred retailer and carries no availability, price, or ETA guarantee

### Requirement: Production enablement remains a documented post-merge operator gate

The repository SHALL document development-key setup and an explicit operator production-enable checklist covering the compliant CTA/demo, production-key request, Instacart activation, secret configuration, and production verification. Completing repository implementation and archiving this change SHALL NOT require third-party approval; requesting/receiving approval and enabling production are post-merge deployment work. The checklist SHALL prohibit `INSTACART_API_ENV=production` until Instacart activates the production key, and the repository SHALL make no claim that approval occurred. The default repository and deployments SHALL contain no key and SHALL leave the adapter disabled. Deploy-merge tests SHALL prove the operator-owned environment selector survives while no maintainer key or default secret is propagated.

#### Scenario: Default deployment stays disabled

- **WHEN** an operator deploys without Instacart configuration
- **THEN** the CTA is absent and the tool/endpoint degrade as `not_configured` without affecting any other grocery path

#### Scenario: Development integration is not presented as production

- **WHEN** the operator uses a development key for the required demo and smoke test
- **THEN** requests use the official development origin and documentation requires external approval before switching to production

#### Scenario: Repository completion does not wait on Instacart

- **WHEN** implementation, tests, fail-closed defaults, and the operator production-enable checklist are complete but Instacart has not approved a production key
- **THEN** the repository change is complete and archivable while production remains disabled and no approval claim is recorded

