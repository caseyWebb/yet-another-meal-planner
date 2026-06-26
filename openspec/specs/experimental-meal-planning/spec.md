# experimental-meal-planning Specification

## Purpose

Defines the experimental, invoke-by-name `semantic-meal-plan` skill that replaces dump-and-reason menu generation with a distill → retrieve → compose flow: it distills the bounded context pre-pass plus the user message into K search specs, retrieves compact candidates via `recipe_semantic_search` (engineering recall through diverse specs), composes mains and sides holistically, imports preference-matched discoveries aggressively in-session, collapses disposition into an import decision (with group-wide reject), and keeps a deliberate exploration allowance so the loop does not collapse into a filter bubble. It is gated behind explicit invocation so it can be A/B'd against the production `menu-generation` flow.

## Requirements

### Requirement: The semantic meal-plan skill is experimental and invoke-by-name

The system SHALL provide an experimental `semantic-meal-plan` skill that is invoked only by name and SHALL NOT be auto-routed by `grocery-core`. The production `menu-generation` flow SHALL remain the default and SHALL be unchanged by this skill's presence. The skill SHALL be marked experimental in `AGENT_INSTRUCTIONS.md` so it can be A/B'd against dump-and-reason before any core behavior is replaced.

#### Scenario: Not auto-invoked

- **WHEN** a member makes an ordinary menu request without naming the experimental skill
- **THEN** the production `menu-generation` flow runs and the semantic skill is not invoked

#### Scenario: Invoked by name

- **WHEN** a member explicitly invokes the `semantic-meal-plan` skill
- **THEN** the distill → retrieve → compose flow runs in place of the default selection path for that request

### Requirement: Distill context into searches, retrieve, then compose

The skill SHALL keep the bounded context pre-pass (pantry, preferences, taste, diet, retrospective, weather, staples, discoveries, and flyer when Kroger), then distill that context plus the user message into K search specs, retrieve compact candidate lists via `recipe_semantic_search`, and compose the plate over the union — rather than loading the whole active corpus. Each spec SHALL separate a semantic `vibe` query from structured `facets`, because contrast/variety is anti-similarity and cannot be expressed as a similarity query. Anti-similarity constraints derived from the retrospective (e.g. avoid recently-repeated proteins/cuisines) SHALL be expressed as facets, never as the vibe query.

#### Scenario: Whole corpus is not dumped

- **WHEN** the skill runs against a large corpus
- **THEN** it issues bounded searches and reasons over the returned compact candidates, and does NOT load every active recipe into context

#### Scenario: Variety is a facet, not a vibe query

- **WHEN** the retrospective shows chicken cooked three times this week
- **THEN** the relevant search specs carry a facet excluding chicken, and "different from chicken" is not phrased as a semantic query

### Requirement: Recall is engineered into the search set

To bound the recall lost by not dumping the corpus, the distillation SHALL include diverse specs: the vibe searches implied by the request, a variety/wildcard spec, a novelty spec (never-cooked × taste), and pantry-overlap specs for expiry-matching. K SHALL be generous (candidate rows are compact). Side selection SHALL run within the same compose pass (driven by the chosen mains' `side_search_terms`, facet `course: side`), not as a separate post-hoc round, preserving holistic mains+sides reasoning.

#### Scenario: Diverse specs cover the space

- **WHEN** the skill distills an open-ended request
- **THEN** the search set includes at least one variety/wildcard spec and one never-cooked novelty spec alongside the request-driven vibe specs

#### Scenario: Sides reasoned with mains in one pass

- **WHEN** mains are selected
- **THEN** side candidates are retrieved via the mains' `side_search_terms` within the same compose pass and the plate is reasoned over holistically

### Requirement: Aggressive in-session import of preference-matched discoveries

During the flow, when the agent judges a loaded discovery matches the member's preferences, it SHALL import it in-session: cheap triage on the discovery blurb, then `parse_recipe` (Worker) and agent-written `description`/`side_search_terms`/facets, then `create_recipe`. Only matched discoveries SHALL be fully parsed and imported, so per-session cost is proportional to matches, not discovery volume. Import is performed on the agent's session (no external embedding/Anthropic API and no headless cron). The agent SHALL avoid importing a recipe already present (exact source-URL dedup at minimum).

#### Scenario: Match is imported on the spot

- **WHEN** a loaded discovery clearly matches the member's taste during planning
- **THEN** the agent imports it with a generated description in the same session, and it becomes a candidate for this plan and a corpus recipe for future plans

#### Scenario: Non-matches are not fully parsed

- **WHEN** a discovery does not pass cheap blurb-level triage
- **THEN** it is not `parse_recipe`'d or imported, and remains a discovery for later re-judgment

#### Scenario: Already-present recipe is not re-imported

- **WHEN** a matched discovery's source URL already exists in the corpus
- **THEN** the agent does not create a duplicate

### Requirement: Disposition collapses into the import decision

With in-session import, the disposition SHALL collapse to a *decision* among three outcomes: importing a discovery IS the positive disposition (the agent decides it is worth adding and creates it **now** rather than deferring); taking no action leaves it a discovery to be re-judged later; an explicit reject SHALL suppress that discovery URL **group-wide** (a shared `discovery_rejections` entry keyed by the canonical URL) so it is not re-surfaced to any member. An imported recipe lands as a normal corpus recipe subject to the unchanged per-tenant `status` lifecycle (retiring the `draft` state corpus-wide is out of scope here), and the agent uses it for the current plan directly from the parse rather than re-searching for it the same session. Because rejection is shared, it SHALL be reserved for "not corpus-worthy for the group" (junk, broken link, non-recipe, duplicate, or clearly off-base for the group's taste); a mere personal not-for-me-this-time SHALL be a no-action skip, NOT a reject, so one member's passing taste does not hide a recipe another member would favorite.

#### Scenario: Import is the yes (a decision, made now)

- **WHEN** the agent judges a discovery worth adding during planning
- **THEN** it imports the recipe in-session (rather than leaving it to disposition later) and places it on the current plan directly from the parse

#### Scenario: Explicit rejection suppresses the URL group-wide

- **WHEN** a member explicitly rejects a surfaced discovery as not corpus-worthy
- **THEN** that discovery URL is suppressed for the whole group and not re-surfaced to any member

#### Scenario: Personal taste-misfit is a skip, not a reject

- **WHEN** a member simply does not want a surfaced discovery this session (personal preference, not a corpus-worthiness judgment)
- **THEN** it is left as a discovery (no shared suppression) and may surface again for that member or another

### Requirement: An exploration allowance keeps the loop from over-tightening

Because both import-match and retrieval-match pull toward established taste, the skill SHALL permit a deliberate "a bit outside your usual" pick — surfacing or importing an occasional candidate that is adjacent to, but not squarely inside, the member's established taste — so the corpus and rotation do not collapse into a filter bubble.

#### Scenario: An adjacent pick is offered

- **WHEN** the skill assembles a proposal
- **THEN** it MAY include a clearly-flagged "a bit outside your usual" option alongside the squarely-on-taste picks
