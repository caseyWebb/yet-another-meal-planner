# Design — narrow-mcp-surface

## Context

`buildServer` (`packages/worker/src/tools.ts`) registers every tool for every caller: ~84 names reach the model on a member connector, including operator-only tools that reject at call time (`isOperator` in `reconcile-tools.ts`), Kroger tools on deployments with no Kroger credentials, and one app-bridge op (`commit_shop`) that leaks into the model-visible list while its siblings (`read_grocery_snapshot`, `set_grocery_checked`, `set_grocery_buy_anyway`, `verify_grocery_pantry`, `set_grocery_substitution`, `relist_grocery_send_line`, `mark_grocery_send_placed`, and the `read_order_review` family) are correctly registered via `registerAppTool` with `_meta.ui.visibility: ["app"]` (`@modelcontextprotocol/ext-apps/server`). Meanwhile the member surface carries many tools whose flows have first-class web/admin homes, plus overlapping reads that confuse weak models.

The exploration outcome (ratified) fixes the target surface: ~28 member base tools, +5 when Kroger is configured, +1 when Instacart is configured; widgets as the user-facing verbs; app-bridge ops never advertised; a server-computed `attention` block feeding a later persona change.

## Goals / Non-Goals

**Goals**

- One registration mechanism in `buildServer` that decides, per request, which tools register — from operator identity, Kroger/Instacart configuration, and the deployment profile.
- A consistent app plane: widget-callable ops are never model-advertised; `commit_shop` stops leaking.
- The cull and fusions: the member surface lands exactly on the target set; fused tools (`set_recipe_disposition`, `import_recipe`, ops-form `update_grocery_list`, absorbed `update_pantry`, fused `read_guidance`, unified `flyer`, `update_taste` mode) replace their predecessors.
- The `attention` block on `read_user_profile`, deterministic and cheap.
- `docs/TOOLS.md` rewritten to describe exactly the new surface.

**Non-Goals**

- Ready-to-eat removal (`remove-ready-to-eat`): `ready_to_eat_available`, `add_draft_ready_to_eat`, `update_ready_to_eat` stay registered and untouched here (`ready_to_eat_available` rides the Kroger-gated set since it makes Kroger calls; its removal is that change's job).
- Persona/skills rewrite and agent-flow spec updates (`rewrite-agent-persona`).
- Re-homing `pairs_with` edge recording (upcoming ownership change; member `update_recipe` removal pauses agent edge writes — rung-1 side reads keep working).
- A merge-review admin screen (the operator-chat flow is the stopgap).
- Removing the `add_night_vibe`/`nights`/`default_cooking_nights` shims (owned by `remove-meal-dimension-shims` on its own gate).
- Any change to the member API or admin routes: every cut member flow already has a web/admin surface over the same shared operation; this change moves no operations, only registrations.

## Decisions

### D1: A per-request `RegistrationContext`, resolved by the MCP handler, passed to `buildServer`

```ts
interface RegistrationContext {
  profile: DeploymentProfile;      // loadDeploymentProfile(env) — one cached D1 read
  operator: boolean;               // isOperator(env, tenant) — exported from reconcile-tools.ts (or hoisted to tenant.ts)
  kroger: boolean;                 // non-empty env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET
  instacart: boolean;              // getInstacartConfig(env) !== null (src/instacart.ts)
}
```

`buildServer(env, tenant, origin, ctx)` branches on `ctx` at registration time. The MCP handler resolves `ctx` alongside tenant resolution; `loadDeploymentProfile` is the only async input (a D1 singleton read, already the one profile accessor). Today no tool differs by `profile` — the field is carried so a future SaaS-only registration difference has its seam without re-plumbing, and because the ratified plan names it as a gating input. `kroger`/`instacart` are env-derived (wrangler secrets), i.e. deployment-level: gating is per-deployment, not per-tenant, which matches how the credentials exist.

**Rationale**: registration-time gating means a member connector's `tools/list` *is* the member surface — the acceptance fixture. Call-time rejection (today's `insufficient_permission` in `reconcile_read_signals`) still runs as defense in depth on the operator tools, but the primary gate moves to registration.

**Alternatives considered**: (a) keep call-time gating only — leaves operator/unconfigured tools advertised, which is the problem; (b) resolve the context lazily inside each tool group — scatters the branch and re-reads D1; (c) drop `profile` from the context since nothing gates on it — rejected to honor the plan and keep the seam, at the cost of one cached read.

### D2: App plane = the existing ext-apps visibility convention, applied consistently

Every widget-callable op registers through `registerAppTool` with `_meta.ui.visibility: ["app"]`: the grocery snapshot family (already correct), the order-review family (already correct), and — newly — `commit_shop` (today a plain `server.registerTool` in `tools.ts`). `display_*` widget tools stay model-visible (they are the user-facing verbs). `log_cooked`, `update_meal_plan`, `read_meal_plan`, `propose_meal_plan` remain model-visible and are also widget-called; a tool may serve both planes.

