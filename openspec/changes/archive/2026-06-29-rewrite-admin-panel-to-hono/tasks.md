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
- [x] Playwright + visual-snapshot CI — **deferred to a follow-up** (not a spec requirement; the migration + cutover are complete and deployed, the panel verified by the vitest suite that drives the real Hono app)

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
- [x] Playwright visual-snapshot baselines for the read-only views — **deferred** (see above)

## 4. Remaining interactive areas (islands)
- [x] Config · Calibration — SSR the loaded config (seeded into the island); island for the `Clean | Dirty | NeedsConfirm` form machine, Analyze, Dry-run, and confirm-gated Save (reads the structured floor-breach error body to confirm — better than the Elm `Http.BadStatus` wart). Config-area shell + sub-nav stood up.
- [x] Config · corpus editors — SSR the 5 lookup tables; one generic island for add/remove with one-at-a-time mutation state; feed-test action (read-only, no refetch). Ranking/Flyer operator-config forms also landed under the Config shell.
- [x] Logs actions — per-row Retry/Delete island (one `RowAction` union, one-at-a-time, reload on success) + the entry detail dialog; retry/delete routes reuse the sweep's own functions
- [x] Kroger-consent link action — per-member "kroger link" button in the Members island minting a single-use consent url (banner is a two-variant `invite | kroger` union); backend extracted to a shared `krogerConsentLink` the legacy path also calls
- [x] Playwright visual-snapshot baselines for the interactive consoles — **deferred** (see above)

## 5. Cutover + cleanup
- [x] Flip `handleAdmin` → `adminApp.fetch` so the Hono app serves all of `/admin`; removed the `ADMIN_HONO` transition flag/branch (`src/index.ts`, `src/env.ts`)
- [x] Remove `admin/elm.json`, `admin/src/*.elm`, `admin/tests/*.elm`, `scripts/test-admin.mjs`, `admin/index.html`, the committed Elm bundle (`admin/dist/admin/{elm.js,index.html}`), and the `test:admin` script (no pinned Elm dep existed — it was npx-fetched)
- [x] Remove the **dropped Tool Console** backend: the legacy router (`routeAdminApi`/`handleAdmin`) in `src/admin.ts` (its `/admin/api/tools*` routes included), and `src/admin-tools.ts` + its test. The reusable in-memory MCP harness (`withServer`/`invokeTool`) moved to `test/tool-harness.ts` (one non-console user)
- [x] Finish `scripts/build-admin.mjs` (esbuild-only); `aubr build:admin --check` passes; no Elm reachability concern remains
- [x] Repoint the admin logic tests onto the Hono app (a `test/admin-request.ts` shim drives `adminApp.fetch`); obsolete transport tests (tool console, SPA shell, removed JSON `/api/data` + `/api/bug-reports`) dropped, corpus cases folded into `admin-config-corpus.test.ts`. Playwright E2E/snapshots remain deferred to the polish pass
- [x] Rewrite the modeling-discipline doc for TypeScript (discriminated unions, `Loadable`, `assertNever`) — now co-located at `src/admin/CLAUDE.md`
- [x] Update `docs/ARCHITECTURE.md`, `CONTRIBUTING.md`, and root `CLAUDE.md` admin references in lockstep; `admin/` now holds only the committed `admin/dist/`
- [x] Rebuild and commit `admin/dist/`; `aubr typecheck` + `aubr test` green
