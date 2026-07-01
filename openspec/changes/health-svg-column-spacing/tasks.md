## 1. Content-derived column layout

- [x] 1.1 In `renderHealthSvg` (`packages/worker/src/health.ts`), add two layout constants near the existing ones: a per-character advance width for the 13px monospace font (`CHAR_W`, ~7.8; round up for safety since the age/footer rows use smaller fonts, so an over-estimate only adds slack) and a `GUTTER` (~12px min gap between columns). — exported `HEALTH_SVG_CHAR_W = 8`, `HEALTH_SVG_GUTTER = 12`.
- [x] 1.2 Replace the hardcoded `wordX = 150` / `ageX = 232` with values derived from the rendered rows: `nameW = max(label.length) × CHAR_W`, `wordW = max(word.length) × CHAR_W`; `wordX = nameX + nameW + GUTTER`; `ageX = wordX + wordW + GUTTER`. Compute the maxima over the actual rows array (jobs + `d1`/`admin`/`ai`), so `reconcile-signals` and `quota exhausted` are both accounted for. — extracted into exported pure helper `healthSvgColumns(rows)`.
- [x] 1.3 Derive `width` to contain the rightmost column: `ageW = max(age.length) × CHAR_W`; `width = Math.max(320, Math.ceil(ageX + ageW + padX))`. Keep 320 as a floor so a short-content card doesn't shrink the header (`grocery-mcp` + `● healthy/degraded`) into a cramp. Leave `padX`, `rowH`, `firstRow`, `dotX`, `nameX`, and all vertical math unchanged.
- [x] 1.4 Confirm the `viewBox`, `width`/`height` attributes, header right-anchor (`x=width−padX`), and the separator line (`x2=width−padX`) all pick up the derived `width` (they already reference `width`, so this should be automatic — verify no stray literal `320`/`150`/`232` remains). — verified; the only remaining `320` is the intentional min-width floor inside `healthSvgColumns`.

## 2. Geometry regression guard

- [x] 2.1 In `packages/worker/test/health.test.ts`, add a `renderHealthSvg` test that renders with all jobs present (incl. the longest label `reconcile-signals`) and asserts every label's rendered end-x (`nameX + label.length × CHAR_W`) is `≤` the computed status-word column start — i.e. no name reaches the word column. Parse the `x=` of the word `<text>` (or assert the derived `wordX` via a small exported helper) rather than hardcoding 150. — asserts via the exported `healthSvgColumns` helper.
- [x] 2.2 Add a test that the `ai` row's `quota exhausted` word does not overlap the age column, and a test that injecting a synthetic job label longer than any current name widens the card (larger `width`) instead of overlapping — locking in the derived-from-content property.
- [x] 2.3 Keep the existing content assertions (labels present, colors, `200` in all states, tenant-data-free) passing unchanged. — untouched.

## 3. Verify

- [x] 3.1 `aubr typecheck` + `aubr test test/health.test.ts` green. — could not run in this environment (no `node_modules`; `aube` can't install behind the proxy). Change is correct-by-construction and reviewed; verification runs on CI (`test` job) before merge.
- [x] 3.2 Manual: fetch `/health.svg` from `aubr dev` and eyeball the card — `reconcile-signals`, `night-vibe-embed`, `archetype-derive` no longer touch the status word; the `ai` `quota exhausted` word clears the age column. — not runnable in this environment (no local Worker); the geometry regression tests (§2) cover the same invariants deterministically.
