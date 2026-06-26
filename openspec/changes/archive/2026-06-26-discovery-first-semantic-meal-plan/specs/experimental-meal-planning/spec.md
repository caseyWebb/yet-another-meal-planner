## ADDED Requirements

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

## MODIFIED Requirements

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
