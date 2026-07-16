# recipe-sides Specification

## Purpose
TBD - created by archiving change add-recipe-sides. Update Purpose after archive.
## Requirements
### Requirement: Two entry modes resolve the main

Side resolution (owned by the `plan` skill) SHALL resolve its subject X through one of two entry modes. When X resolves to an existing corpus main, the agent SHALL use that main's `side_search_terms` and `pairs_with` as the basis for side resolution. When X is a bare dish concept not in the corpus, the agent SHALL reason the kind of complementary side from world knowledge and use that as the basis. In both modes the agent SHALL then run the shared side-resolution ladder. For a main just imported in the same session, the agent SHALL use the classification it holds from that import rather than waiting for the new recipe to become semantically retrievable.

#### Scenario: Corpus main drives resolution from its memoized terms

- **WHEN** X names a main already in the corpus
- **THEN** the agent uses that main's `side_search_terms` and existing `pairs_with` to drive side resolution

#### Scenario: Bare concept drives resolution from world knowledge

- **WHEN** X is a dish concept with no corpus recipe
- **THEN** the agent reasons the complementary side profile from world knowledge and runs the ladder, without requiring a corpus main to exist

#### Scenario: Just-imported main uses in-session terms

- **WHEN** the subject main was imported earlier in the same session and is not yet semantically retrievable
- **THEN** the agent uses the classification held from that import rather than re-searching for the main

### Requirement: Shared cheapest-first side-resolution ladder

Side resolution SHALL follow a single cheapest-first, highest-confidence-first ladder, defined once inside the `plan` skill and used both when rounding out a planned main and when answering a standalone sides question: (1) surface curated `pairs_with` corpus sides when present; (2) otherwise retrieve corpus sides with a `search_recipes` spec whose vibe is the subject's side terms and `facets: { course: "side" }`; (3) otherwise propose new sides to source and, on confirmation, import them via `import_recipe`; (4) otherwise propose a trivial open-world side named from world knowledge. The agent SHALL stop at the first rung that satisfies the request and SHALL NOT search the web when curated or corpus sides already answer it. A standalone sides question answered through the ladder SHALL NOT write the meal plan or the grocery list unless the member asks to plan or shop the result.

#### Scenario: Curated pairing short-circuits the ladder

- **WHEN** the subject main's `pairs_with` already names suitable corpus sides
- **THEN** the agent surfaces those and does not run corpus retrieval or web import

#### Scenario: Corpus retrieval before web import

- **WHEN** `pairs_with` is empty but the corpus holds matching `course: side` recipes
- **THEN** the agent surfaces those corpus sides and does not propose a speculative web import

#### Scenario: Trivial companion stays open-world

- **WHEN** the natural companion is a one-line preparation (steamed rice, dressed greens)
- **THEN** the agent proposes it as an open-world side and imports no recipe

#### Scenario: A standalone sides question writes nothing

- **WHEN** the member asks "what goes with grilled swordfish?" without asking to plan or shop
- **THEN** the `plan` skill answers through the ladder and writes no meal-plan or grocery-list rows

### Requirement: Propose-then-confirm gate for speculative side import

When the corpus has no or only a few matching sides and the agent would source new ones from outside the corpus, it SHALL first propose a short list of candidate sides and obtain the user's confirmation before importing any of them. The confirmation SHALL be at the granularity of which sides to pursue, not a per-recipe re-confirmation; once the user picks, each chosen side imports on sight via `import_recipe`. This propose-then-confirm gate is the deliberate exception to importing on sight — and a stated exception to the silent-write posture, because these are agent-proposed speculative additions to the shared corpus, not a recipe the user handed over. The agent SHALL propose only a few candidates, never a bulk import.

#### Scenario: Corpus thin, agent asks before web import

- **WHEN** corpus retrieval yields no or only a few suitable sides and the agent intends to source new ones
- **THEN** the agent proposes a short list of candidate sides and waits for the user to choose before calling `import_recipe`

#### Scenario: Confirmation is per-selection, not per-recipe

- **WHEN** the user picks which proposed sides to pursue
- **THEN** the agent imports each chosen side on sight without a further per-recipe confirmation prompt

