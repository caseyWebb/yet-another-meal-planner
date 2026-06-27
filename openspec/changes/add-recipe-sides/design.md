## Context

The grocery agent is built persona-first: `AGENT_INSTRUCTIONS.md` is the canonical source, split into a `core` tier plus `cart` / `corpus` / `discovery` depth tiers, with one skill per conversational flow under "Common flows". `aubr build:plugin` generates `plugin/` from it. Coarse, opinionated tools do the deterministic work; the persona decides *when* to call them.

Sides already have a complete data model — `course: [side]` faceting, `pairs_with` (a slug-resolved **plating edge** on a main), and `side_search_terms` (mains-only, AI-memoized phrases describing the kind of side that completes the plate, used as a semantic side-retrieval query). Retrieval is now a single unified tool, `search_recipes` (the `unify-recipe-search` change merged `recipe_semantic_search` and `list_recipes` into one), and meal planning is a single retrieval-based `meal-plan` flow (the `promote-semantic-meal-plan` change retired the classic whole-corpus-dump flow and promoted the semantic one).

But the *behavior* of finding a side is specified only inside that one flow — `menu-generation`'s "Plate-rounding with side pairings" and "Side pairing bootstrap when the edge is empty" requirements, realized as step 5 of the `meal-plan` flow. It runs only when planning a week, grows `pairs_with` only as a side effect of plan acceptance, and there is no skill description a free-form "good sides for X?" can match.

This change introduces a `recipe-sides` flow and hoists the ladder into shared corpus-tier mechanics — mirroring how the parse→classify→create import mechanics are already factored out of `import-recipe` and the `meal-plan` discovery step and referenced by both.

## Goals / Non-Goals

**Goals:**
- A standalone `recipe-sides` flow that answers "sides for X" as **corpus-building**, fully decoupled from planning (no meal-plan write, no cart).
- One canonical side-resolution ladder in the corpus tier, referenced by `recipe-sides` and the `meal-plan` flow.
- Make `recipe-sides` the primary author of `pairs_with`; demote the `meal-plan` flow to opportunistic backfill.
- A propose→confirm gate before any speculative web import of sides.

**Non-Goals:**
- No new tools and no tool-contract changes. Retrieval uses the unified `search_recipes` as it now stands.
- No data-model migration — built on existing `pairs_with` / `side_search_terms` / `course`.
- Not a planner. `recipe-sides` never places sides on the meal plan; if the user then wants to cook, that is the `meal-plan` flow's job.
- No "sides of sides" / multi-level expansion.

## Decisions

### 1. A separate flow, at the import/corpus-building altitude — not a meal-plan branch
The repo draws a hard line: *"importing is cheap and decoupled from planning; an import is not a plan."* "Sides for X" is corpus-building, so it lives next to import, not inside `meal-plan`. A standalone skill also gives the free-form question a **description to match** so the agent reaches for the right flow.
*Alternative considered:* extend `menu-generation` with a "sides-only" sub-mode. Rejected — wrong altitude (drags planning context into a corpus question) and leaves the free-form query unmatched.

### 2. Hoist the ladder into shared corpus-tier mechanics (follow the import-mechanics pattern)
The cheapest-first ladder — `pairs_with` (curated, highest confidence) → corpus retrieval (a `search_recipes` spec whose vibe is the main's `side_search_terms`, with `facets:{course:"side"}`) → propose/confirm/import a new side → open-world trivial side (no slug) — is written **once** in the corpus persona block. `recipe-sides` and the `meal-plan` flow both reference it; the inline copy in step 5 of `meal-plan` collapses to a pointer plus its own same-compose-pass plate logic.
*Alternative considered:* a second hand-written copy in `recipe-sides`. Rejected — two drifting copies; the import mechanics already prove the shared-block pattern works.

### 3. `recipe-sides` is the primary `pairs_with` author; the planner backfills
`pairs_with` is a *plating* edge ("these go on one plate"), not a "we ate this together" edge. Asserting that pairing is precisely what `recipe-sides` does, so it writes the edge via `update_recipe` when a corpus side is confirmed for a main. The `meal-plan` flow still *records* an edge it confirms while composing (opportunistic backfill) but is no longer the primary driver. Open-world trivial sides have no slug and are never written to `pairs_with`.

### 4. Propose → confirm gate for speculative import (the deliberate exception to import-on-sight)
Import-on-sight is justified when *the user handed over the recipe* — the "yes" is implicit. Here the agent would pull speculative, unrequested side recipes into the **shared** corpus, so the consequence class differs. The flow proposes a few candidate sides to search for and asks first; the confirmation is at *which sides*, after which each chosen side imports on sight via the existing mechanics. The gate is "which sides", not a per-recipe re-confirmation.
*Alternative considered:* import proposed sides silently like the `meal-plan` discovery step. Rejected — discovery imports are triaged from a curated pool the user opted into; speculative web sides are agent-initiated and shared-corpus-wide.

### 5. One-level recursion, bounded by the data model
Chosen sides import through the standard mechanics classified `course: [side]`. `side_search_terms` is mains-only and omitted for sides, so an imported side cannot itself trigger a side-search. The bound is structural, not a guard the persona has to remember.

### 6. Two entry modes for the free-form question
`"good sides for X"` branches on whether X resolves to a corpus main: if yes, use its `side_search_terms` + `pairs_with` directly; if X is a bare concept, reason the side profile from world knowledge, then run the same ladder. A useful seam: right after import, the just-classified `side_search_terms` is held in-session from the parse even though the new main is not yet embedded/retrievable — so the import→sides handoff drives the corpus search immediately without waiting on the embedding reconcile.

## Risks / Trade-offs

- **Speculative imports bloat the shared corpus** → the confirm gate plus the existing exact-slug / near-duplicate dedup on import; the flow proposes only "a few", never a bulk pull.
- **Ladder drift between the shared block and the `meal-plan` flow** → step 5 of `meal-plan` must be reduced to a *reference* in the same pass; a lingering inline copy is the failure mode. The `consumer-facing-descriptions` conventions (one owner per fact) are the guardrail.
- **`pairs_with` authorship split is fuzzy** ("primary" vs "backfill") → spec it behaviorally: `recipe-sides` SHALL write the edge on confirmation; the planner MAY. No tool change enforces it, so the persona wording carries it.
- **A free-form question with no corpus matches could feel like a dead end** → the open-world trivial fallback always yields *something* (steamed rice, dressed greens), so the flow never returns empty-handed.

## Open Questions

- Exact trigger wording so "good sides for X?" reliably routes to `recipe-sides` and not `meal-plan` — to be tuned during apply against the real skill descriptions.
- Whether the `import-recipe` handoff offer should fire for every `main` import or only when the corpus side coverage for that main is thin — leaning unconditional-but-light, resolve at apply.
