## 1. Schema + backfill

- [x] 1.1 Add `migrations/d1/0004_profile.sql`: the `profile`, `brand_prefs`, `kitchen_equipment`, `staples`, `overlay`, `ready_to_eat`, `stockup` tables + `idx_overlay_recipe`.
- [x] 1.2 Add `migrations/0003-profile-d1.mjs` (`up({ kv, d1, dataRoot, log })`): per `profile:<username>`, parse the TOML/markdown fields, delete-then-insert the tenant's rows across the profile tables, then `kv.delete` the bundle key. Idempotent (absent key → skip). Don't touch `state:<username>:*`. (Tenant list read from the KV directory/bundle keys; `dataRoot` not needed.)
- [x] 1.3 Test the backfill against a sample bundle (all fields → rows; brands tri-state preserved; re-run no-ops; KV key removed). — `tests/profile-d1-backfill.test.mjs` (in `test:tooling`).

## 2. D1 profile data layer

- [x] 2.1 Add `src/profile-db.ts`: assembly reads (`readProfile`, `readPreferences`, `readOverlay`, `readOwnedEquipment`, `readBrandPrefs`) and row writers (`setProfileFields`/`profileUpsertStmt`, `brandStmt` UPSERT/DELETE, `setStaples`, `setStockup`, `setOverlay`, `setReadyToEat`, `setKitchen`) over `src/db.ts`, using `batch` for multi-row writes. (Replace-style `set*` for the list tables and a `brandStmt` UPSERT/DELETE for the tri-state, in place of the suggested per-row `upsert*`/`delete*` names — same semantics.)
- [x] 2.2 Port `overlay.ts` semantics (`applyOverlayEdit`, `mergeOverlay`, `DEFAULT_STATUS`) to operate on rows/objects; delete `parseOverlay`/`serializeOverlay`/`quoteKey`/`formatScalar`.
- [x] 2.3 Port `staples.ts`/`stockup.ts`/`kitchen.ts` pure logic to object/row in/out; delete their `parseToml`/`stringifyTomlWithHeader`/`*_HEADER` usage.

## 3. Reads → D1

- [x] 3.1 `src/tools.ts`: `read_user_profile` assembles from `src/profile-db.ts`; `getPreferences`/`getOverlay`/`getOwnedEquipment` and the weather location resolver read D1. Same returned shapes.
- [x] 3.2 Matcher wiring (`resolveIngredient`): `brands` from `readBrandPrefs(tenant)`.
- [x] 3.3 `src/notes-tools.ts` `read_recipe_notes`: ratings via `SELECT … FROM overlay WHERE recipe=?` scoped to the caller's group (drop the per-tenant bundle scan); notes half unchanged (GitHub, until slice 6).

## 4. Writes → D1

- [x] 4.1 `update_preferences` → merge-patch on D1: `mergePatch` + staged validation (unknown top-level key → error toward `custom`; enum/type checks on the merged result — in `src/preferences.ts`, wired into the tool); apply as `profile` column updates + `brand_prefs` UPSERT/DELETE + JSON-column deep-merge, in one `batch`. (Validator lives in `src/preferences.ts` rather than `src/validate.ts`, which validates GitHub-committed files only.)
- [x] 4.2 `update_taste`/`update_diet_principles` → `UPDATE profile`.
- [x] 4.3 `update_kitchen` → `kitchen_equipment` rows + `profile.kitchen_notes`.
- [x] 4.4 `update_staples` → `staples` rows (normalized-name dedup).
- [x] 4.5 `update_stockup` → `stockup` rows + `profile.freezer_capacity_estimate`.
- [x] 4.6 `add_draft_ready_to_eat`/`update_ready_to_eat` → `ready_to_eat` rows.
- [x] 4.7 `rate_recipe` (from slice 3): swap its backend from the KV overlay to `setOverlay` (D1).

## 5. Delete the KV-bundle layer

- [x] 5.1 `src/user-kv.ts`: removed `ProfileBundle`, `readProfileBundle`, `writeProfileBundle`, `updateProfileField`, `getProfileBundle`, `deleteProfileBundle` (kept the `state:*` session helpers). File header updated.
- [x] 5.2 Removed the now-unused `smol-toml`/`parse`/`serialize` imports from the profile path; `smol-toml` is imported only by the GitHub-corpus modules (validate/stores/notes/email/feeds/order/parse/serialize).
- [x] 5.3 Grepped `src/**`/`test/**` for `profile:` / `ProfileBundle` / `parseOverlay` / `bundle.<field>` and cleaned up.

## 6. Docs + agent

- [x] 6.1 `docs/SCHEMAS.md`: the profile D1 tables; the `preferences` shape (defined keys + `custom`) and merge-patch contract; the TOML profile schemas reframed as the assembled-from-D1 shapes.
- [x] 6.2 `docs/TOOLS.md`: `update_preferences` `patch` param; profile writes are D1-backed.
- [x] 6.3 `docs/ARCHITECTURE.md`: profile in D1; group ratings as a SQL aggregate.
- [x] 6.4 `AGENT_INSTRUCTIONS.md`: `update_preferences` patch shape (incl. brands tri-state); deleted the configure-profile "read the whole file and rewrite every field" instruction. Rebuilt the plugin.

## 7. Close out json-profile-bundle

- [ ] 7.1 Archive `json-profile-bundle` (realized here) and `finish-kv-migration` (absorbed). DEFERRED to the orchestrator's final cleanup (per the task brief — do not archive here).

## 8. Verify

- [x] 8.1 `npm run typecheck` + `npm test` + `npm run test:tooling` green (D1 read/write, merge-patch validation incl. brands tri-state, backfill).
- [ ] 8.2 Manual verification needs LIVE D1 (no Cloudflare/D1 in this environment) — covered structurally by the unit tests (read assembly parity, partial-patch non-clobber, `rate_recipe` overlay write, group-ratings query) against a fake D1. Flag for the operator's deploy-time `/health` probe + manual smoke.
