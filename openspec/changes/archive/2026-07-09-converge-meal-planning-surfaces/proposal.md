## Why

Two meal-planning engines coexist and diverge exactly where it hurts. The agent's `meal-plan` skill (`menu-generation`) distills the request into `search_recipes` specs and has **Claude hand-compose** the week; the member web app and the `propose_meal_plan` tool run a **deterministic palette planner** (cadence-debt × weather quotas → MMR diversify) that the agent skill never invokes. The night-vibe palette — the durable "shape of a week" — is exercised only by the web app. So the surfaces split precisely at the step an LLM is weakest at: selecting a diverse set over a long candidate list, where positional bias favors the ends of the list. And the palette's revealed-preference signal never reaches the agent.

This change makes the deterministic engine the **single shared spine** across both surfaces and both Claude tiers. Claude keeps the job it is best at — interpreting intent into vibe specs (functionally today's semantic-search distillation) — and hands composition to the engine's existing MMR pass. The night-vibe palette becomes a first-class **revealed-preference** layer in the profile, maintained by a **cook-time cosine attribution** that no longer depends on plan provenance. And the substitution graph deferred in ADR-0001 is **partially un-deferred** as a capture-first taste-substitution edge kind: edges are born from deterministic backend observation, not model speculation.

The through-line is the **amortization flywheel** that makes a good Claude-Free experience possible: the frontier model's expensive judgment is captured once (named vibes, classified facets, observed substitution edges) into deterministic artifacts a token-constrained Free member — and the model-free web app — consume for nothing, while the widget's client-side replay moves plan iteration off the model entirely.

## What Changes

- **One planning engine.** The agent's hand-compose path (`menu-generation`'s `Full proposal assembly` / `Distill … then compose`) is redirected onto `propose_meal_plan`. Claude authors an ephemeral vibe set (intent → vibe phrases + facet gates, as today) that the engine composes via its existing MMR / facet-spread pass; the saved palette is the default when Claude supplies no intent. Composition — the long-list selection an LLM does poorly — moves fully to deterministic code.
- **New-for-me claims slots on both surfaces.** The soft-priority discovery-seed input `propose_meal_plan` already accepts (`Stateless iteration and re-roll`) is wired through both the agent and the web app, and gains a force-placement tier in `sampleWeek` alongside pinned/overdue — closing the web-app blind spot where imported discoveries never seed a plan.
- **Cadence is revealed at cook time, not provenance at plan time.** `log_cooked` computes `satisfied_vibe` by cosine-matching the *actual cooked recipe* against the palette (reusing `rankCandidates`), with the planned row's `from_vibe` as a **guaranteed-reset prior**. This decouples cadence from *how the plan was made* — a Claude-authored ephemeral week, or an off-plan cook, resets the rhythm correctly. **BREAKING (behavioral):** overturns `night-vibe-palette`'s current "off-plan cooks do not reset a vibe; not by fuzzy embedding attribution" stance and narrows what `profile-reconciliation` must catch. The reversal is defensible because it acts at *cook* time on a *concrete* recipe (revealed), not at plan time on a guess (speculative).
- **The palette is a profile pillar.** `read_user_profile` includes the night-vibe palette and each vibe's cadence status; an empty palette joins the profile's `missing[]` onboarding mapping. Claude reads the rhythm at session start as the *basis* for shaping vibes on a bare "plan me a meal" — a prior, not a cage. Night vibes capture revealed preference in a way the stated `taste` / `diet_principles` narratives cannot.
- **Capture-first taste-substitution edges.** A new `substitution` edge kind on the identity graph, born when a purchasable swap replaces ingredient X with a product resolving to a **different canonical id not already an identity neighbor** of X. Edges accrue weight on repeated observation and are qualified by a model only later; they are **excluded from `satisfies()` reachability** and surface as labeled read-time suggestions — the substitution *decision* still routes through the LLM. Amends ADR-0001's deferral of the substitution graph.
- **A `propose` MCP App widget.** A new widget mirroring the `display_recipe` ext-apps pattern renders a proposal in-conversation with the web app's dials (nights, variety, lock / swap / exclude, per-slot vibe). Iteration re-invokes the stateless propose op client-side — **model-free** refinement for token-constrained members.

