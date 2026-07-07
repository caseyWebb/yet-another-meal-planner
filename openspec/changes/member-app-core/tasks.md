# Tasks — member-app-core

Ordered **Worker-first**: the behavior-preserving op extractions and the three contract changes
(§1–§4) land and are fully unit-tested before the route groups (§5) and the pages (§6–§7), so the
frontend binds to a finished API. Implementation is **serial** across the shared Worker surfaces
(`session-db.ts`, `grocery.ts`, `meal-plan.ts`, the tool registration files, `docs/`); page work
within §7 parallelizes freely. **No spike tasks** — every open question is settled in design.md
(D1–D14) against the code and the production spike. Assumes the P0 foundations (proposal.md
"Dependency"); tasks name P0 pieces by role.

## 1. Worker: op extraction (zero behavior change)

- [x] 1.1 Extract `readRecipeDetail(env, tenant, slug)` from the `read_recipe` closure
  (`packages/worker/src/tools.ts`): corpus read (`readCorpusFile`) + `parseMarkdown` +
  `mergeOverlay` + `recipeDescription`, throwing the same `not_found`. Re-point the tool at it.
- [x] 1.2 Extract `logCooked(env, tenant, entry, opts?)` from the `log_cooked` closure
  (`packages/worker/src/cooking-write.ts`): `validateNewEntry` + slug check + the
  `satisfied_vibe` stamp (read `meal_plan.from_vibe` before the clear) + the log-insert /
  plan-clear single batch. Add `opts.dedupe?: boolean` (default false — tool behavior
  unchanged): when true, an existing identical `(tenant, date, type, recipe|name)` row
  short-circuits to `{ logged, deduped: true }` with no insert (D8).
- [x] 1.3 Extract `applyPreferencesPatch(env, tenant, patch)` from the `update_preferences`
  closure (`packages/worker/src/write-tools.ts`): `rejectUnknownPatchKeys` + `mergePatch` +
  `validatePreferences` + the `profileUpsertStmt`/`brandStmt` batch. Re-point the tool.
- [x] 1.4 Extract `assembleUserProfile(env, tenant)` from the `read_user_profile` closure
  (`packages/worker/src/tools.ts`): `readProfile` + the `initialized`/`missing` computation.
- [x] 1.5 Extract `addNightVibe(env, tenant, spec)` / `patchNightVibe(env, tenant, id, patch)`
  from the `add_night_vibe`/`update_night_vibe` closures
  (`packages/worker/src/night-vibe-tools.ts`): id slugify + `conflict` on duplicate;
  read-merge-upsert preserving un-passed fields.
- [x] 1.6 Extract `resolveProposal(env, tenant, id, accept)` from the `confirm_proposal` closure
  (`packages/worker/src/reconcile-tools.ts`): `getProposal` (+ `not_found`), accept →
  `applyProposal` + `setProposalStatus("accepted")`, reject → `setProposalStatus("rejected")`;
  an already-resolved proposal → structured `conflict` (D8 idempotency).
- [x] 1.7 Extract the plan-add composition `applyMealPlanOpsForTenant(env, tenant, ops)` from the
  `update_meal_plan` closure (`packages/worker/src/cooking-tools.ts`): `applyMealPlanRowOps` +
  `stampLastPlanned` when any add applied — so the route cannot skip the new-for-me watermark.
- [x] 1.8 `aubr typecheck` + `aubr test` green with **no test edits** except imports — the
  extractions are behavior-preserving; add small unit tests for `logCooked` dedupe-off parity
  and `resolveProposal` double-confirm `conflict`.

## 2. Worker: W3 — grocery `status` transition guard (D1)

- [x] 2.1 In `packages/worker/src/grocery.ts`, add the pure transition check (e.g.
  `illegalStatusTransition(current: GroceryStatus, next: GroceryStatus): string | null`):
  entering `ordered` is legal iff `current === "in_cart"`; all `active ⇄ in_cart` writes (and
  `ordered → active|in_cart` re-listing) are legal. Unit-test the matrix.
- [x] 2.2 In `updateGroceryRow` (`packages/worker/src/session-db.ts`), enforce it before
  persisting: violation → `ToolError("validation_failed", …, { name, from, to })`, row
  unchanged. On the legal `in_cart → ordered` advance, stamp `ordered_at` = today (parity with
  `advanceOrderedRows`).
- [x] 2.3 Update the `update_grocery_list` tool **description** (`grocery-tools.ts`) to state the
  guarantee: `active ⇄ in_cart` freely writable; `status: "ordered"` accepted only as the
  user-asserted advance from `in_cart` (stamps `ordered_at`); any other `ordered` write returns
  a structured `validation_failed` and changes nothing. Fix the module header comment (it
  currently misstates the lifecycle).
