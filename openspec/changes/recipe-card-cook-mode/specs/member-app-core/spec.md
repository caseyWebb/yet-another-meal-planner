## MODIFIED Requirements

### Requirement: Recipe detail with notes, similar recipes, and the Cook-with-Claude deep link

The recipe detail page SHALL render the recipe's overlay-merged frontmatter, its derived
description, and its markdown body from the shared corpus; a Similar Recipes section computed by
the existing pure cosine over cron-captured embeddings (same floor and cap as the public
cookbook); and the group-aggregated notes for the recipe — the caller's own notes (including
private ones) editable and deletable, other members' shared notes read-only, per the existing
privacy rule. Anything conversational SHALL deep-link out to Claude (a link to
`claude.ai/new` prefilled with the cook command and slug) — the app SHALL NOT embed a model or
make any model call for the detail page. The page SHALL ALSO offer an in-app "Start Cooking" entry
that mounts the SAME shared guided cook-mode component the in-chat recipe card uses (mise-en-place
check-off, step-by-step navigation with a progress indicator, and per-step timers), when the recipe
body yields steps; its step data is parsed from the body client-side. This in-app cook mode is
presentational — its check-offs and timers are client-local — and it sits alongside, not replacing,
the Cook-with-Claude deep link and the existing favorite / add-to-plan / log-as-cooked controls.

#### Scenario: Detail is assembled from existing ops

- **WHEN** a member opens a recipe
- **THEN** the page data comes from the shared corpus read merged with the caller's overlay plus
  the derived description, and the similar list from the pure nearest-neighbor computation —
  with no new ranking logic

#### Scenario: Note privacy is preserved across the group

- **WHEN** the notes section loads
- **THEN** it contains every member's shared notes and only the caller's private notes, and edit
  and delete affordances appear only on the caller's own notes

#### Scenario: Cooking is a deep link, not a model call

- **WHEN** a member taps "Cook with Claude"
- **THEN** the app opens the Claude deep link for the recipe and issues no model request of its
  own

#### Scenario: In-app cook mode walks the recipe without a model call

- **WHEN** a member taps "Start Cooking" on a recipe whose body yields steps
- **THEN** the page mounts the shared cook-mode component and walks the mise-en-place, steps, and
  completion locally, making no model call, while the deep link and existing favorite/log/plan
  controls remain available
