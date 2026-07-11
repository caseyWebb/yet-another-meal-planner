# Story 02 — The meal-type dimension (breakfast / lunch / dinner)

The mockup promotes meal type from an escape-hatch facet to a first-class axis across
five surfaces. Today the product is dinner-centric: plan rows have no meal field, cadence
is a single `default_cooking_nights`, vibes are "night vibes", and the cooking log has no
meal column. This story defines the shared dimension so each page change composes.

## 1. Where the dimension appears

- **Plan rows** (pages/03): every row carries `meal: breakfast|lunch|dinner` (projects
  ride the same column as `meal='project'` — pages/03); scheduled rows sort by date then
  meal; the empty-slots grid addresses slots by `(date, meal)`; unscheduled groups by
  meal with per-meal add.
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
  `meal` is a closed set `breakfast|lunch|dinner|project`; migration defaults: existing
  plan rows and vibes → `dinner`; existing log rows → null (unknown) rather than
  fabricated. **Plan-row identity (decided, D26)**: `meal_plan` moves to a
  client-mintable surrogate row id (ULID) PRIMARY KEY, with a
  **planner-no-duplicates invariant** — a recipe MAY occupy multiple slots, but ONLY by
  explicit user action (grid "add again", a user request in chat); the planner never
  generates duplicates (propose fills a plan's slots with distinct recipes; commit
  updates an existing row rather than duplicating unless the member explicitly chose
  duplication). Consequences: class (b) offline replay keys on the client-minted row id;
  slug-addressed tool ops keep defined fan-out (remove-by-slug drops all matching rows;
  set-by-slug requires a unique match or returns candidates); `log_cooked` clears
  deterministically — exact (recipe, meal, date) first, else the earliest-due row for
  the slug — and accepts an optional row-id param; projects are rows with
  `meal='project'` (planned_for NULL, no sides), hitting `read_meal_plan` and the
  to-buy derivation for free; the migration mints server-side ids once. The
  per-(date, meal, type, recipe) rule is cooking_log DEDUPE identity only, not plan-row
  identity. Same-pass lockstep: SCHEMAS.md, TOOLS.md, the meal-planning spec delta, and
  ARCHITECTURE.md's class (b) keying sentence.
- Preferences doc: `cadence: {breakfast, lunch, dinner}`; migrate
  `default_cooking_nights: N` → `{breakfast: 0, lunch: 0, dinner: N}`.
- Tools (docs/TOOLS.md same pass): `update_meal_plan` / `read_meal_plan` rows,
  `propose_meal_plan` per-meal counts, `log_cooked` meal param (dedupe rule must become
  per-(date, meal, type, recipe)), vibe CRUD tools (`add_night_vibe` family — rename or
  alias to meal vibes), `update_preferences` cadence shape. Skew posture (D21): the
  `night_vibe` family renames to `meal_vibe` with the old names kept as dispatch aliases
  onto the same ops for one deprecation window; `update_preferences` accepts retired
  `lunch_strategy`/`ready_to_eat_default_action` as accepted-and-dropped with a
  `warnings` field ({key, reason: "retired", superseded_by: "meal vibes"}) — never
  `validation_failed` — and accepts `default_cooking_nights: N` as an alias writing
  `cadence.dinner` for the same window.
- Retrospective aggregations become meal-aware ("you cook ~3.8 nights a week" prose →
  per-meal counts).
- The band-1 propose-engine contract is written caller-neutral (D29): the
  hard-constraint floor comes from the household (union), the soft profile is the
  attendance-weighted household blend of member tastes — absent an attendance signal,
  all members weigh equally.

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

1. ~~Are `breakfast|lunch|dinner` the closed set, or does the plan need the mock's
   separate projects section to stay the escape hatch for everything else?~~ — decided
   (D26): closed set + projects; projects are `meal='project'` plan rows, not meals.
2. ~~Log rows for non-meal events (baking a loaf): does the log composer need a fourth
   "other" meal value, or do projects log through a different path?~~ — decided
   (meal-dimension-foundations): no fourth value; `cooking_log.meal` is nullable and NULL
   means "not a meal / unknown" (a baked loaf is `{type:'ad_hoc', meal: null}` — `type` and
   `meal` are orthogonal). A planned project cook logs `{type:'recipe', meal:'project'}`,
   which routes the deterministic clear at the project row.
3. ~~Does per-meal cadence drive vibe-cadence debt normalization (a lunch vibe "every 7
   days" in a 3-lunches-a-week household), or stay orthogonal as today?~~ — decided
   (meal-dimension-foundations): orthogonal, as today. `cadence_days` stays absolute days
   and debt math is unchanged; per-meal counts shape slot *supply*, debt ranks *within* a
   meal's sampling, and `occurrenceCap` handles window-relative repeatability. An
   unfittable vibe stays maximally overdue and wins the next available slot.
4. ~~Weather-bucket allocation currently spans "nights" — does it apply to breakfasts and
   lunches too (grill-weather lunches?) or dinner-only?~~ — decided
   (meal-dimension-foundations): dinner-only. Quotas run in the dinner pass; breakfast/
   lunch never carry `weather_category`; non-dinner stored affinities are preserved but
   inert; the suggest cron discards bucket labels for non-dinner clusters.
