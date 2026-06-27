## Context

Two meal-plan flows coexist (see proposal). The persona side is two sections in `AGENT_INSTRUCTIONS.md` (`### Menu request` lines 88–143; `### Semantic menu — experimental` lines 145–205) that generate two skills (`meal-plan`, `semantic-meal-plan`). The spec side is two capabilities: `menu-generation` (the dump-and-reason contract, ~16 requirements, many of them flow-agnostic) and `experimental-meal-planning` (the semantic contract, 7 requirements, all semantic-flow-specific). The shared D1 storage layer (`meal-planning`) and the retrieval backend (`semantic-recipe-search`) are flow-independent and stay as-is.

The "flow" is entirely persona prose plus its spec contract — there is no flow-specific Worker code. So this change is editing, consolidating, and deleting prose/specs, then regenerating the plugin. It is sequenced after `unify-recipe-search`, so the promoted flow is written against `search_recipes` from the first draft.

## Goals / Non-Goals

**Goals:**
- One canonical meal-plan flow (discovery-first distill→retrieve→compose), auto-routed on ordinary menu requests, with no "experimental" framing anywhere.
- Zero behavior loss: every flow-agnostic guarantee the dump-and-reason flow carried (named-dish enumeration, capture-not-flush, order handoff, perishable callout, weather-aware, variety, plate-rounding) survives on the promoted flow.
- Preserve deterministic recipe-seeded planning by folding the named-dish lookup into the promoted flow as a vibe-less `search_recipes` query.
- One spec capability for the flow (`menu-generation`); `experimental-meal-planning` retired with nothing orphaned.

**Non-Goals:**
- No Worker/tool/test changes (the tools already exist; flow validation is conversational).
- No change to the D1 `meal_plan` model or the `search_recipes` backend.
- Not re-litigating the semantic flow's design — it is promoted as-is, only de-experimentalized and given the named-dish entry point.

## Decisions

### Promote into `menu-generation`, retire `experimental-meal-planning`

The canonical flow keeps the **better capability name** — `menu-generation`, not "experimental-meal-planning". So `menu-generation` is the survivor: its dump-and-reason requirements are rewritten to the semantic model, the semantic-only requirements migrate in from `experimental-meal-planning`, and `experimental-meal-planning` is emptied (all requirements REMOVED). Mirrors the persona edit: the `### Semantic menu` section's *content* moves under the `### Menu request` heading and `skill: meal-plan`.

**Alternative — keep `experimental-meal-planning` as the survivor and retire `menu-generation`:** rejected. The name "experimental" is exactly what we're removing, and `menu-generation` is the established, accurately-named home referenced across docs.

### Requirement-by-requirement disposition in `menu-generation`

The delta is large, so the disposition is explicit:

| Existing `menu-generation` requirement | Action |
|---|---|
| Menu-request context pre-pass | **MODIFY** — drop the whole-corpus `list_recipes()` load; bounded pre-pass + retrieval via `search_recipes` |
| Holistic plate reasoning over one faceted load | **MODIFY** → retrieve-then-compose; sides in the same compose pass via `side_search_terms` |
| Discovery surfaced during menu requests | **MODIFY** → discovery-first (triage+import before retrieval, sized to the gap) |
| Named-dish exhaustive enumeration | **MODIFY** — same guarantee, retargeted to a vibe-less `search_recipes` query spec |
| Menu-generation smoke-test validation | **MODIFY** — seeds exercise the new selection path |
| Sale-steering; Full proposal assembly; To-buy list; Capture-not-flush; Order handoff; Discoveries dispositioned conversationally; Soft variety honoring; Plate-rounding; Side-pairing bootstrap; Perishable waste callout; Weather-aware selection | **KEEP** (flow-agnostic) — light touch only to retarget tool names where the body names `list_recipes`/`recipe_semantic_search` |

Requirements migrated **in** from `experimental-meal-planning` (as ADDED to `menu-generation`): distill→retrieve→compose; recall is engineered into the search set; aggressive in-session import of preference-matched discoveries; disposition collapses into the import decision; exploration allowance; discovery triage precedes retrieval and sizes it to the gap. The "experimental and invoke-by-name" requirement is **dropped**, not migrated.

To stay within OpenSpec's MODIFIED-needs-full-content rule and keep the disposition legible, requirements whose *heading* changes meaning (the dump-specific ones) are handled as REMOVE + ADD; requirements that keep their heading but change body are MODIFIED with full updated text.

### Named-dish fold-in as a vibe-less query

The recipe-seeded entry point is a `search_recipes({ specs: [{ label, facets: { query, include_unmakeable: true } }] })` — **no `vibe`**, so it's membership mode: exhaustive, deterministic, and it surfaces a just-imported match (membership keeps unembedded recipes). The flow enumerates all returned matches, disambiguates if several, confirms the single match, and only then walks the pantry — exactly the dump-and-reason guarantee. Open-ended weeks continue to use vibe-bearing specs. This is the one place the promoted flow gains behavior it didn't have as the experimental skill.

### Plugin regeneration deletes the stale skill

`aubr build:plugin` regenerates `plugin/grocery-agent/skills/` from `AGENT_INSTRUCTIONS.md`, but it does not prune directories for skills that no longer exist. After the rename, `skills/semantic-meal-plan/` is stale and is deleted explicitly; `skills/meal-plan/` is regenerated from the promoted section.

## Risks / Trade-offs

- **Behavior regression from a missed flow-agnostic requirement** → the explicit disposition table above forces a decision on every existing requirement; the tasks include a diff review that no KEEP requirement was dropped.
- **Named-dish path degrades to fuzzy if mis-specified** → the fold-in mandates a *vibe-less* query spec; the spec scenario asserts exhaustive enumeration and that a just-imported match is surfaced (membership mode), guarding against someone rewriting it as a semantic search.
- **Ordering hazard with `unify-recipe-search`** → this change references `search_recipes`; applying it before Change 1 lands would describe a tool that doesn't exist yet. Mitigation: sequence Change 1 first (stated in the proposal); both are persona/spec, so a temporary mismatch is documentation-only, not a runtime break.
- **Large `menu-generation` delta is review-heavy** → the disposition table and REMOVE+ADD-vs-MODIFY rule keep the delta legible; `openspec validate` gates structural correctness.
- **Empty `experimental-meal-planning` capability after archive** → retiring via REMOVED-all leaves the capability with no requirements; acceptable (it reads as retired). If the tooling supports capability deletion at archive, do that; otherwise the empty spec is harmless.
