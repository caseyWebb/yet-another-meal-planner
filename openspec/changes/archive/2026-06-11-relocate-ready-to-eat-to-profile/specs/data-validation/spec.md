## ADDED Requirements

### Requirement: Ready-to-eat catalog structural validation

The system SHALL structurally validate a member's `users/<username>/ready_to_eat.toml` — both in the Node validator (`scripts/build-indexes.mjs`, when run over a data checkout) and in the Worker's write-time structural subset (`src/validate.ts`). Validation SHALL hard-fail (Node: non-zero exit; Worker: structured error, no commit) when: the file does not parse as TOML; an item omits `name` or `slug`; an item's `meal` is outside the enum (`breakfast`, `lunch`, `dinner`); an item's `status` is outside the enum (`active`, `draft`, `rejected`); an item's `rating` is present but not an integer in the rating range; or two items in the file share the same `slug`.

#### Scenario: Unknown meal blocks the write

- **WHEN** a `ready_to_eat.toml` item declares `meal = "brunch"`
- **THEN** validation hard-fails and reports the invalid `meal` and the offending item

#### Scenario: Duplicate slug blocks the write

- **WHEN** two items in a member's `ready_to_eat.toml` share the same `slug`
- **THEN** validation hard-fails and names the duplicated `slug`

#### Scenario: Well-formed catalog passes

- **WHEN** every item carries a `name`, a unique `slug`, a valid `meal`, a valid `status`, and any `rating` is an integer in range
- **THEN** validation passes for the catalog
