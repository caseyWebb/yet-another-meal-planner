## Context

`AGENT_INSTRUCTIONS.md` is the single canonical source of agent behavior. `scripts/build-plugin.mjs` generates the installable plugin from it: everything before `## Common flows` splits into persona-tier library skills on `<!-- persona: <tier> -->` markers (`core` mandatory; `cart`/`corpus`/`discovery` are the recognized depth tiers, emitted only when present), and each `###` flow under `## Common flows` carries a `<!-- skill: <name> / needs: / description: -->` marker that becomes a workflow skill prefixed with a prerequisite line loading `yamp-core` plus any declared depth. `<!-- resource: references/*.md -->` blocks extract long branch content into per-skill reference files. The generator validates structure (`--check`), and `packages/worker/tests/build-plugin.test.mjs` carries both fixture tests and a **real-doc contract test** asserting the current 17-flow census, tier set, and `needs` assignments.

The current persona was written for the author. Its length comes from tool choreography (which tool, which params, in what order), a 10-step onboarding interrogation, an agent-side recipe-classification rubric, retrospective relay rules restating spec contracts, and deprecation lore. The repo rule — tool descriptions own contracts; skills own when-to-call and how-to-act — means most of that never belonged in the persona; after `narrow-mcp-surface` the coarse fused tools carry their own contracts, so the rewrite spends its lines on voice, posture, and flow.

This change depends on `narrow-mcp-surface` (final tool names, `attention` block, `update_taste` append semantics, gated registration) and `remove-ready-to-eat` (no RTE anywhere) having landed.

## Goals / Non-Goals

**Goals:**
- A from-scratch `AGENT_INSTRUCTIONS.md` for non-LLM household members: terse voice, silent learning, one-nudge proactivity, store-agnostic and subscription-cookbook framing, written against the post-cull tool surface.
- The persona source and its generator re-homed into a new `packages/plugin` workspace package (the rewritten file is authored at the new location).
- 17 skills → 6 (`plan`, `shop`, `cook`, `pantry`, `setup`, `report-bug`); import/feedback/notes/vibe-capture/retrospective-relay become core behaviors.
- Keep the generator contract byte-for-byte: no `build-plugin.mjs` changes; only the real-doc contract test updates.
- Spec deltas for every flow-level requirement that changes, plus a new `ambient-preference-learning` capability holding the durable behavioral contract.
- Regenerate and publish the plugin.

**Non-Goals:**
- Any Worker, tool, web-app, or admin change (changes 1+2 own those).
- Re-homing `pairs_with` edge authorship (the upcoming corpus-ownership change owns it; recording pauses here).
- Retiring the resource-block or depth-tier *mechanisms* from the generator — they stay available, unused (depth) or reused (resources).
- Voice-mode or MCP-Apps behavior changes beyond restating the existing guards in fewer words.

## Decisions

### Decision: the persona and its generator move to a new `packages/plugin` workspace package

`AGENT_INSTRUCTIONS.md` sitting in `packages/worker/` is a pre-monorepo artifact: the persona is the source of the **distributed plugin bundle**, consumed by the deploy's publish step — it is not a Worker asset (the Worker never reads it; the spec even forbids carrying the persona in the MCP `instructions` field). A dedicated `packages/plugin` package owns the source, the generator, and the generator's tests:

- `packages/worker/AGENT_INSTRUCTIONS.md` → `packages/plugin/AGENT_INSTRUCTIONS.md`
- `packages/worker/scripts/build-plugin.mjs` → `packages/plugin/scripts/build-plugin.mjs`
- `packages/worker/tests/build-plugin.test.mjs` → `packages/plugin/tests/build-plugin.test.mjs`

