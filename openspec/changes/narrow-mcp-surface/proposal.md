# narrow-mcp-surface

## Why

The member MCP surface accreted to ~84 advertised tools; weak models pick the wrong one of three overlapping list reads, and the audience is shifting to non-LLM household members. This change shrinks the member-advertised surface to ~28 base tools (+5 Kroger-gated, +1 Instacart-gated) via conditional registration, tool fusions, an app-plane separation for widget-callable ops, and a server-computed `attention` staleness block.

## What Changes

- **NEW conditional tool registration** in `buildServer` (`packages/worker/src/tools.ts`): a per-request registration context — deployment profile (`loadDeploymentProfile`), operator identity (`isOperator`, moved from call-time rejection to registration-time gating), Kroger-configured, Instacart-configured — decides which tools register. Member connectors advertise only the member surface.
- **NEW app-plane separation**: every widget/app-bridge-callable op registers with the existing ext-apps `_meta.ui.visibility: ["app"]` convention (`registerAppTool`) and is never advertised to the model. **Fixes the `commit_shop` leak** (registered model-visible today while its snapshot/checked/buy-anyway/verify/substitution/relist/mark-placed siblings are app-only).
- **BREAKING** Operator-only registration: `reconcile_read_signals`, `reconcile_enqueue_proposal`, `list_proposals`, `confirm_proposal`, and `update_recipe` (the merge-review flow's corpus writer) register only for the operator tenant. Members confirm reconcile proposals in the web app.
- **BREAKING** Config-gated registration: the Kroger tool set (`flyer`, `kroger_prices`, `display_order_review`, `place_order`, `kroger_login_url`) registers only when Kroger credentials are configured; `create_instacart_handoff` only when Instacart is configured.
- **NEW `set_recipe_disposition(slug, disposition: "favorite" | "hide" | "none")`** — fuses `toggle_favorite`/`toggle_reject`; mutual exclusivity preserved. One-window dispatch aliases for the old names.
- **NEW `import_recipe(url | text)`** — fuses `parse_recipe` + `create_recipe`: parse (JSON-LD) or classify (pasted text, the discovery sweep's classify path), validate, write, return `{ slug }`; dedup-to-grant and attribution guarantees carried over; the facet-derivation cron/seed owns classification.
- **BREAKING** `update_grocery_list` becomes ops-fused (`operations: [{ op: "add" | "update" | "remove", … }]`), absorbing `add_to_grocery_list`/`remove_from_grocery_list` — the `update_pantry` operations idiom. One-window dispatch aliases for the old names and the old single-patch call form. Status-guard and spend guarantees unchanged.
- **BREAKING** `update_pantry` absorbs `mark_pantry_verified` (the existing `verify` op already covers it) and `update_kitchen`'s ops (new `equip` / `unequip` / `set_kitchen_note` ops over the same kitchen apply path); both standalone tools are removed.
- **BREAKING** `read_guidance` fused with `list_guidance`: omit `slugs` to list a domain (or all domains). `list_guidance` becomes a one-window dispatch alias.
- **BREAKING** `kroger_flyer` + `store_flyer` unify into one config-gated `flyer` tool (same `{ items, as_of }` contract, store resolved from the profile, satellite staleness ceiling retained).
- **NEW** `update_taste` gains a `mode: "replace" | "append"` (default `replace`) so silent captures can't clobber the narrative.
- **NEW `attention` block on `read_user_profile`**: server-computed `{ retrospective_due, unverified_perishables, stale_areas }` (deterministic Worker math; one new nullable `profile.last_retrospective_at` watermark column, stamped by the retrospective surfaces — the `last_planned_at` precedent). Data capability only; the persona's one-light-nudge rule is a later change.
- **BREAKING** propose absorbs weather: `get_weather_forecast` is removed as a tool; the shared propose operation already loads the tenant forecast server-side (`resolveTenantForecast`), and `GET /api/propose/weather` remains.
- **BREAKING** Hard removals from the member surface (no shim; stale calls get the generic unknown-tool rejection after a coordinated plugin publish): `read_grocery_list`, `recipe_site_url`, `get_weather_forecast`, `suggest_substitutions`, `match_ingredient_to_kroger_sku`, `compare_unit_price` (both live on as internal/pipeline cores), `parse_recipe`, `create_recipe`, `update_recipe` (member side), `update_recipe_note`, `remove_recipe_note`, `list_meal_vibes`, `update_meal_vibe`, `remove_meal_vibe`, `suggest_meal_vibes` (+ its `suggest_night_vibes` alias), `update_aliases`, `update_staples`, `update_stockup`, `update_kitchen`, `mark_pantry_verified`, `list_stores`, `read_store`, `update_store`, `remove_store`, `update_store_note`, `remove_store_note`, `read_store_notes`, `update_feeds`, `update_discovery_sources`, `reject_discovery`, `read_discovery_errors`, `read_reconcile_errors`, `read_satellite_rejections`, `save_guidance`, `list_guidance` (aliased), `kroger_flyer`, `store_flyer`, `toggle_favorite`/`toggle_reject` (aliased). The kept store-capture pair is `add_store` + `add_store_note` only. Cut member flows land on the member web app / operator admin surfaces over the same shared operations.
- `docs/TOOLS.md` rewritten to the new surface; `docs/SCHEMAS.md` (attention block, `last_retrospective_at`); `docs/ARCHITECTURE.md` (registration planes and gating).

**Out of scope** (explicitly): the ready-to-eat rip (separate change `remove-ready-to-eat` — RTE tools stay registered and untouched here), the persona/skills rewrite and flow-spec updates that reference retired tool names in agent-behavior requirements (`rewrite-agent-persona`; `menu-generation`, `guided-onboarding`, `guided-cook`, `recipe-sides`, `consumer-facing-descriptions` deltas ride there), `pairs_with` edge re-homing (an upcoming ownership change; removing member `update_recipe` pauses agent edge-recording — acceptable, rung-1 reads keep working), a merge-review admin screen (future), and the already-gated `remove-meal-dimension-shims` cleanup (its `add_night_vibe` alias row survives this change; the `list/update/remove/suggest_night_vibes` alias rows are mooted here because their targets are removed).

## Capabilities

### New Capabilities

- `mcp-tool-gating`: conditional (profile / operator / config-gated) tool registration, the member-surface enumeration, the app-plane (widget-visibility) separation, and this change's one-window dispatch-alias posture. A dedicated capability because registration is a cross-cutting server concern owned by no single tool capability: `mcp-server` owns transport/errors/tenancy, the per-tool capabilities own contracts — which tools a given caller is shown belongs to neither.

### Modified Capabilities

- `data-read-tools`: `recipe_site_url` and `get_weather_forecast` removed; `read_user_profile` gains the `attention` block.
- `data-write-tools`: tool enumeration re-cut; `set_recipe_disposition` replaces `toggle_favorite`/`toggle_reject`; `update_pantry` absorbs verify + kitchen ops; `update_taste` gains `mode`; `update_aliases`/`update_staples`/`update_stockup`/`update_kitchen`/`mark_pantry_verified` leave the MCP surface.
- `grocery-list`: `read_grocery_list` removed (reads are `read_to_buy` / the grocery widget); CRUD fuses into ops-form `update_grocery_list`.
- `recipe-notes`: note edit/delete moves to the member app; MCP keeps `add_recipe_note` + `read_recipe_notes`.
- `meal-vibe-palette`: MCP surface shrinks to `add_meal_vibe`; list rides `read_user_profile`; edit/remove via the member app's vibes page.
- `meal-vibe-archetype-derivation`: the on-demand `suggest_meal_vibes` tool is removed; the scheduled pass is the producer.
- `kitchen-equipment`: `update_kitchen` folds into `update_pantry` equipment ops.
- `staples-tracking`: `update_staples` leaves MCP; the member app curates staples over the shared op.
- `profile-reconciliation`: member confirmation is the web app; the MCP proposal tools register operator-only.
- `in-store-fulfillment`: store tools cut to the capture pair `add_store` + `add_store_note`; other store/note reads/edits via the member/admin surfaces.
- `kroger-integration`: `kroger_flyer` removed in favor of the unified `flyer`.
- `satellite-sale-scan`: `store_flyer` removed in favor of the unified `flyer` (staleness ceiling carried over).
- `ingredient-matching`: the matcher and unit-price cores stop being model-advertised tools; contracts persist as internal/pipeline operations.
- `ingredient-normalization`: human alias/display-name overrides move to the operator admin surface (same human-precedence write op).
- `instacart-adapter`: registration-gated when unconfigured (the member API keeps the structured `not_configured` result).
- `recipe-discovery`: `parse_recipe`/`create_recipe` tool requirements removed (ops persist behind `import_recipe` and the sweep); `update_feeds` and `reject_discovery` writer surfaces move to the operator admin.
- `recipe-import`: `import_recipe` fusion added; the `tools_hint` flows into the fused import's internal conservative classification.
- `newsletter-discovery`: manual walled-source path becomes `import_recipe` paste; allowlist writes move to the admin surface over the same normalize/dedupe op.
- `discovery-sweep`: parked candidates surface in the admin Discovery area, not an agent tool.
- `storage-guidance`: read path is fused `read_guidance`; read-only now holds because no agent guidance write path exists at all.
- `cooking-techniques`: read pair fuses into `read_guidance`; `save_guidance` and the member capture flow are removed (operator curates via admin Data › Guidance).
- `purchasing-guidance`: same — operator-curated corpus, fused read, capture flow removed.
- `satellite-source-audit`: the rejection ledger read moves from an agent tool to the operator admin surface.
- `claude-ai-connector`: the end-to-end write acceptance names `set_recipe_disposition`.
- `member-app-propose`: the shared weather operation is served by `GET /api/propose/weather` and the propose engine only — no `get_weather_forecast` tool.

## Impact

- `packages/worker/src/tools.ts` (registration context + re-cut inline registrations), `reconcile-tools.ts` (registration-time gating), `write-tools.ts`, `grocery-tools.ts`, `night-vibe-tools.ts`, `night-vibe-suggest.ts`, `stores-tools.ts`, `notes-tools.ts`, `discovery-tools.ts` (new `import_recipe` over `classifyRecipe` + the shared create op), `instacart-tool.ts`, `flyer` unification over `readStoreFlyer`, `guidance.ts` (fused read), `kitchen.ts`/pantry apply path (equipment ops), one new D1 migration (`profile.last_retrospective_at`).
- `packages/worker/test/`: registration-matrix tests (member/operator × Kroger × Instacart), attention math, `import_recipe`, fusion/alias dispatch, pantry equipment ops, grocery ops form.
- Widgets: the recipe card's `toggle_favorite` write stays app-plane callable (visibility flip at alias-window close); no widget contract change.
- Docs lockstep: `docs/TOOLS.md` (rewrite), `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`. No new Worker HTTP route → no `run_worker_first` change. Plugin bundle republish is coordinated at implementation time (persona rewrite is a separate change).
