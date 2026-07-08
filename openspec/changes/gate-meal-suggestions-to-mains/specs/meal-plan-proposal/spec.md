# meal-plan-proposal delta — gate-meal-suggestions-to-mains

## ADDED Requirements

### Requirement: The candidate pool is course-gated to mains by default

Each vibe slot's candidate pool SHALL admit only **meal candidates** by default: recipes whose effective `course` includes `main`, or whose effective `course` is **empty** (a not-yet-classified recipe is unknown, not known-non-main — the gate SHALL fail open so an unclassified corpus is never silently hidden). The default SHALL be suppressed when the slot's effective facet set carries an **explicit `course`** (a vibe authored with `facets.course`, e.g. a breakfast-for-dinner vibe), in which case that explicit course facet gates alone with its existing exact-containment semantics. The gate SHALL apply to what the system volunteers, not what the caller demands: `lock`ed recipes and `slots[].recipe` pins SHALL resolve exactly as today, regardless of course. Slot alternates (`alternates`, `alt_similar`, `alt_different`) SHALL be meal candidates by construction (drawn from the gated pool). A pool the gate empties SHALL follow the existing empty-slot contract — an explicit empty slot with a reason, never silently dropped.

#### Scenario: A component sub-recipe never fills a slot by default

- **WHEN** a corpus recipe's effective `course` is `["side"]`, `["component"]`, or any set not containing `main` (e.g. a fresh pasta dough) and a proposal is requested with no explicit course facet on the sampled vibes
- **THEN** that recipe appears in no slot's main, `alternates`, `alt_similar`, or `alt_different`

#### Scenario: An unclassified recipe passes the gate (fail-open)

- **WHEN** a recipe's effective `course` is empty because it has not yet been classified
- **THEN** the default course gate admits it to the pool (the other gates still apply), so a not-yet-converged corpus still proposes

#### Scenario: A vibe's explicit course facet suppresses the default

- **WHEN** a sampled vibe's stored facets carry `course: "breakfast"`
- **THEN** that slot's pool gates on `course: "breakfast"` by containment exactly as today, and the default main-gate does not additionally apply to that slot

#### Scenario: A caller's explicit lock or pin is honored regardless of course

- **WHEN** a caller `lock`s or pins (`slots[].recipe`) a recipe whose effective `course` does not contain `main`
- **THEN** the recipe fills its slot under the existing lock/pin resolution rules — the course gate never vetoes an explicit caller choice

#### Scenario: A gate-emptied pool surfaces as an explicit empty slot

- **WHEN** every recipe a vibe's facet gate and retrieval would admit is excluded by the default course gate
- **THEN** the slot is returned as an explicit empty slot with a reason (with no alternates, since no gate survivor exists), the rest of the week is still proposed, and the caller's escape hatches are a `slots[].recipe` pin or authoring the vibe with an explicit `course` facet
