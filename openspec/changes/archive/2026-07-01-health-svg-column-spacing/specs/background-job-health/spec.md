## ADDED Requirements

### Requirement: Health badge card columns fit their content

The `/health.svg` card SHALL position its three text columns — the row label (job or dependency name), the status word, and the relative-age timestamp — so that no column's rendered text overlaps an adjacent column, for **every** registered row, including the longest label (`reconcile-signals`) and the longest status word (`quota exhausted`). Because the card renders in a monospace font, each column's start SHALL be derived deterministically from the rendered content: a column SHALL begin after the widest text in the column to its left plus a fixed gutter, computed from the text's character count and a fixed per-character advance width — not from hardcoded x-coordinates that assume a maximum label length. The card's overall width SHALL grow to contain the rightmost column, subject to a minimum width that keeps the header (`grocery-mcp` and the status headline) uncramped. This layout SHALL change only column geometry: the card's states, colors, headline, `200`-in-all-states behavior, and tenant-data-free guarantee are unchanged.

#### Scenario: The longest label does not overlap the status word

- **WHEN** `/health.svg` renders with the registered jobs, including `reconcile-signals`
- **THEN** the label's rendered right edge stays left of the status-word column start for every row, so no name overlaps its `ok`/`fail`/`never` word

#### Scenario: The longest status word does not overlap the age column

- **WHEN** the card renders with the `ai` row showing `quota exhausted`
- **THEN** that word's rendered right edge stays left of the age column start, so the word does not collide with (or rely on an empty) age column

#### Scenario: A longer label repacks the card without hand-tuning

- **WHEN** a registered job name longer than any current label is rendered
- **THEN** the card widens and repositions the status-word and age columns to contain it — with no manually edited coordinate — and no column overlaps another
