## Context

The Config area is not greenfield. Today it is:

- `src/admin/pages/config.tsx` — 8 flat SSR routes under a `VIEWS` sub-nav: `""` (calibration, default), `ranking`, `flyer`, `aliases`, `flyer-terms`, `feeds`, `senders`, `members`. Each seeds one island via a `<script type="application/json" id="config-props">` block.
- `src/admin/client/calibration.tsx` — the discovery calibration island. It already implements the exact state machine the mock specifies: `FormState = {t:"clean"} | {t:"dirty";draft} | {t:"needsConfirm";draft;warning}`, Save disabled until dirty, a below-floor Save response (`detail.needsConfirm`) surfacing a destructive confirm/cancel pair, plus Analyze and Dry-run preview panels. This is the reference implementation the mock's `KnobConsole` was authored from.
- `src/admin/client/opconfig.tsx` — one generic island shared by Ranking and Flyer. Its save lifecycle is a *different*, weaker union: `{t:"clean"}|{t:"dirty"}|{t:"saved"}|{t:"error";message}` — no `needsConfirm` variant, because `operator-config.ts` has no floor/ceiling concept to trigger one.
- `src/admin/client/corpus.tsx` — one generic island shared by all five corpus tables (aliases, flyer-terms, feeds, senders, members), with an `Action` union (`idle|busy|failed`) for add/remove and a separate `Test` union for the feed prober. Already close to `admin/CLAUDE.md`'s discipline; needs restyling, not rearchitecting.
- `src/admin/config-api.ts` — the typed-route backing (`getDiscoveryConfig`/`putDiscoveryConfig`/`analyzeDiscovery`/`dryRunDiscovery`/`testFeed`/`getOperatorConfig`/`putOperatorConfig`/`listCorpus`/`addCorpus`/`deleteCorpus`) is a thin pass-through to `src/discovery-calibration.ts`, `src/operator-config.ts`, and `src/admin-corpus.ts`. None of these need new operations — `putOperatorConfig` needs its validation call extended to accept and honor a `confirm` flag, mirroring `putDiscoveryConfig`'s existing `confirm` handling.
- `src/discovery-calibration.ts` already has the floor/ceiling precedent this change ports to Ranking/Flyer: `FLOOR_TASTE = 0.2`, `FLOOR_DEDUP = 0.7`, `CEILING_RATE_CAP = 100`, enforced in `validateDiscoveryConfig(patch, {confirm})`, returning `new ToolError("validation_failed", msg, {field, floor|ceiling, needsConfirm: true})` when a floor/ceiling is breached without `confirm:true`.
- `src/operator-config.ts`'s `validateOperatorConfig` only does range checks (`favoriteWeight` in `[0,2]`, etc.) — no floor concept, no `confirm` parameter, no `needsConfirm` error shape. This is the one genuine gap the mock's design (every knob console behaving identically) exposes.

The reference mock (`ConfigScreen.jsx` / `config-data.jsx`) assigns every knob — including Ranking's `overlapCap` and Flyer's `flyerBatchUnits` — a `floor` value and renders the same below-floor warning + destructive confirm for all three groups' consoles uniformly. It does not distinguish "Discovery already has this" from "Ranking/Flyer don't yet" — that distinction is this design's to make explicit.

## Goals / Non-Goals

**Goals:**
- Consolidate the Config sub-nav from 8 flat destinations to 4 groups (Discovery / Kroger Flyer / Ranking / Aliases), matching the mock, with each group's knob console(s) and corpus editor(s) on one screen.
- Extract a `KnobConsole`/`Knob` pair (kit or kit-adjacent) that implements the Clean/Dirty/NeedsConfirm machine once, so Calibration, Ranking, and Flyer share one implementation instead of Calibration having it and Ranking/Flyer lacking it.
- Give Ranking and Flyer knobs real floors, enforced server-side in `operator-config.ts` exactly like `discovery-calibration.ts` does, so the UI's below-floor confirm gate reflects a genuine backend guard, not a decorative one.
- Consolidate the `senders` + `members` corpus tables into one Email Sources editor (member vs. automated-forward), restyling two existing list/add/remove tables into one grouped presentation.
- Restyle every Config surface onto `src/admin/ui/kit.tsx` (Slider, Badge, Item/ItemGroup, DataTable, Field) and Basecoat, replacing today's hand-rolled `<div class="grid gap-2">` forms and plain `<table class="table">` markup.

