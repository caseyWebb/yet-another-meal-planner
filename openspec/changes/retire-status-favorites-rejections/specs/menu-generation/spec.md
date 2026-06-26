## MODIFIED Requirements

### Requirement: Discoveries are dispositioned conversationally

The agent SHALL let the user disposition discoveries through natural requests, mapping them to the favorites/rejections model: a "loved that one" request SHALL `toggle_favorite` the recipe; a "stop suggesting that" / "hide that" request SHALL `toggle_reject` it for the caller (or `reject_discovery` the URL when the candidate is not yet imported and is not corpus-worthy for the group); ready-to-eat items SHALL be dispositioned analogously via `update_ready_to_eat` (favorite / reject) against the caller's per-tenant catalog. There is no `draft` state and no de-prioritized-drafts behavior: an imported recipe is an available corpus recipe, and a non-imported discovery simply stays a discovery.

#### Scenario: A loved discovery is favorited

- **WHEN** the user says they loved a surfaced or just-imported recipe
- **THEN** the agent calls `toggle_favorite(slug, true)` for the caller, with no `status` or `rating` involved

#### Scenario: An unwanted ready-to-eat item is rejected

- **WHEN** the user says to stop suggesting a ready-to-eat item
- **THEN** the agent calls `update_ready_to_eat(slug, { reject: true })` in the caller's catalog, affecting no other member, with no `status` or `rating`

### Requirement: Menu-request context pre-pass

The agent SHALL load the planning context in one parallel batch (profile, pantry, retrospective, discoveries, weather, and — Kroger only — the flyer). The recipe candidate set is the caller's available corpus: the whole shared corpus **minus the caller's rejects**, with no per-member "active set" to assemble and no `draft` recipes to surface separately. (Whether that candidate set is dumped in full via `list_recipes` or narrowed via `recipe_semantic_search` is the planner's choice and out of scope for this change.)

#### Scenario: No activation gate on the candidate set

- **WHEN** the agent loads recipes for a menu request
- **THEN** it considers every non-rejected shared recipe (plus the caller's personal recipes), not a curated per-member active subset
