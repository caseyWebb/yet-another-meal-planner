# Tasks

Prerequisite (satisfied): `rewrite-admin-panel-to-hono` is cut over and archived — Hono serves all of `/admin`; Elm and the Dev tool console are removed.

## 1. Foundation
- [ ] Add `tailwindcss`, `@tailwindcss/cli`, `basecoat-css` as **devDependencies** (pin exact versions); confirm `aube install` pulls the prebuilt `@tailwindcss/oxide` platform binary, and add it to `aube.allowBuilds` only if an install hook actually requires it (it did not in the spike)
- [ ] Create the Tailwind entry CSS (`@import "tailwindcss"; @import "basecoat-css/vega"; @source "../**/*.tsx";`) and a thin project layer: override `--primary` (and friends) to the operator orange + keep only the genuinely panel-specific layout (the master/detail grids `.workbench`/`.logs`, status dots)
- [ ] Add the Tailwind compile to `scripts/build-admin.mjs` → `admin/dist/admin/styles.css` (gitignored build artifact), replacing the stylesheet copy; the CSS compiles as part of `node scripts/build-admin.mjs` (run by CI, the deploy, and local dev) with **no network fetch**; verify it builds offline
- [ ] Rewrite `src/admin/ui/kit.tsx` to the Basecoat API (typed props unchanged): `Button` (`class="btn"` + `data-variant`/`data-size`), `Card`, `Field` (`label`+`input`), `ErrorBanner`→`alert`, `Table`→`table`, `TierBadge`→`badge` variants, `Pill`→badge/nav, `Dot` (keep), `Dialog`→native `<dialog>` + `showModal()`
- [ ] Document the Basecoat authoring idiom in `src/admin/CLAUDE.md`: component classes + `data-variant`/`data-size` + Tailwind utilities for layout; **no Basecoat component JavaScript**; islands own interactivity in `hono/jsx/dom` state

## 2. Status (thin vertical — prove the look end-to-end)
- [ ] Restyle the Status home (`src/admin/pages/status.tsx`): headline card, per-job rows, D1/admin-gate rows, dots → Basecoat card/badge + utilities; triage keep/simplify/drop

## 3. Members (first island restyle)
- [ ] Restyle the Members page + island (`pages/members.tsx`, `client/members.tsx`): table, onboard form, once-shown banner→`alert`, row actions → Basecoat kit; banner stays inline (no Toast JS); confirm island behavior (onboard/rotate/revoke/kroger) unchanged

## 4. Read-only areas
- [ ] Data explorer (`pages/data.tsx`, 5 views): card/table/badge + tab/nav utilities; triage which of the 5 views earn their keep
- [ ] Usage dashboards (`pages/usage.tsx`): card/badge + keep the custom sparkline viz; triage setup-card states

## 5. Logs
- [ ] Logs master/detail (`pages/logs.tsx`, `client/logs.tsx`): card/table + native `<dialog>` for the detail (drop the bespoke `.dialog-backdrop`/`.dialog`); row-action (retry/delete) island behavior unchanged

## 6. Config (form-heavy — highest payoff, last)
- [ ] Calibration console + ranking/flyer forms + corpus editors (`pages/config.tsx`, `client/calibration.tsx`, `client/corpus.tsx`, `client/opconfig.tsx`): Basecoat form components (input/label/native-select/switch) + form layout; the `Clean|Dirty|NeedsConfirm` form-machine + add/remove island behavior unchanged

## 7. Cleanup + docs
- [ ] Remove the dead hand-rolled component classes from `src/admin/styles.css` (only the thin project theme + layout layer remains); confirm no orphaned class references across `src/admin/**`
- [ ] Update `docs/ARCHITECTURE.md` + `CONTRIBUTING.md` admin-build references for the Tailwind step in lockstep; `aubr typecheck` + `aubr test` green and `node scripts/build-admin.mjs` builds clean (admin/dist is gitignored — nothing to commit)

## 8. Visual regression (optional — the rewrite deferred this harness wholesale; MAY be a separate change)
- [ ] Stand up the Playwright harness: config + a CI job spinning up a `wrangler dev` preview, rendered in the pinned Playwright container, screenshot/diff images uploaded as PR artifacts
- [ ] Commit visual-snapshot baselines against the final Basecoat look (incl. open-dialog + confirm states)
