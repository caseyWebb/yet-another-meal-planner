# Tasks

Prerequisite (satisfied): `rewrite-admin-panel-to-hono` is cut over and archived — Hono serves all of `/admin`; Elm and the Dev tool console are removed.

## 1. Foundation
- [x] Add `tailwindcss`, `@tailwindcss/cli`, `basecoat-css` as **devDependencies** (`aube add -D`; `^` ranges per repo convention, the lockfile pins). `@tailwindcss/oxide` prebuilt binary landed in aube's virtual store — no `allowBuilds` entry needed (the only ignored build is `@parcel/watcher`, a watch-mode-only transitive the one-shot CSS build never invokes)
- [x] Create the Tailwind entry CSS (`@import "tailwindcss"; @import "basecoat-css/vega"; @source "./";`) with `--primary` overridden to the operator orange. Kept the panel-specific layout + a **transitional bridge** (`@layer base` bare-element rules + `@layer components` panel classes) so unmigrated pages render as before; renamed the two colliding selectors `.card`→`.card-legacy`, `.dialog`→`.dialog-legacy` (Basecoat owns the canonical names). Bridge is dropped page-by-page, fully in Phase 7
- [x] Add the Tailwind compile to `scripts/build-admin.mjs` → `admin/dist/admin/styles.css` (gitignored build artifact), replacing the stylesheet copy; the CSS compiles as part of `node scripts/build-admin.mjs` (run by CI, the deploy, and local dev) with **no network fetch** — verified: builds offline in ~680 ms, 24.5 kB gzipped, `aubr typecheck` + 1025 tests green
- [x] Rewrite `src/admin/ui/kit.tsx` to the Basecoat API: `Button` (`btn` + `data-variant`/`data-size`), `Card` (`card`/`section`), `Field` (`label`+`input`), `ErrorBanner`→`alert`, `Table`→`table`, `Dialog`→native `<dialog>`. Kept `Dot`/`TierBadge`/`Pill` on panel-specific semantic styling (Basecoat has no green/amber status badge or nav-pill). **Playwright-verified**: Members (the kit's only consumer) renders the Basecoat card; island still works via the bridge
- [x] Document the Basecoat authoring idiom in `src/admin/CLAUDE.md`: component classes + `data-variant`/`data-size` + Tailwind utilities for layout; **no Basecoat component JavaScript** (native `<dialog>`); islands own interactivity in `hono/jsx/dom` state; the transitional `-legacy` bridge

## 2. Status (thin vertical — prove the look end-to-end)
- [x] Restyle the Status home (`src/admin/pages/status.tsx`): warnings → Basecoat `alert` (destructive, inline Lucide icon), headline + job cards → Basecoat `card`/`section`, Refresh → `btn` ghost; kept the custom status-row/dot UI. **Playwright-verified** against `wrangler dev` (before/after screenshots)

## 3. Members (first island restyle)
- [x] Restyle the Members island (`client/members.tsx`): onboard form (`input`+`btn`), table (`table`), row actions (`btn` ghost for rotate/kroger, `btn` destructive for revoke), failure → `alert`. Kept the `.minted` credentials callout as a panel-specific keep (its key/value layout doesn't fit a plain alert). Island behavior (onboard/rotate/revoke/kroger) unchanged. **Playwright-verified** (seeded members) — and caught + fixed a real bug: scoped the `@layer base` bridge `:not(.btn)`/`:not(.input)`/… so it never bleeds into a Basecoat component (protects every remaining migration)

## 4. Read-only areas
- [x] Data explorer (`pages/data.tsx`, 5 views): tables → Basecoat `table`, `.card-legacy` → `card`/`section`. Kept the `.pill` view-nav, `.tier` status badges, and the `.tool-list` guidance browser as panel-specific (Basecoat has no nav-pill/semantic-tier). All 5 views earn their keep (distinct read surfaces). 22 data tests green; Playwright-verified
- [x] Usage dashboards (`pages/usage.tsx`): dashboard cards → kit `<Card>`, NotConfigured setup cards → `card`/`section` muted, Refresh → ghost `btn`. Kept the status-row/dot meters, `.summary` AI-by-model, and the sparkline viz (panel-specific). Confirmed via Playwright that Basecoat `.card` needs a `<section>` wrapper (direct children get card-layout gaps) — the kit `<Card>` provides it

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
