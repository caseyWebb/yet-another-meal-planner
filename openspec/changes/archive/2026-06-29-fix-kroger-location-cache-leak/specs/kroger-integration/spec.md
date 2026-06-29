## MODIFIED Requirements

### Requirement: Location resolution

The system SHALL resolve `preferences.toml`'s `preferred_location` label to a Kroger `locationId` via the Locations API. A label already holding a pre-resolved `locationId` (no whitespace) SHALL be returned directly without a Locations API call. The system SHALL NOT cache the resolved `locationId` in isolate memory: the only isolate-shared Kroger state is the app-level `client_credentials` access token, which carries no tenant context. Because Cloudflare reuses an isolate across requests and tenants, isolate-shared per-tenant store context would leak one tenant's store to another; the resolution therefore holds no isolate-level location state. Every priced product call SHALL include a `locationId`, since the Products API returns pricing only when a location is supplied.

#### Scenario: Label resolved before priced calls

- **WHEN** a priced Kroger tool runs
- **THEN** the system resolves `preferred_location` to a `locationId` (via the Locations API, or directly when the label already holds a pre-resolved id) and uses it on the product search

#### Scenario: Resolution holds no isolate-level location state

- **WHEN** one tenant's request resolves a `locationId` and a different tenant's request is later served by the same isolate
- **THEN** the second request resolves its own `preferred_location` independently and never receives the first tenant's `locationId`, because no resolved location is cached in isolate memory
