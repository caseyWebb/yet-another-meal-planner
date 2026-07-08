# Tasks — member-app-offline

Ordered **client-core-first**: the persistence layer (§1) and the mutation registry (§2)
land before the boot/purge lifecycle (§3) binds to them and the SW/update/install chrome
(§4) rides on top; the harness (§5) then gates the finished behavior and docs (§6) ride the
same PR. Implementation is **serial** through the shared client modules (`main.tsx`,
`lib/api.ts`, `lib/data.ts`, `lib/persist.ts`, `lib/mutations.ts`) — nearly every task
touches them; the per-page call-site conversions inside 2.3 parallelize freely. **No spike
tasks** — every open question is settled in design.md (D1–D12) against the landed P0–P4 code
and registry-verified versions. Assumes P0–P4 landed (proposal.md "Dependency"); tasks name
pieces by role and the implementer binds to the landed actuals.

## 1. Persistence layer (D1, D2, D12)

- [x] 1.1 `packages/app/package.json`: add `@tanstack/react-query-persist-client@^5.101.2` +
  `idb-keyval@^6.2.6`; `aube install` (lockfile in place). Both are pure JS with no build
  scripts — confirm no `aube.allowBuilds` entry is demanded; if the install surfaces one,
  record the decision in the root `package.json` per the `package-manager` rule.
- [x] 1.2 New `packages/app/src/lib/persist.ts`: the `idb-keyval` structured-clone persister
  (`persistClient`/`restoreClient`/`removeClient` over one `cookbook-query-cache` key,
  errors swallowed — private-mode degradation); exported `PERSIST_PREFIXES` (D2's allowlist:
  `["grocery"]`, `["pantry"]`, `["plan"]`, `["overlay"]`, `["cookbook","index"]`,
  `["cookbook","recipe"]`) with the boundary discipline in the module comment (a new query
  is NOT persisted until its prefix is deliberately added); `shouldDehydrateQuery` (prefix
  match) + `shouldDehydrateMutation` (paused AND registered — §2); `MAX_AGE_MS` = 14 d;
  the identity-stamp helpers (`cookbook:tenant`, try/catch like the theme key); and
  `purgeLocalMemberData()` per design D9 (IDB key, `queryClient.clear()`, stamp, propose
  session; theme survives).
- [x] 1.3 `packages/app/src/main.tsx`: `PersistQueryClientProvider` replaces
  `QueryClientProvider` (`persistOptions`: persister, `buster: APP_BUILD`, `maxAge`,
  dehydrate predicates from 1.2), `onSuccess` → `queryClient.resumePausedMutations()`.
- [x] 1.4 `packages/app/src/lib/data.ts`: allowlisted query hooks (`useGrocery`, `useToBuy`,
  `usePantry`, `usePlan`, `useOverlay`, `useIndex`, `useRecipe`) set `gcTime` = 14 d
  (persisted entries must outlive memory gc — D1); `staleTime` posture unchanged.

## 2. The class (b) mutation registry (D4, D5)

- [x] 2.1 New `packages/app/src/lib/mutations.ts`: `registerMutationDefaults(queryClient)`
  installing `setMutationDefaults` for every registry row in design D4's table (grocery
  add/set/remove, pantry ops/verify, overlay favorite, plan ops, log add/remove, notes
  add/edit/remove, vibes add/remove, proposals confirm) — plain-JSON variables, `mutationFn`
  over the `hc` client throwing the structured `ApiError`, `onMutate` optimistic cache edits
  for grocery add/set/remove + the existing favorite optimism, `onError` structured toast,
  `onSettled` the same area invalidations the current helpers perform. Export the typed
  per-op hooks (`useGrocerySet()` etc. — thin `useMutation({ mutationKey })` wrappers) and
  the registered-key set 1.2's `shouldDehydrateMutation` checks. Called from `main.tsx`
  before render (defaults must exist before restore/resume).
- [x] 2.2 `packages/app/src/lib/data.ts`: `setFavorite` / `applyPlanOps` become registry
  hooks (callers updated); `readWithEtag` and the class (a) write paths stay imperative
  (design D5 — never mutations).
