## Why

The experimental `semantic-meal-plan` flow runs `recipe_semantic_search` first and folds the discovery pools in afterward, which lets retrieval tunnel onto the existing corpus and bury a just-found candidate — the freshest, most intentional signal arrives last. Separately, the recipe triage/import mechanics are restated inline in three flows (`meal-plan`, `semantic-meal-plan`, `import-recipe`), and the cross-references between them ("see the import-recipe flow") are dangling: those skills are not co-loaded at runtime, so the pointer resolves to nothing.

## What Changes

- **Reorder `semantic-meal-plan` to discovery-first.** Triage and import the discovery pools (`fetch_rss_discoveries`, `read_discovery_inbox`) **before** the semantic search; the accepted picks claim plan slots, then `recipe_semantic_search` runs sized to the **remaining** nights (gap-fill) rather than leading with the full week.
- **Decouple import from plan.** Importing every genuine fit stays autonomous (importing into the shared corpus is cheap and reversible — a feature, not a consequential decision), but an import no longer auto-lands the recipe on this week's menu. The disposition taxonomy becomes the agent's triage outcome, not a per-candidate approval gate.
- **Add the "maybe next time" disposition** — import the recipe (it joins the corpus and reconciles an embedding, so it's retrievable next session) but leave it off this week's plan. It is the silent resting state of a good import that didn't fit the week's gaps, surfaced only as a light "saved X for later" line in the proposal.
- **Extract a shared `grocery-discovery` depth tier.** Add a fourth depth tier to the build's `DEPTH_TIERS`; move the reusable triage → parse → classify → create mechanics and the disposition vocabulary into a `<!-- persona: discovery -->` block. `semantic-meal-plan` and `import-recipe` declare `needs: discovery` and thin out to reference the tier instead of restating it; this resolves the dangling cross-references because the tier is co-loaded by the prerequisite line.
- **Leave `meal-plan` unchanged** — it keeps its corpus-led "small side channel" posture and its own inline copy of the mechanics (a deliberate residual duplication, by owner decision).

## Capabilities

### New Capabilities
<!-- none — the shared tier is a build/distribution mechanism, captured under agent-plugin-distribution below -->

### Modified Capabilities
- `experimental-meal-planning`: the `semantic-meal-plan` flow runs discovery triage/import **before** the semantic search; the search is sized to the nights not already filled by accepted discoveries; import is decoupled from plan placement; adds the "maybe next time" (import-don't-plan) outcome surfaced as a light proposal mention.
- `agent-plugin-distribution`: the build gains a `discovery` depth tier in `DEPTH_TIERS`, emitted as the `grocery-discovery` library skill and loaded by reference via the `needs: discovery` declaration on the flows that import.

<!-- Deliberately NOT modified: `recipe-import` (the classification rubrics and the
"surfaced in AGENT_INSTRUCTIONS.md" requirement still hold — the tier block lives
inside that same file) and `recipe-discovery` (the create_recipe / reject_discovery /
parse_recipe tool contracts are unchanged; "maybe next time" is flow behavior, not a
tool change, and is specced under experimental-meal-planning). Extracting the shared
mechanics into the `grocery-discovery` tier is a source-organization + build change,
captured under agent-plugin-distribution. -->

## Impact

- **Source:** `AGENT_INSTRUCTIONS.md` — new `<!-- persona: discovery -->` block; `semantic-meal-plan` flow redesign (reorder + decouple + new disposition); `semantic-meal-plan` and `import-recipe` markers gain `needs: discovery` and thin out. `meal-plan` untouched.
- **Build tooling:** `scripts/build-plugin.mjs` — add `'discovery'` to `DEPTH_TIERS`; regenerate `plugin/grocery-agent/` via `aubr build:plugin`. Build tests in `tests/` may need a fixture update for the new tier.
- **Docs:** keep contract docs in lockstep (`docs/TOOLS.md`/`docs/SCHEMAS.md` unaffected — no tool or data-shape change; the change is persona/flow + build).
- **Runtime risk:** a fourth depth tier adds one more reference-load per heavy flow against claude.ai's reference-dedup behavior, which the build already flags as the uncertain gating check. No MCP tool contract or D1 schema changes.
