# Page 03 — Meal plan

Screens: `screens/nav-meal-plan.png`, `screens/plan-empty-slots-on.png` (note: captured
with toggle off; grid behavior is from source).
Stories: 02 (meal dimension — load-bearing), 03 (projects → grocery).

## 1. Design summary

The plan gains the meal-type dimension end to end: scheduled rows grouped by day with
BREAKFAST/LUNCH/DINNER labels, a toggleable 7-day × 3-meal **empty-slots grid**,
unscheduled grouped by meal, and a brand-new **"Baking, treats & drinks"** projects
section for non-meal items. Header: "What you're cooking next. Schedule a night, add
sides, or pull a recipe in." + "Plan my week" → propose.

## 2. Functional requirements

**Row model**: `{id, recipe, planned_for?, sides[], meal, from_vibe?}` (story 02). Row
identity (decided, D26): `id` is a client-mintable ULID PRIMARY KEY — each slot is its
own row, so plan operations are **row-level ops**, not recipe-level ops. A recipe MAY
occupy multiple slots, but ONLY by explicit user action (the planner never generates
duplicates — the planner-no-duplicates invariant). `from_vibe` correction: the column
EXISTS (migration 0026, written by propose commit, consumed by log_cooked) — only the
page RENDERING of vibe provenance is new.

**Scheduled section** (toggle off): rows sorted date then breakfast<lunch<dinner; hung
day label on the first row of each date, same-day rows visually grouped; per row: date
input (clearing unschedules), meal label, title → detail, sides chips with remove +
"+ side" adder (use the propose side combobox, NOT the mock's `window.prompt`), remove
row. Empty state: "Nothing planned / Add a recipe from here or hit "Add to meal plan" on
any recipe."

**Empty-slots grid** (new; "Show empty meal slots" switch, default off): replaces the
scheduled list with today+0..6 × breakfast/lunch/dinner. Filled slot: title (tooltip
"Change recipe" → inline combobox), sides, remove — the grid position IS the date. Empty
slot: "+ Add Recipe" combobox. Slot semantics (decided, D26 — row-level ops): picking
into an occupied slot must not silently delete the occupant (mock does) — the occupant
row moves to unscheduled. Picking a recipe that is already planned MOVES that row into
the slot (sides preserved) by default; duplicating it into a second slot happens only
through an explicit **"add again"** affordance on the picker ("already planned {day} —
add again?"), which mints a new row — user-initiated duplication is the only kind that
exists. Rows scheduled beyond the 7-day horizon must remain visible somewhere (mock
hides them — bug).

**Unscheduled section**: grouped by meal, all three headings always rendered, per-group
"+ Add Recipe" combobox (re-tags the existing row's meal if the recipe is already
planned, or offers the same explicit "add again" duplication); setting a row's date
schedules it.

**Projects — "Baking, treats & drinks"** (new): catch-all "for anything outside the
big-three daily meals — bakes, desserts, drinks, and whatever else you want to shop for
and keep on deck." Rows: title + kind label (Baking / Dessert / Beverage), remove only —
no date, no meal, no sides. "+ Add a project" combobox. Data model (decided, D26):
projects are corpus recipes with non-meal `course` facets stored as `meal='project'`
plan rows (planned_for NULL, no sides), the picker filtered by course — not a separate
catalog (mock uses a disjoint hardcoded list). They hit `read_meal_plan` and project
ingredients into the to-buy derivation for free (story 03 provenance: planned).

**Sidebar count**: meal rows only — `meal != 'project'` (D26); projects are excluded.

## 3. Delta vs today

| Feature | Status |
|---|---|
| Scheduled/unscheduled, date set/clear, sides, remove, combobox add | exists |
| Day grouping visuals, meal labels, meal-sorted | **new** (dimension) |
| Empty-slots grid | **new** |
| Unscheduled grouped by meal | **new** |
| Projects section | **new** (not specced anywhere) |
| `from_vibe` provenance rendering | **new rendering** (the column exists — migration 0026) |

## 4. Open questions

1. ~~Projects data model: course-faceted corpus recipes vs separate entity; do they hit
   `read_meal_plan` or a parallel list; grocery projection semantics.~~ — decided (D26):
   course-faceted corpus recipes as `meal='project'` rows; they hit `read_meal_plan` and
   the to-buy derivation. Still open: the done/cooked lifecycle routes via story 02 q2's
   non-meal log path — that sub-question stands.
2. Grid horizon: 7 days fixed, or follow the cadence-derived planning window?
3. ~~Occupied-slot replacement: move-to-unscheduled vs confirm-delete.~~ — decided
   (D26): move-to-unscheduled; duplication only via the explicit "add again" affordance.
4. Should empty slots connect to propose (fill this hole) — mock keeps them manual-only;
   see pages/04 q5.
5. Toggle state persistence (per device? URL param?).
