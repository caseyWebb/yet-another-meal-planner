## Why

The operator panel can manage members (Members) and exercise tools as one member (Dev · Tools), but there is no way to look at the **data itself**. Cross-tenant aggregates, the ~10 D1 tables with no read tool (`aliases`, `sku_cache`, `recipe_derived`, `discovery_senders`, …), the raw R2 corpus, and the answer to "why isn't my recipe showing up in the index?" are all reachable today only by hand — `wrangler d1 execute` and `rclone` against the live bucket. A self-hosted operator needs a first-class, in-panel window into D1 and R2 to debug and audit the group's data.

## What Changes

- Add a new top-level **Data** area to the admin SPA (peer to Status / Members / Dev), client-routed under `/admin/data/*`, holding five **entity-centric, read-only** views. The carve models the *entity*, not the raw table — most of the ~27 tables are one facet of one of these:
  - **Recipe** (`/admin/data/recipes/<slug>`) — a **cross-tier** per-slug view joining the R2 `recipes/<slug>.md` source, the D1 `recipes` projection, `recipe_derived` (description/embedding), any `reconcile_errors` entry, and the **cross-tenant** `overlay` + `recipe_notes` (who favorited/rejected/annotated, named). Its headline is a single derived **projection status** (indexed / skipped-with-reason / pending / orphaned) — the "why isn't it showing up?" answer in one value.
  - **Member** (`/admin/data/members/<id>`) — a **per-tenant 360**: that member's `profile`, `brand_prefs`, `kitchen_equipment`, `staples`, `stockup`, `ready_to_eat`, `overlay`, `pantry`, `meal_plan`, `grocery_list`, `cooking_log`, and authored `recipe_notes` / `store_notes` (including `private` notes — no redaction).
  - **Shared corpus** (`/admin/data/corpus`) — the shared lookup tables (`aliases`, `flyer_terms`, `feeds`, `stores`, `store_notes`, `sku_cache`) plus the authored `guidance/**` R2 markdown tree (rendered with the same viewer the Recipe view uses).
  - **Discovery** (`/admin/data/discovery`) — the newsletter/RSS pipeline state: `discovery_candidates`, `discovery_senders`, `discovery_members`, `discovery_rejections`.
  - **System** (`/admin/data/system`) — operational tables: the full `reconcile_errors`, `bug_reports`, and `schema_meta`.
- Add read-only `GET /admin/api/data/*` JSON endpoints backing those views, **cross-tenant** by design (the admin surface already manages every tenant), routed through `src/db.ts` and `src/corpus-store.ts`. No arbitrary SQL: each endpoint is a fixed query over a named entity/table.
- **No writes** (read-only v1), **no new bindings** (reuses `DB` + `CORPUS`), **no new D1 migrations**, and **no redaction** — the group has no assumed internal privacy, so the operator sees every tenant's rows, named, including `private` notes.
- Reuse the existing canonical readers (`src/profile-db.ts`, `src/session-db.ts`, `src/recipe-index.ts`, `src/corpus-store.ts`) for per-tenant and recipe reads; add a thin cross-tenant/lookup read module only for the genuinely-new queries (the by-slug overlay/notes aggregate and the bare lookup tables).
- Modify the operator-admin **top-level areas** requirement so the enumerated areas include **Data**.

## Capabilities

### New Capabilities
- `operator-data-explorer`: the read-only, cross-tenant Data area of the operator panel — its five entity-centric views, the `/admin/api/data/*` read endpoints behind them, the recipe cross-tier projection-status model, and the no-redaction / read-only / Access-gated guarantees.

### Modified Capabilities
- `operator-admin`: the "Admin panel is organized into top-level areas with client-side routing" requirement gains the **Data** area (Status / Members / Dev / **Data**), with the data views as deep-linkable client routes under `/admin/data/*`.

## Impact

- **Worker** (`src/`): new `src/admin-data.ts` (the `/admin/api/data/*` router + the cross-tenant/lookup reads) wired into `src/admin.ts`'s `routeAdminApi`; reuses `db.ts`, `corpus-store.ts`, `profile-db.ts`, `session-db.ts`, `recipe-index.ts`. All reads are `SELECT` / R2 `get`/`list`; structured errors via `src/errors.ts` (`storage_error` / `upstream_unavailable`), no throws.
- **Admin SPA** (`admin/src/`): new `Data/*.elm` modules (one per view) plus a `Data` page area, new `Route` variants under `/admin/data/*`, and `Main.elm` area wiring (`Page` union + nav). Per `admin/CLAUDE.md`: each fetch is `WebData`; the recipe projection status is a custom type (impossible states unrepresentable), not booleans. Rebuild the committed `admin/dist/` bundle.
- **Gate**: inherits the existing Cloudflare Access gate on `/admin*` unchanged — opt-in (404 when unconfigured), fails closed, loopback-only dev bypass. No new auth surface.
- **Docs**: extend the "Operator admin surface" section of `docs/SCHEMAS.md` with the new `/admin/api/data/*` endpoints; note the Data area in `docs/ARCHITECTURE.md` if the admin overview enumerates areas.
- **Out of scope**: any write/edit/delete of D1 or R2; the KV tier; pagination beyond simple bounds on the two growing tables (`sku_cache`, `cooking_log`).
