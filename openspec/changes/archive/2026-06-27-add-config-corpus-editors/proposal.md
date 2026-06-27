## Why

Five shared-corpus lookup tables — `aliases`, `flyer_terms`, `feeds`, `discovery_senders`, `discovery_members` — are the operator's group-wide tuning surface for matching and discovery, but today the operator can only **read** them (the `Data → Corpus` explorer) and can never **remove** a row from any of them:

- `aliases` and `feeds` and the `discovery_senders`/`discovery_members` allowlist are **add-only** via their MCP tools (`update_aliases`, `update_feeds`, `update_discovery_sources`) — there is no delete anywhere, in any surface.
- `flyer_terms` has **no write path at all** — no MCP tool, no admin endpoint; the warm cron reads it but nothing populates it except a raw D1 mutation.

So a stale feed, a wrong alias, a typo'd allowlist address, or a noisy flyer term can only be fixed by `wrangler d1 execute`. The operator panel is exactly where this curation belongs: it is already the Access-gated, cross-tenant operator surface, and these are group-wide (tenant-free) config.

This change gives the **Config** area a routed editor for each of the five tables — list, add, remove — reusing the existing add-side D1 helpers and adding the missing delete (and `flyer_terms` add) helpers. **Remove stays operator-only**: no MCP delete tools are added, consistent with `flyer_terms` already being agent-invisible — the agent keeps adding, the operator curates and prunes.

## What Changes

- **The Config area becomes a routed shell with a pill sub-nav** (mirroring the Data area, not the Dev scroll-sections): `/admin/config` keeps the discovery **Calibration** console as its default sub-view, and five new sibling sub-routes host the table editors — `/admin/config/aliases`, `/admin/config/flyer-terms`, `/admin/config/feeds`, `/admin/config/senders`, `/admin/config/members`. Each is deep-linkable and fetches on demand. The existing calibration console moves verbatim into a `Config.Calibration` sub-view; its behavior is unchanged.
- **A generic `Config.TableEditor` Elm module** (precedent: the read-only `Data.Table` is already generic) renders one shared-corpus table as list + add-form + per-row remove, configured per table by a record (label, column specs, row decoder, add encoder, primary-key extractor, endpoint base). The five editors are five instances. Modeled per `admin/CLAUDE.md`: the loaded rows are `WebData (List Row)`; the in-flight mutation + its failure are a single `ActionState` custom type (`Idle | Adding | Removing Key | Failed Operation Http.Error`), never a `busy : Bool` + `Maybe String` triple; one mutation at a time falls out for free.
- **A new writable admin API namespace `/admin/api/corpus/<table>`** in `src/admin.ts`, sibling to `/admin/api/discovery/config` and leaving the read-only `/admin/api/data/*` explorer untouched. Per table: `GET` lists the rows, `POST` adds one (validated), `DELETE /admin/api/corpus/<table>/<key>` removes by primary key. Access-gated exactly like the rest of `/admin*` (404 when Access is unconfigured), cross-tenant, never exposed as MCP tools.
- **Worker D1 helpers (`src/corpus-db.ts`):** *reuse* `addAliases`, `addFeedRows`, `addSourceRows`; *add* `addFlyerTerms` (none exists) and five delete helpers — `deleteAlias(variant)`, `deleteFlyerTerm(term)`, `deleteFeed(url)`, `deleteSender(address)`, `deleteMember(address)` (precedent: `deleteStore`). Address-keyed deletes normalize (trim + lowercase) to match the add-side write semantics so a delete always hits the row an add produced.

## Capabilities

### New Capabilities

<!-- none — this extends the existing operator-admin Config area -->

### Modified Capabilities

- `operator-admin`: **MODIFIES** the area-organization requirement (Config is no longer single-occupant — it gains routed editor sub-views) and the Config-area requirement (it now hosts the calibration console **and** the corpus editors). **ADDS** a requirement for the operator-only corpus add/remove editors and their `/admin/api/corpus/*` endpoints.

## Impact

- **Admin SPA (`admin/src/`):** `Route.elm` gains a `ConfigRoute` union (`Calibration | Aliases | FlyerTerms | Feeds | Senders | Members`) with its sub-route parsing/printing, paralleling `DataRoute`. `Config.elm` becomes a shell (sub-nav + delegate) like `Data.elm`; the current calibration body moves to `Config/Calibration.elm`. New `Config/TableEditor.elm` (generic) plus the five per-table config records. `Main.elm` wires `Config` like `Data` (a `goto`/`stepTo` for `ConfigRoute`). Rebuilds the committed `admin/dist/` via `aubr build:admin` (needs `package.elm-lang.org`; if unreachable, land source and leave the rebuild to CI per `admin/CLAUDE.md`).
- **Worker (`src/admin.ts`, `src/corpus-db.ts`):** the new `/admin/api/corpus/*` route group and the new add/delete D1 helpers. All writes go through `src/db.ts` (throw-free, structured `storage_error`); the route handlers stay `ToolError`-based like the rest of `routeAdminApi`. No migration — the five tables already exist (`migrations/d1/0006_shared_corpus.sql`).
- **MCP tools:** **none** — no delete tools added; remove is operator-only. The existing `update_aliases`/`update_feeds`/`update_discovery_sources` add tools are unchanged.
- **Docs:** the `operator-admin` spec via this change's delta, and a line in `docs/SELF_HOSTING.md` describing the new operator curation surface. `docs/TOOLS.md` unaffected (no tool-contract change); `docs/SCHEMAS.md` unaffected (no data-shape change — the tables exist) beyond an optional pointer that the operator panel is now a write surface for them.
- **Tests:** Worker — `src/corpus-db.ts` add/delete helpers (incl. address normalization on delete and `addFlyerTerms` dedup) and the `/admin/api/corpus/*` route behavior (GET/POST/DELETE, validation rejection, 404 when Access unconfigured, 405 on a bad method). Elm — `Route` parse/print round-trip for the new `ConfigRoute` sub-routes, and `Config.TableEditor` decode/encode plus the `ActionState` transitions. No change to the read-only `/admin/api/data/*` tests.
- **Security:** the new endpoints are mutating and cross-tenant, so they ride the **same** Cloudflare Access gate as the rest of `/admin*` (verified before `routeAdminApi`), the same opt-in 404-when-unconfigured rule, and the same loopback-only dev bypass. No new secret, no new gate. Input is validated server-side (non-empty keys, numeric feed weight, normalized addresses); the admin surface is the sole writer of these via this path.
