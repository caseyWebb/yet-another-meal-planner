# Page 07 — Retrospective (Cooking log / Spend analyzer / Waste analyzer)

Screens: `screens/retro-log.png`, `screens/tall-retrospective.png`,
`screens/retro-spend.png`, `screens/tall-retro-spend.png`, `screens/retro-waste.png`,
`screens/tall-retro-waste.png`.
Stories: 02 (meal on log), 03 (spend/waste — the analyzers' contracts live there).

## 1. Design summary

The nav item "Log" becomes **Retrospective** ("Look back at what you cooked — and what it
cost.") with three tabs: Cooking log (default), Spend analyzer, Waste analyzer. Tab and
range state should be URL search params (`?tab=spend&range=8w` — repo convention).

## 2. Cooking log tab

**Composer** ("+ LOG A COOK"): meal segmented (Breakfast/Lunch/Dinner; default by time of
day: <11 breakfast, <16 lunch, else dinner) + source segmented **From cookbook /
Leftovers / Something else** → per-source input (recipe select / free text "What
leftovers? e.g. beef pho" / free text "What did you eat? e.g. takeout ramen") + date
picker (default today, backdating allowed) + "Log it". On submit, meal+date persist for
rapid multi-logging. Source→type mapping: recipe / ready_to_eat / ad_hoc.

**Semantic conflict to resolve**: today's contract says leftovers of an already-logged
cook are NOT re-logged (the log is a cooking log, not an eating log), and `ready_to_eat`
means convenience meals. The composer's "Leftovers" source deliberately relaxes this
toward an eating log — decide: either a new `leftovers` type (eating-log semantics,
excluded from cook-count aggregates) or drop the source. Don't silently overload
`ready_to_eat`.

**List**: grouped by day (Today / Yesterday / "Wed Jul 8" + "N LOGGED"), rows ordered
B<L<D within a day; row = meal tag, title (recipe rows link + facet chips; others get
"leftovers" / "made something else" badges), delete. Dedupe rule becomes
per-(date, meal, type, recipe) (story 02).

## 3. Spend analyzer (new — contract in story 03)

Range 4w/8w/12w; deterministic insight banner; KPI tiles (Total spend / Avg per week
"groceries + household" / Cost per meal "~N meals cooked at home" / Weekly trend vs prior
period, "not enough history" fallback); weekly bar chart with **budget line** (member
weekly-budget preference; over-budget bars highlighted; $0 hides); breakdowns: By
department, By store, By meal source (Planned vs Impulse); Top cost drivers ("bought
N×"). All household-scoped, derived from D16 spend events over the canonical D17
department dimension only ("Not mapped" can never appear); no LLM in the read path.
Lingering in_cart rows surface as "N items awaiting mark-placed" rather than being
counted (D16). The `retrospective` tool gains read-only household-scoped spend/waste
aggregate sections; no spend-write tool exists.

## 4. Waste analyzer (new — contract in story 03)

Same range control; insight banner; KPI tiles (Tossed $ / Items binned "~N a week" /
Waste rate "% of grocery spend" red ≥10% / Weekly trend); weekly tossed chart; breakdowns:
By department (incl. Leftovers), By reason, Avoidable vs Hard to avoid; Most-wasted items
("tossed N×"). Derived from the D15/D17 waste events captured at pantry disposition
(pages/06), over the canonical department dimension only; $ value and avoidability
derived, never asked — avoidability and the Leftovers pseudo-department are read-time
derivations from the versioned reason table (story 03 §2).

## 5. Delta vs today

| Feature | Status |
|---|---|
| Log list, recipe links/facets, delete, log-a-cook | exists |
| Meal on log rows + composer, day grouping, backdating, non-recipe entry from web | **new** |
| Retrospective shell (rename + tabs) | **new** |
| Spend analyzer | **new product area** |
| Waste analyzer | **new product area** |

## 6. Open questions

1. Leftovers semantics (§2) — the one real product decision on the log.
2. Cost-per-meal denominator (which log types count; breakfasts weigh same as dinners?).
3. ~~Does the agent-side `retrospective` tool gain spend/waste aggregates in the same
   pass?~~ — decided (D16 / story 03): yes — read-only household-scoped aggregate
   sections; no spend-write tool is minted.
4. `/log` route redirect.
5. Trend availability rules at range edges; week-start convention (mock: Sunday).
