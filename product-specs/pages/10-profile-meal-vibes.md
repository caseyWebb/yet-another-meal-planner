# Page 10 — Profile: Meal vibes tab

Screens: `screens/profile-vibes.png`, `screens/tall-profile-vibes.png`.
Story: 02 (meal scoping).

## 1. Design summary

"Night vibes" → **"Meal-vibe palette"**: "The *shapes* of your week — repeatable meal
ideas across breakfast, lunch, and dinner, not exact recipes. Each is a saved search with
a cadence; the planner samples them by weather and how overdue they are." The
reconciliation queue dissolves into **inline suggestions** attached to rows and groups.
Tab badge = pending proposal count. Vibes are household-scoped (tenant-keyed) with
optional **member assignment** (D29): a vibe applies to one or more members, default
everyone; an assigned vibe contributes slots/cadence-debt only when its members are
eating that week. Banding (D25): this tab is the band-2 `profile-planning-and-vibes-ui`
slice, paired with band 1's vibe schema change; the D8 lunch-strategy/RTE →
seeded-vibes migration rides this slice.

## 2. Functional requirements

**Add form** (persistently open at top when not editing): freeform name ('"Sunday
sauce", "savory eggs"…'), **Meal select** (Breakfast/Lunch/Dinner — new), cuisine /
protein / max-time selects, cadence select (7/10/14/21/30/45 days — cadence stays
optional per D21; the mock's mandatory select is a UI default), optional **member
assignment** (one or more household members; default everyone — D29), weather-fit chips
(grill / cold-comfort / wet), season chips, **"Pinned (weekly intent)"** checkbox (flag
exists in specs already; force-placed by weather-bucket allocation).

**List grouped by meal**: per-row name + status badge (NEW / ON TRACK / DUE SOON / DUE
NOW / OVERDUE at debt thresholds 0.6 / 1.0 / 1.5 — confirm parity with current app math),
facet + season chips, "every N days", "cooked 2d ago" / "never cooked from this",
cadence-debt progress bar, weather chips; pencil → inline edit form (same fields incl.
meal, so vibes can move between meals) + Delete. Per-group empty line; palette-empty
state ("…or let the suggestions above seed it."). **Pinned has no row indicator in the
mock — add one** (it changes planner behavior; invisible flags are a trap).

**Cuts (decided, D8; ledger completed by D20)**: the standalone reconcile-queue section
and the manual "Suggest from your cooking" trigger are gone — inline suggestions with
confirm_proposal semantics and durable dismissal replace them, and the cron carries
generation; `merge_recipes` proposals stay agent-side, never surfaced in the member app.

**Inline suggestions** (same proposals, new presentation): row-attached wand icon for
adjust_cadence / prune_vibe → "Suggestion from your cooking" panel with rationale +
Apply(/Retire) / Dismiss; per-meal-group footer cards for add_vibe ("Add 'Yogurt +
granola'? — shows up most mornings this week") with Add / Dismiss.

## 3. Delta vs today

| Feature | Status |
|---|---|
| Palette CRUD, facets, cadence, weather/season, pinned flag, debt meter | exists |
| Meal field + grouping + per-meal empties | **new** (story 02) |
| Inline suggestion presentation | tweak (same proposals) |
| Standalone queue, merge_recipes surface, suggest trigger | **cut (decided, D8)** |
| Pinned row indicator | **add** (absent in mock) |

## 4. Open questions

1. ~~Migration: existing vibes → `meal: dinner`; tool naming (`add_night_vibe` family →
   meal vibes) across TOOLS.md.~~ — decided (D21): the family renames to `meal_vibe`
   with `night_vibe` dispatch aliases kept for one deprecation window;
   `update_night_vibe` gains explicit-null field clearing for the inline edit form;
   existing vibes migrate to `meal: dinner` (story 02).
2. ~~merge_recipes surfacing~~ / ~~suggest trigger~~ — decided (D8): agent-side only;
   the cron carries suggestion generation.
3. ~~Cadence optionality~~ — decided (D21): cadence stays optional (the mock's mandatory
   select is a UI default). Still open: propose behavior for a meal with zero vibes
   (pages/04 q2).
5. What "pinned (weekly intent)" guarantees exactly (a slot every week regardless of
   debt?) — align with `weather-bucket-planning`'s force-place.
