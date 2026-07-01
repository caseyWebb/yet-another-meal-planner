## Why

The `meal-plan` skill's quality rests on Claude doing two genuinely-fuzzy steps in-conversation: **distilling** the request + context into a handful of search queries, and **composing** a varied, coherent week from what retrieval returns. A web-app surface has no Claude in the loop, so it can reproduce neither — and even in chat, the distillation is ad-hoc per session (retrieval tunnels onto one attractor; variety is luck). We want a synchronous `propose_meal_plan` tool that returns a varied, weather- and pantry-aware week from structured inputs, so a Claude-less web app gets most of the skill's benefit and the chat skill gains a consistent retrieve-and-diversify spine. The expensive work (recipe embeddings, taste vectors, discoveries) is already captured on crons; this is a cheap hot-path *composition* over it — cosine, set math, and at most one embedding call, off no hot path that isn't already paid for.

The design also names a durable taste dimension nothing captures today: the **shape** of a week (a Sunday-sauce, a weekly pasta, a monthly project cook) — *archetypes* people repeat, not exact meals. Capturing that as an editable, cadence-aware **palette of "night vibes"** turns the query-distillation step into a persisted, curated artifact, and makes variety *structural* (the slots are different archetypes by construction) rather than an algorithm fighting cosine's tendency to clump.

## What Changes

- **NEW** `propose_meal_plan` tool — a synchronous, stateless proposal engine. Two levels: **shape the week** (sample N night-vibe slots, weather- and cadence-weighted, seeded) → **fill the slots** (retrieve per slot, then **diversify-select** a varied set). Returns a structured proposal (per-slot main + corpus sides + `why[]` + waste/meal-prep/exploration flags + variety diagnostics). Iteration is re-invocation with `lock` / `exclude` / `nudges` and a `seed` for "give me another week."
- **NEW** `diversifySelect` — a pure ranking step: Maximal Marginal Relevance (tunable `λ`) plus facet-spread constraints (protein cap, cuisine spread), seeded for deterministic re-rolls. Sits on top of the existing `rankCandidates` blend; it only *reorders/selects survivors*, never admits a gated-out recipe.
- **NEW** night-vibe **palette** — a per-tenant, durable set of night vibes, each a **saved `search_recipes` spec** (`vibe` + `facets`) plus lifecycle metadata: a `cadence_days` target period, `weather_affinity` tags, optional `season`. Embedding is derived on the cron (hash-gated, like `taste_derived`). CRUD tools; weather-weighted seeded sampling drives Level 1.
- **NEW** **cadence-as-debt** scheduling — one continuous knob (the period) subsumes the pinned/weighted/occasional spectrum. `debt = days_since_satisfied / period`; overdue vibes gain sampling weight (spaced-repetition); over-subscription resolves by debt-rank with rollover. **Satisfaction is slot-provenance** — only a cook that came from a filled slot resets that vibe's clock.
- **NEW** **profile-reconciliation** — the `retrospective` grows from *reporting* patterns to *proposing* profile edits (palette/cadence add-prune-adjust), reconciling **stated** preference (profile) against **revealed** behavior (cooking log, overlay, in-app slot edits). A deterministic **signal cron** computes debt/drift/prune candidates always-fresh; **synthesis is pluggable** — a routine edge-model pass and an occasional **operator-frontier** pass (the operator's Claude, over an operator-privileged cross-tenant surface) — both writing to a per-member **pending-proposals queue** the member confirms.
- **MODIFIED** meal-plan rows carry an optional `from_vibe` (the slot's provenance).
- **MODIFIED** cooking-log rows carry an optional `satisfied_vibe`; `log_cooked` copies `from_vibe` → `satisfied_vibe` in the *same transaction* that clears the cooked recipe from the plan.

## Capabilities

### New Capabilities

- `meal-plan-proposal`: the `propose_meal_plan` tool contract (two-level planning, `diversifySelect` MMR + facet constraints, deterministic composition of sides/waste/meal-prep, structured proposal, seeded re-roll, stateless iteration).
- `night-vibe-palette`: the per-tenant night-vibe palette — the "saved spec + cadence + weather affinity + season" shape, its D1 storage and derived embedding, the CRUD tools, cadence-as-debt scheduling, and weather-weighted seeded sampling.
- `profile-reconciliation`: stated-vs-revealed profile reconciliation — the deterministic signal cron, the pending-proposals queue, member confirmation, and the pluggable synthesis tiers (routine edge model + occasional operator-frontier over an operator-privileged cross-tenant surface).

### Modified Capabilities

- `meal-planning`: `meal_plan` rows gain an optional `from_vibe` slot-provenance field; `update_meal_plan` accepts and preserves it.
- `cooking-history`: `cooking_log` rows gain an optional `satisfied_vibe`; `log_cooked` copies the planned row's `from_vibe` into it within the plan-clearing transaction; `last_satisfied(vibe)` is derived by query (`MAX(date)` over rows for that vibe).

## Impact

- **New `src/` modules:** a pure `diversify.ts` (MMR + facet caps, seeded); `propose_meal_plan` tool wiring (composes the existing `filterRecipes` + `rankCandidates` + `diversifySelect`); a night-vibe palette store + CRUD tools; a cron pass reconciling night-vibe embeddings (mirrors `taste-vector.ts` / `recipe-embeddings.ts`); the reconciliation signal cron + pending-proposals store + confirm/enqueue tools.
- **Migrations (`migrations/d1/`):** `night_vibes` (+ derived embedding), `pending_proposals`, `meal_plan.from_vibe`, `cooking_log.satisfied_vibe`.
- **Modified:** `src/meal-plan.ts` + write path (`from_vibe`); `src/cooking-write.ts` / `log_cooked` (provenance copy); `src/index.ts` `scheduled()` (new reconcile passes); the tenant model (`isOperator`); `src/admin/*` (a reconcile-trigger surface).
- **Docs (lockstep):** `docs/TOOLS.md` (new tools), `docs/SCHEMAS.md` (new tables/columns + the palette/proposal/queue shapes), `docs/ARCHITECTURE.md` (the two-level planner, the model-frequency gradient, the stated-vs-revealed reconcile loop).
- **`AGENT_INSTRUCTIONS.md`:** the `cooking-retrospective` flow extended to surface and confirm reconciliation proposals (a later phase; the tool + web-app surface land first).
- **No hot-path cost regression:** `propose_meal_plan` reads cron-captured vectors and runs cosine + MMR + set math; the only external/AI call is an optional single embed for a freeform box.
