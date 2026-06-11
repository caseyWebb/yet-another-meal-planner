## MODIFIED Requirements

### Requirement: ready_to_eat_available by curbside/delivery fulfillment

The system SHALL provide `ready_to_eat_available()` that cross-references the **caller's** per-tenant `users/<username>/ready_to_eat.toml` catalog against current Kroger availability, where "available" means the item is fulfillable via curbside or delivery (`fulfillment.curbside || fulfillment.delivery`) at the resolved location. The system SHALL NOT claim live in-store stock, which the public API does not expose. When the caller has no catalog file (or an empty one), the tool SHALL return an empty availability result rather than erroring.

#### Scenario: Availability partitioned by fulfillment

- **WHEN** `ready_to_eat_available` runs
- **THEN** the caller's catalog items fulfillable via curbside or delivery are returned as available and the rest as unavailable

#### Scenario: Empty or absent catalog returns empty

- **WHEN** `ready_to_eat_available` runs for a caller whose `users/<username>/ready_to_eat.toml` is absent or empty
- **THEN** the tool returns an empty availability result without error
