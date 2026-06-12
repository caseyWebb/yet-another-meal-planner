## ADDED Requirements

### Requirement: profile_status reports initialization from a single subtree listing

The system SHALL provide a per-tenant `profile_status` read tool that reports whether the caller has completed grocery-profile setup, derived from a **single** listing of the caller's `users/<username>/` subtree (via the prefixed GitHub client's `listDir`). It SHALL take no parameters, never write, and address only the caller's own subtree.

It SHALL return `{ initialized: boolean, missing: string[] }`:

- `initialized` SHALL be `true` if and only if the caller's `preferences.toml` is present (the unconditional first onboarding area), and `false` otherwise.
- `missing` SHALL list the onboarding-area keys whose backing file is absent, using the fixed mapping: `store`→`preferences.toml`, `taste`→`taste.md`, `diet`→`diet_principles.md`, `equipment`→`kitchen.toml`, `pantry`→`pantry.toml`, `ready-to-eat`→`ready_to_eat.toml`, `stockup`→`stockup.toml`, `corpus`→`overlay.toml`.

When the subtree does not exist yet (the GitHub Contents API returns 404 for a brand-new member), the tool SHALL treat it as an empty subtree and return `{ initialized: false, missing: <all area keys> }` rather than erroring. Any other upstream failure SHALL surface as a structured `upstream_unavailable` error (the standard tool-boundary mapping), so the caller can treat an indeterminate result as non-gating.

#### Scenario: Brand-new member with no subtree

- **WHEN** `profile_status` is called for a member whose `users/<username>/` subtree does not exist (404)
- **THEN** it returns `{ initialized: false, missing: [...all area keys...] }` without erroring

#### Scenario: Set-up member reports initialized

- **WHEN** `profile_status` is called for a member whose subtree contains `preferences.toml`
- **THEN** it returns `initialized: true`, with `missing` listing only the onboarding areas whose files are still absent

#### Scenario: Partially set-up member lists the gaps

- **WHEN** `profile_status` is called for a member who has `preferences.toml` but no `taste.md` or `stockup.toml`
- **THEN** it returns `initialized: true` and `missing` includes `taste` and `stockup`

#### Scenario: Transient upstream failure is a structured error, not a false "not initialized"

- **WHEN** the subtree listing fails for a reason other than a 404 (e.g. a 5xx from GitHub)
- **THEN** the tool returns a structured `upstream_unavailable` error rather than reporting `initialized: false`
