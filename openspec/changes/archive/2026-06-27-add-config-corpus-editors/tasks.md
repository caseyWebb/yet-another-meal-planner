## 1. Worker D1 helpers (`src/corpus-db.ts`)

- [x] 1.1 Add `addFlyerTerms(env, terms: string[]): Promise<number>` — insert-or-ignore over the bare `term` PK, trimming each term and skipping empties; returns the count actually added. Mirrors `addFeedRows`'s shape.
- [x] 1.2 Add five delete helpers, each a single `DELETE … WHERE <pk> = ?1` through `src/db.ts`, returning `Promise<boolean>` (was a row removed) — precedent `deleteStore`: `deleteAlias(env, variant)`, `deleteFlyerTerm(env, term)`, `deleteFeed(env, url)`, `deleteSender(env, address)`, `deleteMember(env, address)`. The two address-keyed helpers normalize (trim + lowercase) the key before the `WHERE`, matching the add-side write semantics in `addSourceRows`.
- [x] 1.3 `test/corpus-db.test.ts` (or extend the existing suite): `addFlyerTerms` dedups; each delete removes the matching row and reports `true`, a miss reports `false`; an address delete with mixed case / surrounding whitespace still hits the normalized stored row.

## 2. Writable admin API (`src/admin.ts`)

- [x] 2.1 In `routeAdminApi`, add a `/admin/api/corpus/<table>` group **before** the read-only `/admin/api/data/` block. Match `<table>` against the fixed allowlist `aliases | flyer-terms | feeds | senders | members` (a bad table → `not_found`); dispatch `GET` (list), `POST` (add), `DELETE …/<key>` (remove by PK), any other method → `unsupported` (405).
- [x] 2.2 `GET` returns `{ rows: [...] }` from the existing read helpers (`readAliases` → `[{variant,canonical}]`, `readFlyerTerms` → `[{term}]`, `readFeeds`, `readAllowlist` split into `senders`/`members`). Column order is the server's, matching the editor's `columns`.
- [x] 2.3 `POST` parses + validates the body per table, then calls the add helper: `aliases` upsert via `addAliases` (require non-empty `variant` + `canonical`); `flyer-terms` via `addFlyerTerms` (non-empty `term`); `feeds` via `addFeedRows` (require `url`; `weight` numeric default 1; `tags` a string array); `senders`/`members` via `addSourceRows` (require `address`; `senders` optional `name`). Reject with a structured `validation_failed` `ToolError` on a bad/empty field — write nothing.
- [x] 2.4 `DELETE` takes the trailing path segment as the (URL-decoded) PK and calls the matching delete helper; a removed row → `{ removed: true }`, a miss → `{ removed: false }` (not a 404 — idempotent curation). Address tables normalize in the helper (task 1.2).
- [x] 2.5 `test/admin.test.ts` (or its API suite): for each table, `GET` lists, `POST` adds (and an invalid body is rejected with no write), `DELETE` removes; an unknown `<table>` is `not_found`; a `PUT`/`PATCH` is `unsupported` (405); and the whole group is `404` when Access is unconfigured (rides the existing gate — assert via the same harness the `/admin/api/discovery/config` tests use).

## 3. Routing (`admin/src/Route.elm`)

- [x] 3.1 Add `type ConfigRoute = Calibration | Aliases | FlyerTerms | Feeds | Senders | Members` and thread it through `Route` as `Config ConfigRoute` (replacing the bare `Config`). Parse `/admin/config` → `Config Calibration`, `/admin/config/<slug>` → the matching variant (unknown slug → `NotFound`), and print each back to its canonical slug (`flyer-terms`, `senders`, `members`, …) — paralleling `DataRoute`/`dataSegments`.
- [x] 3.2 `admin/tests/RouteTest.elm`: parse/print round-trip for every `ConfigRoute` slug, bare `/admin/config` → `Calibration`, and an unknown `/admin/config/bogus` → `NotFound`.

## 4. Config shell + calibration move (`admin/src/Config.elm`, `admin/src/Config/Calibration.elm`)

- [x] 4.1 Move the current `Config.elm` body (the discovery calibration console) verbatim into `Config/Calibration.elm` (`Model`/`Msg`/`init`/`update`/`view` unchanged) so its behavior and its tests are untouched.
- [x] 4.2 Rewrite `Config.elm` as a shell over a `Section` union (the live sub-view + its model, like `Data.Section`): a pill sub-nav (Calibration · Aliases · Flyer terms · Feeds · Senders · Members), a `goto` that preserves a sub-view's state on same-view nav and builds fresh otherwise, and exhaustive `update`/`view` delegation. No `_ ->` that swallows a section.

## 5. Generic table editor (`admin/src/Config/TableEditor.elm`)

- [x] 5.1 New module: `Model` = `{ config : EditorConfig, rows : WebData (List Row), draft : Draft, action : ActionState }` with `ActionState = Idle | Busy Operation | Failed Operation Http.Error` and `Operation = Add | Remove String` (the row key). `init config` fetches `GET /admin/api/corpus/<slug>`.
- [x] 5.2 `view`: the loaded rows as a table with a per-row **Remove** button (disabled while any mutation is `Busy`), an add-form built from `config.addFields`, and a `Failed` banner rendering the real `Http.Error` with which-operation context. Each load/mutation state renders distinctly (no `Bool`/`Maybe String`).
- [x] 5.3 `update`: `Add` → `POST` the encoded draft, `Remove key` → `DELETE …/<key>`; on success **refetch** the list (don't locally patch); on failure → `Failed op err`. One mutation at a time falls out of `ActionState`.
- [x] 5.4 Define the five `EditorConfig` values (columns, decoders, add encoders, `rowKey`, add-form fields) for aliases / flyer-terms / feeds / senders / members. Wire them as the five non-Calibration sections in `Config.elm`.
- [x] 5.5 `admin/tests/` for `TableEditor`: row decode for a representative table, add-draft encode, `rowKey` extraction, and the `ActionState` transitions (Idle→Busy→Idle on success, Idle→Busy→Failed on error, no second mutation while Busy).

## 6. Shell wiring (`admin/src/Main.elm`)

- [x] 6.1 Update the `Config` arms of `stepTo`/`enter` to delegate to `Config.goto`/`Config.init` over the `ConfigRoute` (paralleling the `Data` arms), and the `viewNav` `Config` link to `Config Calibration`. Keep `isConfig` matching any `Config _`. `wrapClass` for `Config _` stays `wrap-wide`.

## 7. Build, docs, verify

- [x] 7.1 `aubr build:admin` regenerates `admin/dist/` (needs `package.elm-lang.org`; if unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md`).
- [x] 7.2 Update `docs/SELF_HOSTING.md` — note the Config area now hosts operator add/remove editors for the five shared-corpus tables (the operator curation surface; remove is operator-only, the agent only adds). Optional one-line pointer in `docs/SCHEMAS.md` that the operator panel writes these tables.
- [x] 7.3 `aubr test` + `aubr test:admin` green (new Worker corpus-db / admin-API tests, new Elm Route / TableEditor tests, existing calibration + data-explorer tests unaffected). `aubr typecheck` clean.
- [x] 7.4 `openspec validate add-config-corpus-editors --strict` passes.
