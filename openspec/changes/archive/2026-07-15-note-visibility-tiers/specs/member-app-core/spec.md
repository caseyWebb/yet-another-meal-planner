## MODIFIED Requirements

### Requirement: Recipe detail with notes, similar recipes, and the Cook-with-Claude deep link

The recipe detail page SHALL render the recipe's overlay-merged frontmatter, its derived
description, and its markdown body from the shared corpus; a Similar Recipes section computed by
the existing pure cosine over cron-captured embeddings (same floor and cap as the public
cookbook); and the tier-scoped notes for the recipe — the caller's own notes (every tier)
editable and deletable, other members' tier-admitted notes read-only with author handle, per the
`recipe-notes` visibility tiers. The note composer SHALL present a three-state visibility
control — Public / Friends / Private, rendered with the shared segmented-control primitive (the
Time-filter treatment), **Friends pre-selected** (never neutral) — with a one-line description of
the selected tier (Friends: "Your household and friends can see this"; Private: "Only you";
Public: "Anyone who can see this recipe — including the public cookbook site if this recipe is
public"). When the recipe is not anonymously visible (the notes read reports
`anonymously_visible: false`), the Public option SHALL stay selectable with its description
changed to state the note won't reach the public site. Rendered notes that are not Friends-tier
SHALL carry a small tier indicator (a lock glyph for Private, a globe for Public; Friends renders
unmarked), and the own-note edit state SHALL offer the same three-state control seeded with the
note's current tier. Anything conversational SHALL deep-link out to Claude (a link to
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

#### Scenario: Note visibility tiers are preserved across the group

- **WHEN** the notes section loads
- **THEN** it contains the tier-admitted notes of other members (handle-attributed, with lock and
  globe indicators on Private and Public rows) and every one of the caller's own notes, and edit
  and delete affordances appear only on the caller's own notes

#### Scenario: Composer defaults to Friends and states the audience

- **WHEN** a member opens the note composer
- **THEN** the segmented control shows Friends selected with its one-line audience description,
  and switching tiers swaps the description — including the reduced Public copy when the recipe
  is not anonymously visible

#### Scenario: Editing a note can change its tier

- **WHEN** a member edits one of their own notes and selects a different tier before saving
- **THEN** the update is sent with the new tier on the same idempotent note-edit write, and the
  list re-renders with the matching tier indicator

#### Scenario: Cooking is a deep link, not a model call

- **WHEN** a member taps "Cook with Claude"
- **THEN** the app opens the Claude deep link for the recipe and issues no model request of its
  own

#### Scenario: In-app cook mode walks the recipe without a model call

- **WHEN** a member taps "Start Cooking" on a recipe whose body yields steps
- **THEN** the page mounts the shared cook-mode component and walks the mise-en-place, steps, and
  completion locally, making no model call, while the deep link and existing favorite/log/plan
  controls remain available