- [x] 2.3 Convert the call sites (each page independently, same pattern: fire the registry
  hook's `mutate`, stop awaiting network settle for UI progression, keep per-item loops
  per-item): `_app.grocery.tsx` (in-cart set, add-row, materialize, buy-fresh, remove,
  clear-purchased, mark-order-placed, pantry verify nudge), `_app.pantry.tsx` (ops, verify),
  `_app.plan.tsx` + `_app.recipe.$slug.tsx` + `_app.propose.tsx` (plan ops incl. commit),
  `_app.log.tsx` + `_app.recipe.$slug.tsx` (log add/delete, notes add/edit/remove),
  `_app.favorites.tsx`/cookbook favorite toggles, `_app.profile.tsx` (vibe create/delete,
  proposal confirm). The online-only surfaces (order preview/commit, substitutions, suggest,
  session, class (a) editors, propose POST) are left as direct calls — verify none acquires
  a `mutationKey` (D5's construction).
- [x] 2.4 Offline affordance pass (design D10): `useOnline()` over `onlineManager`; the shell
  offline pill (`data-testid="offline-pill"`); disable-with-hint on the order button, the
  substitutions button, vibe suggest, the class (a) editors, and propose re-roll while
  offline. Small chrome from existing tokens; flag for a Claude Design pass in the PR notes.

## 3. Offline boot + local-data lifecycle (D3, D9)

- [x] 3.1 `_app.tsx` loader: catch the whoami fetch rejection → stamped-tenant fallback
  (render the shell offline) or redirect to `/login` when no stamp; a definitive 401 →
  `purgeLocalMemberData()` + redirect (today's behavior plus the purge); other non-OK
  statuses keep today's throw. Successful whoami refreshes the stamp.
- [x] 3.2 `login.tsx`: on submit success, purge first when the stamp names a *different*
  tenant (compare before the navigate), then stamp the new tenant. `_app.tsx` logout: purge
  before navigating (replaces the bare `router.clearCache()`).

## 4. SW, update prompt, skew, install (D6, D7, D8, D10)

- [x] 4.1 `packages/worker/src/api/etag.ts`: stamp `Cache-Control: private, no-cache` on
  `jsonWithEtag`'s 200 and 304 arms (design D6); extend the existing etag unit coverage
  (`test/api-member.test.ts` family) to pin the header on both arms.
- [x] 4.2 `packages/app/src/lib/api.ts`: the fetch wrapper grows the `X-App-Build` response
  tap → a subscribable skew store (`useSyncExternalStore`-shaped; signal only when both ids
  are non-`"dev"` and differ) that also fires a throttled SW `registration.update()`.
- [x] 4.3 `ReloadPrompt` in `__root.tsx` over `useRegisterSW`
  (`virtual:pwa-register/react`; retire `main.tsx`'s bare `registerSW({})`): banner on
  `needRefresh` OR skew (action: `updateServiceWorker(true)`, falling back to a plain
  reload on the skew-only path), one-shot `offlineReady` toast, hourly-throttled
  `registration.update()` on visibility-visible. Login page: one-shot `GET /api/version`
  check on mount feeding the same skew store. Nothing auto-reloads (spec'd).
- [x] 4.4 `packages/app/vite.config.ts`: `globPatterns:
  ["**/*.{js,css,html,svg,png,webmanifest}"]` (explicit precache incl. icons;
  `globIgnores: ["admin/**"]` unchanged); NO `runtimeCaching` (the negative guarantee —
  keep it that way, per spec); manifest gains the PNG icons (192, 512, 512-maskable).
- [x] 4.5 Install assets + affordance: rasterize the committed `public/icon.svg` to
  `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` (padded safe zone),
  `apple-touch-icon.png` (180) — committed files in `packages/app/public/`; `index.html`
  gains the `apple-touch-icon` link; account menu gains "Install app" gated on a captured
  `beforeinstallprompt` + not `display-mode: standalone` (design D10 — no iOS dead
  affordance).
- [x] 4.6 New tooling drift test `packages/worker/tests/navigate-denylist.test.mjs`
  (`aubr test:tooling`): parse `run_worker_first` from `wrangler.jsonc` and the
  `navigateFallbackDenylist` regex source from `packages/app/vite.config.ts`; assert every
  Worker-owned top-level prefix (including `/health.svg`-style dotted paths) matches.

## 5. Playwright (D11)

- [ ] 5.1 `app/visual/setup.mjs`: stamp both sides with one id — `VITE_APP_BUILD=pw-harness`
  in the vite-build env, `--var APP_BUILD:pw-harness` on the `wrangler dev` invocation —
  replacing the unstamped-posture comment. Existing specs stay green (ids equal ⇒ no skew;
  buster now exercises a real value).
- [ ] 5.2 Page-object/fixture additions: shell offline pill + reload banner + install item
  locators (`shell.page.ts`), grocery check-off state helpers as needed
  (`grocery.page.ts`), an IDB condition-poll helper (raw `indexedDB` via `page.evaluate` —
  persisted-client contents, post-purge absence).
- [ ] 5.3 New `app/visual/specs/offline.spec.ts` (SW allowed, `/api` never routed): the
  acceptance sequence per design D11 — login → grocery → SW ready → controlled reload →
  IDB poll → `setOffline(true)` → reload → grocery renders from the persisted cache +
  offline pill (screenshot `grocery-offline`) → check-off (optimistic) →
  `setOffline(false)` → poll the server-visible `in_cart` via the browser's own `fetch`
  (the P1 cookie finding) → the across-reload variant (queued write survives an offline
  reload, replays on reconnect). Condition-polls only, no fixed sleeps.
- [ ] 5.4 New `app/visual/specs/update.spec.ts` (`test.use({ serviceWorkers: "block" })`):
  fulfill an `/api` response with a differing `X-App-Build` → banner renders → Reload
  navigates; equal ids → no banner. Record the honest split in the spec header (the real
  waiting-SW trigger is library-provided and drives the same component — design D11).
- [ ] 5.5 Extend `passthrough.spec.ts` (SW-controlled passthrough: visit `/` first, then
  `/cookbook` + `/health` are Worker-rendered) and the login/session spec (logout purge:
  IDB key gone, no `cookbook:tenant`/propose session in localStorage). `aubr test:app`
  green (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).

## 6. Docs (same pass)

- [ ] 6.1 `docs/ARCHITECTURE.md` member-app section: the offline posture — the three layers,
  the persist allowlist + purge lifecycle, the class (b) queue/replay + the online-only
  negative space, prompt-to-reload + skew UX, the no-API-runtime-cache guarantee; update the
  `jsonWithEtag` sentence for the `Cache-Control` stamp. Current-state prose (no "is now").
- [ ] 6.2 Verify no other doc owes an update: `docs/TOOLS.md`/`docs/SCHEMAS.md` untouched
  (no tool/shape change — client-device state is not operator data); `CLAUDE.md` build
  commands unchanged; PR template checklist filled at PR time.
