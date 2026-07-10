# Page 10 — Profile: Meal vibes tab

Screens: `screens/profile-vibes.png`, `screens/tall-profile-vibes.png`.
Story: 02 (meal scoping).

## 1. Design summary

"Night vibes" → **"Meal-vibe palette"**: "The *shapes* of your week — repeatable meal
ideas across breakfast, lunch, and dinner, not exact recipes. Each is a saved search with
a cadence; the planner samples them by weather and how overdue they are." The
reconciliation queue dissolves into **inline suggestions** attached to rows and groups.
Tab badge = pending proposal count.

## 2. Functional requirements

**Add form** (persistently open at top when not editing): freeform name ('"Sunday
sauce", "savory eggs"…'), **Meal select** (Breakfast/Lunch/Dinner — new), cuisine /
protein / max-time selects, cadence select (7/10/14/21/30/45 days — mandatory in mock;
today cadence is optional — decide), weather-fit chips (grill / cold-comfort / wet),
season chips, **"Pinned (weekly intent)"** checkbox (flag exists in specs already;
force-placed by weather-bucket allocation).

**List grouped by meal**: per-row name + status badge (NEW / ON TRACK / DUE SOON / DUE
NOW / OVERDUE at debt thresholds 0.6 / 1.0 / 1.5 — confirm parity with current app math),
facet + season chips, "every N days", "cooked 2d ago" / "never cooked from this",
cadence-debt progress bar, weather chips; pencil → inline edit form (same fields incl.
meal, so vibes can move between meals) + Delete. Per-group empty line; palette-empty
state ("…or let the suggestions above seed it."). **Pinned has no row indicator in the
mock — add one** (it changes planner behavior; invisible flags are a trap).

**Inline suggestions** (same proposals, new presentation): row-attached wand icon for
adjust_cadence / prune_vibe → "Suggestion from your cooking" panel with rationale +
Apply(/Retire) / Dismiss; per-meal-group footer cards for add_vibe ("Add 'Yogurt +
granola'? — shows up most mornings this week") with Add / Dismiss. **Cut from the mock,
decide explicitly**: the standalone queue section, `merge_recipes` proposal surfacing
(today: dismissable-only rows), and the job-health-gated "Suggest from your cooking"
trigger button.

## 3. Delta vs today

| Feature | Status |
|---|---|
| Palette CRUD, facets, cadence, weather/season, pinned flag, debt meter | exists |
| Meal field + grouping + per-meal empties | **new** (story 02) |
| Inline suggestion presentation | tweak (same proposals) |
| Standalone queue, merge_recipes surface, suggest trigger | **cut — confirm** |
| Pinned row indicator | **add** (absent in mock) |

## 4. Open questions

1. Migration: existing vibes → `meal: dinner`; tool naming (`add_night_vibe` family →
   meal vibes) across TOOLS.md.
2. Where do `merge_recipes` proposals surface now?
3. Does the archetype-derivation cron fully replace the manual suggest trigger?
4. Cadence optionality; propose behavior for a meal with zero vibes (pages/04 q2).
5. What "pinned (weekly intent)" guarantees exactly (a slot every week regardless of
   debt?) — align with `weather-bucket-planning`'s force-place.
