## ADDED Requirements

### Requirement: Vibe satisfaction provenance on cooks

A `cooking_log` row MAY carry an optional **`satisfied_vibe`** field. When `log_cooked` logs a `type = recipe` cook that clears a planned row, it SHALL copy that planned row's `from_vibe` (if present) into the new cooking-log row's `satisfied_vibe`, **in the same D1 transaction** as the cooking-log insert and the meal-plan clear. An off-plan cook (no planned row, or a planned row without `from_vibe`) SHALL leave `satisfied_vibe` null. A night vibe's `last_satisfied` SHALL be derived by query as `MAX(date)` over the caller's cooking-log rows whose `satisfied_vibe` equals that vibe — never stored on the vibe. This SHALL be purely additive to existing `log_cooked` behavior: the insert, the atomic plan-clear, slug resolution, and validation are unchanged.

#### Scenario: A planned cook records its satisfied vibe atomically

- **WHEN** a planned row carrying `from_vibe` is cooked and logged
- **THEN** the cooking-log row records `satisfied_vibe` in the same transaction that inserts it and clears the plan

#### Scenario: An off-plan cook leaves satisfied_vibe null

- **WHEN** an off-plan meal is logged
- **THEN** `satisfied_vibe` is null and no vibe's derived `last_satisfied` is affected

#### Scenario: last_satisfied is a query, not a stored field

- **WHEN** a vibe's `last_satisfied` is resolved
- **THEN** it is `MAX(date)` over the caller's cooking-log rows with that `satisfied_vibe`, with nothing written to the vibe
