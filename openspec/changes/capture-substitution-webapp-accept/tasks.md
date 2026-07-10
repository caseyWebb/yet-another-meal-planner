Single-surface change, no shared-surface serialization needed. Section 1 is the one-line client wiring; section 2 is its app-suite coverage; section 3 keeps the spec in lockstep. **No spike tasks** — the one open data question (how much signal lives in recipe notes) was settled by a planning-time read against production D1 (10 notes / 2 authors / 0 substitution edges), which is why Thread B is deferred in `design.md` rather than tasked here. No worker code, no migration, no docs-contract change.

## 1. Web-app accept capture (D1–D3)

- [ ] 1.1 In `swapSibling` (`packages/app/src/routes/_app.grocery.tsx`), add `substitutes_for: line.name` to the existing `api.api.grocery.items.$post({ json: { … } })` call, so the cross-ingredient accept annotates its `add_to_grocery_list` with the replaced ingredient. No other client change.
- [ ] 1.2 Confirm the same-identity order-dialog accept (`acceptAlternative`) is untouched and sends no `substitutes_for` — it stays a `place_order` override (D2).

## 2. App-suite coverage (D4)

- [ ] 2.1 Extend `packages/worker/app/visual/specs/substitutions.spec.ts`: intercept `**/api/grocery/items` and assert a cross-ingredient inline accept's `postDataJSON().substitutes_for` equals the replaced line's ingredient, on both an explicit row (add+remove) and a virtual `origin: "plan"` row (materialize+exclude). Reuse the existing `grocery.page.ts` helpers (`acceptSub`, `addRow(name, extra)`, `rowStatus`).
- [ ] 2.2 Assert the same-identity order-dialog accept posts an override with **no** `substitutes_for` (guards D2 from regressing into a spurious edge).
- [ ] 2.3 Run `aubr test:app` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) green; surface the per-area screenshots for review (the `app-ui` CI job publishes them as the PR's sticky screenshot comment).

## 3. Specs (lockstep)

- [ ] 3.1 `member-app-differentiators` deltas authored with this proposal (`specs/member-app-differentiators/spec.md`): the "Acting on a suggestion reuses existing writes only" requirement now has the cross-ingredient accept carry `substitutes_for` and the same-identity accept record no edge; the surfaced-substitution accept scenario's "future trigger" web-app note becomes present-tense. No `ingredient-normalization` delta (capture is already surface-agnostic), no `app-ui-testing` delta (the gate's shape is unchanged; §2 is the feature's coverage under the existing "an app change ships with its Playwright coverage" rule).

## 4. Acceptance (gates before PR)

- [ ] 4.1 `openspec validate "capture-substitution-webapp-accept" --strict` passes. (If the `openspec` CLI is unavailable in the session, hand-check delta format against the archived converge change: `## MODIFIED Requirements` header, `### Requirement:`, four-hash `#### Scenario:`, `**WHEN**`/`**THEN**` bullets.)
- [ ] 4.2 `aubr typecheck` and `aubr test:app` green.
- [ ] 4.3 Post-deploy verification: a real cross-ingredient accept in the web app mints or accrues an operator-global `substitution` edge (confirm against production D1 that `ingredient_edge` gains a `kind='substitution'` row for the accepted pair). This is the acceptance fixture — the production graph converges through the shipped surface, not manual surgery.
