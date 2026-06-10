## MODIFIED Requirements

### Requirement: Exact-vs-fuzzy matching never guesses

Matching SHALL place only exact normalized-name matches in `in_pantry`. **Every** inexact (fuzzy / token-overlap) correspondence between a parsed recipe ingredient and a pantry item SHALL be placed in `possible_matches` as a candidate pair for the agent to confirm or reject — all plausible candidates for an ingredient SHALL be surfaced, not only the first found. A fuzzy correspondence SHALL NOT be silently treated as a match (no false-positives) and SHALL NOT be silently dropped (no false-misses, whether dropping the ingredient to `not_in_pantry` or dropping the alternative candidates). Within an ingredient's candidates, substring-containment matches SHALL be ordered before token-overlap-only matches so the likeliest candidate appears first. An ingredient with no exact and no plausible candidate SHALL go to `not_in_pantry`.

#### Scenario: Token-overlap candidate is surfaced for confirmation, not assumed

- **WHEN** a recipe calls for `long-grain white rice` and the pantry contains `rice`
- **THEN** the pair appears in `possible_matches` for the agent to confirm, and `rice` is NOT placed in `in_pantry` automatically

#### Scenario: All plausible candidates are surfaced, ranked

- **WHEN** a recipe calls for `jasmine rice` and the pantry contains both `rice` and `rice vinegar`
- **THEN** `possible_matches` contains a pair for **both** `rice` and `rice vinegar` (not just the first), with `rice` (a containment match) ordered before `rice vinegar` (a token-overlap-only match)

#### Scenario: A misleading overlap is not auto-matched

- **WHEN** a recipe calls for `onion powder` and the pantry contains `yellow onion` but no `onion powder`
- **THEN** the tool SHALL NOT auto-match `yellow onion`; the pair is at most a `possible_matches` candidate for the agent to reject
