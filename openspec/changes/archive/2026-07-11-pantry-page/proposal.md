# Proposal — pantry-page

## Why

Band 1 (`pantry-disposition-foundations`) landed the entire backend for the page-06 pantry
redesign: `GET /api/pantry` serves `location`; `POST /api/pantry/ops` accepts
`op:"dispose"` with `disposition: used|waste`, a required `reason` from the canonical
`WASTE_REASONS` enum, an idempotent client-minted `event_id`, and `occurred_at`; the
`location`/`category` split, the D17 `stampDepartment` funnel, and the ingredient-category
cron that autofills categories are all shipped. What is still the pre-split single-row form
is the member-facing surface. This change is the band-2 FRONTEND that consumes that
contract: the multi-item add grid, the group-by Category|Location view, and disposition-based
removal (Used / Mark-as-waste), plus one small vocabulary lift so the app and the Worker share
a single source for the three controlled arrays.

## What Changes

- **The pantry page (`packages/app/src/routes/_app.pantry.tsx`) is rewritten** to page 06 §2:
  - The needs-verification section is UNCHANGED (perishable categories `{produce, dairy,
    seafood, meat}` + a 7-day staleness threshold, client-derived from served fields); its bare
    trash stays — there it is verification cleanup, not a disposition.
  - A **multi-item add grid** (ITEM / QTY / CATEGORY / LOCATION) with `<datalist>` suggestions
    over the controlled vocab, a fresh row appending as the last row gets a name, per-row
    remove, Clear, and an "Add N items" commit firing ONE batch of `add` ops. A blank category
    commits as "auto" — the server's D17 funnel/cron is authoritative; any client-side
    recognition that pre-fills category/location is UX-only and never clobbers a typed override.
  - A **group-by toggle** (Category alphabetical | Location in the fixed vocabulary order).
  - **Item rows** carry a relative verified stamp, an editable qty (the `add` upsert), a
    re-verify icon that hides once verified today, and a **Used split button** — primary Used
    fires `dispose{disposition:"used"}` (an idempotent delete), its menu opens the waste modal.
    Regular rows carry NO bare trash. `prepared_from` rows use the same dispose flow.
  - A **waste modal** ("Toss '{item}'") offering all 10 canonical `WASTE_REASONS` as a
    single-tap reason list; on tap it mints an `event_id`, stamps `occurred_at`, fires
    `dispose{disposition:"waste", reason, event_id, occurred_at}`, and removes the row. No
    value/price is ever asked (the event's value is derived later from spend history).
- **The three controlled vocabularies lift into `@yamp/contract`** (`packages/contract/src/pantry.ts`):
  `PANTRY_CATEGORIES`, `PANTRY_LOCATIONS`, `WASTE_REASONS` become the single source; the Worker's
  `src/department.ts` re-exports them (its existing importers are untouched) and the member app
  imports them directly for its dropdowns and waste modal.
- **`packages/satellite` version bumps 0.1.14 → 0.1.15** — a `packages/contract/**` change trips
  the `satellite-version` CI gate, which requires a strictly-greater satellite version.
- Playwright coverage (`app/visual/pages/pantry.page.ts`, `specs/pantry.spec.ts`) and the app
  pantry seed rows are updated for the grid, the group-by view, and the dispositions.

## Non-goals / explicitly unchanged

- **No Worker route, D1 schema, MCP tool, `docs/TOOLS.md`, or `docs/SCHEMAS.md` change.** Every
  behavior this page needs already shipped in band 1 (`GET /api/pantry` → `location`;
  `POST /api/pantry/ops` → `dispose`; `WASTE_REASONS`; `PANTRY_LOCATIONS`/`PANTRY_CATEGORIES`;
  server-side `stampDepartment` + the ingredient-category cron are the autofill funnel). This
  change is frontend + the contract vocab lift + the satellite version bump only.
- **No new persisted read endpoint for autofill** (page 06 open question 3, decided D17): the
  server-side ingredient-identity funnel is the authority; the client offers the controlled
  vocab via datalists and any recognition is non-authoritative UX.
- **No new offline mutation key.** Both the disposition write and the multi-add batch ride the
  already-registered `["pantry","ops"]` class (b) key.
- **`Used` is a pure removal.** Partial-use decrement and a consumption signal are out of scope
  (qty stays editable in-row); page 06 open questions 1–2.

## Spec deltas

- `member-app-core` MODIFIES "Pantry page over row-level ops": adds the group-by dimension, the
  multi-add grid with funnel autofill, and disposition-based removal, while keeping the
  needs-verification section.
- `member-app-offline` MODIFIES "Class (b) writes queue offline and replay on reconnect" to
  restore the band-1 pantry-dispose class-(b) language (keyed on the client-minted waste
  `event_id`, `occurred_at` stamped at tap time) and its "An offline waste disposition replays
  without double-counting" scenario — a real regression a later band-1 archive clobbered from the
  live spec.
