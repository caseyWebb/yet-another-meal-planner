# group-insights Specification

## Purpose

The Insights area is a read-only operator dashboard over group-wide popularity in the recipe corpus — windowed summary tiles, a GitHub-style cooking-activity heatmap, and recipe + source leaderboards — aggregated across all member-tenants from the cooking log (`cooking_log`) and favorites (`overlay`), so the operator can see what the group actually cooks and loves. It performs no write; the area loads one typed insights payload and its window/sort/expand toggles re-render client-side from it without refetching.
## Requirements
### Requirement: Insights is a read-only top-level operator area

The admin panel SHALL provide an **Insights** area, rendered at `/admin/insights` and reached from the area nav after the Data area. The area SHALL be read-only — it displays group-popularity aggregates and performs no write. A deep link or refresh to `/admin/insights` SHALL render the Insights area directly.

#### Scenario: Insights renders at its own URL

- **WHEN** the operator opens `/admin/insights` directly (or refreshes there)
- **THEN** the Insights area renders as its own top-level surface, reached from the area nav alongside Status, Members, Data, Usage, Discovery, Logs, and Config

#### Scenario: Insights performs no write

- **WHEN** the operator interacts with any control in the Insights area
- **THEN** no D1 row, corpus object, or configuration value is created, updated, or deleted — every control only re-scopes or re-ranks the displayed aggregates

### Requirement: Insights aggregates group-wide across member-tenants

Insights figures SHALL aggregate over **all member-tenants** on the deployment (the group), not a single tenant. A recipe's times-cooked and favorite counts SHALL sum every member's contribution.

#### Scenario: A recipe cooked by multiple members sums across the group

- **WHEN** two different members each have a `cooking_log` `type='recipe'` row for the same slug in the window
- **THEN** that recipe's times-cooked for the window is at least 2 (the group total), not a per-member value

#### Scenario: Favorites count distinct favoriting members

- **WHEN** N members have an `overlay` row with `favorite` set for a slug
- **THEN** that recipe's favorite count is N

### Requirement: A window scopes cook-derived figures but not favorites

Insights SHALL offer a window control with the values **All time**, **Year**, **Month**, and **Week**. Selecting a window SHALL scope every cook-derived figure — the Cook events tile, the heatmap's in-window emphasis, and each leaderboard's times-cooked — to `cooking_log` rows whose `date` falls within the window. Because `overlay` carries no timestamp, favorite counts SHALL be identical in every window.

#### Scenario: Narrowing the window reduces times-cooked

- **WHEN** the operator switches from All time to Week
- **THEN** each recipe's times-cooked reflects only cooks whose `date` is within the last 7 days, and older cooks are excluded

#### Scenario: Favorites are unchanged by the window

- **WHEN** the operator switches between any two windows
- **THEN** every recipe's and source's favorite count is unchanged

### Requirement: Cook-event type determines what is counted

Insights SHALL treat `cooking_log.type` as follows: a recipe's **times cooked** SHALL count only rows with `type='recipe'` whose `recipe` slug is present in the recipe index; the **cooking-activity heatmap** and the **Cook events** summary SHALL count rows with `type IN ('recipe','ad_hoc')`. Rows with `type='ready_to_eat'` SHALL NOT count toward cooking activity.

#### Scenario: Ad-hoc cooking counts as activity but not toward a recipe

- **WHEN** a member logs an `ad_hoc` cook with no in-corpus recipe slug
- **THEN** it increments the heatmap day and the Cook events total, but does not add to any recipe's times-cooked

#### Scenario: Ready-to-eat is excluded from activity

- **WHEN** a member logs a `ready_to_eat` entry
- **THEN** it is not counted by the heatmap or the Cook events total

### Requirement: Summary tiles headline the selected window

The Insights area SHALL render four summary tiles for the selected window: **Cook events** (window cooking-activity total), **Favorites** (group favorite total), **Top recipe** (highest-ranked recipe title), and **Top source** (highest-ranked source name). A tile with no data SHALL render `0` or an em dash rather than an error.

#### Scenario: Tiles reflect the window

- **WHEN** the operator selects a window
- **THEN** the Cook events tile shows that window's cooking-activity total and the Top recipe/Top source tiles name the current top-ranked entries

### Requirement: Cooking-activity heatmap over a trailing year

The Insights area SHALL render a GitHub-style heatmap of the trailing 53 weeks, one cell per day, each cell's intensity level derived from that day's cooking-activity count. Days outside the selected window SHALL be visually dimmed rather than removed, so the full trailing year is always present.

#### Scenario: Out-of-window days are dimmed, not dropped

- **WHEN** the operator selects the Month window
- **THEN** the heatmap still spans the trailing 53 weeks, with days older than the window shown dimmed

### Requirement: Recipe leaderboard ranks the most popular recipes

The Insights area SHALL render a recipe leaderboard of the top recipes for the selected window, rankable by **Times cooked** or **Favorites**. Rows SHALL sort by the selected metric descending, ties broken by a combined popularity score. Each row SHALL deep-link to that recipe's data-explorer detail at `/admin/data/recipes/<slug>`.

#### Scenario: Re-ranking by favorites reorders the board

- **WHEN** the operator switches the rank control from Times cooked to Favorites
- **THEN** the recipe rows reorder by favorite count descending

#### Scenario: A recipe row deep-links to its detail

- **WHEN** the operator activates a recipe row
- **THEN** the browser navigates to `/admin/data/recipes/<slug>` for that recipe

### Requirement: Source leaderboard rolls recipes up by origin

The Insights area SHALL render a source leaderboard that rolls each recipe up by the **domain of its `source_url`**, rankable by the same metrics. A recipe with no usable `source_url` SHALL roll into a **member-authored** bucket, badged accordingly. A source whose domain matches a configured discovery feed SHALL be tagged as a **discovery feed** and link to the Config Discovery feeds editor. Each source row SHALL expand to list its recipes.

#### Scenario: Member-authored recipes group separately

- **WHEN** a recipe has no usable `source_url`
- **THEN** it appears under the member-authored source bucket, not a domain bucket

#### Scenario: A discovery-feed source links to its config

- **WHEN** a source's domain matches a configured discovery feed and the operator activates its feed tag
- **THEN** the browser navigates to the Config Discovery feeds editor

#### Scenario: Expanding a source lists its recipes

- **WHEN** the operator expands a source row
- **THEN** the row reveals that source's recipes with their per-recipe metrics

### Requirement: Insights toggles re-render from seeded data without refetch

The Insights area SHALL load **one** payload carrying every window's precomputed aggregates (the panel's typed insights read over the existing group-aggregation reader). Changing the window, the rank metric, or expanding a source SHALL update the view client-side from that already-loaded payload, without an additional network request or a navigation.

#### Scenario: Toggling the window makes no request

- **WHEN** the operator changes the window or rank metric after the area has loaded
- **THEN** the tiles, heatmap emphasis, and leaderboards update from the already-loaded payload with no additional server request

