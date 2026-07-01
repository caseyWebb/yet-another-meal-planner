## Why

The operator reviewed the shipped 8-area admin-panel redesign (`#159`, merged to `main`) against the approved design mock and filed a punch-list spanning every area: missing icons/borders/tooltips, inconsistent expand/collapse affordances, a stale "Service Health" heading, several outright bugs (an empty Stores explorer, a dropdown menu that navigates instead of opening, a slider fill that doesn't track its value, all-grey Usage namespace colors, and a Members roster stuck showing "awaiting connection"), and a handful of editors that don't match the approved Config mock. The panel needs a fidelity pass to close the gap between what shipped and what was approved, plus root-cause fixes for the items that are genuine bugs rather than polish.

## What Changes

- **Status homepage**: drop the redundant "Service Health" heading (health now lives in the global corner indicator); add card icons; make the RSS Feeds tile navigate to Config's Discovery-feeds editor and the Cached SKUs tile navigate to Data > Stores; show a "checked `<age>`" label next to Refresh; render job summary counts as pills/badges; cap sparkline segment width and right-align the run history so it doesn't look broken while still populating; add a hover tooltip per sparkline segment; add "OLDER"/"NOW" axis labels to the sparkline; add a border/shadow to stat and job cards.
- **Members**: remove the duplicate "ROSTER" heading; fix the dropdown-menu trigger so opening it never navigates to the member detail page; investigate and resolve (or explain) why both members show "awaiting claude.ai connection".
- **Data > Recipes**: make the list page size configurable, defaulting to 50 (today it is a fixed 6).
- **Recipe detail**: render D1-index list-valued fields as badges/pills (matching the R2 frontmatter's pretty render); improve the markdown renderer's fidelity.
- **Data > Stores**: fix the explorer showing empty when the shared registry has data (or confirm and document when empty is correct).
- **Guidance**: strip YAML frontmatter before markdown rendering (today it leaves stray whitespace and a leading `<hr>`); render the extracted frontmatter as a pretty key/value block, matching the recipe frontmatter treatment.
- **Usage**: add padding below the "Cloudflare usage for `<day>` (UTC)…" line; widen the container (or fix the layout) so cards don't overflow it; fix per-namespace KV colors so they render distinctly instead of all-grey; add hover tooltips to sparkline segments.
- **Discovery**: surface match scores when a candidate halts at the `match` stage; make the candidate card's expand/collapse ("Details") affordance consistent and discoverable in both directions (currently the label doesn't show until first expanded, and clicking it again doesn't collapse).
- **Logs**: remove the left sidebar/submenu (the area is single-destination — the all-jobs run log — per the already-shipped redirect of the legacy Discovery log route).
- **Config**: bring the Discovery-feeds editor, the flyer-terms editor, and the aliases editor in line with the approved mock; replace every text "remove" button with an icon-only trash button (the mock's pattern, applied everywhere a corpus-editor row is removable); fix the slider fill so its orange track reflects the knob's actual value instead of a fixed amount for every slider.
- **Overall**: a general fidelity pass reconciling remaining visual drift against the mock once the above land.

## Capabilities

### New Capabilities

(none — this change fixes and polishes the already-shipped `operator-admin` and `operator-data-explorer` surfaces; it introduces no new capability domain)

### Modified Capabilities

- `operator-admin`: the Status area's stat-tile navigation gains two more navigating tiles (RSS Feeds → Config's Discovery-feeds editor, Cached SKUs → Data > Stores); the Logs area drops its left submenu now that it has a single destination; the Discovery area's candidate cards surface the per-member match/taste scores when a candidate halts at the `match` or `confirm` stage.
- `operator-data-explorer`: the Recipes explorer's list gains an operator-configurable page size (default 50, replacing the fixed page size).
- `discovery-sweep`: a no-match/dietary-gated/confirm-declined log entry's `detail` gains the per-member cosine match scores computed at the match stage, so the operator admin surface can display them (today they are computed and then discarded).

## Impact

- **Code**: `src/admin/pages/*.tsx` (status, members, data, discovery, logs, config), `src/admin/client/*.tsx` (the members, discovery, corpus, knob-console islands), `src/admin/ui/kit.tsx` (`Slider`, badge/pill primitives), `src/admin/styles.css` (card borders/shadows, sparkline layout, slider fill), `src/admin-data.ts` (Stores explorer read — pending root-cause), `src/tenant.ts` / `src/admin.ts` (Members status — pending root-cause), `src/usage.ts` / `src/admin/pages/usage.tsx` (namespace color resolution — pending root-cause), a shared markdown-render helper (frontmatter stripping, used by both Guidance and Recipe detail), and a shared `PrettyKV`-style badge/pill renderer for D1 list-valued fields.
- **No D1 schema change** is anticipated — the Members/Stores/Usage items are read-path or write-path bugs against existing tables (`tenant_activity`, `stores`/`store_notes`/`sku_cache`, `usage.ts`'s namespace-label parsing), not new tables.
- **No new API surface** — the Recipes page-size and Discovery match-score items extend existing endpoints' query params / response shape; everything else is client-rendering/CSS.
