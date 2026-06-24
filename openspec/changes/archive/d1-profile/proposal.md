## Why

Roadmap slice 4 of `cloudflare-storage-architecture`, and the realization of the **redirected `json-profile-bundle`** change: the per-tenant profile bundle moves from a TOML-strings-inside-a-JSON-blob in `DATA_KV` (`profile:<username>`) to **normalized D1 tables**. This is the heaviest slice and the highest-value for the coming admin UI — the profile is exactly the data an operator/member edits.

Two things make D1 the right home, beyond consistency and admin-editability:

- **Group ratings become a query.** `read_recipe_notes` today enumerates the entire tenant directory and reads each tenant's overlay out of their KV bundle — an O(tenants) scan — to compute "rated 4+ by others." With overlay as a D1 table that's a single indexed `GROUP BY`.
- **The TOML/JSON serialization question disappears.** The fields were TOML strings; `json-profile-bundle` would have made them JSON strings. In D1 they are columns and rows — no document format at all, with JSON columns only for the genuinely freeform bits (`preferences.custom`, `kitchen.notes`).

This slice carries forward `json-profile-bundle`'s validated interface design intact — `update_preferences` as a deep **merge-patch** over a defined top-level schema plus an open `custom` — and lands it on D1, where the `brands` tri-state maps onto UPSERT/DELETE of a `brand_prefs` row.

## What Changes

- **NEW** schema `migrations/d1/0004_profile.sql` — per-tenant tables:
  - `profile(tenant PK, taste, diet_principles, default_cooking_nights, lunch_strategy, ready_to_eat_default_action, stores /*json*/, dietary /*json*/, custom /*json*/, kitchen_notes /*json*/, freezer_capacity_estimate)` — the singleton row: scalars + freeform JSON + the two markdown fields.
  - `brand_prefs(tenant, term, ranks /*json array*/, PK(tenant, term))` — the tri-state brand map (absent row = ambiguous; `ranks='[]'` = don't-care; non-empty = ranked).
  - `kitchen_equipment(tenant, slug, PK(tenant, slug))` — owned equipment (the makeability gate's left operand).
  - `staples(tenant, name, normalized_name, perishable, PK(tenant, normalized_name))`.
  - `overlay(tenant, recipe, rating, status, PK(tenant, recipe))` — per-tenant subjective; `rate_recipe` (slice 3) swaps its backend here.
  - `ready_to_eat(tenant, slug, meal, name, status, category, source, brand, notes, PK(tenant, slug))`.
  - `stockup(tenant, name, normalized_name, unit, typical_purchase, notes, baseline_price, buy_at_or_below, PK(tenant, normalized_name))`.
- **NEW** data backfill `migrations/0003-profile-d1.mjs` — read each `profile:<username>` KV bundle, parse the TOML/markdown fields, INSERT into the D1 tables, then delete the KV bundle key. Idempotent (delete-then-insert per tenant; absent KV key = already migrated).
- **`update_preferences` → merge-patch on D1** (the `json-profile-bundle` design): `patch` object, RFC-7396 deep merge, `null` deletes; staged validation (top-level keys ∈ defined set else error toward `custom`; types validated on the merged result). Applied as: scalar/JSON columns `UPDATE`d on `profile`; `brands` entries UPSERT/DELETE `brand_prefs` rows (value sets, `null` deletes — the tri-state); `custom`/`stores`/`dietary` merged into their JSON columns.
- **All structured profile writes target D1** (object/row writes, no TOML, no header comments): `update_taste`, `update_diet_principles` (`UPDATE profile`); `update_kitchen` (UPSERT/DELETE `kitchen_equipment` + `profile.kitchen_notes`); `update_staples` (UPSERT/DELETE `staples`); `update_stockup` (UPSERT `stockup` + `profile.freezer_capacity_estimate`); `add_draft_ready_to_eat`/`update_ready_to_eat` (UPSERT `ready_to_eat`); `rate_recipe` (UPSERT `overlay`).
- **Reads target D1**: `read_user_profile` assembles the profile from D1 (a batch of per-table queries / JOINs) and returns the same shape; `getPreferences` (assemble from `profile` + `brand_prefs`), `getOverlay`, `getOwnedEquipment`, the weather location resolver, and the matcher's `[brands]` all read D1.
- **Group ratings → SQL**: `read_recipe_notes`' ratings aggregation becomes a single `SELECT rating, status, tenant FROM overlay WHERE recipe=?` across the group (no tenant-directory scan). (The notes half still reads GitHub until slice 6 — `read_recipe_notes` is hybrid until then.)
- **Deletion of the KV-bundle layer**: `src/user-kv.ts` profile-bundle helpers (`readProfileBundle`/`writeProfileBundle`/`updateProfileField`, `ProfileBundle`) and the TOML codecs that only served them — `parseOverlay`/`serializeOverlay`/`quoteKey`/`formatScalar` (`overlay.ts`), the `parseToml`/`stringifyTomlWithHeader` calls + `*_HEADER` blocks in `staples.ts`/`stockup.ts`, `toInventory`'s parse, the `parseToml(bundle.preferences)` sites — are removed. `smol-toml` leaves the profile path entirely (still used for the GitHub corpus until slice 6).

## Capabilities

### Modified Capabilities

- `data-write-tools`: profile/overlay/staples/stockup/kitchen/ready_to_eat writes target D1; `update_preferences` is a merge-patch over the structured D1 preferences.
- `data-read-tools`: `read_user_profile` and the profile read helpers assemble from D1; no TOML parsing on the profile path.
- `recipe-notes`: the group-ratings aggregation reads the D1 `overlay` table (single query), not a tenant-directory KV scan.

## Impact

- New `migrations/d1/0004_profile.sql`, `migrations/0003-profile-d1.mjs`.
- `src/user-kv.ts` (drop profile-bundle helpers; session-state helpers stay until slice 5), `src/overlay.ts` (drop TOML codecs; keep `applyOverlayEdit`/`mergeOverlay` semantics as row ops), `src/staples.ts` / `src/stockup.ts` / `src/kitchen.ts` (object/row helpers), `src/write-tools.ts` (all profile write tools + `update_preferences` merge-patch + `rate_recipe` backend), `src/tools.ts` (read helpers → D1), `src/notes-tools.ts` (ratings → D1 query), `src/validate.ts` (structured `preferences` validator on the merged result).
- New `src/profile-db.ts` (or similar): the D1 assembly/persistence for the profile.
- `docs/SCHEMAS.md` (profile D1 tables; the `preferences` shape + merge-patch contract), `docs/TOOLS.md` (`update_preferences` patch param), `docs/ARCHITECTURE.md` (profile in D1).
- `AGENT_INSTRUCTIONS.md` + plugin rebuild: `update_preferences` patch shape; delete the configure-profile "read the whole file and rewrite every field so a later write doesn't clobber the ZIP" instruction — the deep merge / row writes are the non-clobber guarantee.

## Supersedes / Depends On

- **Supersedes `json-profile-bundle`** (already marked REDIRECTED): this slice realizes its interface design on D1. `json-profile-bundle` can be archived once this lands.
- **Depends on** `d1-foundation` (rails), `d1-recipe-index` (slug references), and pairs with `retire-commit-changes` (`rate_recipe` exists; its overlay backend swaps to D1 here).
