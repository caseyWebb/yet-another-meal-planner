## Context

`semantic-meal-plan` is the experimental, invoke-by-name retrieval planner. Today it leads with `recipe_semantic_search` (step 3), composes sides (step 4), and only then folds the discovery pools in as additional candidates (step 5, "aggressive in-session import"). Two problems motivate this change:

1. **Retrieval tunnels.** Searching the established corpus first lets the highest-scoring corpus rows claim the plan before the freshest, most intentional signal — a just-found discovery — gets a look. The issue's premise is that discovery picks should *seed* the menu, with retrieval filling the gaps.
2. **Triplicated, dangling mechanics.** The recipe triage/parse/classify/create mechanics are restated inline in `meal-plan`, `semantic-meal-plan`, and `import-recipe`. Both menu flows say "see the import-recipe flow," but at runtime those are *separate skills that are not co-loaded* — the cross-reference resolves to nothing in the generated bundle.

The build (`scripts/build-plugin.mjs`) already supports the one mechanism that fixes (2): **depth tiers** (`grocery-cart`, `grocery-corpus`) are library skills loaded by a workflow's prerequisite line, deduped once per session, declared via `needs:`. The other sharing mechanism — per-skill `<!-- resource: -->` blocks — is *not* cross-skill (each lands under its own flow's directory), so it cannot serve shared mechanics.

The owner has fixed three design points up front: importing is a **feature, not consequential** (no per-candidate gate); **`meal-plan` is left alone**; the shared mechanics get a **new dedicated tier** (not folded into `corpus`).

## Goals / Non-Goals

**Goals:**
- Reorder `semantic-meal-plan` so discovery triage/import runs before retrieval, accepted picks claim slots, and retrieval is sized to the remaining nights.
- Decouple import from plan placement and add the "maybe next time" (import-don't-plan) outcome as a silent resting state with a light proposal mention.
- Extract the shared triage/import mechanics into a `grocery-discovery` depth tier that `semantic-meal-plan` and `import-recipe` load via `needs: discovery`, resolving the dangling cross-references.

**Non-Goals:**
- Changing `meal-plan` — its corpus-led "small side channel" posture and its own inline copy of the mechanics stay as-is (deliberate residual duplication).
- Any MCP tool contract or D1 schema change. `create_recipe`, `parse_recipe`, `reject_discovery` are unchanged; "maybe next time" is `create_recipe` without an `update_meal_plan` add.
- Adding a per-candidate user approval prompt for imports.
- Promoting `semantic-meal-plan` out of experimental / changing `menu-generation`.

## Decisions

### D1 — Discovery-first via reorder, not a new tool
The reorder is purely a flow-text change: keep the step-1 parallel context load (which already calls `fetch_rss_discoveries` / `read_discovery_inbox`), then move the triage/import + slotting ahead of the `recipe_semantic_search` call, and size that call to the unfilled nights. No tool changes. *Alternative — a "remaining nights" parameter on the search:* rejected; sizing is the agent's compose judgment, and `recipe_semantic_search` already takes a generous `k` the agent controls.

### D2 — "maybe next time" = import minus the plan write
"accept" and "maybe next time" are the **same** `create_recipe` import; they differ only by whether an `update_meal_plan` add follows. This is exactly what `import-recipe` already does (save, don't plan) — which is why the mechanics unify cleanly into one tier. No new persisted state, no flag on the recipe: "maybe next time" is simply *imported and not on this week's plan*, and it becomes retrievable next session once its embedding reconciles. *Alternative — a persisted "shortlist" state:* rejected as over-engineering; the corpus itself is the shortlist.

### D3 — New `grocery-discovery` depth tier (over folding into `corpus`)
Add `'discovery'` to `DEPTH_TIERS`; add a `<!-- persona: discovery -->` block holding the triage/classify/create mechanics and disposition vocabulary. `semantic-meal-plan` (already `needs: cart, corpus`) and `import-recipe` (already `needs: corpus`) add `discovery`. *Alternative — fold into the existing `corpus` tier:* avoids a fourth tier and an extra reference-load, but bloats `grocery-corpus` with full import mechanics for every corpus-needing flow (`cook`, `cooked`, notes, feedback) that never imports. A dedicated tier is surgical: only the two importing flows pay for it. The owner chose the dedicated tier.

### D4 — Tier owns mechanics; flows own posture
Per the CLAUDE.md tool-vs-skill boundary, `grocery-discovery` owns *how* (triage cheap-first, parse→classify→create, the `description`/`side_search_terms` field guidance, `existing_slug` dedup, the accept/maybe/skip/reject taxonomy). Each flow keeps *when/how aggressively*: `semantic-meal-plan` runs discovery-first then gap-fills; `import-recipe` is the standalone save plus paywalled-paste handling. This is what lets `meal-plan` stay out — it simply doesn't adopt the tier.

### D5 — Thin the consumers, keep `import-recipe` triggerable
`import-recipe` keeps its trigger frontmatter, its prerequisite line (now `+discovery`), and its paywalled-paste branch, but defers the parse→classify→create field detail to the tier. `semantic-meal-plan` step 5 stops restating classification fields and points at the tier. Net: the field-classification prose lives once (in the tier), `meal-plan` keeps its own copy by choice.

## Risks / Trade-offs

- **A fourth reference-loaded tier against claude.ai's dedup** → The build comment already flags claude.ai's "load once per session" behavior as the uncertain gating check; a 4th tier widens that surface. Mitigation: the prerequisite-line hedge is unchanged; worst case is a redundant reload, not a correctness break. Validate by inspecting a live session's loaded skills after the rebuild.
- **Thinning `import-recipe` could weaken it when run truly standalone** → it must still carry enough to import from a bare URL/paste. Mitigation: keep the trigger + paste-handling in the flow; the tier is always co-loaded via `needs: discovery`, so the mechanics are present whenever `import-recipe` fires.
- **Behavioral drift between the two menu flows** → `meal-plan` (untouched, corpus-led) and `semantic-meal-plan` (discovery-first) now treat discovery differently by design. Mitigation: that divergence is intentional and documented; the shared tier holds only mechanics, not ordering.
- **Build/fixture breakage** → adding to `DEPTH_TIERS` and a new persona block may trip `build-plugin.mjs` validation or its tests. Mitigation: `node scripts/build-plugin.mjs --check` and `aubr test:tooling` gate it before commit.

## Migration Plan

1. Edit `AGENT_INSTRUCTIONS.md`: add `<!-- persona: discovery -->` block; add `discovery` to the two flows' `needs`; redesign `semantic-meal-plan`; thin both importing flows.
2. Add `'discovery'` to `DEPTH_TIERS` in `scripts/build-plugin.mjs`; update tooling tests/fixtures as needed.
3. `node scripts/build-plugin.mjs --check`, `aubr test:tooling`, `aubr typecheck`; then `aubr build:plugin` to regenerate `plugin/grocery-agent/`.
4. Rollback is a pure revert (persona/build only; no Worker deploy, no migration, no data touched).

## Open Questions

- None blocking. The claude.ai dedup behavior for a 4th tier is the one thing to *observe* post-rebuild (a monitoring step, not a design decision).
