# Tasks

## 1. Scaffold + Members thin vertical (pipeline proof)
- [x] Add the `hono` (+ `ts-pattern`, `esbuild`, `@playwright/test`) deps; set `jsx: "react-jsx"` + `jsxImportSource: "hono/jsx"` in `tsconfig.json` (server JSX compiles via the Worker's existing esbuild)
- [x] Create the Hono admin app (`src/admin/app.tsx`), `basePath('/admin')`, exporting `AdminApp` for `hc`
- [x] Port `requireAccess` to Hono middleware (reuse the function verbatim); preserve the opt-in / dev-bypass / email-allowlist posture
- [x] Mount the app where `handleAdmin` is called (`src/index.ts`) **behind `ADMIN_HONO=1`** so Elm still serves `/admin` until cutover
- [x] Rewrite `scripts/build-admin.mjs`: esbuild island bundler → `admin/dist/admin/islands/*.js`; keep the `--check` drift gate; remove the Elm path (staged — full removal in Phase 5)
- [x] Extract the inline `<style>` → served `admin/dist/admin/styles.css`; add `@view-transition { navigation: auto; }` + `view-transition-name` on the persistent shell (h1 + nav)
- [x] Stand up the `src/admin/ui/` component kit (Card, Button, Pill, TierBadge, Dot, Dialog, Field, ErrorBanner, Table, layout, `Loadable` RemoteData primitive)
- [x] SSR the Members list by calling the existing `src/` lifecycle/list functions directly
- [x] Hydrate onboard / rotate / revoke as one island; wire mutations through `hc` typed routes that call the same `src/` functions
- [x] Preserve the once-shown invite-code + connector-URL minting (never logged)
- [x] Establish the TS discipline primitives: `Loadable`/RemoteData union, `assertNever`; the island's `ActionState` is one in-flight-mutation union
- [x] vitest coverage for the Members routes (`app.request(...)`): gate, SSR, list, onboard, structured-error, revoke
- [ ] Stand up Playwright + a CI job (spin up `wrangler dev`, run E2E, upload screenshot/diff artifacts); commit the first Members visual-snapshot baseline (rendered in the Playwright container)

## 2. Tool Console — runtime-ceiling gate
- [ ] SSR the console shell + tool catalog via the same `buildServer` enumeration path the Elm console uses
- [ ] Port the schema-derived example generator and the JSONC arg tolerance (comment/trailing-comma stripping) to TS
- [ ] Hydrate the console as a `hono/jsx/dom` island; invoke tools via a typed route returning the structured result/error verbatim
- [ ] Preserve the acting-persona guardrails (visible persona, no-invoke-without-persona, confirm-before-real-member)
- [ ] **Gate:** if `hono/jsx/dom` strains on the dynamic forms, swap this one island to Preact/React (data layer untouched) and record it
- [ ] Commit a Playwright visual-snapshot baseline for the tool console (catalog + seeded-args + result states)

## 3. Read-heavy areas (SSR-only)
- [x] Status home — SSR `buildHealthPayload` directly (headline, per-job rows, D1 row, admin-gate posture incl. exposed/AI-quota warnings, never-run state); the 503-decode dance is gone (in-process call)
- [ ] Logs — SSR the source submenu + selected-source entries (master/detail)
- [x] Data explorer — SSR the 5 entity views (recipes list/detail, members, corpus + guidance browser, discovery, system) by calling `admin-data.ts` directly; all client state → query-param SSR navigation (no islands)
- [ ] Usage — SSR the usage / trends / tool-usage dashboards (`{ configured: false }` handling preserved)
- [ ] Commit Playwright visual-snapshot baselines for these read-only views

## 4. Remaining interactive areas (islands)
- [ ] Config · Calibration — SSR the loaded config; island for the `Clean | Dirty | NeedsConfirm` form machine, Analyze, Dry-run, and confirm-gated Save (read the structured floor-breach error body to name the field — an improvement over the Elm `Http.BadStatus` wart)
- [ ] Config · corpus editors — SSR the 5 lookup tables; island for add/remove with one-at-a-time mutation state; feed-test action (read-only, no refetch)
- [ ] Logs actions — per-row Retry/Delete islands (one-at-a-time, reload on success) + the entry detail dialog
- [ ] Kroger-consent link action where it lives in the panel
- [ ] Commit Playwright visual-snapshot baselines for the interactive consoles (incl. open-dialog and confirm states)

## 5. Cutover + cleanup
- [ ] Flip `handleAdmin` → `admin.fetch` so the Hono app serves all of `/admin`; remove the transition flag/branch
- [ ] Remove `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm`, `scripts/test-admin.mjs` (Elm), and the pinned Elm compiler / `package.elm-lang.org` build dependency
- [ ] Finish `scripts/build-admin.mjs` (esbuild-only); confirm `aubr build:admin --check` passes; drop the Elm reachability concern from CI
- [ ] Repoint admin logic tests into the vitest run; the Playwright E2E + visual-snapshot suite runs in CI
- [ ] Rewrite `admin/CLAUDE.md` for the TypeScript discipline (discriminated unions, `Loadable`, exhaustiveness)
- [ ] Update `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` admin-build references in lockstep; confirm `repo-structure` (`admin/src` → committed `admin/dist`) still holds
- [ ] Rebuild and commit `admin/dist/`; `aubr typecheck` + `aubr test` green
