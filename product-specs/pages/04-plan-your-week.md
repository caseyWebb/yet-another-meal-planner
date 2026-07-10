# Page 04 — Plan your week (propose + Meal Planning widget)

Screens: `screens/propose.png` (pre-propose state), `screens/widget-meal-planning-widget.png`.
Stories: 02 (per-meal sessions), 06 (widget is dual-use — this page embeds it).

## 1. Design summary

The propose flow becomes per-meal: BREAKFASTS / LUNCHES / DINNERS steppers (0–6 each)
drive independent proposal sessions over a shared seed; slot cards simplify (swap is the
only visible per-slot action); sides become editable on cards; a summary bar carries
variety stats and one "Commit all to meal plan". The page is a thin shell (breadcrumb,
heading, vibe-settings gear) around the embedded widget.

## 2. Functional requirements

**Steppers & live propose**: three per-meal counts; touching a dial proposes/updates
live. Pre-propose intro card: "Set how many of each meal you want, then propose — picked
from the kinds of meals you cook, spread out so it doesn't feel samey, with the weather
taken into account… Nothing's added to your plan until you say so." + "Propose meals".
Stepper defaults seed from the per-meal cadence preference (mock's `{0,0,3}` widget
default vs `{2,3,4}` profile — resolve to profile cadence).

**Session model**: shared `{seed, variety, proteinWants, freeform}` + per-meal
`{locked, overrides, excluded, facet pins, vibe override, sides}`; persisted (localStorage
today; keep). Per-meal sections are collapsible; slots draw from that meal's vibes
(story 02 §3 — mock rotates one generic vibe list; fix).

**Slot cards**: vibe caption (edited-state when overridden); **swap menu** (Something
similar / A different cuisine / Pick a specific recipe… / Change the vibe… with freeform
description + palette presets); inline **facet dropdown-chips** (protein, cuisine, time
tiers ≤20/30/45/60 — pinning constrains the slot pool and widens candidates to the whole
cookbook); **sides editing** (chips + side-library combobox, allow-custom); badges:
"Meal-preps well" (→ derived `meal_preppable` facet, not the mock's time≥40 heuristic)
and "Single-use: {ingredient}" (→ `perishable_ingredients`; mock latches at most one per
proposal — decide per-slot vs per-proposal); empty-slot state with honest reason
("No {facets} fits under a {t}-min cap — loosen a filter.") + pick list.

**Deliberate UX cuts (confirm, then spec)**: lock and exclude buttons are CSS-hidden
(handlers intact); adventurousness/variety dial, protein wants, freeform input, global
reroll, why-chips, and the weather strip are all plumbed but unrendered. The cross-check
says the weather strip IS specced with member UI (`member-app-propose`) — dropping it is
a spec regression to decide explicitly, not silently.

**Summary bar**: "N cuisines / N proteins" + protein histogram chips ("chicken ×2");
"Commit all to meal plan" disabled when nothing filled.

**Commit** (fix two mock bugs — see pages/03 & story 02): committed rows carry each
slot's **meal** and its edited sides + `from_vibe`; dates pack per (date, meal) openness
starting tomorrow. Duplicate-recipe handling: mock silently skips recipes already
planned — give feedback or update the existing row (decide). After commit: land on plan
page (standalone/MCP host shows the success view: "Week added to your plan", per-row
Day · Title · sides · Meal · Vibe, "Plan another week").

**MCP App host (story 06)**: propose runs inside Claude conversations via
`propose_meal_plan`; every swap/pin/commit sends agent context updates; commit is the
consolidated handoff.

## 3. Delta vs today

| Feature | Status |
|---|---|
| Slot cards, vibe caption/override, facet pins, swap/alternates, empty-reason, session persistence, weather shaping server-side | exists |
| Per-meal steppers + independent per-meal sessions | **new** |
| Sides editing on slots (committed with plan) | **new** |
| meal-prep / single-use badges | **new surfacing** of derived facets |
| Lock/exclude/nudge-bar/reroll/weather-strip removal | **cut — confirm each** |
| Commit meal+date packing | **new (fixes mock bug)** |

## 4. Open questions

1. Confirm each UX cut (lock, exclude, adventurousness, protein wants, freeform, global
   reroll, weather strip). Weather strip removal contradicts `member-app-propose`.
2. Empty-meal fallback: slots for a meal with no vibes of that meal (pages/10 q; nudge to
   vibes tab exists today).
3. Single-use badge cardinality (per-slot vs first-only).
4. Duplicate-at-commit behavior.
5. Propose ↔ plan-grid integration: should propose offer to fill existing empty (date,
   meal) holes instead of appending days? (Mock: no connection.)
6. Session-shape migration (`v:3` per-meal) from existing single-nights sessions.
