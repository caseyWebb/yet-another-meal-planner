# Story 02 — The meal-type dimension (breakfast / lunch / dinner)

The mockup promotes meal type from an escape-hatch facet to a first-class axis across
five surfaces. Today the product is dinner-centric: plan rows have no meal field, cadence
is a single `default_cooking_nights`, vibes are "night vibes", and the cooking log has no
meal column. This story defines the shared dimension so each page change composes.

## 1. Where the dimension appears

- **Plan rows** (pages/03): every row carries `meal: breakfast|lunch|dinner`; scheduled
  rows sort by date then meal; the empty-slots grid addresses slots by `(date, meal)`;
  unscheduled groups by meal with per-meal add.
- **Cadence preference** (pages/09): `default_cooking_nights` → per-meal weekly counts
  `{breakfast: 0-7, lunch: 0-7, dinner: 0-7}` (mock default 2/3/4). Feeds propose stepper
  defaults and the planning window.
- **Vibes** (pages/10): "Night vibes" → "Meal vibes"; each vibe carries `meal`, the
  palette groups by meal, and propose draws each meal's slots from that meal's vibes.
- **Propose** (pages/04): three independent steppers (0–6 each); per-meal proposal
  sessions (locks/pins/exclusions/sides per meal) over a shared seed and dials.
- **Cooking log** (pages/07): log rows gain `meal`; composer defaults by time of day;
  day-grouped display ordered breakfast < lunch < dinner.

## 2. Contract changes implied (one coordinated pass per surface)

- D1: `meal_plan.meal`, `cooking_log.meal` columns (+ vibe `meal` in the palette table);
  migration defaults: existing plan rows and vibes → `dinner`; existing log rows → null
  (unknown) rather than fabricated.
- Preferences doc: `cadence: {breakfast, lunch, dinner}`; migrate
  `default_cooking_nights: N` → `{breakfast: 0, lunch: 0, dinner: N}`.
- Tools (docs/TOOLS.md same pass): `update_meal_plan` / `read_meal_plan` rows,
  `propose_meal_plan` per-meal counts, `log_cooked` meal param (dedupe rule must become
  per-(date, meal, type, recipe)), vibe CRUD tools (`add_night_vibe` family — rename or
  alias to meal vibes), `update_preferences` cadence shape.
- Retrospective aggregations become meal-aware ("you cook ~3.8 nights a week" prose →
  per-meal counts).

## 3. Semantics that need care

- **Lunch strategy and ready-to-eat default action are cut** from Preferences in the
  mockup (vestigial JS only). Working assumption: meal-scoped vibes subsume them (e.g. a
  "Leftovers remix" lunch vibe replaces `lunch_strategy: leftovers`). The proposal that
  removes them must map existing preference values onto seeded lunch/breakfast vibes and
  address `ready_to_eat` interactions (RTE catalog/tools are untouched by the mockup).
- **Commit path (mock bug — do not copy)**: the propose widget must carry each slot's
  meal onto the committed plan row, and the date allocator must pack per `(date, meal)`
  openness so a day can hold breakfast + dinner (mock hardcodes `Dinner` and one row per
  day).
- **Vibe-meal binding in propose**: breakfast slots sample breakfast vibes only; define
  behavior when a meal has slots but no vibes of that meal (fallback pool? nudge to add
  vibes — the mock's empty-palette state routes to the vibes tab).
- **Meal-agnostic entry points** (cookbook row plan-toggle, recipe detail "Add to meal
  plan") default to `dinner`, unscheduled. Acceptable default; note it in copy ("Want To
  Cook" list framing).

## 4. Open questions

1. Are `breakfast|lunch|dinner` the closed set, or does the plan need the mock's separate
   projects section to stay the escape hatch for everything else (story: pages/03 —
   projects are NOT meals)? (Recommended: closed set + projects.)
2. Log rows for non-meal events (baking a loaf): does the log composer need a fourth
   "other" meal value, or do projects log through a different path?
3. Does per-meal cadence drive vibe-cadence debt normalization (a lunch vibe "every 7
   days" in a 3-lunches-a-week household), or stay orthogonal as today?
4. Weather-bucket allocation currently spans "nights" — does it apply to breakfasts and
   lunches too (grill-weather lunches?) or dinner-only?