**Non-Goals:**
- No change to the discovery sweep, its knobs, or `discovery-calibration.ts`'s existing floors — that capability is read-only ground truth here (already has the gate this change ports elsewhere).
- No change to what the corpus tables store or their upsert/insert-or-ignore semantics (`admin-corpus.ts` is untouched) — Email Sources is a presentation grouping of `senders`+`members`, not a schema merge. The two tables remain distinct D1 tables with distinct primary keys; the UI renders them as one list with a `kind` badge, sourced from two reads.
- No new floor/ceiling *values* research beyond porting the mock's per-knob figures — where the mock's `floor` doesn't cleanly map to an existing `operator-config.ts` range check, this design proposes a value (see Decision 2) but flags it as an operator-tunable-later default, not a load-bearing safety constant.
- No change to the Feeds probe (`test-feed`) contract — restyled only.
- The Data area's own corpus tables (a later, separate change per the task brief) are out of scope; this change doesn't touch anything under a prospective `/admin/data` route.

## Decisions

### Decision 1 — `KnobConsole` state machine lives in a shared module, not duplicated per group

`calibration.tsx`'s `FormState` union (`clean | dirty | needsConfirm`) becomes the one shape all three knob consoles use. Rather than three copies, extract:

- A generic `Draft = Record<string, string>` + `FormState<Draft>` union, plus the `save(confirm)`/`onField`/`reset` logic, into a small shared client module (e.g. `src/admin/client/knob-console.tsx` exporting a `useKnobConsole` hook-like function plus a presentational `KnobConsole` component) that both `calibration.tsx` and a rewritten `opconfig.tsx` import.
- The presentational half (label + numeric input + `Slider` + help/floor-warning text per knob) is a `Knob`/`KnobRow` addition to `src/admin/ui/kit.tsx` alongside the existing `Slider`, since it's pure layout over kit primitives with no fetch/state — consistent with the kit's existing "presentational only, SSR-safe" convention. The stateful wrapper (`KnobConsole`, with its Save/Discard/Confirm buttons and dirty tracking) stays in `client/` because it's genuinely interactive (island-only, not SSR-safe) — the kit only gets the row-level presentation.
- Each group's island (Discovery's calibration island, the Ranking island, the Flyer island) supplies its own `knobs: {key,label,step,min,max,floor,pct?,help}[]` spec + its own save/analyze/dry-run wiring; Discovery's island additionally renders the Analyze/Dry-run panels below the shared `KnobConsole`, exactly as `calibration.tsx` does today — that part is Discovery-specific and stays out of the shared piece.

*Alternative considered:* keep `opconfig.tsx` as its own weaker union and just restyle its markup. Rejected — the proposal's whole point is that Ranking/Flyer should get the *same* below-floor confirm behavior Discovery has, not just the same look; sharing the state machine is what makes that guaranteed rather than a maintained-by-hand parallel implementation that can drift.

### Decision 2 — Ranking/Flyer floors: port the mock's values, ported through existing range checks

`operator-config.ts` gains a floor (or ceiling, for `overlapCap`-style caps) per knob, following the discovery precedent's shape:

| Knob | Existing range | New floor | Rationale |
|---|---|---|---|
| `favoriteWeight` | `[0,2]` | `0` (no floor above range min) | Weight already bottoms at "no effect"; nothing below 0 is meaningful, so no additional floor beyond the existing range check. |
| `noveltyBoost` | `[0,2]` | `0` (no floor) | Same reasoning. |
| `pantryWeight` | `[0,2]` | `0` (no floor) | Same reasoning. |
| `perishWeight` | `[0,10]` | `0` (no floor) | Same reasoning — a 0 weight is a legitimate "don't prioritize this" choice, not a footgun. |
| `keyWeight` | `[0,10]` | `0` (no floor) | Same reasoning. |
| `overlapCap` | positive int ≤ 20 | none (no confirm gate) | A cap of 1 is restrictive, not dangerous; no floor warranted. |
| `minFlyerDiscount` | `[0,1]` | none | 0% is "show everything" — a legitimate, non-dangerous choice. |
| `flyerRefreshHours` | int `[1,720]` | **floor 6** (below 6h risks hammering the Kroger flyer endpoint / burning the shared 50-subrequest budget every tick) | Mirrors the mock's `floor: 6` on `flyerRefreshHours`. |
| `flyerBatchUnits` | int `[1,200]` | **ceiling 4 as floor-equivalent? No — port mock's `floor: 4`** (below 4 under-batches, inflating per-tick embedding call overhead) | Mirrors the mock's `floor: 4`. |

