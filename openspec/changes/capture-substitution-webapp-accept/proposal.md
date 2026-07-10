# Broaden taste-substitution capture: the web-app one-tap accept

## Why

Taste-substitution edge capture shipped in `converge-meal-planning-surfaces` (#247) as a **single agent-side signal**: Claude passes `substitutes_for` on `add_to_grocery_list` when a member accepts a swap it suggested, and the shared write path (`addGroceryRow` → `captureSubstitution`) records an operator-global `substitution` edge — born a candidate, promoting on repeated observation, excluded from `satisfies()` reachability. Two more capture sources were deferred (design D6): the member web app's one-tap accept, and a cook-log "what did you actually use" field.

The member web app already surfaces cross-ingredient alternatives **inline** on the to-buy list (the `member-app-differentiators` depth-1 substitution walk) and lets the member accept one in a single tap. That accept already performs the correct writes — `add_to_grocery_list(Y)` + `remove_from_grocery_list(X)` on an explicit row, or a materialize-add + order-scoped `exclude` on a virtual row — but it does **not** annotate the add with `substitutes_for`. So a swap a member accepts *in the app* is applied but **forgotten**, while the identical swap accepted *through Claude* is captured. The backend hook is already surface-agnostic: `POST /api/grocery/items` reads and forwards `substitutes_for` today (`src/api/grocery.ts`), and `captureSubstitution` is best-effort and guards cross-ingredient-only with pure set logic. The shipped design explicitly named this accept "a future trigger onto that same `substitutes_for` path."

This change wires that trigger — a second **behavioral** capture surface at near-zero cost — and records the exploration's conclusion on the third source (mining recipe-note prose) as a deferred design memo rather than building it, because the production note corpus is far too thin to justify it today (10 notes, 2 authors) and it is the one source that touches the determinism boundary.

## What Changes

- **The web-app cross-ingredient accept captures the swap.** The grocery page's inline "Swap" action (`swapSibling` in `packages/app/src/routes/_app.grocery.tsx`) SHALL annotate its `add_to_grocery_list` with `substitutes_for` set to the replaced line's ingredient, so a cross-ingredient substitution accepted in the app feeds the operator-global `substitution` graph exactly as the agent-side accept does. It is an **optional annotation on an existing write** — no new write operation, no new backend, no schema change.
- **The same-identity path stays edge-free.** The order-dialog accept (`acceptAlternative`, a `place_order` SKU override on the same canonical identity) is unchanged and records no edge — a product/price pick is not a taste substitution. This is enforced twice: structurally (a different code path) and by `captureSubstitution`'s server-side set-logic gate.
- **App-suite coverage.** The member app's Playwright suite (`packages/worker/app/visual/`) gains coverage asserting the cross-ingredient accept posts `substitutes_for` (the replaced ingredient) and that the same-identity path does not — extending the existing `substitutions.spec.ts`.
- **Comment-mining deferred with a documented boundary.** Thread B — a cron that mines recipe notes for substitution prose — is captured in `design.md` as a deferred memo (the determinism-boundary resolution, the qualifier-enrichment-vs-candidate-minting split, the self-corroboration defect, the mechanism reframe, and a concrete volume trigger). Not built here.

## Capabilities

### Modified Capabilities

- `member-app-differentiators`: the inline cross-ingredient accept now carries `substitutes_for` so the accepted taste swap is captured through the shared `ingredient-normalization` hook; the same-identity order-override accept explicitly records no edge; and the surfaced-substitution accept scenario's "future trigger" web-app note becomes present-tense (both surfaces feed one operator-global graph).

## Impact

- **Code:** `packages/app/src/routes/_app.grocery.tsx` — one field on the `swapSibling` add. App-suite specs under `packages/worker/app/visual/`. **No worker code, no migration, no docs-contract change** — `substitutes_for` already exists on the `add_to_grocery_list` tool, the `POST /api/grocery/items` route, and in `docs/TOOLS.md`/`docs/SCHEMAS.md`.
- **Data:** more operator-global `substitution` edges accrue (production currently holds **zero**, expected — #247 merged 2026-07-09). No per-tenant data touched.
- **Boundary:** none crossed. This is deterministic behavioral observation, squarely inside the shipped `ingredient-normalization` capture-first requirement and ADR-0001's 2026-07-09 amendment. No ADR amendment needed.

## Dependency

Builds on `converge-meal-planning-surfaces` (#247): the `substitution` edge kind (migration 0048), `captureSubstitution` (`src/corpus-db.ts`), the surface-agnostic `substitutes_for` hook on `addGroceryRow` (`src/session-db.ts`) and `POST /api/grocery/items` (`src/api/grocery.ts`), and the inline substitute-hint walk (`src/substitute-annotator.ts`). No other change depends on this one.