## Capabilities

### New Capabilities

- `meal-plan-widget`: an MCP Apps widget that renders a `propose_meal_plan` result as an interactive in-conversation card (nights / variety / lock / swap / exclude / per-slot vibe), re-invoking the stateless propose op on interaction. Returns `_meta.ui.resourceUri` unconditionally with a text `content` fallback, served as an `ui://` MCP resource over `resources/read` with no new Worker HTTP route — mirroring `recipe-card-widget`.

### Modified Capabilities

- `menu-generation`: the agent distills intent into an ephemeral vibe set and delegates week-shaping + composition to `propose_meal_plan`; the hand-compose requirements are retired/redirected.
- `meal-plan-proposal`: accepts a Claude-authored ephemeral vibe set (palette as fallback); the discovery-seed soft-priority gains a force-placement tier.
- `weather-bucket-planning`: `sampleWeek` force-places new-for-me discoveries alongside pinned/overdue within bucket quotas.
- `planning-cadence`: the precedence order gains an explicit new-for-me tier while staying seed-deterministic.
- `night-vibe-palette`: satisfaction is attributed at cook time by cosine over the actual cooked recipe (`from_vibe` as prior), superseding the plan-time-provenance-only stance; the palette is declared part of the profile payload.
- `cooking-history`: `satisfied_vibe` is computed by cosine match at `log_cooked`, with `from_vibe` a guaranteed-reset prior; off-plan cooks can now reset a vibe; a cook MAY satisfy more than one vibe.
- `meal-planning`: `from_vibe` remains advisory provenance but now seeds the cook-time cosine as a guaranteed-reset prior.
- `data-read-tools`: the `read_user_profile` payload includes the palette + cadence status; `missing[]` gains a palette onboarding key.
- `ingredient-normalization`: a new capture-born `substitution` edge kind (weighted, optionally qualified), excluded from `satisfies()` reachability.
- `member-app-differentiators`: the depth-1 substitution walk surfaces `substitution`-kind edges as a labeled relation.
- `profile-reconciliation`: the off-plan cadence blind spot is narrowed now that cook-time attribution handles it.

## Impact

- **Worker (`src/`)**: `meal-plan-proposal-tool.ts` (ephemeral vibe set, discovery force-placement), `night-vibe-schedule.ts` (`sampleWeek` new-for-me tier), `cooking-write.ts` (cosine `satisfied_vibe`), `night-vibe-db.ts` / `semantic-search.ts` (cook-time cosine), `tools.ts` + a new `meal-plan-widget.ts`, `corpus-db.ts` + `ingredient-*.ts` (substitution edge kind + capture), `substitute-annotator.ts` (surface sub edges), profile assembly (`profile-db.ts` + `tools.ts`).
- **Agent persona (`AGENT_INSTRUCTIONS.md`)**: the `meal-plan` skill redirected onto `propose_meal_plan` + the palette; the plugin bundle regenerates.
- **Member app (`packages/app`, `packages/ui`, `packages/widgets`, `packages/contract`)**: new-for-me threading; the propose widget bundle + a shared contract type.
- **D1**: a migration extending `ingredient_edge` with the `substitution` kind (weight + optional qualifier) and a cook→vibe satisfaction record supporting multi-vibe `last_satisfied` derivation.
- **Docs (lockstep)**: `docs/TOOLS.md` (propose input, `read_user_profile` payload, the widget, `log_cooked`), `docs/SCHEMAS.md` (edge kind + satisfaction record), `docs/ARCHITECTURE.md` (the converged engine, the revealed-preference palette, capture-first substitution), and the **ADR-0001 amendment**.

## Dependency

Lands as a staggered sequence per the repo's working mode (implementation stays serial on the shared `propose` / `scheduled()` / graph surfaces): (1) profile fold-in → (2) cook-time cadence → (3) engine convergence + new-for-me → (4) the propose widget. (5) the ADR-0001 amendment + substitution capture is an independent thread that can plan and implement in parallel.