Net: of the nine Ranking/Flyer knobs, only `flyerRefreshHours` (floor 6) and `flyerBatchUnits` (floor 4) get a real confirm-gated floor — matching the mock's `config-data.jsx` (`{key:"flyerRefreshHours", floor:6}`, `{key:"flyerBatchUnits", floor:4}`; the ranking knobs' mock floors are all `0`, i.e. inert). This keeps the new backend surface small and honest: it adds exactly the two floors the mock actually specifies as non-zero, rather than inventing floors for knobs where "0" is a legitimate value with no footgun story. `validateOperatorConfig` gets a `confirm` parameter exactly like `validateDiscoveryConfig`'s, and only these two checks consult it.

*Alternative considered:* invent floors for the ranking weights too (e.g. "keyWeight below 0.1 undermines the key-ingredient signal"), to visually match the mock's uniform `KnobConsole` styling for all groups. Rejected — a floor is a safety claim ("this value is dangerous"), not a styling requirement; the UI's `KnobConsole` renders a knob with `floor: 0` exactly like one with no floor risk (the `below` check `value < knob.floor` is never true for a range starting at 0), so the shared component naturally handles "no real floor" without inventing one. Only where `operator-config.ts` truly has a footgun (starving the flyer warm's refresh cadence or under-batching it) does this design add one.

### Decision 3 — Group pages compose multiple SSR reads into one props payload

Each group page (`GroupDiscovery`, `GroupFlyer`, `GroupRanking`, `GroupAliases` — replacing the current one-view-per-route pattern) calls the SSR readers it needs and serializes them together:

- **Discovery** group: `getDiscoveryConfig` (calibration knobs) + `listCorpus(env, "feeds")` + `listCorpus(env, "senders")` + `listCorpus(env, "members")` (the latter two feeding the consolidated Email Sources editor) — four reads, one props block, one island (`client/discovery-config.tsx` or a renamed `calibration.tsx`).
- **Kroger Flyer** group: `getOperatorConfig` (flyer knobs only — the island filters to the flyer field set) + `listCorpus(env, "flyer-terms")`.
- **Ranking** group: `getOperatorConfig` (ranking knobs only).
- **Aliases** group: `listCorpus(env, "aliases")` only — unchanged from today's single-table page, just restyled.

This mirrors the mock's `ConfigScreen.jsx` grouping exactly (`GroupDiscovery`/`GroupFlyer`/`GroupRanking`/`GroupAliases` functions, each composing a `KnobConsole` + zero-or-more `CorpusEditor`/`AlwaysImport` sections under one `<Section>` per sub-block). Routes become `/admin/config` (discovery, default), `/admin/config/flyer`, `/admin/config/ranking`, `/admin/config/aliases` — four routes replacing eight.

*Alternative considered:* keep one route per sub-table (today's shape) and only restyle the visual chrome, with the "group" being purely a client-side tab switch within a single fetched superset. Rejected — the mock's URLs and the `admin/CLAUDE.md` SSR-first convention favor one real route per group (deep-linkable, no client-side data-fetch-on-tab-switch), and four routes is a smaller, more honest surface than eight thin ones.

### Decision 4 — `putOperatorConfig` / `PUT /admin/api/operator-config` gains `confirm`, backward compatible

`config-api.ts`'s `putOperatorConfig` reads `body.confirm === true` (mirroring `putDiscoveryConfig`) and passes `{confirm}` to `validateOperatorConfig`. An existing caller that never sends `confirm` (there are none besides the panel itself, but the route is technically public within Access) behaves exactly as today for every knob except the two new floors — since prior behavior had no floor concept, this is additive: a write that would have succeeded before (because it was in-range) still succeeds now unless it also breaches the new `flyerRefreshHours`/`flyerBatchUnits` floor, in which case it now requires `confirm:true`. This is a narrowing of what previously succeeded silently — flagged in Risks.

### Decision 5 — Email Sources: a distinct island composing two corpus tables, not a merged table

The mock's `AlwaysImport` component abstracts "discovery members" (people in the group) and "automated forwards" (newsletter senders) into one list with a `kind` badge and one add form (address + label + kind selector). The real backend has these as two separate corpus tables (`senders`, `members`) with different columns (`members` today is address-only per `CorpusEditorPage`'s `addFields`; `senders` has `address`+`name`). This design keeps them as two D1 reads/writes behind one presentational list:

- The Email Sources island fetches both `listCorpus(env,"members")` and `listCorpus(env,"senders")` (two SSR reads composed into the group props, per Decision 3), renders them interleaved as one list tagged `member`/`automated`, and routes an add/remove back to the correct underlying table based on which `kind` the operator picked in the add form (`kind: "member"` → `POST/DELETE /admin/api/corpus/members/...`; `kind: "automated"` → `.../senders/...`).
- No new corpus-table union member, no schema change — `isCorpusTable`/`admin-corpus.ts` are untouched. This is presentation-layer composition of two existing endpoints, consistent with the proposal's "restyle, don't rearchitect the backend" framing.

*Alternative considered:* add a `kind` column to a merged table. Rejected as a schema change (out of scope — Non-Goals) for a purely presentational grouping the mock itself calls "abstracted" (see `config-data.jsx`'s own comment: "the discovery members + senders tables, abstracted").

## Risks / Trade-offs

- **[Backward-compatibility narrowing.]** Once `flyerRefreshHours`/`flyerBatchUnits` gain floors, an existing saved config (or a future non-panel API caller) that sets a value below the new floor without `confirm:true` now gets rejected where it previously succeeded. → Mitigation: the floors (6h, 4 units) are the mock's own chosen values and match the "under-batching starves the flyer warm's per-tick budget" story already true of the system; an operator who has already saved a value below these thresholds keeps that saved value (validation only runs on write, not read) and is only asked to confirm on their *next* edit to that field — no silent data loss, no retroactive rejection of stored state.
- **[The "no floor" ranking knobs render the same `KnobConsole` UI as floored ones, just inert.]** An operator seeing five ranking sliders with no floor annotation might wonder if the floor mechanism was simply not wired for Ranking. → Mitigation: `Knob`'s help text still renders per-knob explanatory copy (ported from the mock's `help` strings) even without a floor; the below-floor styling only activates when `value < floor`, which for `floor: 0` fields with a `[0,…]` range is structurally unreachable — this is the same "floor: 0 means no real floor" fact from Decision 2, made visible in copy so it doesn't read as a bug.
- **[One shared `KnobConsole` state machine used by three call sites increases blast radius of a bug in it.]** A defect in the shared Clean/Dirty/NeedsConfirm logic now affects Discovery, Ranking, and Flyer simultaneously, versus today where only Discovery has the fancier state and a Ranking/Flyer bug is contained to the simpler union. → Mitigation: the shared piece is the *exact* logic already shipped and presumably tested in `calibration.tsx` today (extraction, not a rewrite); the group-specific parts (which knobs, which floors, whether Analyze/Dry-run render) stay in each group's own island, so a Ranking-specific defect (e.g. wrong floor value) can't come from the shared module.
- **[Email Sources' two-table composition means one operator "add" action must route to the right table based on a UI-only `kind` selection.]** A mis-routed add (e.g. picking "member" but the backend receiving a `senders` write) would silently land in the wrong table. → Mitigation: this is exactly the shape the mock's own `AlwaysImport` component already handles (a `Select` with `member`/`automated` options gating which array a client-side `add()` pushes to); porting it to two real endpoints instead of one in-memory array is a mechanical substitution, tested by the two-table round-trip (add a member, add an automated forward, confirm each lands in its own table's list on refetch).
