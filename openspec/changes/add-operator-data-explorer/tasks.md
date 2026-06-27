## 1. Worker read layer (`src/admin-data.ts`)

- [x] 1.1 Create `src/admin-data.ts` that closes over `db(env)` and `createR2CorpusStore(env.CORPUS)` — never `env.DB` directly — and returns structured errors (`storage_error` / `upstream_unavailable`), no throws.
- [x] 1.2 Recipe cross-tier assembly: given a slug, read the R2 `recipes/<slug>.md` source, the D1 `recipes` projection row (via `src/recipe-index.ts`), the `recipe_derived` row, and any `reconcile_errors` entry; derive the projection status `indexed | skipped(reason) | pending | orphaned` and a `Described | DescriptionPending` derived state (embedding shown as presence + hash, never raw floats).
- [x] 1.3 Cross-tenant per-slug aggregate: one query returning every tenant's `overlay` disposition (favorite/reject, named by tenant) and `recipe_notes` for the slug.
- [x] 1.4 Recipe listing: enumerate slugs (R2 `recipes/` ∪ `recipes` rows) and return `{slug, title, status}` for each, so orphaned/skipped slugs appear, not only indexed ones.
- [x] 1.5 Member 360 assembly: resolve the id against the allowlist (`resolveTenant`, `not_found` on miss); reuse `src/profile-db.ts` + `src/session-db.ts` readers for profile/session state, and gather `overlay`, `cooking_log`, and authored `recipe_notes`/`store_notes` (by `author`) — no redaction (private notes included).
- [x] 1.6 Lookup-table reads: fixed `SELECT` per named table for `aliases`, `flyer_terms`, `feeds`, `stores`, `store_notes`, `sku_cache` (bounded default `LIMIT`), `discovery_candidates`, `discovery_senders`, `discovery_members`, `discovery_rejections`, `reconcile_errors`, `bug_reports`, `schema_meta` — table name matched against an allowlist, never interpolated SQL.
- [x] 1.7 Guidance R2 browse: list the `guidance/**` tree (corpus-store `list`/`listDir`) and return a single guidance object's markdown text by key.

## 2. Worker API routing (`src/admin.ts`)

- [x] 2.1 Extend `routeAdminApi` with the read-only `GET /admin/api/data/*` routes: `recipes`, `recipes/<slug>`, `members/<id>`, `corpus/<table>`, `corpus/guidance` (list) + guidance object, `discovery/<table>`, `system/<table>`.
- [x] 2.2 Reject non-GET methods on data routes with the existing `unsupported` (405) path; confirm the routes sit inside `handleAdmin` so they inherit the Access gate (404 when the gate is disabled) with no new auth code.
- [x] 2.3 Map a bad/unknown table or slug to the existing `not_found` (404) structured error via `statusFor`.

## 3. Worker tests (`test/*.test.ts`)

- [x] 3.1 Recipe projection status: a test per state — indexed, skipped (carries the reconcile reason), pending, orphaned — over an in-memory D1 + corpus store.
- [x] 3.2 Cross-tenant aggregate names each tenant's disposition/notes for a slug.
- [x] 3.3 Member view assembles full per-tenant state including a `private` note; an unknown id returns `not_found`.
- [x] 3.4 `sku_cache` read is bounded by the default limit; a data route rejects a non-allowlisted table name.
- [x] 3.5 Read-only guarantee: exercising the data routes creates/updates/deletes no D1 row or R2 object; data routes 404 when the Access gate is unconfigured.

## 4. Admin SPA — routing & shell (`admin/src/`)

- [x] 4.1 `Route.elm`: add the Data routes under `/admin/data/*` (recipe list + `recipes/<slug>`, `members/<id>`, `corpus`, `discovery`, `system`), with `toString`/`href` and deep-link parsing.
- [x] 4.2 `Main.elm`: add a `Data` top-level area — a `Page` union arm per data view (so being "on a data page holding another's model" is unrepresentable), a nav link, and the `enter`/`stepTo` wiring.
- [x] 4.3 Generic typed table renderer module (header + `List (List Cell)`) shared by the three flat views, decoding a `{columns, rows}` JSON shape.

## 5. Admin SPA — bespoke views

- [x] 5.1 Recipe view module: the `RecipeTier` custom type (`Indexed DerivedState | Skipped ReconcileError | PendingReconcile | Orphaned`) + decoder, the `WebData` fetch, and a view showing the cross-tier record (R2 source as raw markdown text, projection row, derived description, reconcile reason, named cross-tenant dispositions/notes). Recipe list view shows each slug's status.
- [x] 5.2 Member view module: the per-tenant bundle model + decoder (profile/session/overlay/cooking_log/authored notes), `WebData` fetch keyed by member id, and a sectioned view; member picker fed by the existing `/admin/api/tenants` listing.

## 6. Admin SPA — flat views & guidance

- [x] 6.1 Shared-corpus view: the lookup tables through the generic renderer, plus a `guidance/**` browser (tree listing + raw markdown object view) reusing the Recipe view's markdown text rendering.
- [x] 6.2 Discovery view and System view: wire each table to the generic renderer (`discovery_*`; `reconcile_errors`/`bug_reports`/`schema_meta`).

## 7. Admin SPA — tests (`admin/tests/`)

- [x] 7.1 `RecipeTier` decoder test covering all four statuses (incl. skipped-with-reason and the derived state).
- [x] 7.2 Generic table decoder test and member-bundle decoder test.

## 8. Build, docs & validation

- [x] 8.1 `aubr build:admin` to rebuild the committed `admin/dist/` bundle (if `package.elm-lang.org` is unreachable in the sandbox, leave the rebuild to CI and say so — do not commit a stale bundle).
- [x] 8.2 `aubr typecheck`, `aubr test`, `aubr test:tooling`, and `aubr build:admin --check` all green.
- [x] 8.3 Extend the "Operator admin surface" section of `docs/SCHEMAS.md` with the `GET /admin/api/data/*` endpoints; note the **Data** area in `docs/ARCHITECTURE.md`'s admin overview.
- [x] 8.4 `openspec validate "add-operator-data-explorer"` passes; fill the PR template (What & why + every consideration checked).
