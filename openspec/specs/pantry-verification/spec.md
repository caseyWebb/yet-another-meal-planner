# pantry-verification Specification

## Purpose
TBD - created by archiving change pantry-verification-substitution. Update Purpose after archive.
## Requirements
### Requirement: Recipe-ingredient parsing

The system SHALL provide `parseRecipeIngredient(line)` that reduces a free-text, price-annotated recipe ingredient line to a clean ingredient name. It SHALL strip a leading quantity and optional unit, trailing and leading preparation descriptors (e.g. `diced`, `chopped`, `divided`, `boneless, skinless`), `(...)` parenthetical annotations, and a `($x.xx)` price annotation, then apply the `ingredient-matching` capability's `normalizeIngredient()` (lowercase + `aliases.toml`) to the result. The parser SHALL reuse `normalizeIngredient` rather than reimplementing alias handling.

#### Scenario: Full annotated line reduces to a clean name

- **WHEN** `parseRecipeIngredient("1.25 lbs. boneless, skinless chicken thighs (4-5 thighs) ($4.59)")` is invoked
- **THEN** it returns the name `chicken thighs` (quantity, unit, prep descriptors, parenthetical, and price all removed)

#### Scenario: Simple line with prep

- **WHEN** `parseRecipeIngredient("1 yellow onion, diced ($0.32)")` is invoked
- **THEN** it returns the name `yellow onion`

### Requirement: Optional-ingredient detection

The system SHALL detect an `optional` marker in a recipe ingredient line (e.g. a `(optional ...)` parenthetical) and flag the parsed ingredient as optional. Optional ingredients SHALL be non-blocking: they SHALL NOT appear in `not_in_pantry`, and an absent optional ingredient SHALL NOT be added to any buy list automatically.

#### Scenario: Optional garnish is flagged, not treated as required

- **WHEN** a recipe contains `1 Tbsp chopped parsley (optional garnish)` and parsley is not in the pantry
- **THEN** `parsley` is returned in the `optional` set and SHALL NOT appear in `not_in_pantry`

### Requirement: verify_pantry_for_recipe walks a recipe against the pantry

The system SHALL provide `verify_pantry_for_recipe(slug)` that parses the named recipe's `## Ingredients` section and matches each parsed ingredient against `pantry.toml`. It SHALL return an object with the sets `in_pantry`, `possible_matches`, `not_in_pantry`, `optional`, and `inventory_substitutes_available`. Each `in_pantry` entry SHALL carry the matched pantry item's age metadata: `added_at`, `last_verified_at`, `days_since_verified`, `category` (when present), and `prepared_from`.

#### Scenario: Recipe ingredients are bucketed by presence

- **WHEN** `verify_pantry_for_recipe("chicken-and-rice")` is invoked and the pantry contains `yellow onion` but not `vegetable broth`
- **THEN** `yellow onion` appears in `in_pantry` with its age metadata and `vegetable broth` appears in `not_in_pantry`

### Requirement: Facts not freshness verdicts (no have_stale bucket)

The verify tools SHALL NOT classify items as fresh or stale and SHALL NOT return a `have_stale` bucket. Freshness determination SHALL be left to the agent, which reasons over the surfaced age metadata and prompts the user to verify items it judges may have drifted. The tool SHALL surface the metadata needed for that judgment but SHALL NOT itself decide which items are stale.

#### Scenario: A long-unverified perishable is surfaced as a fact, not classified

- **WHEN** `verify_pantry_for_recipe(slug)` matches a pantry herb whose `last_verified_at` is many days old
- **THEN** the item is returned in `in_pantry` with `days_since_verified` populated, and the return contains no `have_stale` bucket and no stale/fresh label

### Requirement: Exact-vs-fuzzy matching never guesses

Matching SHALL place only exact normalized-name matches in `in_pantry`. Any inexact (fuzzy / token-overlap) correspondence between a parsed recipe ingredient and a pantry item SHALL be placed in `possible_matches` as a candidate pair for the agent to confirm or reject — it SHALL NOT be silently treated as a match (no false-positives) and SHALL NOT be silently dropped to `not_in_pantry` (no false-misses). An ingredient with no exact and no plausible candidate SHALL go to `not_in_pantry`.

#### Scenario: Token-overlap candidate is surfaced for confirmation, not assumed

- **WHEN** a recipe calls for `long-grain white rice` and the pantry contains `rice`
- **THEN** the pair appears in `possible_matches` for the agent to confirm, and `rice` is NOT placed in `in_pantry` automatically

#### Scenario: A misleading overlap is not auto-matched

- **WHEN** a recipe calls for `onion powder` and the pantry contains `yellow onion` but no `onion powder`
- **THEN** the tool SHALL NOT auto-match `yellow onion`; the pair is at most a `possible_matches` candidate for the agent to reject

### Requirement: Presence-only, no quantity sufficiency

The verify tools SHALL report presence (have-it / don't-have-it) only. They SHALL NOT compute whether the pantry quantity is sufficient for the recipe and SHALL NOT net required amounts against the buy list. Quantity reconciliation remains the responsibility of the order-placement capability's partials flow.

#### Scenario: A present-but-low item is not netted

- **WHEN** a recipe needs three onions and the pantry has one onion entry
- **THEN** `onion` appears in `in_pantry` (present) and the tool SHALL NOT add an onion shortfall to `not_in_pantry`

### Requirement: verify_pantry_for_candidates aggregates with attribution

The system SHALL provide `verify_pantry_for_candidates(slugs)` returning the same shape as `verify_pantry_for_recipe`, aggregated across the named candidate recipes and deduped by parsed ingredient name. Each `not_in_pantry`, `possible_matches`, and `inventory_substitutes_available` entry SHALL carry a `for_recipes` array naming the candidate recipe(s) that need it.

#### Scenario: A shared missing ingredient is deduped and attributed

- **WHEN** `verify_pantry_for_candidates(["a", "b"])` is invoked and both recipes need `vegetable broth`, which is not in the pantry
- **THEN** `vegetable broth` appears once in `not_in_pantry` with `for_recipes` containing both `a` and `b`

### Requirement: Structured errors and empty-data resilience

The verify tools SHALL return structured errors per the established convention rather than throwing. An unknown recipe slug SHALL return `{ error: "not_found", slug }`. A recipe missing its `## Ingredients` section SHALL return a structured error identifying the cause. A walk against an empty or comment-only `pantry.toml` SHALL succeed, placing every parsed ingredient in `not_in_pantry` (with `optional` ones excluded as usual).

#### Scenario: Unknown slug returns a structured error

- **WHEN** `verify_pantry_for_recipe("does-not-exist")` is invoked
- **THEN** it returns `{ error: "not_found", slug: "does-not-exist" }` and does not throw

#### Scenario: Empty pantry yields all-not-in-pantry

- **WHEN** `verify_pantry_for_recipe(slug)` runs against a `pantry.toml` containing only comments
- **THEN** every required parsed ingredient appears in `not_in_pantry` and `in_pantry` is empty