`toggle_favorite`/`toggle_reject` (the recipe card's writes) remain registered during the alias window as model-visible dispatch aliases of `set_recipe_disposition`; at window close they flip to app-plane registrations (`visibility: ["app"]`) rather than being unregistered, because the recipe-card widget calls `toggle_favorite` by name through the app bridge (`recipe-card-widget` D18). The widget contract never changes.

**Rationale**: the visibility metadata is the mechanism the deployed hosts already honor (the grocery/order ops don't leak today); consistency is a registration change, not a new mechanism.

**Alternative considered**: a server-side `tools/list` filter stripping app-only tools regardless of host. Rejected: it would remove the very declaration ext-apps hosts key on, with unknown host behavior, to defend against hosts we don't run; the convention plus a registration-matrix test that asserts the metadata is the smaller, honest fix.

### D3: One-window dispatch aliases only where old→new is semantics-identical; everything else is a hard removal

Following the `*_night_vibe` D21 precedent (dispatch aliases, identical requests/responses, no `warnings` injection — the deprecation table in `docs/TOOLS.md`), this change ships aliases for exactly the three fusions where the old call maps 1:1 onto the new tool:

| Old (window-only) | Dispatches to |
| --- | --- |
| `toggle_favorite(slug, favorite)` / `toggle_reject(slug, reject)` | `set_recipe_disposition(slug, favorite→"favorite"/"none", reject→"hide"/"none")` |
| `add_to_grocery_list(item)` / `remove_from_grocery_list(name)` / old-form `update_grocery_list(name, …patch)` | ops-form `update_grocery_list({ operations: [{ op: "add"/"remove"/"update", … }] })` (the old single-patch form is detected by shape and converted) |
| `list_guidance(domain?)` | `read_guidance(domain?)` list mode (no `slugs`) |

Everything else is removed outright: stale plugin bundles get the generic unknown-tool rejection. **Posture and rationale**: the repo's shim convention exists so a *stale agent's write still succeeds and steers*. That applies when the new tool can honor the old intent exactly — the three rows above. For the rest, the intent itself moved surfaces (web app/admin/pipeline-internal) or the tool is gone by design (`get_weather_forecast`); an accept-and-convert shim would keep dead verbs alive in the model's context, defeating the change's purpose. The implementation lands behind a coordinated plugin publish (`rewrite-agent-persona` republishes skills against the final names), and mid-conversation breakage between deploy and republish is accepted: these are member-conversation tools, and the failure mode is a visible unknown-tool error the agent can route around with the surviving surface, not a silent data loss. Alias-window close follows the existing removal condition pattern (a subsequent plugin publish + ≥30 days), recorded in the TOOLS.md deprecation table.

Note on collateral aliases: removing `list/update/remove/suggest_meal_vibes` removes their `*_night_vibe` alias rows with them (an alias cannot outlive its target); `add_night_vibe` survives with `add_meal_vibe` and stays owned by `remove-meal-dimension-shims`.

### D4: `set_recipe_disposition(slug, disposition)` — one verb, one row

`disposition: "favorite" | "hide" | "none"` writes the caller's overlay row exactly as the pair did: `favorite` sets favorite and clears reject; `hide` sets reject and clears favorite; `none` clears both (row DELETEd when empty). Slug validated against `recipes` (`not_found`), lens/reject semantics unchanged, D1-backed, no `commit_sha`. "hide" is deliberately the member-facing word (the old `reject` naming leaks curation jargon).

**Alternative considered**: keeping the pair (the plan allowed implementer's choice). Fusing wins: one verb removes a mutual-exclusivity trap from the model's hands and drops a tool.

### D5: `import_recipe({ url? | text?, title? })` — the sweep's pipeline as a member-initiated tool

Exactly one of `url`/`text`. URL path: the egress-guarded fetch + JSON-LD parse (the `parse_recipe` operation's extractor, with its structured `unreachable`/`no_jsonld`/`not_a_recipe`/`incomplete` errors and `existing_slug` idempotence). Text path: the discovery sweep's classification (`classifyRecipe`, `src/discovery-classify.ts` — env.AI, corrective-retry, contract-valid frontmatter including the authored gates `dietary`/`requires_equipment` under the conservative rubric, with `tools_hint` consumed as a hint where present). Both paths converge on the shared create operation (`create_recipe`'s body in `discovery-tools.ts`): slug from the cleaned dish name, `slug_exists` guard, **dedup-to-grant** on a duplicate `source` (returns the existing slug), `recipe_imports` attribution (`via 'agent'`, resolved member), synchronous facet/description seed (`recipe-facet-derivation`). Returns `{ slug }` (or `{ slug, already_existed: true }` on dedup-to-grant, replacing the `already_exists` error shape — an import that lands the recipe in your cookbook is a success, not an error). Recipe *editing* leaves MCP entirely (web app owns member edits; merge review's writer arrives with the fast-follow admin merge screen — D7).

**Rationale**: capture → retrieve → narrow. The agent stops doing the judgment-field assembly `parse_recipe`→`create_recipe` required (the persona's biggest failure surface); the Worker owns the whole deterministic-plus-classify pipeline it already runs unattended for the sweep. One AI-classify call per pasted import is the same budget the sweep pays per candidate.

**Alternative considered**: keep parse/create with a thinner contract — still two calls and agent-assembled frontmatter; rejected.

### D6: Ops fusions mirror `update_pantry`'s idiom

- **`update_grocery_list(operations)`**: `add` (the full `add_to_grocery_list` item contract: `name`/`id` funnel, merge semantics, `substitutes_for` capture), `update` (the patch contract incl. the status-transition guard and spend guarantees — unchanged, still enforced in the shared operation), `remove`. Per-op `applied`/`conflicts` reporting. The widget's separate `grocery_add`/`grocery_remove` app ops are untouched.
- **`update_pantry`** absorbs: `mark_pantry_verified` is already the existing `verify` op — the standalone tool just unregisters; `update_kitchen`'s ops arrive as `{ op: "equip" | "unequip", slug }` and `{ op: "set_kitchen_note", key, value }`, delegating to the same kitchen apply path (`EQUIPMENT_VOCAB` conflicts, idempotent add, absent-remove conflict — all preserved). Renamed op verbs avoid colliding with the pantry `add`/`remove`.
- **`read_guidance(domain?, slugs?)`**: `slugs` present → today's read; `slugs` absent → today's `list_guidance` result for the domain (or all domains grouped when `domain` is also absent). One narration verb.
- **`flyer(filter?)`**: `store_flyer`'s exact behavior (resolve `stores.primary` + `preferred_location`, read `flyer:{store}:{locationId}` via `readStoreFlyer`, `min_savings_pct` at read, satellite staleness ceiling via `isSatelliteRollupStale`, cold/unresolvable → `{ items: [], as_of: null }`) under one name; `kroger_flyer` and `store_flyer` unregister. Kroger-config-gated: a walk-only deployment has no flyer producer today (the satellite scan feeds the same rollup, but satellite deployments are Kroger-credentialed operators in practice); if a satellite-only deployment materializes, ungating `flyer` is a one-line registration change.
- **`update_taste(content, mode?)`**: `replace` (default, today's content-faithful write) or `append` (append `content` to the existing narrative with a blank-line separator; a null narrative behaves as replace). Silent captures use `append`; a member-directed rewrite uses `replace`.

### D7: Operator plane — merge review keeps its chat surface

`list_proposals`, `confirm_proposal`, `reconcile_read_signals`, and `reconcile_enqueue_proposal` register only when `ctx.operator`. Members confirm reconcile proposals in the web app's reconciliation queue (`member-app-core`, already shipped). `update_recipe` is removed outright (user-ratified: the merge-review admin UI is an easy fast-follow, so no operator-plane retention): `merge_recipes` proposals keep accumulating in the durable queue, the operator can still reject a pair via `confirm_proposal(accept: false)`, and accepting/folding waits for the admin merge screen — the server-side objective-update operation core is retained for that screen to reuse. The `recipe-dedup` delta records this deferral. Call-time `isOperator` checks remain on the reconcile pair as defense in depth.

### D8: `attention` — deterministic, cheap, one new column

`read_user_profile` gains:

```ts
attention: {
  retrospective_due: boolean,        // cooking_log non-empty AND (last_retrospective_at NULL or > 42 days old)
  unverified_perishables: number,    // pantry rows in perishable categories (produce|dairy|seafood|meat)
                                     // with last_verified_at NULL or > 7 days old — the member app's
                                     // needs-verification rule, shared
  stale_areas: string[],             // the existing `missing` onboarding-area derivation (empty-area names)
}
```

Pure Worker math over tables the profile assembly already reads, plus one bounded pantry/cooking-log count each — no AI, no new read amplification beyond two aggregate queries folded into `assembleUserProfile`'s existing `Promise.all`. **Migration required** (verified): `retrospective_due` needs a watermark; nothing records when a retrospective was last seen, and the tool-usage AE dataset is deliberately tenant-blind. A new nullable `profile.last_retrospective_at` column (migration `NNNN_profile_attention.sql`) is stamped (today's date) by the `retrospective` tool and the member retrospective endpoints — the exact `last_planned_at` precedent (stamped by `update_meal_plan`). The spend/waste *analyzers* stay pure — the stamp is a profile watermark outside the analyzer, not a spend/waste mutation. `stale_areas` deliberately reuses the `missing` derivation (per-area recency needs per-area `updated_at` columns that don't exist; not worth a schema change for a nudge input). Thresholds (42d/7d) are compiled constants, tunable later via operator config if needed.

### D9: Weather absorbed — remove the tool, keep the operation

`propose_meal_plan` already loads the forecast server-side (`resolveTenantForecast` in `tools.ts`, threaded through the shared propose op; window-clamped per `weather-bucket-planning`). Removing `get_weather_forecast` changes no engine behavior and no `GET /api/propose/weather` adapter — only the model stops seeing a weather verb (weather is silent context by design; the persona was already forbidden from narrating it).

### D10: Cut member flows land on existing surfaces — no operation moves

Every removal maps to a shipped surface over the same shared operation: notes edit/delete → member recipe detail; vibe list/edit/remove → member vibes page; staples/stockup → member profile surfaces; proposals → member reconciliation queue; aliases/display names → operator admin (human-precedence write, `ingredient-normalization`); feeds/senders/discovery rejection/discovery errors → admin Discovery + Config; reconcile/satellite rejection ledgers → admin health/audit surfaces; guidance writes → admin Data › Guidance; store identity edits and note maintenance → member/admin store surfaces (the capture pair `add_store`/`add_store_note` stays MCP because mid-walk hands-busy capture is a chat-native moment). `read_grocery_list` dies with no successor tool: `read_to_buy` is the reasoning read, `display_grocery_list` the member-facing verb, `read_grocery_snapshot` the app-plane boot read — exactly one list surface per plane, which is the confusion this change exists to remove. `suggest_substitutions` dies: `read_to_buy(enrich)` already carries `substitutes[]`; same-identity SKU alternatives live in the order-review widget's app ops.

## Risks / Trade-offs

- **[Stale plugin bundles hard-error mid-conversation]** → Accepted deliberately (D3): coordinated plugin publish, three semantics-identical alias windows for the highest-traffic writes, unknown-tool errors are visible and routable, no silent data loss. The persona republish is sequenced in `rewrite-agent-persona`.
- **[Members lose chat access to moved flows before the persona teaches the new homes]** → The web app surfaces already exist and the surviving tools cover the daily loop (plan/shop/cook/pantry/import). The persona rewrite (next change) re-points narration; in the gap the agent simply lacks dead verbs rather than mis-executing them.
- **[Host ignores ext-apps visibility and lists app-plane ops]** → The deployed hosts honor it today (the grocery/order families don't leak). Registration-matrix tests assert the metadata on every app-plane op so a regression is caught in CI; a server-side list filter remains available as a follow-up if a non-honoring host ever matters (D2 alternative).
- **[Merge review has no writer until the fast-follow admin screen lands]** → Proposals are durable in the queue and rejection is unaffected; the admin merge screen is an easy fast-follow and the pending queue is its ready-made backlog.
- **[`flyer` gated on Kroger config strands a hypothetical satellite-only deployment]** → No such deployment exists; ungating is a one-line change noted in D6.
- **[`import_recipe` adds an env.AI call to pasted imports]** → Same per-candidate budget the sweep already pays; URL imports stay parse-first (no AI beyond the existing facet seed).
- **[Retrospective watermark stamp on a read path]** → Narrow: one profile-column write on the retrospective surfaces, mirroring `last_planned_at`; analyzers and spend/waste data untouched.

## Migration Plan

1. Land the registration context + app-plane fix + fusions + aliases + attention block in one Worker deploy (D1 migration first: `profile.last_retrospective_at`). All shared operations are unchanged, so the member app and admin panel need no migration.
2. `docs/TOOLS.md`/`SCHEMAS.md`/`ARCHITECTURE.md` land in the same PR (docs-lockstep rule).
3. Coordinated plugin publish follows via `rewrite-agent-persona` (skills reference final tool names). Until then, stale skills hit the three aliases or visible unknown-tool errors.
4. Alias-window close (the three D3 rows + the visibility flip of `toggle_favorite`/`toggle_reject` to app-plane): after a subsequent plugin publish **and** ≥30 days, per the existing removal-condition pattern; recorded in the TOOLS.md deprecation table.
5. Acceptance fixture: a live member MCP session's `tools/list` equals the target member set (base + configured gates); an operator session additionally shows the operator plane; `commit_shop` and siblings absent from both models' lists.

## Open Questions

None. (Resolved during planning: `mark_pantry_verified` is already `update_pantry`'s `verify` op; propose already loads weather server-side; the attention block needs exactly one new column; the app plane mechanism already exists as ext-apps visibility; merge review's folding is parked on the fast-follow admin merge screen.)
