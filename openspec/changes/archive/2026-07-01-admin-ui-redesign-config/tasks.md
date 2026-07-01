## 1. Backend — extend the floor-confirm gate to Ranking/Flyer

- [x] 1.1 In `src/operator-config.ts`, add `FLOOR_FLYER_REFRESH_HOURS = 6` and `FLOOR_FLYER_BATCH_UNITS = 4` constants (mirroring `discovery-calibration.ts`'s `FLOOR_TASTE`/`FLOOR_DEDUP`/`CEILING_RATE_CAP` naming/placement).
- [x] 1.2 Extend `validateOperatorConfig` to accept an `opts: { confirm?: boolean }` parameter; when `flyerRefreshHours` or `flyerBatchUnits` is present and at/below its new floor and `confirm` is not `true`, return a `ToolError("validation_failed", ..., { field, floor, needsConfirm: true })` — same shape `validateDiscoveryConfig` returns.
- [x] 1.3 Update `src/admin/config-api.ts`'s `putOperatorConfig` to read `body.confirm === true` and pass it through to `validateOperatorConfig`, mirroring `putDiscoveryConfig`.
- [x] 1.4 Add/extend unit tests (`test/operator-config.test.ts` or equivalent) covering: a below-floor `flyerRefreshHours`/`flyerBatchUnits` write is rejected without confirm; the same write succeeds with `confirm:true`; an in-range write unaffected by the new floors behaves exactly as before; a saved below-floor value from before this change is not retroactively rejected on read.

## 2. Kit — shared knob presentation primitive

- [x] 2.1 Add a `Knob`/`KnobRow` presentational component to `src/admin/ui/kit.tsx`: label + numeric input + the existing `Slider` + help text + a conditional below-floor warning line, taking `{key,label,value,min,max,step,floor?,pct?,help}` and an `onChange`-shaped prop contract compatible with island usage (kit stays SSR-safe/no-handler per its convention — confirm whether this needs to live in a client-only sibling instead, since it needs an `onInput` handler; if so, place it in the new shared client module from task 3.1 instead of `kit.tsx`, and only add a purely-presentational read-only variant to `kit.tsx` if one is needed elsewhere).

## 3. Client — shared KnobConsole state machine

- [x] 3.1 Extract `client/calibration.tsx`'s `FormState` union (`clean|dirty|needsConfirm`), `toDraft`/`toPatch`-style helpers, and the Save/Discard/Confirm-and-save button row into a shared module (e.g. `src/admin/client/knob-console.tsx`) parameterized over a generic knob spec and a caller-supplied `save(patch, confirm)` function.
- [x] 3.2 Rewrite `client/calibration.tsx` to consume the shared `KnobConsole` from 3.1, keeping its Discovery-specific Analyze/Dry-run panels and typed-route calls as-is.
- [x] 3.3 Rewrite `client/opconfig.tsx` to consume the shared `KnobConsole`, replacing its current `clean|dirty|saved|error` union with the shared Clean/Dirty/NeedsConfirm union; wire its Save to `PUT /admin/api/operator-config` with the `confirm` flag from task 1.3.
- [x] 3.4 Verify (via the client tsconfig typecheck pass) that a knob with `floor: undefined`/no floor never produces a `below` state, for the ranking knobs that intentionally carry no floor.

## 4. SSR pages — four-group sub-nav

- [x] 4.1 Rewrite `src/admin/pages/config.tsx`'s `VIEWS`/routing to four groups: `""` (Discovery, default), `flyer`, `ranking`, `aliases` — removing the eight-slug flat list.
- [x] 4.2 Discovery group page: compose `getDiscoveryConfig` + `listCorpus(env,"feeds")` + `listCorpus(env,"senders")` + `listCorpus(env,"members")` into one props payload seeding one island (calibration console + Feeds editor + Email Sources editor).
- [x] 4.3 Kroger Flyer group page: compose `getOperatorConfig` (filtered to the flyer field set) + `listCorpus(env,"flyer-terms")` into one props payload.
- [x] 4.4 Ranking group page: `getOperatorConfig` (filtered to the ranking field set) only.
- [x] 4.5 Aliases group page: `listCorpus(env,"aliases")` only, restyled onto the kit (no grouping change from today).
- [x] 4.6 Update the group sub-nav markup to the four group labels/hrefs (`Discovery`, `Kroger Flyer`, `Ranking`, `Aliases`), restyled per the kit's pill/nav pattern.

## 5. Client — Email Sources consolidated editor

- [x] 5.1 Build the Email Sources island (composing two `listCorpus` reads for `members`/`senders`) rendering one interleaved list with a kind badge (`Badge` from the kit) per row.
- [x] 5.2 Wire the add form's kind selector to route `POST` to `/admin/api/corpus/members` or `/admin/api/corpus/senders` based on the selected kind.
- [x] 5.3 Wire per-row remove to `DELETE /admin/api/corpus/members/:key` or `/senders/:key` based on the row's own kind (not the currently-selected add-form kind).
- [x] 5.4 Refetch both tables after any add/remove (per `admin/CLAUDE.md`'s "refetch, don't locally patch" rule) and re-render the merged list.

## 6. Client/SSR — restyle remaining corpus editors onto the kit

- [x] 6.1 Restyle `client/corpus.tsx`'s generic list/add/remove markup (Feeds, Flyer terms, Aliases) onto `DataTable`/`Item`/`Field`/`Badge` kit primitives and Basecoat classes, replacing the hand-rolled `<table class="table">`/`<div class="grid gap-2">` markup.
- [x] 6.2 Keep the Feeds row/drafted-URL "test" action (`POST /admin/api/discovery/test-feed`) working unchanged, restyled onto the kit's row-action affordance.

## 7. Styling

- [x] 7.1 Add/port the mock's `styles.css` layout classes needed for the knob console (`knob`/`knob-head`/`knob-value`/`knob-help`/`knob-floor`) and the group-page section headers (`cfg-section`/`cfg-section-title`/`cfg-section-blurb`), per `admin/CLAUDE.md`'s "Basecoat + Tailwind utilities first, panel CSS only for layout Basecoat lacks" rule.

## 8. Verification

- [x] 8.1 `aubr typecheck` passes both the root and `client/tsconfig.json` passes.
- [x] 8.2 `aubr test` passes, including the new/updated `operator-config` validation tests.
- [x] 8.3 Manually verify in `wrangler dev`: Discovery group shows calibration + Feeds + Email Sources; a below-floor τ requires confirm; a below-floor `flyerRefreshHours` in the Kroger Flyer group requires confirm; Ranking knobs (no floor) save directly at any in-range value; Aliases group unchanged in function; Email Sources add/remove correctly routes to `members`/`senders`.
- [x] 8.4 Update `openspec/specs/operator-admin/spec.md` is NOT edited directly — confirm the delta in `specs/operator-admin/spec.md` archives cleanly (`openspec validate admin-ui-redesign-config --strict`).
