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

Importing a discovery into the shared corpus is cheap and reversible, so the agent SHALL import every genuine fit autonomously, without a per-candidate approval gate — import is **not** a consequential decision. Importing SHALL be **decoupled from plan placement**: a created recipe does NOT automatically land on this week's menu. The disposition SHALL resolve to one of these outcomes:

- **accept** — import the recipe **and** place it on this week's plan (the agent works from the parse directly; a just-imported recipe is not semantically retrievable the same session);
- **maybe next time** — import the recipe (it joins the corpus and reconciles an embedding, so it is retrievable next session) **but leave it off this week's plan**. This is the silent resting state of a good import that did not fit the week's gaps; it SHALL be surfaced only as a light "saved … for later" mention in the proposal, never as an approval prompt;
- **no-action skip** — leave a non-fitting candidate as a discovery to be re-judged later (no write);
- **reject** — `reject_discovery(url, reason?)`, suppressing the URL **group-wide**, reserved for "not corpus-worthy for the group" (junk, broken link, non-recipe, duplicate, clearly off-base for the group). A mere personal not-for-me-this-time SHALL be a no-action skip, NOT a reject.

Because rejection is shared, one member's passing taste SHALL NOT hide a recipe another member would favorite. What goes on the plan remains the consequential choice surfaced in the proposal for the member to iterate on; what enters the corpus is autonomous.

#### Scenario: Import is autonomous and does not auto-plan

- **WHEN** the agent judges a discovery worth adding during planning
- **THEN** it imports the recipe in-session without asking, and the recipe lands on this week's plan only if it is an accepted pick — importing alone does not place it on the menu

#### Scenario: A good import that does not fit the week is "maybe next time"

- **WHEN** a discovery is a genuine fit but the week's plan is already filled by better-fitting picks
- **THEN** the recipe is still imported (joining the corpus for future plans) and is left off this week's plan, surfaced as a light "saved for later" line rather than a per-candidate question

#### Scenario: Explicit rejection suppresses the URL group-wide

- **WHEN** a candidate is not corpus-worthy for the group (junk, broken, non-recipe, duplicate, off-base)
- **THEN** the agent calls `reject_discovery` and the URL is suppressed for the whole group and not re-surfaced to any member

#### Scenario: Personal taste-misfit is a skip, not a reject

- **WHEN** the agent simply judges a candidate not a fit for this member this session (personal preference, not a corpus-worthiness judgment)
- **THEN** it is left as a discovery (no shared suppression) and may surface again for that member or another

### Requirement: An exploration allowance keeps the loop from over-tightening

Because both import-match and retrieval-match pull toward established taste, the skill SHALL permit a deliberate "a bit outside your usual" pick — surfacing or importing an occasional candidate that is adjacent to, but not squarely inside, the member's established taste — so the corpus and rotation do not collapse into a filter bubble.

#### Scenario: An adjacent pick is offered

- **WHEN** the skill assembles a proposal
- **THEN** it MAY include a clearly-flagged "a bit outside your usual" option alongside the squarely-on-taste picks

### Requirement: Discovery triage precedes retrieval and sizes it to the gap

The `semantic-meal-plan` skill SHALL triage and import the loaded discovery pools (`fetch_rss_discoveries`, `read_discovery_inbox`) **before** issuing the `recipe_semantic_search` retrieval, so the freshest, most intentional candidates seed the plan first and retrieval cannot tunnel onto the established corpus and bury a just-found candidate. The discovery pools SHALL still be loaded in the bounded context pre-pass; only the triage/import and the slotting of accepted picks move ahead of retrieval. Accepted discovery picks SHALL claim plan slots first, and `recipe_semantic_search` SHALL then be sized to the **remaining** nights (gap-fill), not the full week. Sides SHALL still be reasoned in the same compose pass, covering both the accepted-discovery mains and the retrieved mains.

#### Scenario: Discovery is triaged before the search runs

- **WHEN** the skill plans a week and the discovery pools contain candidates
- **THEN** it triages and imports the genuine fits before issuing `recipe_semantic_search`, and the accepted picks occupy plan slots before retrieval is consulted

#### Scenario: Retrieval fills only the remaining nights

- **WHEN** accepted discoveries already fill some of the week's nights
- **THEN** `recipe_semantic_search` is sized to the nights not yet filled, rather than retrieving a full week and folding discoveries in afterward

#### Scenario: Sides cover discovery-sourced mains too

- **WHEN** an accepted discovery main needs a side
- **THEN** its side is reasoned in the same compose pass as the retrieved mains' sides, not in a separate post-hoc round

