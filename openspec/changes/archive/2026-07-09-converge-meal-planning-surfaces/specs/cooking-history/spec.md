## MODIFIED Requirements

### Requirement: Vibe satisfaction provenance on cooks

When `log_cooked` logs a `type = recipe` cook, it SHALL attribute vibe satisfaction by a **cook-time cosine match** of the cooked recipe against the caller's night-vibe palette, writing a satisfaction record for each matched vibe **in the same D1 transaction** as the cooking-log insert (and, for an on-plan cook, the meal-plan clear). Attribution SHALL union: (a) the cleared planned row's `from_vibe`, when present, as a **guaranteed-reset prior** — that vibe always gets a record, even at a borderline cosine; and (b) every palette vibe whose embedding the cooked recipe's embedding matches at or above a calibrated cosine threshold. A cook MAY therefore satisfy **more than one** vibe, and an **off-plan** cook (no planned row, or a planned row without `from_vibe`) SHALL still record satisfaction for every vibe it genuinely matches — off-plan cooks are no longer null-attributed. To bound over-reset, the top match SHALL record a full reset and lower matches SHALL be gated by the threshold, so one recipe cannot suppress the whole palette. A night vibe's `last_satisfied` SHALL be derived by query as `MAX(date)` over the caller's satisfaction records for that vibe — never stored on the vibe. The cosine match SHALL reuse the ranking machinery (`rankCandidates` / the `recipe_derived` and `night_vibe_derived` embeddings); it SHALL NOT introduce a new AI call — both embeddings are cron-captured. This is additive to existing `log_cooked` behavior: the insert, the atomic plan-clear, slug resolution, and validation are unchanged.

#### Scenario: An on-plan cook records its aimed vibe plus any it also matches

- **WHEN** a planned row carrying `from_vibe` is cooked and logged, and the recipe also cosine-matches a second palette vibe at/above the threshold
- **THEN** the transaction inserts satisfaction records for both the `from_vibe` (guaranteed) and the second vibe, alongside the cooking-log insert and plan-clear

#### Scenario: An off-plan cook records the matched vibes

- **WHEN** an off-plan meal is logged whose recipe cosine-matches one or more palette vibes at/above the threshold
- **THEN** a satisfaction record is written for each matched vibe, and their derived `last_satisfied` advances — attribution is no longer null for off-plan cooks

#### Scenario: Over-reset is bounded

- **WHEN** a cooked recipe matches three palette vibes, one strongly and two weakly near the threshold
- **THEN** the top match records a full reset and the weaker matches are admitted only if they clear the gate, so a single dish does not reset the whole palette

#### Scenario: last_satisfied is a query, not a stored field

- **WHEN** a vibe's `last_satisfied` is needed
- **THEN** it is `MAX(date)` over the caller's satisfaction records with that vibe, with nothing written to the vibe

#### Scenario: No new AI call at cook time

- **WHEN** `log_cooked` computes the cosine attribution
- **THEN** it reuses the cron-captured `recipe_derived` and `night_vibe_derived` embeddings via the existing ranking machinery and issues no new embedding call
