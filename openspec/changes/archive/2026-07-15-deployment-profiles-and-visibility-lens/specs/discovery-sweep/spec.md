## MODIFIED Requirements

### Requirement: A candidate matching any member is auto-imported with attribution

The sweep SHALL import a candidate into the shared corpus when it matches **at least one** member, and SHALL record per-member **match attribution** — `discovery_matches` rows carrying the matched household AND the matched `member` (backfilled to the founding member for pre-existing rows). A sweep import's visibility grants ARE its attribution rows made effective: the SAME write path that records a household's match SHALL mint that household's `recipe_imports` grant (`via = 'feed:<canonical feed url>'`, or `'satellite'` when the candidate arrived by satellite push) in the same batch, so a candidate confirmed across N households gets N grants and attribution and visibility cannot drift — never public by default, never orphaned invisible. Import SHALL stamp `discovered_at`, `discovery_source`, and the attribution. Within a household the shared opt-out model stands: the recipe is visible to the whole household (and travels further only through friend lenses); a member who does not want it uses `toggle_reject`. A candidate matching **no** member SHALL NOT be imported and SHALL be recorded in `discovery_evaluated`.

#### Scenario: One member's match imports for their household

- **WHEN** a candidate matches exactly one member's taste
- **THEN** the recipe is imported once, the match row records that member, and the member's household gains its `recipe_imports` grant in the same write — visible to that household (and to everyone, under self-hosted's computed all-to-all), traveling further only through friend lenses

#### Scenario: N confirmed households mean N grants

- **WHEN** a candidate is confirmed against members of three households
- **THEN** three `discovery_matches` rows and three `recipe_imports` rows exist for the one imported recipe, minted together

#### Scenario: No match means no import

- **WHEN** a classified candidate matches no member
- **THEN** it is not imported and is recorded in `discovery_evaluated` so it is not re-evaluated

#### Scenario: Attribution drives per-member surfacing

- **WHEN** a recipe is imported attributed to member A but not member B of another household
- **THEN** A's new-for-me read surfaces it as newly discovered; B's does not — and B's household sees it at all only if its own lens admits it

### Requirement: New-for-me read surfaces recently-imported, taste-matched recipes

The system SHALL provide a read (e.g. `list_new_for_me`) returning the caller's newly-discovered recipes: those imported (`discovered_at`) after the caller's `last_planned_at` watermark, attributed to the calling **member** by the matcher (the `discovery_matches.member` key — attribution is per-member while visibility is per-household: two reads of the same rows), for which the caller has no overlay row (not yet favorited or rejected) and which the caller has not cooked. New-for-me remains discovery-attribution-based and unchanged by visibility events: a recipe newly visible through a friend link never surfaces here, and curated landings write no member matches so they can never appear. A fixed-window floor SHALL bound the cold-start case (a member with no/old watermark does not receive the entire backlog). The returned recipes SHALL already be classified and embedded (the sweep captured them), so they are immediately retrievable — there is no "imported this session but not yet retrievable" gap. An empty result SHALL NOT be an error.

#### Scenario: Only the caller's matches, only what they haven't acted on

- **WHEN** member A calls the new-for-me read
- **THEN** it returns recipes imported after A's watermark, whose match rows name A as the matched member, with no overlay row for A and not in A's cooking log — excluding recipes matched only to other members

#### Scenario: Visibility events never feed new-for-me

- **WHEN** a recipe enters a SaaS caller's lens through a new friendship, or the curated tier lands new recipes
- **THEN** neither appears in the caller's new-for-me read — there is no match row naming the caller

#### Scenario: Cold-start is bounded by the window floor

- **WHEN** a member has never planned (no `last_planned_at`)
- **THEN** the read returns at most the fixed-window-floor recent matches, not the entire backlog

#### Scenario: Empty new-for-me is not an error

- **WHEN** there are no new matched recipes for the caller
- **THEN** the read returns an empty list and does not raise an error

## ADDED Requirements

### Requirement: The curated source is consumed as a provenance-tagged floor (SaaS only)

Under the SaaS profile, the sweep SHALL additionally consume the deployment's configured curated source (`operator_config.curated_source_url`, compiled-default to the product-maintained public curated feed; operator-repointable; cleared = disabled) through the existing intake pipeline and bounds — feed rotation, volume governance, dedup (URL and semantic), and rejection suppression — with two deliberate differences: curated candidates SKIP taste matching and member attribution (no `discovery_matches` rows are ever written for them), and their grants land on the reserved curated tenant (`recipe_imports` with `via = 'curated'`). Under the self-hosted profile the curated source SHALL NOT be consumed at all. A recipe already in the corpus that appears in the curated source gains a curated grant beside any household grants (ordinary dedup-to-grant); a curated recipe a household later imports itself gains that household's own grant beside the curated one.

#### Scenario: Curated landings are granted to the curated tenant only

- **WHEN** the sweep imports a new recipe from the curated source on a SaaS deployment
- **THEN** the recipe lands with one `recipe_imports` row owned by the reserved curated tenant (`via 'curated'`), zero `discovery_matches` rows, and a real `discovered_at`

#### Scenario: Curated intake respects the sweep's governance

- **WHEN** a curated source publishes many candidates in one window
- **THEN** intake is bounded by the sweep's existing per-tick rotation and volume caps, so curated intake never starves member feeds

#### Scenario: Self-hosted ignores the curated source

- **WHEN** the sweep runs on a self-hosted deployment with a configured curated source URL
- **THEN** the curated source is not polled and no curated grant is written

#### Scenario: The operator can disable or repoint the source

- **WHEN** the operator clears `curated_source_url`, or points it at a fork
- **THEN** subsequent ticks consume nothing (cleared) or the fork (repointed); existing curated grants are unaffected
