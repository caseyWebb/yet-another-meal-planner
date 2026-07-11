## Why

The "Cooking log" nav destination becomes the **Retrospective** — a tabbed shell (Cooking
log / Spend analyzer / Waste analyzer) whose default tab is the meal-aware cooking log. Band
1 already landed the backend: `cooking_log.meal`, the `log_cooked` `meal` param, the meal-aware
`retrospective` tool (`cadence.by_meal`), and the `/api/log` read/write both carry `meal`. What
is missing is the member UI — this change is the coupling half (D25(2)): surface `meal` on the
log and reshape the page into the retrospective shell. The Spend and Waste analyzers themselves
are band 4; this change ships the shell they mount into.

## What Changes

- Rename the nav destination and route: **Cooking log → Retrospective** at `/retrospective`
  ("Look back at what you cooked — and what it cost."), with `/log` redirecting to it.
- Add the tabbed shell: **Cooking log** (default), **Spend analyzer**, **Waste analyzer** — tab
  state in a `?tab` URL search param. Spend/Waste render a "coming soon" placeholder; their
  analyzers and the `?range` control land in band 4.
- Reshape the Cooking log tab to be meal-aware:
  - **Composer**: a **meal** segmented control (Breakfast/Lunch/Dinner, default by time of day —
    `<11` breakfast, `<16` lunch, else dinner) and a **source** segmented control
    (**From cookbook / Something else** → `recipe` / `ad_hoc`), a per-source input (recipe select
    / free-text "what did you eat"), a date picker (default today, **backdating allowed**), and
    "Log it". On submit the meal and date persist for rapid multi-logging.
  - **List**: grouped by day (Today / Yesterday / "Wed Jul 8" + an "N LOGGED" count), rows ordered
    breakfast < lunch < dinner within a day (meal-less legacy rows last), each row showing its
    **meal tag**, the recipe link + facet chips (or a "made something else" badge for `ad_hoc`),
    and delete.
- **Leftovers source decision (pages/07 q1, resolved):** the composer does **not** offer the
  mock's "Leftovers" source. The cooking log is a cooking log, not an eating log (the
  `log_cooked` contract: `type ∈ recipe|ready_to_eat|ad_hoc`, "no fourth value", "leftovers of
  an already-logged cook are not re-logged"); a distinct eating-log `leftovers` type would be a
  foundations-level schema/tool change out of band. Leftovers-as-waste is captured in band 4's
  waste analyzer via pantry `prepared_from`. This is a deliberate D5 deviation from the
  painted-door mock.

## Capabilities

### Modified Capabilities

- `member-app-core`: the cooking-log page requirement gains the meal-aware composer and
  day-grouped, meal-tagged list; a new requirement pins the Retrospective tabbed shell.

## Impact

- Affected code: `packages/app/src/routes/_app.retrospective.tsx` (new), `_app.log.tsx`
  (redirect), `_app.tsx` (nav rename), `packages/app/src/lib/data.ts` (`LogRow.meal`),
  `packages/app/src/lib/mutations.ts` (`LogAddVars.meal`), `packages/ui/src/cookbook.css`
  (retro composer/day-group/entry styles, ported from the mockup).
- Affected tests: `packages/worker/app/visual/` — the log page object becomes the retrospective
  page object; specs cover the tab shell, meal composer, day grouping, and backdating.
- No Worker route, MCP tool, D1 schema, docs contract, or `@yamp/contract` change: the backend
  (`/api/log` meal, `retrospective` meal-aware) landed in band 1.
