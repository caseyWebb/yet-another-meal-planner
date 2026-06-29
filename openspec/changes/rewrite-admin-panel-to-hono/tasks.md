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

## 2. Dev → Tool Console — DROPPED
The MCP inspector / Tool Console is **not ported** — dedicated external MCP-inspector tooling
covers this better, and the in-panel console did not earn its keep. The `/admin/dev/*` area and
its `/admin/api/tools` + `/admin/api/tools/:name` routes are removed at cutover (Phase 5). See
the spec delta's REMOVED Requirements. (The island runtime was already validated on the Members
and Logs islands, so no separate runtime-ceiling gate is needed.)

## 3. Read-heavy areas (SSR-only)
- [x] Status home — SSR `buildHealthPayload` directly (headline, per-job rows, D1 row, admin-gate posture incl. exposed/AI-quota warnings, never-run state); the 503-decode dance is gone (in-process call)
- [x] Logs — SSR the source submenu + selected-source entries (master/detail); entries hydrate as an island for row actions
- [x] Data explorer — SSR the 5 entity views (recipes list/detail, members, corpus + guidance browser, discovery, system) by calling `admin-data.ts` directly; all client state → query-param SSR navigation (no islands)
- [x] Usage — SSR the usage / trends / tool-usage dashboards (KV/AI meters, per-job sparklines, per-tool latency; `{ configured: false }` setup cards preserved); Refresh is a reload
- [ ] Commit Playwright visual-snapshot baselines for these read-only views

## 4. Remaining interactive areas (islands)
- [x] Config · Calibration — SSR the loaded config (seeded into the island); island for the `Clean | Dirty | NeedsConfirm` form machine, Analyze, Dry-run, and confirm-gated Save (reads the structured floor-breach error body to confirm — better than the Elm `Http.BadStatus` wart). Config-area shell + sub-nav stood up.
- [ ] Config · corpus editors — SSR the 5 lookup tables; island for add/remove with one-at-a-time mutation state; feed-test action (read-only, no refetch)
- [x] Logs actions — per-row Retry/Delete island (one `RowAction` union, one-at-a-time, reload on success) + the entry detail dialog; retry/delete routes reuse the sweep's own functions
- [ ] Kroger-consent link action where it lives in the panel
- [ ] Commit Playwright visual-snapshot baselines for the interactive consoles (incl. open-dialog and confirm states)

## 5. Cutover + cleanup
- [ ] Flip `handleAdmin` → `admin.fetch` so the Hono app serves all of `/admin`; remove the transition flag/branch
- [ ] Remove `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm`, `scripts/test-admin.mjs` (Elm), and the pinned Elm compiler / `package.elm-lang.org` build dependency
- [ ] Remove the **dropped Tool Console** backend: `GET /admin/api/tools` + `POST /admin/api/tools/:name` in `src/admin.ts`, and `src/admin-tools.ts` + its tests (if unused elsewhere)
- [ ] Finish `scripts/build-admin.mjs` (esbuild-only); confirm `aubr build:admin --check` passes; drop the Elm reachability concern from CI
- [ ] Repoint admin logic tests into the vitest run; the Playwright E2E + visual-snapshot suite runs in CI
- [ ] Rewrite `admin/CLAUDE.md` for the TypeScript discipline (discriminated unions, `Loadable`, exhaustiveness)
- [ ] Update `docs/ARCHITECTURE.md` and `CONTRIBUTING.md` admin-build references in lockstep; confirm `repo-structure` (`admin/src` → committed `admin/dist`) still holds
- [ ] Rebuild and commit `admin/dist/`; `aubr typecheck` + `aubr test` green
