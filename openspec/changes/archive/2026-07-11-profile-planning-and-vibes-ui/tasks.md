# Tasks

## 1. Data + mutation types

- [x] 1.1 Add `meal` and `members` to `VibeRow` in `packages/app/src/lib/data.ts`.
- [x] 1.2 Add optional `meal` to `VibeAddVars` in `packages/app/src/lib/mutations.ts`
  (`useVibeAdd` already forwards the whole `payload()` object — no mutation change needed).

## 2. Shared UI styles

- [x] 2.1 Port the cadence + budget classes (`.cadence-row/.cadence-item/.cadence-meal`,
  `.budget-input/.budget-prefix/.budget-clear`, `.prof-help`) into `packages/ui/src/cookbook.css`.
- [x] 2.2 Port the meal-vibe classes (`.vibe-group`, `.vibe-pin`, `.vibe-who/.who-chip/.who-ava`,
  `.vibe-who-tag/.who-stack/.who-ava-sm`, `.vibe-wand`, `.vibe-suggest`, `.vibe-add-suggest`) and
  the pinned de-emphasis (`.vibe-row.pinned .vibe-debt`). Remove the dead `.rec-*` queue classes.

## 3. Preferences → Planning card

- [x] 3.1 Replace the "Cooking nights per week" segmented control (and the retired
  "Lunch strategy" / "Ready-to-eat items" controls) with per-meal cadence steppers
  (Breakfast/Lunch/Dinner, 0–7, `patch({cadence:{[meal]:n}})`, disabled at 0 and 7).
- [x] 3.2 Widen the resurface-after slider to 14–60d; keep the novelty-boost slider.
- [x] 3.3 Add the `BudgetField` as the card's last row (clear → `weekly_budget: null`;
  value → `Math.max(0, Math.round(n))`; format on blur; unset helper copy).

## 4. Meal vibes tab

- [x] 4.1 Rename the tab label + heading + subtitle ("Night vibes" → "Meal vibes").
- [x] 4.2 Group vibe rows by `meal` into Breakfast/Lunch/Dinner sections with per-group empties.
- [x] 4.3 Add the Meal select as the vibe form's first field; include `meal` in `payload()`.
- [x] 4.4 Add the pinned indicator (`.vibe-pin`) + de-emphasized debt for pinned rows.
- [x] 4.5 Port the member-assignment layout (form field + row tag) gated behind `SHOW_WHO` (false).

## 5. Inline suggestions

- [x] 5.1 Delete the `ReconcileQueue` component + render and the suggest button + `suggest()`.
- [x] 5.2 Drive row-attached suggestions (`adjust_cadence`/`prune_vibe`, joined by
  `target === vibe.vibe`) — a wand opening an Apply/Retire + Dismiss panel.
- [x] 5.3 Drive per-meal-group `add_vibe` footer cards (Add + Dismiss).
- [x] 5.4 Filter `merge_recipes` out entirely (never renders on the vibes tab).

## 6. Tests + seed

- [x] 6.1 `profile.page.ts`: replace `setCookingNights`/`expectCookingNights` with cadence +
  budget helpers; replace queue/suggest helpers with `vibeGroup`/`expectVibeInGroup`/
  `expectPinned`/`openRowSuggestion`/`applyRowSuggestion`/`dismissRowSuggestion`/`addGroupSuggestion`.
- [x] 6.2 `profile.spec.ts`: rewrite the retired-control, cadence, budget, grouping/pinned,
  inline add_vibe, adjust_cadence, and no-merge cases; delete the suggest-retirement case.
- [x] 6.3 `seed.mjs` + `seed.d.mts`: seed a meal-vibe palette (six vibes, one pinned + one
  unpinned per group), `cadence` + `weekly_budget` on the profile, and the proposals feed
  (add_vibe / adjust_cadence / prune_vibe targeting seeded vibes; merge absence).

## 7. Spec + validation

- [x] 7.1 Modify the three `member-app-core` requirements (profile / meal-vibe palette /
  reconciliation) per the spec delta.
- [x] 7.2 `openspec validate "profile-planning-and-vibes-ui" --strict`; `build:app`;
  `typecheck`; the full app-ui Playwright suite; `test`; `test:tooling`.
