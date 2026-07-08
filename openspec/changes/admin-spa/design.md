# Design — admin-spa

## Context

P6 — the final phase — of `docs/plans/web-app.md` (§7 is the charter; §8 toolchain; §11
defaults). P0–P5 are the baseline: the member SPA stack is proven end-to-end (Vite 8 on
Rolldown, React 19, TanStack Router/Query, `packages/ui`, the app Playwright harness), and the
Worker serves one merged, gitignored assets root (`packages/worker/assets/`) where each builder
cleans only its own subtree. The landed actuals this design binds to:

- `src/admin/app.tsx`: the Access-gated Hono app — `accessGate` middleware, the
  `injectHealthDock` HTML-splicing middleware, 13 SSR page routes (+ `registerDataRoutes`,
  `registerConfigRoutes`), the chained typed routes (`AdminApp` for `hc`), two 302 redirects,
  and the `notFound` handler whose content-type guard 404s a missing admin asset instead of
  serving the member SPA shell.
- `src/admin/pages/*.tsx` (13 files, ~4.5k lines) render server-side from direct `src/` reads;
  `src/admin/client/*.tsx` (13 islands) hydrate from `<script type="application/json">` props
  blocks and mutate via `hc<AdminApp>`; `src/admin/ui/` holds the Basecoat kit/layout/icons and
  the health dock; `scripts/build-admin.mjs` esbuilds each island and Tailwind-CLI-compiles
  `styles.css` into `assets/admin/`.