- [x] 2.4 Worker tests: `active → ordered` rejected with `validation_failed` + `{from, to}`
  context and the row unchanged; `in_cart → ordered` accepted and `ordered_at` stamped;
  `active ⇄ in_cart` both ways unchanged; `ordered → active` re-listing allowed;
  `advanceInCartRows`/`advanceOrderedRows` behavior untouched (existing tests stay green).
- [x] 2.5 `docs/TOOLS.md`: rewrite the `update_grocery_list` entry + the grocery lifecycle notes
  (the `place_order` section's user-asserted-transitions text) to state the guard as current
  behavior — no history narration.

## 3. Worker: `update_meal_plan` `set` op (D3)

- [ ] 3.1 In `packages/worker/src/meal-plan.ts`, add the `set` variant to `MealPlanOp` and
  `applyMealPlanOps`: targets an existing row by slug (absent → per-op conflict); `sides`
  supplied ⇒ replaced wholesale (empty ⇒ removed); `planned_for: null` ⇒ cleared, string ⇒ set,
  absent ⇒ preserved; `from_vibe` preserved unless supplied. Unit tests: remove one side, clear
  a date, set on absent row conflicts, `add` semantics untouched.
- [ ] 3.2 Thread `set` through `applyMealPlanRowOps` (`session-db.ts`) — the upsert statement
  already writes the full row, so this is op-plumbing only; test a `set` persists and preserves
  `from_vibe`.
- [ ] 3.3 Expose `set` on the MCP `update_meal_plan` schema (`cooking-tools.ts`) with a
  description stating replace-wholesale/explicit-clear semantics; update `docs/TOOLS.md` in the
  same pass.

## 4. Worker: cooking-log list + delete ops (D4)

- [ ] 4.1 Add `readCookingLog(env, tenant, { limit })` (beside `loadRetrospective` in
  `packages/worker/src/cooking-tools.ts`, all D1 via `src/db.ts`): most-recent-first
  (`date DESC, id DESC`), bounded, recipe rows enriched with `title`/`protein`/`cuisine` via the
  existing `LEFT JOIN recipes` COALESCE idiom. Returns `id` per row.
- [ ] 4.2 Add `deleteCookingLogRow(env, tenant, id)`: tenant-scoped `DELETE … WHERE tenant=? AND
  id=?`, returning found/not. No MCP tool (web-only, D4).
- [ ] 4.3 Tests: list order + enrichment + bound; delete removes only the caller's row; derived
  `last_cooked` (MAX(date)) reflects a deletion on the next read.

## 5. Worker: the `/api` member route groups

- [ ] 5.1 Create the per-area route modules under `packages/worker/src/api/` (one file per area:
  `cookbook.ts`, `overlay.ts`, `plan.ts`, `grocery.ts`, `pantry.ts`, `log.ts`, `profile.ts`,
  `vibes.ts`), each a chained Hono group mounted by the P0 `/api` app (admin-app idiom:
  chain routes, `export type` per area for `hc`; all handlers call the design.md
  page→endpoint→op map's named ops — no `env.DB` access, no inline tool logic).
- [ ] 5.2 Extend the **P0-owned shared `/api` error middleware's** code→status table with the
  mappings P1 introduces (D8): `conflict`→409 — and **412** when the conflict is a failed
  `If-Match` precondition — `insufficient_permission`→403, `reauth_required`→401. P0's table
  ships only `validation_failed`→400, `not_found`→404, `unsupported`→405, the storage
  class→503, and the API-layer `unauthorized`→401 / `csrf_rejected`→403 / `rate_limited`→429;
  these additions land in the **shared** table (never per-route), anything unmapped stays 500,
  and bodies keep the structured code. Unit-test each new mapping.
- [ ] 5.3 Wire the D8 write-class mechanics: class (a) routes (`PATCH /profile/preferences`,
  `PUT /profile/taste`, `PUT /profile/diet-principles`, `PATCH /vibes/:id`) require `If-Match`
  against the current representation hash → 412 + structured `conflict` on mismatch; class (b)
  routes never check `If-Match`. `PATCH /grocery/items/:name` validates `status ∈
  {active, in_cart}` at the boundary (the op-layer guard backstops).
- [ ] 5.4 `POST /api/vibes/suggest` (D7): `readJobHealth("archetype-derive")` — ok and within the
  derivation interval (~20h, the cron's constant) ⇒ `{ throttled: true, retry_after_ms }` with
  **no** `runDerivation` call; else `runDerivation(env, tenant.id, seed, max)` →
  `{ candidates, enqueued }`.
- [ ] 5.5 Per-route analytics to the existing `TOOL_AE` dataset (or a sibling blob shape) so app
  usage sits beside tool usage.
- [ ] 5.6 Worker tests (route level, `app.request` idiom): each area's happy path returns the
  op's data; a `ToolError` surfaces as its mapped status + structured body; 412 on stale
  `If-Match`; the suggest gate throttles without touching AI (assert via a stubbed
  `runDerivation`); the grocery route rejects `status: "ordered"` at the boundary.

## 6. packages/ui: shared components for the member pages

- [ ] 6.1 From the design bundle (`docs/plans/web-app-design/project/cookbook/app.css` + `ds/`),
  add the shared primitives P1 needs to `packages/ui` (Basecoat → shadcn/ui mapping, tokens
  already established by P0): recipe row + facet chips, page head, empty-state block,
  breadcrumb, token/chip fields, segmented control, combobox (recipe/side pickers), toast,
  card, icon set. Match the mock's markup/visual output, not its internals.

## 7. packages/app: pages (design bundle, pixel-matched; dependency order)

- [ ] 7.1 App shell: sidebar (Cookbook / Favorites / Meal plan / Grocery / Pantry / Cooking log,
  client-derived counts), account menu (profile link, Kroger badge from `GET /api/profile`,
  sign out), theme toggle; TanStack Router routes for all P1 pages; area query hooks over the
  typed `hc` client (short `staleTime` + `refetchOnWindowFocus` per plan §6).
- [ ] 7.2 Login restyle per the design card — single invite-code field over P0's session POST
  (D13; no roster, no password).
- [ ] 7.3 Cookbook browse + in-place search: "New for you" (new-for-me) + all-recipes sections
  (D5), debounced search over `GET /api/cookbook/search`, row actions (favorite set,
  plan-toggle via plan ops).
- [ ] 7.4 Recipe detail: title/facets/time/source, **Cook with Claude** deep link
  (`https://claude.ai/new?q=` + encoded `/cook <slug>`), add-to-plan, log-as-cooked, favorite;
  markdown body render; notes section (own editable incl. private, community read-only, D14);
  Similar recipes.
- [ ] 7.5 Favorites page (overlay ∩ index, empty state).
- [ ] 7.6 Meal plan page: scheduled/unscheduled groups, date set/clear + side add/remove via the
  `set` op (D3), remove, add-recipe combobox. No "Plan my week" entry point (P2).
- [ ] 7.7 Grocery page (D9): category groups, bottom add-row, in-cart set (optimistic), remove,
  source facet + `for_recipes` links, "In cart" group + "Clear purchased" (remove each
  `in_cart` row).
- [ ] 7.8 Pantry page: needs-verification section (perishable categories + stale threshold,
  client-derived like the mock), category groups, add form, qty edit (pantry `add` upsert),
  verify, remove. Must stay comfortable at ~100+ rows/tenant (production spike).
- [ ] 7.9 Cooking log page: most-recent-first list (title links for recipe rows, facet chips,
  non-cooked type badges), log-a-cook select → `POST /api/log`, per-row remove.
- [ ] 7.10 Profile page — Taste tab: derived taste read from `GET /api/profile/retrospective` +
  overlay favorites; `taste` and `diet_principles` markdown editors with If-Match
  rebase-on-412 (D8, D10); read-only owned-equipment card.
- [ ] 7.11 Profile page — Preferences tab: planning knobs, `lunch_strategy` single-select over
  the real vocab (D10), dietary token fields, stores + ZIP, ranked brands (merge-patch with
  If-Match rebase).
- [ ] 7.12 Profile page — Night vibes tab: palette rows (production vocab per D11, debt meter
  from derived `last_satisfied`), add/edit/delete forms, the reconciliation queue with
  kind-specific actions (D12) rendering dozens of pending rows sanely, and the gated
  "Suggest from your cooking" button (throttled state surfaced quietly) (D7).
- [ ] 7.13 Every class (b) mutation is an explicit-set optimistic mutation keyed on its canonical
  id (D8) — verify replaying any mutation twice converges (unit-level test on the mutation fns).

## 8. Playwright coverage (blocking, per the P0 harness)

- [ ] 8.1 Page objects + specs for every P1 page (browse/search, detail incl. notes + similar,
  favorites, plan incl. side-remove + date-clear, grocery incl. in-cart + clear-purchased +
  the status-guard error path, pantry incl. verify, log incl. add + delete, profile tabs incl.
  a 412 rebase flow, palette + queue incl. confirm/dismiss and the throttled suggest state),
  with seeded data covering the production-observed states (empty palette + pending proposals;
  near-empty log).
- [ ] 8.2 Run the suite (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` in web sessions) and surface
  the per-area screenshots for review; CI job stays blocking.

## 9. Docs (lockstep, same pass)

- [ ] 9.1 `docs/TOOLS.md`: `update_grocery_list` guard (§2.5) and `update_meal_plan` `set` op
  (§3.3) — written as current behavior.
- [ ] 9.2 `docs/ARCHITECTURE.md`: the member app's P1 surface — the per-area `/api` route groups
  over shared ops, the write-class posture, the gated suggest endpoint. (`docs/SCHEMAS.md`
  untouched — no schema change; state verified.)
- [ ] 9.3 Confirm `AGENT_INSTRUCTIONS.md` needs no edit: the documented user-asserted
  `in_cart → ordered` advance remains valid under the guard (D1). If any persona text asserts
  an unguarded transition, correct it in the same pass.
