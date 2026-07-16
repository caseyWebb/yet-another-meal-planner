# mcp-tool-gating — delta

## ADDED Requirements

### Requirement: Tool registration is conditioned on a per-request registration context

`buildServer` SHALL register tools conditionally on a per-request registration context resolved before registration: the deployment profile (`loadDeploymentProfile(env)` — the one profile accessor, one cached D1 read), operator identity (the caller's tenant equals `OWNER_TENANT_ID`), Kroger configuration (non-empty Kroger API credentials in the deployment env), and Instacart configuration (a resolvable Instacart config). A tool outside the caller's planes SHALL NOT be registered — it appears in no `tools/list` response and a call to it receives the generic unknown-tool rejection, indistinguishable from a tool that never existed. Registration-time gating is the primary gate; operator-only tools MAY additionally keep call-time permission checks as defense in depth.

#### Scenario: A member connector advertises only the member surface

- **WHEN** a non-operator member's MCP session requests the tool list on a deployment with Kroger and Instacart configured
- **THEN** the response lists exactly the member base tools plus the Kroger-gated and Instacart-gated sets, and no operator-only or app-plane tool

#### Scenario: An unregistered tool is indistinguishable from a nonexistent one

- **WHEN** a member session calls `reconcile_read_signals` (operator-only)
- **THEN** the call receives the generic unknown-tool rejection, not an `insufficient_permission` error revealing the tool exists

### Requirement: Operator-only tools register only for the operator tenant

`list_proposals`, `confirm_proposal`, `reconcile_read_signals`, `reconcile_enqueue_proposal`, and `update_recipe` (the merge-review flow's corpus writer) SHALL register only when the resolved tenant is the operator. Their contracts are unchanged for the operator; members reach the corresponding flows through the member web app (reconcile confirmation) and future admin surfaces (merge review).

#### Scenario: The operator session carries the reconcile and merge-review tools

- **WHEN** the operator's MCP session requests the tool list
- **THEN** it includes `list_proposals`, `confirm_proposal`, `reconcile_read_signals`, `reconcile_enqueue_proposal`, and `update_recipe` in addition to the member surface

#### Scenario: A member session carries none of them

- **WHEN** a non-operator member's session requests the tool list
- **THEN** none of the operator-only tools appear

### Requirement: Store-integration tools register only when their integration is configured

The Kroger tool set — `flyer`, `kroger_prices`, `display_order_review` (and its app-plane review ops), `place_order`, and `kroger_login_url` — SHALL register only when the deployment carries Kroger API credentials. `create_instacart_handoff` SHALL register only when the Instacart configuration resolves. The gates are deployment-level (the credentials are deployment secrets), not per-tenant. The shared operations behind these tools keep their structured unconfigured results for non-MCP callers (e.g. the member API's `not_configured`).

#### Scenario: A walk-only deployment advertises no Kroger tools

- **WHEN** a member connects to a deployment with no Kroger credentials configured
- **THEN** the tool list contains no `flyer`, `kroger_prices`, `display_order_review`, `place_order`, or `kroger_login_url`

#### Scenario: Instacart gating follows its configuration

- **WHEN** the deployment has no Instacart API key
- **THEN** `create_instacart_handoff` is not registered, while the member API's Instacart endpoint still returns its structured `not_configured` result

### Requirement: App-plane operations are never advertised to the model

Every widget/app-bridge-callable operation — the grocery snapshot family (`read_grocery_snapshot`, `grocery_add`, `grocery_remove`, `set_grocery_checked`, `set_grocery_buy_anyway`, `verify_grocery_pantry`, `set_grocery_substitution`, `relist_grocery_send_line`, `mark_grocery_send_placed`), `commit_shop`, and the order-review ops (`read_order_review`, `search_order_broader`, `search_order_catalog`, `save_order_brand_preference`) — SHALL be registered with the ext-apps app-only visibility declaration (`_meta.ui.visibility: ["app"]`) so hosts exclude them from the model's tool context while widgets keep calling them by name. `commit_shop` SHALL move to this plane (it is registered model-visible today). The `display_*` widget tools remain model-visible; a tool MAY legitimately serve both planes (e.g. `log_cooked`, called by the model and by the recipe card).

#### Scenario: commit_shop stops leaking into the model's tool list

- **WHEN** a member session requests the tool list
- **THEN** `commit_shop` is absent from the model-visible list while remaining callable through the widget app bridge

#### Scenario: App-plane metadata is present on every widget-callable op

- **WHEN** the registered tool set is enumerated with its metadata
- **THEN** every app-plane operation carries `_meta.ui.visibility: ["app"]`

### Requirement: The member surface is the enumerated target set

A member connector's model-visible surface SHALL be exactly: reads `read_user_profile`, `read_pantry`, `read_to_buy`, `read_meal_plan`, `search_recipes`, `read_recipe`, `read_recipe_notes`; engine `propose_meal_plan`; widgets `display_recipe`, `display_meal_plan`, `display_grocery_list`; writes `update_meal_plan`, `update_pantry`, `update_grocery_list`, `log_cooked`, `set_recipe_disposition`, `add_recipe_note`, `add_meal_vibe`, `import_recipe`, `add_store`, `add_store_note`; config `update_preferences`, `update_taste`, `update_diet_principles`; signals `list_new_for_me`, `retrospective`; narration `read_guidance`; escape `report_bug` — plus the Kroger-gated and Instacart-gated sets when configured, plus any registrations owned by other in-flight changes (the ready-to-eat tools until `remove-ready-to-eat` lands; the `add_night_vibe`-family aliases until `remove-meal-dimension-shims` closes) and the one-window dispatch aliases below while their window is open. This enumeration is the acceptance fixture: a live member session's tool list SHALL match it.

#### Scenario: The live tool list is the acceptance fixture

- **WHEN** the deployed Worker serves a member MCP session on a Kroger-configured deployment
- **THEN** the model-visible tool list equals the member base set plus the five Kroger-gated tools (and the Instacart tool when configured), with no extras beyond the documented in-flight and alias registrations

### Requirement: One-window dispatch aliases cover only semantics-identical fusions

The change SHALL register one-deprecation-window dispatch aliases (the `*_night_vibe` precedent: identical requests and responses, no `warnings` injection) for exactly three fusions: `toggle_favorite`/`toggle_reject` → `set_recipe_disposition`; `add_to_grocery_list`/`remove_from_grocery_list` (and the old single-patch `update_grocery_list` call form) → ops-form `update_grocery_list`; `list_guidance` → `read_guidance` list mode. Every other removed tool SHALL be a hard removal with no shim — a stale call receives the generic unknown-tool rejection. At window close (a subsequent plugin publish and ≥30 days elapsed), the alias registrations are removed; `toggle_favorite`/`toggle_reject` then flip to app-plane-only registrations (the recipe-card widget calls them by name) rather than disappearing.

#### Scenario: A stale favorite toggle still lands

- **WHEN** a stale plugin calls `toggle_favorite(slug, true)` during the window
- **THEN** the call dispatches to `set_recipe_disposition(slug, "favorite")` and returns the identical overlay result with no warning injected

#### Scenario: A hard-removed tool gets the generic rejection

- **WHEN** a stale plugin calls `save_guidance` after this change deploys
- **THEN** the call receives the generic unknown-tool rejection, with no accept-and-convert shim

#### Scenario: The recipe card keeps its write after the window

- **WHEN** the alias window closes
- **THEN** `toggle_favorite`/`toggle_reject` remain registered with app-only visibility for the widget bridge and no longer appear in the model's tool list

### Requirement: Registration gating is covered by a configuration-matrix test

The Worker test suite SHALL assert the advertised (model-plane) tool-name set for each cell of the registration matrix — member vs. operator × Kroger configured vs. not × Instacart configured vs. not — and SHALL assert the app-plane visibility metadata, so any registration drift (a leak, a missing gate) fails CI rather than shipping.

#### Scenario: A registration leak fails CI

- **WHEN** a tool is registered without its gate (e.g. a Kroger tool on the unconfigured cell, or an app op without visibility metadata)
- **THEN** the matrix test fails naming the unexpected tool
