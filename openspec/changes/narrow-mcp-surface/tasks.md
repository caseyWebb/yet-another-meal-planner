# Tasks — narrow-mcp-surface

## 1. Registration mechanism

- [ ] 1.1 Add `RegistrationContext` (`profile`, `operator`, `kroger`, `instacart`) and resolve it in the MCP handler: `loadDeploymentProfile(env)` (one cached read), `isOperator` (export from `reconcile-tools.ts` or hoist to `tenant.ts`), non-empty `KROGER_CLIENT_ID`/`KROGER_CLIENT_SECRET`, `getInstacartConfig(env) !== null`. Thread it into `buildServer(env, tenant, origin, ctx)`.
- [ ] 1.2 Gate the Kroger set on `ctx.kroger`: `flyer` (task 3.5), `kroger_prices`, `kroger_login_url`, `place_order` (`registerOrderTools`), `display_order_review` + its app ops (`registerOrderReviewWidget`). `ready_to_eat_available` rides this gate unchanged (its removal belongs to `remove-ready-to-eat`).
- [ ] 1.3 Gate `create_instacart_handoff` on `ctx.instacart` (`registerInstacartTool`); the shared op keeps its `not_configured` branch for the member API.
- [ ] 1.4 Gate the operator plane on `ctx.operator`: `list_proposals`, `confirm_proposal`, `reconcile_read_signals`, `reconcile_enqueue_proposal` (`registerReconcileTools`). Keep the call-time `isOperator` checks on the reconcile pair as defense in depth.

## 2. App-plane separation

- [ ] 2.1 Re-register `commit_shop` via `registerAppTool` with `_meta.ui.visibility: ["app"]` (move from the plain `server.registerTool` in `tools.ts` next to its grocery-widget siblings); behavior/handler unchanged.
- [ ] 2.2 Audit every widget-callable op for the visibility metadata (grocery snapshot family, order-review family, `commit_shop`) and add a test helper that enumerates registered tools with their `_meta` so the plane split is assertable.

## 3. Fusions and new tools

- [ ] 3.1 `set_recipe_disposition(slug, disposition: "favorite"|"hide"|"none")` in `write-tools.ts` over the existing overlay write (mutual exclusivity, row-delete-when-empty, `not_found` on unknown slug). Register `toggle_favorite`/`toggle_reject` as one-window dispatch aliases onto it.
- [ ] 3.2 Ops-form `update_grocery_list(operations)` in `grocery-tools.ts`: `add` (full `add_to_grocery_list` contract incl. `id` path and `substitutes_for` capture), `update` (existing patch contract; status guard + spend guarantees stay in the shared op), `remove`; per-op `applied`/`conflicts`. Register `add_to_grocery_list`/`remove_from_grocery_list` as dispatch aliases, and accept the old single-patch `update_grocery_list` form by shape-detection for the window.
- [ ] 3.3 `update_pantry` absorbs kitchen: add `equip`/`unequip`/`set_kitchen_note` ops delegating to the kitchen apply path (`EQUIPMENT_VOCAB` conflict on off-vocab, idempotent equip, absent-unequip conflict). Unregister `update_kitchen` and `mark_pantry_verified` (the `verify` op already exists).
- [ ] 3.4 Fuse `read_guidance(domain?, slugs?)` in `guidance.ts`/`tools.ts`: absent `slugs` returns the listing (per-domain, or all domains grouped when `domain` is absent). Register `list_guidance` as a dispatch alias. Remove `save_guidance` registration (`saveGuidance` stays for the admin editor).
- [ ] 3.5 Unified `flyer(filter?)`: `store_flyer`'s resolve/read/staleness behavior under the new name; unregister `kroger_flyer` and `store_flyer`.
- [ ] 3.6 `import_recipe({ url? | text?, title? })` in `discovery-tools.ts`: exactly-one-of validation; URL → egress-guarded fetch + JSON-LD extraction (existing parse op, structured errors); text → `classifyRecipe` (`discovery-classify.ts`) with corrective retry and `tools_hint`-informed conservative gates; both → the shared create op (slug derivation, `slug_exists`, dedup-to-grant returning `{ slug, already_existed: true }`, `recipe_imports` `via 'agent'`, synchronous facet/description seed). Unregister `parse_recipe` and `create_recipe` (operations stay for the sweep).
- [ ] 3.7 `update_taste(content, mode?: "replace"|"append")` (default `replace`; `append` concatenates with a blank-line separator; null narrative appends-as-replace).

## 4. Attention block

