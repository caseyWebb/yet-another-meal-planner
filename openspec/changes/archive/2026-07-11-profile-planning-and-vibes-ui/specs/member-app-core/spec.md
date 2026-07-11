## RENAMED Requirements

- FROM: `### Requirement: Night-vibe palette page uses the production vocabulary`
- TO: `### Requirement: Meal-vibe palette page uses the production vocabulary`

## MODIFIED Requirements

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile (including the member's Kroger link state),
SHALL edit structured preferences via the existing merge-patch operation (dietary avoid/limit;
rotation; stores; brand tiers; the per-meal `cadence` map; the `weekly_budget`), SHALL edit the
`taste` and `diet_principles` markdown fields, SHALL render the derived taste read from the
existing retrospective aggregation, and SHALL obtain the Kroger consent URL from the existing
builder. All whole-document writes on this page are conditional (see the write-classes
requirement).

The Preferences tab's **Planning card** SHALL expose the household planning knobs the shipped
schema backs:

- **Per-meal weekly cadence steppers** — Breakfast / Lunch / Dinner, an integer 0–7 each, each
  writing a per-key merge patch (`{cadence: {<meal>: n}}`) so adjusting one meal preserves the
  others, with the − and + controls disabled at 0 and 7. (The mock's richer per-night "typical
  week" grid is out of scope — it needs storage the shipped schema does not carry.)
- The resurface-after and novelty-boost sliders (schema-faithful).
- A **weekly grocery budget** control whose unset state is first-class: clearing the field
  writes `weekly_budget: null` (deleting the key), a numeric value writes
  `Math.max(0, Math.round(n))` formatted on blur, and the control SHALL NEVER write `0` to mean
  "off"; an unset budget SHALL show helper copy that the budget line won't render.

The retired `lunch_strategy` and `ready_to_eat_default_action` preferences (D8/D21; per-meal
cadence and meal vibes subsume them) SHALL have no control.

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation
  over the real cooking log — no new aggregation is introduced

#### Scenario: A per-meal cadence set persists

- **WHEN** a member steps one meal's weekly cadence up or down on the Planning card
- **THEN** the change is written as a per-key `{cadence: {<meal>: n}}` merge patch, the other
  meals' counts are preserved, and a reload shows the persisted value

#### Scenario: Setting and clearing the weekly budget (a clear is not a zero)

- **WHEN** a member sets a numeric weekly budget and then clears the field
- **THEN** the numeric value is written as `weekly_budget` (rounded, non-negative) and the clear
  writes `weekly_budget: null` — an UNSET state, not `0` — so a reload renders the empty control
  with its "no budget line" helper copy

#### Scenario: No retired-preference control renders

- **WHEN** the profile page's preferences tab renders
- **THEN** it offers no `lunch_strategy` or ready-to-eat default-action control — those
  preferences are retired and subsumed by the per-meal cadence steppers and meal vibes

### Requirement: Meal-vibe palette page uses the production vocabulary

The meal-vibe palette page SHALL list, create, edit, and delete the tenant's meal vibes through
the shared vibe operations, rendering the **production** field vocabulary — the closed
`weather_affinity`/`weather_antipathy` set, `season` as a list, `facets`, `cadence_days`,
`pinned`, `base_weight`, and the vibe's `meal` — and SHALL derive per-vibe recency (last
satisfied) from the cooking log's `satisfied_vibe` provenance at read time, since the vibe row
stores none. The page SHALL render a useful empty state (production palettes start empty).

The list SHALL be **grouped by meal** into Breakfast / Lunch / Dinner sections (a vibe's `meal`,
defaulting `dinner`), each group rendering a per-group empty line when it holds no vibes. The
add/edit form SHALL carry a **Meal select** as its first field and include `meal` in the
created/edited vibe, so a vibe can be created into — or moved between — meals. A **pinned** vibe
SHALL carry a row indicator (a pin glyph + "Pinned" chip) beside its name, coexisting with the
status badge and chips without adding row height, and a pinned row SHALL de-emphasize its
cadence-debt meter (pinning force-places the vibe regardless of debt). The **member-assignment**
layout (the "Who's it for" form field and the row's member tag, D29) SHALL be present in the
markup but gated behind a `showWho` flag that is off this band — no member roster is rendered
until band 5 wires it.

#### Scenario: The palette read merges derived recency

- **WHEN** the palette page loads
- **THEN** each vibe row carries its derived last-satisfied date (or none), and the
  cadence-debt display is computed from it and `cadence_days` without any new stored column

#### Scenario: Vibes are grouped by meal

- **WHEN** the palette holds vibes across breakfast, lunch, and dinner
- **THEN** each vibe renders inside its meal's group, and a meal with no vibes renders its
  per-group empty line

#### Scenario: A pinned row renders its indicator and de-emphasizes debt

- **WHEN** the palette holds a pinned vibe and an unpinned vibe in the same meal group
- **THEN** the pinned row shows the pin indicator beside its name and de-emphasizes its
  cadence-debt meter, and the unpinned row shows no pin indicator

### Requirement: Reconciliation queue with member confirmation

The app SHALL render the member's pending reconciliation proposals as **inline suggestions** and
resolve them through the same confirm semantics as `confirm_proposal`: accept applies the
proposal's diff and records `accepted`; dismiss records `rejected` and the proposal never
re-surfaces. Presentation SHALL be kind-specific — no synthetic action without a backing
operation:

- An `adjust_cadence` or `prune_vibe` proposal SHALL attach to its palette row (joined by the
  proposal's target vibe) as a wand opening a suggestion panel with the rationale and an
  Apply/Retire + Dismiss action.
- An `add_vibe` proposal SHALL render as a per-meal-group footer card (grouped by its payload
  meal) with an Add + Dismiss action.
- A `merge_recipes` proposal (corpus curation, present only in the operator's own queue) SHALL
  NOT surface on the member vibes tab at all — it is filtered out entirely, since the merge
  itself is performed with the agent in chat; the member app has no merge operation.

Confirming an already-resolved proposal SHALL return a structured conflict and change nothing.
The tab SHALL render large backlogs sanely (production shows dozens of pending proposals).

#### Scenario: Accepting an add_vibe proposal updates the palette

- **WHEN** a member accepts a pending `add_vibe` proposal from its meal-group footer card
- **THEN** the vibe is upserted into that meal's group in the palette, the proposal is recorded
  `accepted`, and its card leaves the tab permanently

#### Scenario: An inline adjust_cadence suggestion applies to its row

- **WHEN** a member opens a palette row's suggestion wand and applies its `adjust_cadence`
  proposal
- **THEN** the vibe's cadence is upserted to the proposal's value, the proposal is recorded
  `accepted`, and the row's wand/suggestion leaves the tab

#### Scenario: Dismissal is durable

- **WHEN** a member dismisses an inline suggestion
- **THEN** it is recorded `rejected` and is never re-enqueued or re-surfaced (stable id
  idempotency)

#### Scenario: A merge_recipes proposal never surfaces on the member vibes tab

- **WHEN** the member's proposal feed contains a pending `merge_recipes` proposal
- **THEN** it renders nowhere on the meal vibes tab — no title, no rationale, and no
  accept/dismiss surface — because the merge is chat-guided and the member app has no merge
  operation
