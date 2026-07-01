## 1. Backend read: candidate enrichment

- [x] 1.1 In `src/discovery-db.ts`, add a pure `deriveHalt(row: DiscoveryLogRow): { haltStage: StageKey; kind: CandidateKind; retryable: boolean }` implementing the Decision 1 / "Discovery candidate progression track" mapping table, switching exhaustively over the `Outcome` union imported from `discovery-sweep.ts` (compile-time-safe against a future outcome addition).
- [x] 1.2 Add `readDiscoveryCandidates(env, limit = 200)`, wrapping `readDiscoveryLog` and mapping each row through `deriveHalt`; degrade-on-storage-error consistent with the existing readers.
- [x] 1.3 Unit-test `deriveHalt` against representative rows for every outcome (including both `no_match` sub-cases by `detail.stage`, and the three `error` sub-cases by `detail.reason` shape) — no D1 needed, pure function.

## 2. Discovery area SSR page

- [x] 2.1 Add `src/admin/pages/discovery.tsx`: compute stat tiles (total / imported + rate / parked+failed / in-retry-queue) and filter-pill counts from one `readDiscoveryCandidates` call.
- [x] 2.2 Implement the filter-pill row and pagination as `?filter=&page=` query params (mirroring `admin-ui-redesign-logs`'s `?job=&page=` precedent); "Retrying" filters on `retryable`, others on `outcome`.
- [x] 2.3 Implement the candidate-card list: title, source + icon + relative age, outcome badge, the progression track, the plain-language summary line, and the retry-clock / terminal readout for retryable/terminal rows.
- [x] 2.4 Implement the expand-to-detail (native `<details>`/`<summary>`, zero-JS): the 7-stage breakdown (passed / stopped here / not reached + blurb) and `PrettyKV` over the raw log row (id, url, outcome, slug, attempts, retry countdown, detail).
- [x] 2.5 Wire `app.get("/discovery", ...)` to render this page, replacing the foundation placeholder body.

## 3. Progression-track kit primitive

- [x] 3.1 Add a `StageTrack` (or similarly named) presentational primitive to `src/admin/ui/kit.tsx`: takes `stages`, `haltIndex`, `kind`, `imported`/`heldNotFailed` flags; emits the panel's `pl-track`/`pl-stage`/`pl-node`/`pl-seg`-equivalent classes (ported from the mock's CSS naming).
- [x] 3.2 Add the corresponding layout CSS to `src/admin/styles.css` (track/node/segment states: done / halt-reject / halt-park-fail / halt-hold / todo), composing Basecoat tokens per `admin/CLAUDE.md` styling rules.

## 4. Retry/Delete island

- [x] 4.1 Add `src/admin/client/discovery.tsx` (or relocate `client/logs.tsx`'s Discovery-specific logic here): hydrate retryable cards' Retry buttons and each card's Delete action, with one-row-at-a-time `ActionState` (`idle | busy{id} | failed{id,message}`).
- [x] 4.2 Wire Retry to `POST /admin/api/discovery/:id/retry` and Delete to `DELETE /admin/api/discovery/:id` via the typed `hc` client (existing routes, unchanged contract); on success, reload so the resolved/removed candidate reflects immediately.
- [x] 4.3 Seed the island's hydration props from the SSR page's `<script type="application/json">` block per `admin/CLAUDE.md` rule 8 (no fetch-on-mount for data the server already had).

## 5. Logs ↔ Discovery reconciliation

- [x] 5.1 Remove the Discovery left-submenu destination and its candidate-list rendering from `src/admin/pages/logs.tsx` / `src/admin/client/logs.tsx`, leaving the all-jobs run log as Logs' sole content (coordinate with `admin-ui-redesign-logs` if it has not yet archived — confirm which change lands this removal vs. which lands the all-jobs view, so they don't conflict).
- [x] 5.2 Change `app.get("/logs/discovery", ...)` in `src/admin/app.tsx` to a redirect to `/admin/discovery`.
- [x] 5.3 Repoint the `discovery-sweep` run entry's "View discovery candidates →" link (in the all-jobs Logs view) from `/admin/logs/discovery` to `/admin/discovery`.

## 6. Verification

- [x] 6.1 `aubr typecheck` (root + `client/tsconfig.json` for the new/relocated island).
- [x] 6.2 `aubr test` — the `deriveHalt`/`readDiscoveryCandidates` unit tests, plus confirm no existing Logs/Discovery test regresses.
- [x] 6.3 `aubr build:admin` and a manual `wrangler dev` pass: visit `/admin/discovery` (stat tiles, pills, cards, expand, retry), confirm `/admin/logs/discovery` redirects, confirm the Logs all-jobs `discovery-sweep` entry's link points at `/admin/discovery`.
- [x] 6.4 Confirm `docs/TOOLS.md`/`docs/SCHEMAS.md`/`docs/ARCHITECTURE.md` need no edits (no MCP/schema/architecture change) per the proposal's Impact section.
