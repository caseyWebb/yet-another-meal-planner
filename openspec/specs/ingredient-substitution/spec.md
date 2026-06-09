# ingredient-substitution Specification

## Purpose
TBD - created by archiving change pantry-verification-substitution. Update Purpose after archive.
## Requirements
### Requirement: propose_substitutions applies substitutions.toml rules deterministically

The system SHALL provide `propose_substitutions(ingredient, mode)` that applies the standing rules in `substitutions.toml` deterministically and returns `{ substitutes: [...], unacceptable: [...] }`. The tool SHALL NOT invent substitutions beyond what the rules permit, and SHALL NOT itself apply a substitution — it surfaces alternatives for the agent to present to the user for confirmation. This tool is the sole owner of substitution logic, fulfilling the `ingredient-matching` capability's rule that the matcher never substitutes.

#### Scenario: Rules produce acceptable and unacceptable alternatives

- **WHEN** `propose_substitutions("salmon", "inventory")` is invoked and `substitutions.toml` allows `trout` but disallows `tilapia` for salmon
- **THEN** the result contains `trout` in `substitutes` and `tilapia` in `unacceptable`, and no substitution is applied automatically

### Requirement: Inventory and sale modes

The `mode` parameter SHALL select the candidate source. In `inventory` mode the tool SHALL surface rule-acceptable substitutes that are present in `pantry.toml`. In `sale` mode the tool SHALL fetch current Kroger flyer/price data **internally** (via the kroger-integration capability) and surface rule-acceptable substitutes that are on sale; it SHALL NOT require the caller to pre-fetch flyer data.

#### Scenario: Inventory mode restricts to pantry-present substitutes

- **WHEN** `propose_substitutions("salmon", "inventory")` is invoked, the rules allow `trout` and `cod`, and only `trout` is in the pantry
- **THEN** `trout` is returned as an available substitute and `cod` is not surfaced as inventory-available

#### Scenario: Sale mode fetches Kroger data without caller pre-pass

- **WHEN** `propose_substitutions("salmon", "sale")` is invoked
- **THEN** the tool internally queries Kroger for the rule-acceptable substitutes' current prices and returns those whose `promo > 0`, without the caller having called `kroger_flyer` first

### Requirement: Dormant until seeded

When `substitutions.toml` is empty or contains no rule matching the requested ingredient, the tool SHALL return an empty `{ substitutes: [], unacceptable: [] }` result rather than an error. An empty result is a valid, expected outcome until the user-curated rules are seeded.

#### Scenario: No rules yields an empty, non-error result

- **WHEN** `propose_substitutions("olive oil", "inventory")` is invoked against an empty `substitutions.toml`
- **THEN** it returns `{ substitutes: [], unacceptable: [] }` and does not return an error

### Requirement: Structured errors in sale mode

When the internal Kroger fetch required by `sale` mode fails (unreachable, rate-limited, or location unresolved), the tool SHALL return a structured error per the established convention rather than throwing or returning a misleadingly empty result.

#### Scenario: Kroger unavailable surfaces a structured error

- **WHEN** `propose_substitutions("salmon", "sale")` is invoked and the Kroger price lookup fails
- **THEN** the tool returns a structured error indicating the Kroger fetch failed, distinct from an empty no-rules result