`pnpm-workspace.yaml` already globs `packages/*`, so the package joins the workspace with only its own `package.json`. The generator's internal paths survive the move unchanged (`REPO_ROOT` resolves `..` from `scripts/`, i.e. the package root, where the source doc still sits beside it; the test imports `../scripts/build-plugin.mjs`). What re-points: the root `build:plugin` script (currently `aube --filter @yamp/worker`), root `test:tooling` coverage, CI's plugin-build job (`working-directory: packages/worker`), CI's deploy-relevance path filter (names both old paths), the data-deploy workflow's `_code/packages/worker/scripts/build-plugin.mjs` invocation, and comment/doc references (`build-vault.mjs` header, `write-tools.ts:589`, the doc set). The **vault builder stays in `packages/worker`** — it is generated from `vault-template/` + `src/vocab.js`, both Worker-owned; only its header comment mentions the persona.

*Rejected alternatives:* **repo root** — collides conceptually with `AGENTS.md`/`CLAUDE.md` (development-context docs); a persona file at the root reads as repo guidance, not a build source (and the `repo-structure` spec's root-location clause is already stale). **Stay in worker** — perpetuates the pre-monorepo layering and keeps plugin-publish tooling entangled with the Worker package for no reason.

### Decision: single `core` tier; marker grammar unchanged; generator untouched

The depth tiers existed to keep a 639-line persona from re-inlining into every skill. At the new size (core well under ~120 lines) a single tier is simpler and cheaper: every flow's prerequisite line is just "read `yamp-core`". The source keeps the exact marker grammar (`<!-- persona: core -->`, skill markers, resource blocks); `build-plugin.mjs` already handles a depth-tier-free source — `buildPluginFiles` emits only tiers present, `validateParsed` errors only when a flow `needs` an absent tier, and `loaderLine([])` renders the core-only prerequisite. So **zero generator changes and zero new generator tests**; only the real-doc contract test's census updates (flow names, no `needs`, only `yamp-core` emitted, `shop` reference files). If a future persona grows a depth tier again, the mechanism is still there.

*Rejected alternative:* delete `DEPTH_TIERS` and the `needs` grammar. It would ship generator + test churn in the same change as a full persona rewrite for no behavioral gain, and forecloses cheap re-tiering.

### Decision: voice rules (the core tier's opening contract)

- **Terse by default**: short, plain responses; answer first; no flattery, no flowery language, no restating what a widget already shows. Respect an expressed style preference (a member who asks for more detail gets it).
- **No tool narration**: never announce a tool call, a read, or a write ("let me check your pantry…" is out; the answer is in).
- **Zero machinery jargon in chat**: members never hear *vibe, palette, corpus, embedding, retrieval, slug, tenant, engine, MCP, tool, widget, flush, derivation, overlay, satellite, D1/KV/R2*. The persona speaks member language: "your cookbook", "your recipes", "sources you trust", "your list", "what I've learned about your tastes". **"Cookbook" is the canonical member-facing term for the shared recipe collection** (user-ratified; it matches the existing member-app cookbook surface) — the word "corpus" stays a system term that never reaches chat. Tool *names* may appear in skill procedure text (that half is for the model, per `consumer-facing-descriptions`) — the rule governs what is said to the member.
- **Error relay rule**: a failing tool is reported in plain language as what didn't work and what the member can do — never raw error codes, tool names, or internals. Unworkable errors route to `report-bug`.

### Decision: silent-learning boundary

Inverts the current "my config is mine — suggest it, don't write it" posture, for **profile-learning writes only**:

| Signal observed in conversation | Write | Posture |
| --- | --- | --- |
| Taste lean ("we loved that", third salmon this month, "too spicy" reactions) | `update_taste` (append/patch) | silent — capture as it happens, no announcement |
| A rhythm worth keeping ("we do pasta on Fridays", recurring meal-prep lunches) | `add_meal_vibe` | silent — the palette concept never surfaces in chat |
| Substitution stance ("never tilapia for salmon", "greek yogurt works for sour cream") | `update_taste` (append) | silent |
| Equipment observation ("I'll use the pressure cooker", "we don't have a blender") | `update_pantry` kitchen ops | silent |
| **Dietary restriction / allergy** | `update_diet_principles` | **explicit statements only** — "I'm allergic to shellfish" IS the direction and needs no confirmation ceremony; never inferred from behavior (avoiding pork ≠ no-pork rule), never relaxed silently (eating shrimp once never removes a shellfish gate — relaxation also takes an explicit statement) |

Silent writes are **append-shaped**: `update_taste` gains append/patch semantics in `narrow-mcp-surface` precisely so ambient capture cannot clobber authored content; `add_meal_vibe` is additive by construction. The transparency surface is the **member web app profile page** (profile, taste, palette, diet pages already exist) — members inspect and correct learned data there; chat never runs a "should I remember that?" ceremony and never recites what it learned unless asked. Asked directly ("what do you know about me?"), the agent answers honestly and points at the profile page.

**Unchanged confirmation posture** for consequential actions: placing an order, substitutions applied to an order, agreeing a plan before saving it, and agent-proposed speculative corpus imports (the sides propose-then-confirm gate) all still wait for a yes. Once the member chooses, act without re-confirming each step.

### Decision: one nudge, from the `attention` block

`read_user_profile` (post change 1) returns a server-computed `attention` block — retrospective due, stale profile areas, long-unverified perishables. The persona rule: **at most one light nudge per session**, delivered at a natural moment (end of a completed flow, never interrupting one), phrased as an offer, dropped without comment if declined. The agent also proactively offers the next step in the loop — a saved plan offers the shop, a finished shop offers storage-relevant tips, a cooked meal offers nothing further unless `attention` says a retrospective is due. Deterministic Worker math decides *what* is nudge-worthy; the persona only decides *when* (one moment) and *how* (one line).

### Decision: skill consolidation map (17 → 6)

| Old skill | Fate | Rationale |
| --- | --- | --- |
| `meal-plan` | → **`plan`** | Same engine-driven flow, renamed to the member's verb, rewritten against `propose_meal_plan` + `attention` |
| `recipe-sides` | → absorbed into `plan` | The ladder is planning judgment; a standalone "sides for X" question is answered by `plan` without writing a plan. `pairs_with` recording pauses (`update_recipe` removed) |
| `grocery-sale-check` | → absorbed into `plan` (sale-steering) and `shop` (trip-time check) | "What's on sale" is only ever asked in service of planning or shopping; `flyer` + `kroger_prices` are presence-gated |
| `shop-groceries` | → **`shop`** | All six flush branches kept as resource files, rewritten store-agnostic-first |
| `cook` | → **`cook`** | Pre-flight + card/text walk kept |
| `cooked` | → absorbed into `cook` | The walkthrough ends by logging; a reported completed meal ("I made the chili last night") is the same capture path — one skill owns `log_cooked` |
| `cooking-retrospective` | → core behavior | Call `retrospective`, relay server-authored numbers/insights faithfully, never recompute — the truthfulness contracts live in `cooking-history`/`spend-telemetry` specs and the tool description, not restated in the persona |
| `update-pantry` | → **`pantry`** | Keeps its own skill (distinct member verb, merge-not-duplicate judgment); gains kitchen ops; market-haul seam hands to `plan` |
| `configure-yamp-profile` | → **`setup`** | Slims to store/ZIP + hard diet gates + rough rhythm; still idempotent/resumable; ends by offering the first plan |
| `report-yamp-bug` | → **`report-bug`** | Substance unchanged |
| `import-recipe` | → core behavior | One fused `import_recipe(url \| text)` call; already-there / paste-on-unreachable handling is the tool's contract; a few persona lines cover the ask and the one light next-step offer |
| `add-recipe-feedback` | → core behavior | One `set_recipe_disposition` line ("loved it" / "stop suggesting that") |
| `add-recipe-note` | → core behavior | One `add_recipe_note` line (a tweak is a note, never an edit — recipes come from sources you trust) |
| `save-technique` | **removed** | `save_guidance` removed in change 1; operator curates via admin Data › Guidance |
| `save-buying-guide` | **removed** | Same |
| `merge-duplicate-recipes` | **removed** | Merge review is operator-gated registration (change 1); not a member skill |
| `add-ready-to-eat-feedback` | **removed** | RTE ripped in change 2 |

### Decision: persona outline (section-by-section)

Header comment: same build contract note (generator, tiers, rebuild command), updated to name the single core tier.

**`<!-- persona: core -->`** (target ≲ 120 lines):
1. **Identity + voice** — household meal agent; plan, shop, cook, keep the kitchen straight. The voice rules above.
2. **Session start** — `read_user_profile()` once; `initialized: false` → run `setup`, then resume the original ask; fail open on error; gate skipped inside `setup`/`report-bug`. Household handles: resolve people-references through `household.members` (nicknames private to their author); ask when unresolvable; People management lives in the app.
3. **What you learn silently** — the silent-learning boundary table above, in prose: capture taste leans, rhythms, substitution stances, equipment as they happen; dietary restrictions/allergies from explicit statements only, never inferred, never silently relaxed; the app's profile page is where members see and fix what's learned.
4. **What you always confirm** — orders, order substitutions, plan agreement, agent-proposed imports. Chosen once means chosen.
5. **One nudge** — the `attention` rule above; offer the next step in the loop.
6. **Showing things** — any "show me / open / what's on" ask renders the widget (`display_grocery_list`, `display_meal_plan`, `display_recipe`); JSON reads are for the agent's own reasoning, never pasted at the member.
7. **Core micro-behaviors** (a few lines each): import (`import_recipe`; paste when a site is walled; one light offer to plan a just-imported main); reaction capture (`set_recipe_disposition`, `add_recipe_note` — notes not edits); "how have I been eating/spending" → `retrospective`, relay faithfully; storage/purchasing/technique tips via `read_guidance` — vetted only, a light touch, silence when nothing matches; stores are captured mid-trip with `add_store`/`add_store_note`.
8. **Degrading by presence** — if an ordering tool isn't available, that path doesn't exist for this household; use what is present (list, walk, handoff) and never apologize for absent machinery.
9. **When it breaks** — error-relay rule; repeated correction or unworkable errors → `report-bug`.

**`## Common flows`** — six `###` blocks, each with `<!-- skill: name / description -->` (no `needs`):
- **`plan`** — triggers: menu/week/tonight/sides questions/market-haul planning. Body: context reads (`read_user_profile`, `read_pantry`, `read_meal_plan` — reconcile due rows via the `cook` capture when needed, `list_new_for_me`, `flyer` when present); distill intent and drive `propose_meal_plan` (the engine composes; iterate with its dials, never hand-compose); sides via the ladder (curated pairings → corpus retrieval → propose-confirm-import via `import_recipe` → open-world; no edge writes); sale-steering when flyer data exists; save with `update_meal_plan`; review with `display_grocery_list` + `read_to_buy`; offer the shop.
- **`shop`** — the flush, distinct from capture. Opening read (`read_to_buy`, profile), branch detection, then per-branch resource files (`references/`): Kroger online (`display_order_review` → confirmed `place_order`; `kroger_login_url` on reauth), Kroger in-store, in-store walk, map + walk, satellite cart-fill, Instacart handoff (explicit ask only, `create_instacart_handoff`). Lifecycle assertions stay user-asserted via `update_grocery_list`/`update_pantry`; storage tips on receive.
- **`cook`** — pre-flight in chat (equipment from the profile's kitchen, gather, pin servings, sufficiency; volunteered equipment saved silently via `update_pantry` kitchen ops); `display_recipe` cook card or plain-text walk; user-owned timers; technique tips woven in via `read_guidance`; **completion logs in-flow**: `log_cooked` (plan row clears), pantry decrements, one light reaction ask. Also the entry point for "I made X last night".
- **`pantry`** — adds/removes/verifies (`update_pantry`, merge don't duplicate); staples depletion prompt from the profile; storage tips for fresh perishables; a market haul to be planned hands off to `plan`.
- **`setup`** — idempotent, resumable, three areas only: store/ZIP (`update_preferences`), hard diet gates (`update_diet_principles`, explicit statements), rough rhythm (`update_preferences` cadence). Point at the member app for browsing recipes and everything else; close by offering the first plan.
- **`report-bug`** — as today: specific, reproducible, once per distinct problem, file-and-inform.

Not carried over: the classification rubric (facet cron owns classification; `import_recipe` is one call), deprecation-shim lore, `commit_changes`-era multi-write narration, RTE anything, weather narration (engine-internal), the retrospective's restated analyzer contracts, discovery-pool triage (the sweep imports autonomously; `list_new_for_me` is a read).

### Decision: spec deltas are authored against the post-1+2 surface

Changes 1 and 2 are drafted in parallel and will archive first. Deltas here reference the final tool names (`import_recipe`, `update_pantry` kitchen ops, `set_recipe_disposition`, `flyer`) and assume RTE requirements are already gone (e.g. `guided-onboarding`'s ready-to-eat cross-record requirement is change 2's removal, not duplicated here). A **reconcile task** before apply re-checks each MODIFIED block against the then-archived spec text so the archive tool matches headers exactly.

## Risks / Trade-offs

- **[Risk] Silent writes clobber or pollute authored profile content** → Mitigation: silent capture uses only append/patch-shaped writes (`update_taste` append semantics from change 1; `add_meal_vibe` additive); dietary principles are exempt from silent capture entirely; the profile page gives members inspection/correction, and the new spec makes the boundary a requirement with scenarios.
- **[Risk] Jargon leaks via relayed tool errors or tool output** → Mitigation: an explicit error-relay rule in core (plain-language translation, no codes/tool names), spec'd as a scenario in `ambient-preference-learning`'s no-jargon requirement.
- **[Risk] Silent learning erodes trust ("it wrote something I didn't say")** → Mitigation: the hard dietary gate is the trust-critical case and stays explicit-only; everything else captured is low-stakes steering data, visible and editable on the profile page; asked directly, the agent answers honestly about what it learned.
- **[Risk] Six coarse skills mis-trigger where seventeen fine ones routed precisely** → Mitigation: trigger descriptions are rewritten around member phrasings (each old skill's trigger set folds into its absorber's description); the claude.ai 1024-char/no-angle-bracket description limits are enforced by the existing build validator.
- **[Risk] MODIFIED delta blocks drift from what changes 1+2 archive** → Mitigation: dependency stated in the proposal; explicit pre-apply reconcile task; deltas kept to flow-level requirements to minimize overlap with change 1's tool-level deltas.
- **[Risk] Stale installed bundles reference removed skills/tools mid-conversation** → Mitigation: the marketplace version is monotonic per operator, so auto-update pulls the new bundle; the breakage posture for removed tools is owned and stated by `narrow-mcp-surface`; this change publishes in the same deploy tail (Worker first, structurally ordered).
- **[Trade-off] Losing the depth tiers re-inlines nothing but forfeits per-flow token savings** → Accepted: with a ≲120-line core the per-session cost is small, and sequential-flow sessions load it once; the tier mechanism remains available if the core regrows.
- **[Trade-off] `pairs_with` edge recording pauses** → Accepted per the exploration outcome: rung-1 reads keep working from existing edges; the corpus-ownership change re-homes edge writes to household-scoped storage.

## Migration Plan

1. Land after `narrow-mcp-surface` and `remove-ready-to-eat` merge (Worker already serving the final surface).
2. Reconcile spec deltas against the archived specs of changes 1+2; `openspec validate`.
3. Create `packages/plugin` and `git mv` the source doc, generator, and test into it; re-point root scripts, CI, and the data-deploy invocation (green build at the new paths *before* the rewrite, so relocation and rewrite are separately verifiable).
4. Rewrite `AGENT_INSTRUCTIONS.md` at the new location; update the real-doc contract test; `aubr test:tooling` + `node packages/plugin/scripts/build-plugin.mjs --check`.
5. `aubr build:plugin` locally for a full inspection build; read the generated bundle end-to-end.
6. Merge to `main`. The deploy auto-kicks in the data repo: Worker redeploys (no-op for this change), then the plugin bundle is rebuilt with the operator URL and committed to the data-repo marketplace with a strictly-greater version, so installed members auto-update. No member action required; no shims — old skill names simply disappear from the plugin on update.
7. Rollback: revert the commit and republish; the version stays monotonic so the reverted bundle also propagates.

## Open Questions

None. (Implementer latitude: exact core-tier wording and final line counts; whether `shop` keeps five or six resource files after the satellite/instacart rewrite — both stay within the decisions above.)