- `wrangler.jsonc` already enumerates `/admin` + `/admin/*` in `run_worker_first`, so **every**
  `/admin` request reaches the Worker before the asset layer — the Worker must serve the SPA
  shell itself (the member SPA's asset-fallback path never applies under `/admin`).
- `packages/worker/admin/visual/`: the blocking Playwright gate — 9 registered areas + 3
  sub-surfaces, 6 spec files, the shared deterministic seed (`seed.mjs`, also used by the app
  suite), boot via `setup.mjs` (`build-admin` → migrate → seed → `wrangler dev --local --var
  ADMIN_DEV_BYPASS:1`).
- The design source: `docs/plans/web-app-design/project/*.jsx` (the outer screens) — data-
  agnostic React screens over `window.GA` fixtures, no router, Basecoat DS export in `_ds/`.
  Basecoat ↔ shadcn/ui tokens map near-1:1 (plan §1), so the screens translate onto
  `packages/ui` components directly.

All questions an implementer would otherwise resolve unilaterally are settled below (no spike
tasks remain). No production-data spike applies — this change reads/writes no D1 shape and adds
no tool; every read it moves already exists as a deployed SSR read.

## Goals / Non-Goals

**Goals:**
- The admin panel is the member-app SPA stack end to end: one component kit, one data-flow
  idiom, one build pipeline — at parity with the shipped panel (the ported Playwright suite
  green is the acceptance bar).
- Every SSR page's data assembly is reachable as a typed `/admin/api/*` read; every existing
  mutation route survives verbatim; both transports keep calling the same `src/` functions.
- Deep-linkability is preserved at today's exact URLs, including query-param states.
- The SSR pages, islands, Basecoat stylesheet, and the esbuild/Tailwind-CLI build step are
  retired in the same change; `src/admin/CLAUDE.md` is rewritten to the Query-era standards.

**Non-Goals:**
- No new operator surfaces: the design bundle's Data › Flyer deals browser (`FlyerScreen.jsx`)
  and the Nodes tab's pinned-edge mutations (`NodeEdgeDialog`) have no shipped counterpart and
  no backing routes — out (D11).
- No offline layer, no service worker, no persisted query cache, no paused-mutation replay —
  P5's posture is member-facing; the admin panel is an online operator tool (D3).
- No auth machinery: the Access gate, the loopback `ADMIN_DEV_BYPASS`, and the key-authed
  `POST /admin/api/ingest` carve-out are byte-for-byte unchanged. No CORS, no CSRF additions.
- No D1 migration, no tool/schema change, no member-app change.

## Decisions

### D1 — Workspace shape: a new `packages/admin-app`, not an extension of `packages/app`

The plan's target is "two bundles, one shared package" (§2). The admin app differs from the
member app in auth (Access cookie vs invite session), mount (`/admin` base vs `/`), and PWA
posture (none vs installable/offline), so it is its own Vite project:
`packages/admin-app` (`@grocery-agent/admin-app`), scripts/toolchain identical to
`packages/app` (Vite ^8, `@vitejs/plugin-react` ^6, `@tanstack/react-router` + router-plugin,
`@tanstack/react-query` ^5, `@tailwindcss/vite`, oxlint + Biome; **no** `vite-plugin-pwa`).
Versions are already pinned in `aube-lock.yaml` by `packages/app` — no new research, no new
build-gated deps expected (any that appear get explicit `aube.allowBuilds` decisions).

Shared primitives live in `packages/ui`, which grows the Radix-based shadcn/ui components the
admin screens need (Dialog, AlertDialog, DropdownMenu, Select, Slider, Switch, Progress, Table,
Badge, Empty, Pagination, Combobox/Command, Tooltip) — vendored shadcn source per the P0
precedent. Admin-only composites (sparkline + hover tip, stat-tile grid, `PrettyKV`,
`ListFooter`, the pipeline/progression track, the health indicator popover) live in
`packages/admin-app/src/components/` — they have no member-app consumer; promotion to
`packages/ui` happens if one appears.

### D2 — Serving: the Worker serves the shell explicitly; `/admin/assets/*` is the static namespace

`/admin*` is `run_worker_first`, so the admin Hono app owns everything. Final dispatch order in
`src/admin/app.ts` (renamed from `.tsx`; `AdminApp` export and Access gate unchanged):

1. `accessGate` on `*` (unchanged — 404 unconfigured, 403 denied, loopback dev bypass).
2. The typed `/admin/api/*` routes (existing mutations + the D4 reads), chained as today.
3. The kept 302 redirects: `/admin/logs/discovery` → `/admin/discovery`,
   `/admin/config/aliases` → `/admin/normalize?tab=aliases` (Worker-side — bookmarks survive
   with no JS and no SPA code).
4. `GET /admin/assets/*` (+ `GET /admin/favicon.svg`): `ASSETS.fetch(request)` with today's
   content-type guard — an HTML response means the merged root's SPA fallback answered a
   genuine miss, so return a real 404 (the existing `navigation.spec.ts` assertion carries
   over).
5. Catch-all `GET`/`HEAD`: serve the shell — `ASSETS.fetch(new URL("/admin/index.html",
   request.url))`. Deep link, refresh, and client-route URLs all land here. The catch-all
   **excludes `/admin/api/*`**: an API-shaped path that matched no registered route (a typo,
   or a client newer than the Worker) returns a plain 404 — today's semantics for an unknown
   API route — never the shell's HTML, so D7's HTML-means-`access_expired` classification
   stays sound. Non-GET non-API → 404.

The Vite build sets `base: "/admin/"` and `outDir: ../worker/assets/admin` with
`emptyOutDir: false` plus a clean-own-subtree plugin (the mirror of the member app's
`cleanAppOutputs`, deleting only `assets/admin/*`) — the P0 invariant that `build:admin` /
`build:app` run in either order is preserved, now with Vite on both sides. Hashed chunks land
under `assets/admin/assets/` → served at `/admin/assets/*` (namespace 4 above).
`injectHealthDock` and the `page()` HTML helper are deleted; no `hono/jsx` import remains in
the Worker (the worker tsconfig's JSX settings and the `src/admin/client/tsconfig.json` DOM
pass retire with them).

**Version skew:** none of the member app's stamp machinery. The admin bundle has no SW and no
persisted cache; `index.html` is served fresh per navigation by the assets binding and chunks
are content-hashed. The one long-lived-tab hazard (a stale shell holding old chunk URLs after a
deploy prunes them) surfaces as a failed dynamic import → the D7 reload prompt covers it.

### D3 — Data layer: TanStack Query over `hc<AdminApp>`; the P5 offline patterns are deliberately NOT adopted

The worker package gains a types-only export `"./admin-api": "./src/admin/app.ts"` (the
`"./api"` precedent); the SPA constructs `hc<AdminApp>("/")` over a thin shared fetch wrapper
(D7). Query posture mirrors the member app's plan-§6 stance — the server is the truth, the
cache is a display buffer: `staleTime` 15 s, `refetchOnWindowFocus`, no persister, no
`gcTime` extension, no paused mutations, no mutation registry. Mutations are awaited
`useMutation`s that `invalidateQueries` on settle — this replaces every `location.reload()`
and fire-and-forget refetch. Optimistic cache updates are used exactly where the current
panel already behaves optimistically (the satellite quarantine hold/clear) via `onMutate` +
rollback-by-invalidation; nowhere else — the operator panel prefers honest in-flight states.

### D4 — The read routes: one aggregate GET per screen, mirroring the SSR assembly

The SSR pages already compose one props payload per page from bounded `src/` reads; the SPA
keeps that shape — each screen has **one** primary query, so parity is mechanical and the
`hc` type surface stays small. New chained routes (all Access-gated, all calling the exact
reads the SSR pages call today — no new `env.DB` access, no new read logic):

| Route | Assembles (today's SSR reads) |
|---|---|
| `GET /admin/api/status` | `buildHealthPayload` + `corpusCounts` + `readSatelliteLiveness` + `readReconcileObservability` + `readAuditObservability` + `readJobRuns` per job (sparkline window) — the `StatusPage` props verbatim; also the health indicator's rollup source (D6) |
| `GET /admin/api/members/:id` | `listTenants` row + `memberDetail` + `recipeTitles`; a pending member returns `{ row }` only (no detail read — today's guard) |
| `GET /admin/api/data/recipes?q&mode&page&size` | `recipeList` / `searchRecipes` + the facet join — server-parameterized (hybrid mode embeds the query; pagination stays server-side as today) |
| `GET /admin/api/data/recipes/:slug` | `recipeDetail` + Worker-rendered markdown HTML (D8) |
| `GET /admin/api/data/stores` · `GET /admin/api/data/stores/:slug` | `storeList` / `storeDetail` |
| `GET /admin/api/data/guidance?gpath\|gprefix` | `guidanceListing` / `guidanceObject` (+ rendered HTML, D8) |
| `GET /admin/api/insights` | `readInsights` (every window precomputed — the toggles stay request-free) |
| `GET /admin/api/usage` | `fetchUsage` + `fetchUsageTrends` + `fetchToolUsage` (not-configured/failure detail states pass through structurally, as data — never a thrown 500) |
| `GET /admin/api/logs/runs` | `readAllJobRuns` (existing cap); the `?run=` deep-link resolves client-side against this payload, falling back to the default view when pruned — same semantics, no extra route |
| `GET /admin/api/discovery/candidates` | `readDiscoveryCandidates(200)` + the liveness-derived ingest strip |
| `GET /admin/api/satellites` | `readSatelliteLiveness` + `readRejections` (quality window) + `getQuarantine` — the `SatellitesPage` props |
| `GET /admin/api/normalization/page` · `/nodes` · `/audit` · `GET /admin/api/reconcile` | `readNormalizationPage` / `readNodesPage` / `readAuditSurface` / `readReconcileObservability` — split per Normalize tab so a tab switch fetches only its data and a mutation invalidates narrowly |

Existing routes are untouched: all mutations/previews (tenants CRUD + rotate + kroger-login,
ingest keys, quarantine set/clear, discovery retry/delete, discovery config + analyze/dry-run/
test-feed, operator-config, corpus editors, normalization alias/requeue/decision), plus
`GET /api/tenants`, `GET /api/ingest/keys`, `GET /api/corpus/:table`, the config GETs, and the
spec-pinned `GET /admin/api/logs/discovery`.

**Filtering/pagination split:** the bounded whole-dataset reads (discovery candidates, job
runs, normalize streams/aliases/nodes) are already fetched whole and paginated in-render by
the SSR pages — the SPA fetches the same bounded payload once and filters/paginates
client-side. The genuinely parameterized reads (recipe search — an AI embed per hybrid query;
guidance browse — an R2 walk) keep their query params server-side. No read gets less bounded
than today.

### D5 — Routing: TanStack Router at today's exact URLs; query-param state becomes typed search params

`createRouter({ basepath: "/admin" })`, history-API. The route table is today's URL scheme
verbatim — `/` (Status), `/members`, `/members/$id` (+ `/$section`), `/data` (+
`/data/recipes`, `/data/recipes/$slug`, `/data/stores`, `/data/stores/$slug`,
`/data/guidance`), `/insights`, `/usage`, `/discovery`, `/discovery/satellites`, `/normalize`,
`/logs`, `/config` (+ `/config/ingest-keys`, `/config/flyer`, `/config/ranking`). Every
query-param state the SSR pages parse today becomes a validated search param on its route,
same names, same defaults-omitted convention: Normalize `?tab/stream/filter/q/src/page/node/
facet`, Discovery `?filter/page`, Logs `?job/page/run`, Data recipes `?q/mode/page/size`,
guidance `?gpath/gprefix`. Existing bookmarks and the Status-sparkline → `/admin/logs?run=`
deep-link keep working unchanged; the Playwright specs' URL assertions port as `waitForURL`
on client-side navigations. The design bundle's `window.GA.open*` cross-screen hacks translate
to plain router `Link`s carrying these search params.

### D6 — Status + the global health indicator share one query

`GET /admin/api/status` returns the full Status aggregate; the `HealthIndicator` (design
bundle: fixed-corner popover — healthy/degraded word, failing jobs, dependency states,
"Open status →") renders in the router root layout on every screen and subscribes to the same
`["status"]` query the Status screen uses — one read, one cache entry. The query sets
`refetchInterval` 60 s + refetch-on-focus so the indicator stays honest during long client-side
sessions (the SSR dock was per-navigation-fresh; client routing removes that implicit refresh,
the interval restores it). Degraded payloads are data, not errors: the route returns 200 with
the payload regardless of health (the `/health`-derived posture — a decoded degraded payload
is a successful read; load-failure states are reserved for transport/decode failures).

### D7 — The shared fetch layer owns Access-expiry detection; no new auth machinery

The Access cookie rides every same-origin fetch transparently — until it expires, when
Cloudflare Access answers a fetch with a redirect toward the IdP (which the browser follows
cross-origin and CORS kills, surfacing as a network error) or an HTML interstitial. The shared
fetch wrapper (the one `hc` is constructed over) classifies any `/admin/api` response that is
not JSON — network failure, opaque/cross-origin redirect, or `text/html` content-type — as
`access_expired` and flips a module-level flag the root layout renders as a **blocking
"session expired — reload to sign back in" overlay**; a full reload re-runs the Access flow
and lands back on the same URL (deep links are routes, D5). Queries with that error class do
not retry. Under the loopback `ADMIN_DEV_BYPASS` this path is simply never taken. Structured
`ToolError` bodies keep flowing through as typed JSON errors exactly as the islands received
them.

### D8 — Markdown stays rendered Worker-side

The Data explorers' rendered recipe/guidance bodies (operator-data-explorer's formatted-HTML
requirement) keep using the existing `marked`-based renderer, relocated
`src/admin/ui/markdown.ts` → `src/admin/markdown.ts`: the detail read routes return
`{ …, html }` and the SPA injects it (`dangerouslySetInnerHTML`) styled by the app's
typography classes. Rationale: one renderer, no `marked` in the browser bundle, the
trust boundary is unchanged (operator-authored corpus behind the Access gate — the same HTML
the SSR pages emit today).

### D9 — Modeling standards: the `Loadable` discipline maps onto Query states (the CLAUDE.md rewrite)

`src/admin/CLAUDE.md` is rewritten (same prime directive, new idioms):

- **Remote data**: `useQuery`'s status union IS the `Loadable` — `pending`/`error`/`success`
  (+ `fetchStatus` for in-flight distinction); `notAsked` is a disabled query. The antipattern
  ban is restated as: never destructure a query into loose `isLoading`/`error`/`data` locals
  that can be recombined contradictorily — branch on `status` and end with `assertNever` (the
  helper moves to `packages/admin-app/src/lib/assert.ts`).
- **Server state is never copied into `useState`** — the query cache is the one source of
  truth; a mutation edits the cache (invalidate or `setQueryData`), never a shadow copy. This
  is the SPA-era restatement of "derive, don't store".
- **Mutations**: one `useMutation` per operation; its state union (idle/pending/error/success
  + `variables` as the target) is the old `ActionState` — busy, which target, and the failure
  cannot contradict. One-at-a-time stays structural: gate the surface on the mutation's
  `isPending`, never a parallel boolean.
- **Errors carry their type inside the failing variant**: the structured `ApiError` body rides
  `mutation.error`/`query.error`, never a detached `string | null`.
- **Finite local UI states remain discriminated unions** (dialog/wizard states, the knob
  console's Clean/Dirty/NeedsConfirm machine port as-is); **URL search params own any state a
  deep link should reproduce** (tabs, filters, pages — D5); component state is for the rest.
- Boundary rule unchanged: narrow at the boundary, invariants live in `src/`.
- Styling/build/testing sections rewritten for shadcn/`packages/ui`/Vite and the ported
  harness (D12); the Claude Design project rule stays verbatim.

### D10 — Visual layer: shadcn/ui from `packages/ui`, the operator theme as a layer, dark mode included

The screens translate `docs/plans/web-app-design/project/*.jsx` onto `packages/ui` components
(Basecoat → shadcn/ui is near-1:1 by design). The admin app's entry CSS imports the shared
theme (`@grocery-agent/ui/theme.css`) plus an **operator theme layer** setting the panel's
accent (`--primary: #f4a259` and the warm neutrals from the bundle's tokens) — the member app's
look is untouched. The bundle's light/dark toggle ships: `.dark` on `<html>`, persisted to
`localStorage["ga-theme"]`, applied pre-paint by an inline script in the admin `index.html`
(the member app's `ThemeFab` pattern). Lucide icons come as inline SVG components in
`packages/admin-app` (the bundle's `icons.jsx` set, trimmed to what the screens use).
Where the bundle and the shipped panel disagree (bundle Config groups fold email-sources into
Discovery; the shipped panel's `Config › Ingest Keys` group exists in both), the **shipped
panel's structure + living specs win** — the bundle is the visual/styling source, the parity
inventory (below) is the behavioral source.

### D11 — Parity-first scope: designed-but-never-built surfaces are excluded

- **`FlyerScreen.jsx` (Data › Flyer deals browser)**: no shipped page, no admin read over the
  KV flyer cache, and its "taste match" section needs per-member cosine scoring — a new
  surface, not a port. Excluded; a natural follow-up change once the SPA lands.
- **`NodeTab`'s `NodeEdgeDialog` (add/remove human-pinned edges)**: no `/admin/api` route
  exists; the shipped Nodes tab is read-only browse. The SPA ports it read-only; the edge
  mutations are a follow-up (they need new corpus-db writes + spec work in
  `ingredient-normalization`).
- The bundle's design-review-only affordances (`ReconcilePreviewToggle`/`AuditPreviewToggle`
  fake stores, `setTimeout`-simulated retries) are dropped, as their own comments instruct.

### D12 — Playwright port: same assertions, SPA timing model; the gate never yields

`packages/worker/admin/visual/` keeps its layout (registry, fixtures, seed, page objects,
specs) and its assertion content; what changes is the rendering model:

- `setup.mjs`: `npx vite build` (cwd `packages/admin-app`) replaces `node
  scripts/build-admin.mjs`; everything else identical (migrate → shared seed → `wrangler dev
  --local --var ADMIN_DEV_BYPASS:1`; readiness URL stays `/admin`, which now returns the
  shell). The seed is unchanged — every landmark's fixture already exists.
- `base.page.ts`: landmarks render after the screen's query resolves; Playwright locator
  auto-wait covers the fetch+render cycle (the app suite's proven posture) — the "landmark is
  SSR-rendered" discipline is restated as "landmark renders from the screen's primary query,
  is unique, and is time-free".
- `NavComponent`/tab helpers: client-side navigations — `waitForURL` still works (history API
  updates the URL); the "no client router" comment inverts.
- `DialogComponent`: Radix (`role="dialog"` + accessible name) replaces the native `<dialog>`
  `.open` probe; `openVia`'s retry-until-open survives as a plain click + `expectOpen`
  (hydration is one-shot at boot, not per-island).
- Kept verbatim: the missing-asset 404 spec (D2's guard), all seeded-fixture assertions, the
  screenshot flow. Added: an `/admin/api` passthrough spec (a representative GET returns JSON,
  never the shell — guarding D2's dispatch order).
- CI: the `admin-ui` job is unchanged in name, trigger, and blocking-ness; its
  screenshot-publish path filter gains `packages/admin-app/**` + `packages/ui/**` (and drops
  `scripts/build-admin.mjs`).

### D13 — Build/scripts/CI/deploy wiring

- `scripts/build-admin.mjs` is deleted. Worker `build:admin` script is removed; the **root**
  `build:admin` repoints to `aube --filter @grocery-agent/admin-app run build` (the
  `build:app` pattern) — so `ci.yml`'s test-job step becomes `aubr build:admin` and
  `data-deploy.yml` (which already runs `aubr build:admin`) needs **no change**; the deploy
  keeps building admin-then-app into the merged root in either order. No build stamp for the
  admin bundle (D2).
- Worker `package.json`: `+ "./admin-api"` export; `typecheck` drops the
  `src/admin/client/tsconfig.json` pass (the dir is gone), keeps `admin/visual` +
  `app/visual`; devDeps `esbuild`, `tailwindcss`, `@tailwindcss/cli`, `basecoat-css` are
  removed (esbuild's `aube.allowBuilds` entry can stay — harmless — but nothing needs it).
  Recursive `aubr typecheck` picks up `packages/admin-app` via its own script.
- New root `scripts/dev-admin.mjs` + `aubr dev:admin` (the `dev-app.mjs` twin): `wrangler dev`
  + Vite dev (cwd `packages/admin-app`, port 5174, `base: "/admin/"`, proxy `/admin/api` →
  `127.0.0.1:8787`) — HMR against the real Worker; the loopback bypass engages exactly as
  today when `.dev.vars` sets `ADMIN_DEV_BYPASS=1`. Plain `aubr dev` serves the last-built
  bundle from `assets/admin/` (the no-HMR path the harness uses).
- `ci.yml` `trigger-deploy` path filter gains `packages/admin-app/` and drops
  `packages/worker/scripts/build-admin.mjs`.

### D14 — Migration: one change, screen-staged commits, single cutover

Page-by-page dual-running (an `/admin/next` mount, per-page fallthrough) was rejected: it
doubles the maintenance the change exists to end, complicates the Access posture, and the
Playwright suite can't meaningfully gate half a panel. Instead the change lands as **one
branch/PR** whose commits stage cleanly — (1) read routes + tests, (2) `packages/admin-app`
scaffold + shell + `packages/ui` growth, (3) screens in dependency-light groups (each with its
page-object port), (4) the serving cutover + SSR/island/build-step deletion, (5) docs — but
merges only when the full ported suite is green on the SPA. Until the cutover commit the SSR
panel keeps serving; there is no deployed intermediate state. Rollback = revert the PR (no
data migration, no config migration; `wrangler.jsonc` untouched).

## The parity inventory (normative)

The rewrite is complete when every row below renders and mutates in the SPA and the ported
suite's assertions pass. "Client" filtering = router search params over the screen's one
bounded query (D4/D5).

| Today's page (SSR reads) | Islands → mutations | SPA route + primary query | API gap closed by |
|---|---|---|---|
| `/admin` Status — `buildHealthPayload`, `corpusCounts`, `readSatelliteLiveness`, `readReconcileObservability`, `readAuditObservability`, `readJobRuns`×jobs | `sparkline-tip` (hover only); dock via `injectHealthDock` + `client/health.tsx` | `/` ← `["status"]` (also feeds `HealthIndicator`, D6); sparkline ticks link `/logs?run=` | `GET /admin/api/status` |
| `/admin/members` — `listTenants` | `client/members.tsx` → onboard / rotate / kroger-login / revoke (+ roster refetch) | `/members` ← `["tenants"]`; invite/rotate/consent shown-once banners; row action menu | none (`GET /admin/api/tenants` exists) |
| `/admin/members/:id(/:section)` — `listTenants` + `memberDetail` + `recipeTitles`; pending → empty state | none (pure SSR; 6 section pills) | `/members/$id(/$section)` ← `["member", id]` | `GET /admin/api/members/:id` |
| `/admin/data(/recipes)` — `recipeList`/`searchRecipes` + facet join; `?q/mode/page/size` | none | `/data/recipes` ← `["data","recipes",params]` (server-paginated, `keepPreviousData`) | `GET /admin/api/data/recipes` |
| `/admin/data/recipes/:slug` — `recipeDetail` + rendered markdown | none | `/data/recipes/$slug` ← `["data","recipe",slug]` | `GET /admin/api/data/recipes/:slug` |
| `/admin/data/stores(/:slug)` — `storeList`/`storeDetail` | none | `/data/stores(/$slug)` | `GET /admin/api/data/stores(/:slug)` |
| `/admin/data/guidance` — `guidanceListing`/`guidanceObject`; `?gpath/gprefix` | none | `/data/guidance` ← params in search | `GET /admin/api/data/guidance` |
| `/admin/insights` — `readInsights` | `client/insights.tsx` (window/sort/expand — client state, no fetch) | `/insights` ← `["insights"]`; toggles re-render from the one payload (request-free, spec-pinned) | `GET /admin/api/insights` |
| `/admin/usage` — `fetchUsage` + `fetchUsageTrends` + `fetchToolUsage` | `sparkline-tip` | `/usage` ← `["usage"]`; not-configured/failure states pass through as data | `GET /admin/api/usage` |
| `/admin/discovery` — `readDiscoveryCandidates(200)` + liveness strip; `?filter/page` | `client/discovery.tsx` → retry / delete, then `location.reload()` | `/discovery` ← `["discovery","candidates"]`; client filter pills + pager; retry/delete `useMutation` → invalidate (one-at-a-time per card) | `GET /admin/api/discovery/candidates` |
| `/admin/discovery/satellites` — `readSatelliteLiveness` + `readRejections` + `getQuarantine` | `client/satellite-audit.tsx` → quarantine set/clear (optimistic hold) | `/discovery/satellites` ← `["satellites"]`; optimistic quarantine kept (D3) | `GET /admin/api/satellites` |
| `/admin/normalize` — `readNormalizationPage` + `readNodesPage` + `readAuditSurface` + `readReconcileObservability`; `?tab/stream/filter/q/src/page/node/facet` | `client/normalize.tsx` → alias add/delete, requeue, decision delete, then `location.reload()` | `/normalize` ← per-tab queries (`["normalize","page"|"nodes"|"audit"]`, `["reconcile"]`); tabs/streams/filters as search params; mutations invalidate `["normalize","page"]` | `GET /admin/api/normalization/page` · `/nodes` · `/audit`, `GET /admin/api/reconcile` |
| `/admin/logs` — `readAllJobRuns` (+ `readJobRunById` for `?run=`) | none (native disclosure) | `/logs` ← `["logs","runs"]`; job pills + pager client-side; `?run=` resolved client-side, pruned id → default view | `GET /admin/api/logs/runs` |
| `/admin/config` (Discovery group) — `getDiscoveryConfig` + corpus tables (feeds, members/senders) | `calibration.tsx` (analyze/dry-run/save + confirm), `corpus.tsx` (feeds + test-feed), `email-sources.tsx` | `/config` ← `["discovery-config"]`, `["corpus",table]`; knob console state machine ports as-is; previews are mutations rendering their result state | none (all reads exist) |
| `/admin/config/flyer` · `/ranking` — `getOperatorConfig` (+ flyer-terms corpus) | `opconfig.tsx`, `corpus.tsx` | `/config/flyer` · `/config/ranking` ← `["operator-config"]` | none |
| `/admin/config/ingest-keys` — `readSatelliteLiveness` + `listTenants` | `ingest-keys.tsx` → mint (shown-once secret) / revoke (destructive confirm) | `/config/ingest-keys` ← `["ingest-keys"]` + `["tenants"]` | none |
| `/admin/logs/discovery`, `/admin/config/aliases` — 302s | — | kept Worker-side (D2) | — |
| every page — health dock (middleware-injected) | `client/health.tsx` (expand) | `HealthIndicator` in the root layout ← shared `["status"]` | covered by `GET /admin/api/status` |

Retirement inventory (deleted in the cutover commit): `src/admin/pages/*` (13),
`src/admin/client/*` (13 + tsconfig), `src/admin/ui/*` (kit/layout/icons/health-dock;
`markdown.ts` relocates), `src/admin/styles.css`, `src/admin/logs-shared.ts` /
`satellite-audit-shared.ts` / `shared.ts` (types fold into the route payloads / admin-app),
`injectHealthDock` + its middleware test, `scripts/build-admin.mjs`, the four retired worker
devDeps. Kept: `src/admin/app.ts` (gate + routes + serving), `src/admin/config-api.ts`,
`src/admin/markdown.ts`, every `src/` reader, `handleIngest`'s pre-gate carve-out, the
`admin-data.ts` layer.

## Risks / Trade-offs

- **Parity regressions across 14 surfaces** → the normative inventory above + the ported
  suite's existing assertions are the bar; the suite is ported alongside each screen group,
  not at the end, so drift surfaces per-commit.
- **First-paint regression** (SSR HTML → shell + fetch) → accepted for an operator tool; the
  per-screen aggregate reads are single round-trips (D4), and client-side navigation +
  Query cache make every subsequent interaction faster than today's full SSR round-trips —
  the trade the plan already made.
- **Read-route payload drift vs the old SSR props** → routes reuse the exact assembly
  functions; vitest route tests pin each payload's shape against the readers (same fixtures
  the SSR pages consumed).
- **Access-expiry UX regressions** (SSR got a free redirect on navigation; fetches don't) →
  D7's explicit detection + reload prompt; covered by a unit test on the fetch classifier
  (Playwright can't drive a real Access flow — same honesty split P5 used).
- **A half-cutover deploy window** → none exists: single-PR cutover (D14); deploy is atomic
  (Worker + assets ship together, and the Worker serves whichever shell is in the bundle it
  deployed with).
- **Bundle-vs-panel design conflicts** → resolved by rule (D10): shipped structure + specs
  win; the bundle styles.

## Migration Plan

1. Commit-staged single change per D14; each stage green on `aubr typecheck`, `aubr test`,
   and (from stage 3) the growing ported `aubr test:admin`.
2. No data/config migration. `wrangler.jsonc`, secrets, Access config, and the data-repo
   deploy workflow are untouched (`data-deploy.yml` already runs `aubr build:admin`).
3. Post-merge deploy: normal auto-kick; verify `/admin` serves the SPA behind Access, a deep
   link (`/admin/normalize?tab=audits`) resolves, `/admin/api/status` returns the aggregate,
   and a missing `/admin/assets/*` file 404s.
4. Rollback: revert the PR — the SSR panel and its build step return wholesale.

## Open Questions

None — serving order, route inventory, search-param mapping, harness port mechanics, theme
source, and the excluded surfaces are all settled above. (Archive note: this change must
archive **after** `member-app-foundations` — its spec deltas write the post-P0 final text for
requirements P0 also touches.)