- [ ] 4.1 D1 migration `packages/worker/migrations/d1/NNNN_profile_attention.sql`: `ALTER TABLE profile ADD COLUMN last_retrospective_at TEXT;`
- [ ] 4.2 Stamp `last_retrospective_at` (today) in the `retrospective` tool and the member retrospective endpoints (the `last_planned_at` precedent); analyzers untouched.
- [ ] 4.3 Compute `attention` in `assembleUserProfile` (`tools.ts`): `retrospective_due` (cooking_log non-empty AND watermark NULL/&gt;42d), `unverified_perishables` (perishable-category pantry rows with `last_verified_at` NULL/&gt;7d — the member app's needs-verification rule), `stale_areas` (the existing `missing` derivation). Fold the two aggregate reads into the existing `Promise.all`; all writes stay out of the read path. Surface it on `read_user_profile` and the member `GET /api/profile` (same assembly).

## 5. Removals

- [ ] 5.1 Unregister from the member surface (handlers/ops deleted only where nothing else uses them): `read_grocery_list`, `recipe_site_url`, `get_weather_forecast` (keep `resolveTenantForecast` for propose + `GET /api/propose/weather`), `suggest_substitutions`, `match_ingredient_to_kroger_sku`, `compare_unit_price` (cores stay for order/review paths), `update_recipe` (keep the objective-update operation core server-side for the fast-follow admin merge screen), `update_recipe_note`, `remove_recipe_note`, `list_meal_vibes`, `update_meal_vibe`, `remove_meal_vibe` (+ their `*_night_vibe` alias rows), `suggest_meal_vibes`/`suggest_night_vibes`, `update_aliases`, `update_staples`, `update_stockup`, `list_stores`, `read_store`, `update_store`, `remove_store`, `update_store_note`, `remove_store_note`, `read_store_notes`, `update_feeds`, `update_discovery_sources`, `reject_discovery`, `read_discovery_errors`, `read_reconcile_errors`, `read_satellite_rejections`.
- [ ] 5.2 Confirm every cut flow's surviving surface still passes its own tests (member app vibes/notes/pantry/reconcile pages; admin Discovery/Config/Guidance/health) — no shared operation was moved, so this is a test-suite run, not a code change.
- [ ] 5.3 Grep `packages/worker/src` and `test/` for the removed tool names and clean up dead registrations, dead exports, and stale descriptions.

## 6. Deprecation table and aliases

- [ ] 6.1 Add the three alias rows (`toggle_*` → `set_recipe_disposition`; grocery add/remove/old-form → ops `update_grocery_list`; `list_guidance` → `read_guidance`) to the `docs/TOOLS.md` deprecation table with the removal condition (subsequent plugin publish + ≥30 days), plus the `toggle_favorite`/`toggle_reject` app-plane visibility flip at window close.

## 7. Tests

- [ ] 7.1 Registration-matrix unit tests: build the server for member/operator × Kroger on/off × Instacart on/off and assert the exact advertised (model-plane) tool-name sets — the member base set, the gated additions, the operator plane — and that app-plane ops (`commit_shop` included) carry `visibility: ["app"]` and never appear model-visible.
- [ ] 7.2 Fusion tests: `set_recipe_disposition` (three dispositions, exclusivity, row cleanup, alias dispatch parity), ops-form `update_grocery_list` (add/update/remove, status guard, spend guarantees, old-form conversion, alias dispatch), `update_pantry` equip/unequip/set_kitchen_note (vocab conflict, idempotence), fused `read_guidance` (list mode per-domain/all-domains, alias), unified `flyer` (Kroger resolve, satellite staleness, cold cache).
- [ ] 7.3 `import_recipe` tests: url/text exclusivity, JSON-LD path structured errors, pasted-text classify path (mock env.AI), dedup-to-grant `already_existed`, attribution row, facet seed invoked.
- [ ] 7.4 Attention tests: watermark stamping (tool + endpoint), due/not-due boundaries (42d), perishable count rule (7d, categories), `stale_areas` = `missing`, empty-profile degradation.
- [ ] 7.5 `update_taste` mode tests (replace default, append separator, append onto null).
- [ ] 7.6 `aubr typecheck` + `aubr test` green; `aubr test:app` / `aubr test:admin` for 5.2.

## 8. Docs (lockstep, living voice)

- [ ] 8.1 Rewrite `docs/TOOLS.md` to describe exactly the new surface: the member base set, the Kroger/Instacart-gated sets, the operator plane, the app plane (widget-callable ops enumerated as app-callable, not model tools), the fused tool contracts (`set_recipe_disposition`, `import_recipe`, ops `update_grocery_list`, absorbed `update_pantry`, fused `read_guidance`, `flyer`, `update_taste` mode), the `attention` block on `read_user_profile`, and the updated deprecation table. Remove every culled tool's section.
- [ ] 8.2 `docs/SCHEMAS.md`: `profile.last_retrospective_at`, the `read_user_profile` `attention` shape, `import_recipe`'s pipeline note where the parse/create contracts were referenced.
- [ ] 8.3 `docs/ARCHITECTURE.md`: the registration context and planes (member/operator/app, config gates), weather absorbed into the propose op, guidance writes as operator curation.
- [ ] 8.4 Verify no new Worker-owned HTTP route was added (no `run_worker_first` change needed).

## 9. Verification

- [ ] 9.1 Live MCP acceptance: a member connector's `tools/list` equals the target set for the deployment's configuration (`commit_shop` absent; `display_grocery_list` the only list-shaped member verb); an operator session additionally lists the operator plane.
- [ ] 9.2 `openspec validate narrow-mcp-surface` passes; run the code-review skill before PR.
