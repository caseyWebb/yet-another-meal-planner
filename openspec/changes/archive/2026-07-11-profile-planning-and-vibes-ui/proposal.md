## Why

Band 1 shipped every backing surface for the profile's planning + vibes redesign — the
per-meal `cadence` map and the `weekly_budget` column on `profile`, the `meal` / `members`
fields on vibes, and the `add_vibe` / `adjust_cadence` / `prune_vibe` proposals feed — but
left the member-app UI on the pre-band-1 controls: a single "cooking nights" segmented
control, the retired `lunch_strategy` / ready-to-eat controls, a "Night vibes" palette with
no meal grouping and an invisible `pinned` flag, and a standalone reconciliation queue with a
retired "Suggest from your cooking" trigger. This is the D25(2) coupling obligation that
member-app-core's profile requirement forward-references: land the band-2 UI over the schema
band 1 already shipped.

## What Changes

- **Preferences → Planning card.** Replace the single "Cooking nights per week" segmented
  control (and the retired "Lunch strategy" / "Ready-to-eat items" controls) with **per-meal
  weekly cadence steppers** (Breakfast / Lunch / Dinner, 0–7 each, per-key merge patch
  `{cadence:{<meal>:n}}`). Widen the resurface-after slider to 14–60 days; keep the
  novelty-boost slider. Add the **weekly grocery budget** control as the card's last row —
  clearing writes `weekly_budget: null` (a first-class UNSET), a value writes
  `Math.max(0, Math.round(n))`; it never writes `0` to mean off.
- **Meal vibes tab.** Rename "Night vibes" → "Meal vibes" (tab + heading + subtitle). Group
  the palette **by meal** (Breakfast / Lunch / Dinner, per-group empty line); add a **Meal
  select** as the add/edit form's first field. Add the **pinned indicator** (a pin glyph +
  "Pinned" chip beside the name; pinned rows de-emphasize the debt meter). Port the
  **member-assignment** layout (form field + row tag) but gate it behind a `showWho` flag
  that is off this band (no roster renders until band 5).
- **Inline suggestions (replace the standalone queue).** Delete the `ReconcileQueue`
  component and the retired suggest trigger. Drive presentation from the same proposals feed:
  `adjust_cadence` / `prune_vibe` become a row-attached wand + suggestion panel (Apply/Retire
  + Dismiss), `add_vibe` becomes a per-meal-group footer card (Add + Dismiss), all via the
  existing `confirm_proposal`. `merge_recipes` is filtered out entirely — it never renders on
  the member vibes tab.

## Capabilities

### Modified Capabilities

- `member-app-core`: the Profile page's Preferences tab gains per-meal cadence steppers and
  the first-class weekly-budget control (retired-control forward-reference dropped); the
  "Night-vibe palette" requirement is renamed to "Meal-vibe palette" and gains meal grouping,
  the pinned indicator, and the (hidden) member-assignment layout; the reconciliation queue
  becomes inline suggestions and the `merge_recipes` render clause is removed (merge never
  surfaces in the member app).

## Impact

- **No TOOLS / SCHEMAS / D1 / worker-route delta** — band 1 shipped `update_preferences`
  (`cadence` per-key merge; `weekly_budget` with `null` delete), the `meal_vibe` family
  (`meal` / `members` / `pinned` accepted and returned by `GET /vibes`), and the
  `GET /vibes/proposals` + `POST /vibes/proposals/:id/confirm` feed. This slice is
  frontend-only.
- **Edited (app):** `packages/app/src/routes/_app.profile.tsx` (PrefsTab Planning card +
  VibesTab + VibeForm + VibeRowView), `packages/app/src/lib/data.ts` (`VibeRow` gains
  `meal` / `members`), `packages/app/src/lib/mutations.ts` (`VibeAddVars` gains `meal`).
- **Edited (ui):** `packages/ui/src/cookbook.css` (cadence/budget + meal-group/pinned/who +
  inline-suggestion classes; dead `.rec-*` queue classes removed).
- **Edited (tests):** `packages/worker/app/visual/pages/profile.page.ts`,
  `packages/worker/app/visual/specs/profile.spec.ts`,
  `packages/worker/admin/visual/seed.mjs` (+ `seed.d.mts`) — the seed gains a meal-vibe
  palette (six vibes, one pinned + one unpinned per group), `cadence` + `weekly_budget` on
  the profile, and an `adjust_cadence` proposal joined to a seeded vibe.
