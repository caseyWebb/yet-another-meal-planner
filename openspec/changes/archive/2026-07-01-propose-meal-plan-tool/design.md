## Context

The `meal-plan` skill leans on Claude for two fuzzy steps that a Claude-less web app cannot reproduce: **distilling** context into search queries, and **composing** a varied, coherent week. Almost everything expensive those steps need is *already captured on crons* — recipe `description` embeddings (`recipe_derived`), the per-member taste vector (`taste_derived`), favorites (overlay), and discovery matches. The pure ranking middle-leg already exists as a unit-tested function (`src/semantic-search.ts` `rankCandidates`), and recipe→recipe cosine over stored vectors is already a proven pattern (`src/cookbook-similar.ts`). So a proposal tool is a *hot-path composition* over captured vectors — cosine + set math + at most one embed — not new heavy machinery.

This change also names a taste dimension nothing captures today: the **shape** of a week (a weekly pasta, a monthly project cook) — archetypes people repeat, not exact meals. Capturing that as a durable, editable, cadence-aware **night-vibe palette** turns the query-distillation step into a persisted artifact (capture → retrieve → narrow applied to the *queries*), and makes variety **structural** — the slots are different archetypes by construction — rather than an algorithm fighting cosine's tendency to clump into near-duplicates.

## Goals / Non-Goals

**Goals:**
- A synchronous, stateless `propose_meal_plan` tool: shape the week (sample vibe slots) → fill each slot (retrieve + diversify) → compose plate → structured proposal with re-roll.
- A per-tenant night-vibe palette (saved spec + cadence + weather affinity), embedding-reconciled on the cron; cadence-as-debt scheduling with slot-provenance satisfaction.
- A stated-vs-revealed reconciliation loop: deterministic signal cron + pending-proposals queue + pluggable synthesis (routine edge model, occasional operator-frontier).

**Non-Goals:**
- **Rewiring `AGENT_INSTRUCTIONS.md` to call the tool.** The tool + web-app surface land first; folding the palette into the chat `meal-plan`/`retrospective` flows is a fast-follow, not this change. (The `retrospective` *reconciliation* requirements here define the contract; the skill prose that drives it is deferred.)
- **Sale/flyer steering inside the tool.** Genuinely fuzzy and Kroger-coupled; stays a chat/order-time concern.
- **Open-world side generation.** The tool composes corpus sides only and flags the rest.
- **Vectorize.** Brute-force cosine over `recipe_derived` stays (the existing measured-promotion trigger is unchanged).
- **A server-side frontier call.** The frontier tier is the *operator's own Claude* over a privileged surface, not a new server-side Anthropic dependency.

## Decisions

### D1 — Two-level planning (shape → fill), not one ranked list
Level 1 samples N night-vibe *slots* (cadence- and weather-weighted); Level 2 fills each slot by retrieval + diversify. This is the human mental model ("a soup night, a pasta night, something new," *then* specifics) and it moves the variety guarantee into the *slot structure* — you cannot get three chicken dishes when the slots are distinct archetypes. *Alternative — one MMR pass over a taste-vector query:* rejected as the primary structure; MMR alone fights the favorite-affinity term (which concentrates toward the taste centroid) and gives no legible, editable week-shape. MMR is retained *within* Level 2.

### D2 — A night-vibe is a saved `search_recipes` spec + lifecycle metadata
The existing spec shape (`vibe` + `facets` + `boost_ingredients` + `k`) already *is* a query. A night vibe persists that plus `cadence_days`, `weather_affinity`, and `season`. Level-2 fill runs the **existing** ranked retrieval unchanged — minimal new machinery; the only new parts are the palette store, the sampler, and the diversify step. Its embedding rides the `taste_derived` reconcile pattern (hash-gated, pruned on delete).

### D3 — `diversifySelect` = MMR + facet constraints, seeded, atop `rankCandidates`
Relevance is the existing blended score; the diversity term is recipe→recipe cosine over the loaded candidate embeddings. `λ` trades relevance vs redundancy; facet caps (per-protein, cuisine spread) add categorical diversity MMR's semantic distance misses. It selects **only over hard-gate survivors** — never admits a gated-out recipe. Seeded (a shared `mulberry32` in `src/rng.ts` — the deterministic paths avoid `Math.random`) so re-rolls are reproducible and "give me another week" is a seed bump. *Alternatives — cluster-then-pick (one per k-means cluster) and DPP sampling:* recorded as considered; DPP is the principled diverse-*sampling* tool and the natural home for re-rolls, but MMR + a seed gets ~all of it at a fraction of the complexity. **Validated against the real 158-recipe corpus (spike):** the facet **caps are the *primary* diversity lever** — they bind for ~89% of anchors, while MMR alone barely beats top-K on a corpus whose relevant recipes sit at high pairwise cosine — so both ship (caps = coarse categorical spread, MMR = fine de-duplication). Measured defaults: λ=0.65 (hard floor 0.4, below which relevance degrades), protein cap 2, cuisine cap 3, course cap off (prefer a hard course gate upstream).

### D4 — Cadence-as-debt: one period knob subsumes the rotation enum
`debt = days_since(last_satisfied) / cadence_days`; sampling weight rises monotonically (bounded) with debt. A short period behaves as a weekly "pin" (but stays dormant the week after it's cooked — *more* correct than a hard pin); a long period is "occasional." It is spaced-repetition for archetypes. Over-subscription (more due than slots) resolves by debt-rank with rollover. *Alternative — a `pinned|weighted|occasional` enum + explicit "always include":* rejected; the enum is a lossy discretization of the period axis and a naive pin re-serves a just-cooked archetype.

### D5 — Satisfaction = slot provenance, riding the existing atomic clear
`from_vibe` on the `meal_plan` row → copied to `satisfied_vibe` on the `cooking_log` row **inside the transaction `log_cooked` already uses** to clear the cooked recipe from the plan (near-zero new plumbing — the link exists). `last_satisfied` is `MAX(date)` by query. *Alternative — nearest-vibe embedding attribution:* rejected for the hot path (misattributes a dish matching two vibes). The honest cost — an off-plan cook doesn't reset the clock — is **by design**, and backstopped by D6 (the reconcile reads the whole log, off-plan cooks included): precision on the hot path, nuance in the reconcile.

### D6 — Reconciliation is stated-vs-revealed, hybrid-produced
The profile is *stated* preference; the cooking log + overlay + in-app slot edits are *revealed* behavior; the `retrospective` closes the gap by **proposing** (never silently writing) palette/cadence add-prune-adjust. Production is hybrid: a **deterministic signal cron** (debt/drift/prune, always-fresh, no large model) feeds a **pluggable synthesis** step. Both tiers write to one **pending-proposals queue**; the member confirms from either surface (a rejection is itself a revealed signal). *Alternative — big-model recompute on every read:* rejected; violates the determinism boundary and can't run where no frontier model is present.

### D7 — Frontier tier = the operator's Claude over an `isOperator` cross-tenant surface
Resolves "no frontier on the cron": the operator runs an occasional group-wide reconcile from *their own* Claude, over an operator-privileged, cross-tenant MCP surface (a tenant flagged `isOperator`, checked before any tool runs). This is the **model-frequency gradient** — determinism on the hot path, small models on the capture crons, the *biggest* model on the rarest human-gated step — and it mirrors the discovery sweep's shape aimed at profiles. It's consistent with the operator's existing cross-tenant trust (the admin Data explorer, no redaction). *Alternative / complement — a larger edge model (step up from the 24b classifier) server-side:* kept as the autonomous, data-stays-in-the-Worker option; the two coexist behind the pluggable queue, and the operator chooses the privacy trade.

### D8 — Weather reweights the palette; it does not generate text
Each vibe's `weather_affinity` joins the forecast's controlled `meal_vibes` set (`src/weather.ts`) to a soft weight multiplier — a cold week boosts soup/comfort, a warm midweek day can still surface grill. No hot-path generation; per-date forecasts additionally allow assigning a slot's vibe to its best-fitting night (a small bipartite match). A freeform box, if the surface offers one, is the one optional embed call — not a generation step. **Spike caveat, resolved in code:** under a realistic overdue backlog, debt-forcing ate every slot and weather never changed the outcome (only the weights). So overdue force-placement now yields `minSampledSlots` (default 1) back to the weather-weighted sampling pool — **pinned** vibes stay sticky, but **overdue** ones cede a slot — guaranteeing weather shapes ≥1 slot each week.

### D9 — The tool is a spine both surfaces stand on
It need not equal Claude's compose. It must be a good-enough proposal that (a) stands alone in the web app with re-roll + manual slot edits as the user's judgment substitute, and (b) gives the chat skill a consistent retrieve-and-diversify substrate to reason over. This reframes the ADR-0001 tension (see Risks): the change *mechanizes* the narrow-end compose for a Claude-less surface, without removing Claude's narrowing where it is present.

## Risks / Trade-offs

- **Determinism-boundary shift.** ADR-0001 deliberately kept plate composition in Claude as "genuinely fuzzy." Mitigation: MMR + facet caps is demonstrably strong at *semantic + categorical* diversity; the weaker residual (taste-coherence — "three soups in a cold week is monotonous") is exactly what an optional small-model coherence yes/no repair covers later, and what the D9 dual-surface framing absorbs (user iteration + the reconcile). The spike confirmed the mechanized weeks are measurably more varied on the real corpus (~+1 distinct protein and +0.7 distinct cuisine per week vs top-K, with negligible relevance loss at λ≈0.65).
- **Operator-frontier data locality.** The frontier path moves member behavior into the operator's model context. Mitigation: acceptable for a trusted friend group and stated as a property; the edge-model tier is the data-stays-in-Worker alternative.
- **Cold start.** No favorites/log → weak taste vector and no observed cadence. Mitigation: seed the palette from authored `taste` text at onboarding with default cadences; enrich (cluster-and-name) as the log accumulates.
- **Over-specification / empty slots.** Too many pins make a rigid week; a vibe can retrieve nothing makeable. Mitigation: keep pins few and reserve wildcard/discovery slots; surface an *explicit* empty slot with a reason (never silently drop), and widen facets as a fallback.
- **Migration surface.** New tables (`night_vibes` + derived embedding, `pending_proposals`) and two additive columns (`meal_plan.from_vibe`, `cooking_log.satisfied_vibe`). Mitigation: all additive; the columns are optional and behavior-preserving when absent.

## Migration Plan

Phased so the highest-risk math is validated before infrastructure lands:

1. **Pure algorithms (spike → src).** Land `diversify.ts` (MMR + facet caps, seeded) and the cadence-debt/sampler as pure, unit-tested functions, with defaults informed by the running spike's findings. No schema, no tool — fully testable.
2. **Palette store + embedding reconcile.** Migration for `night_vibes` (+ derived embedding); CRUD tools; a cron pass mirroring `taste-vector.ts`.
3. **`propose_meal_plan` tool.** Compose `filterRecipes` + `rankCandidates` + `diversifySelect` + the sampler + deterministic plate composition into the structured tool; docs lockstep (`TOOLS.md`/`SCHEMAS.md`/`ARCHITECTURE.md`).
4. **Slot provenance.** Additive columns + `update_meal_plan`/`log_cooked` threading (the provenance copy rides the existing atomic clear).
5. **Reconciliation.** Signal cron + `pending_proposals` + confirm/enqueue tools + the `isOperator` surface; routine edge-model synthesis first, operator-frontier second. `retrospective`/skill wiring is the last, separable step.

Rollback: additive throughout — drop the new tools/tables; the optional columns are inert when unused.

## Open Questions

- **Operator-privileged MCP auth.** How `isOperator` is provisioned and verified on the MCP path (vs the Access-gated admin surface), which exact tools it unlocks, and their rate limits. (Design decision to make before Phase 5.)
- **Palette generation method.** Frontier-at-onboarding vs small-model cluster-and-name over favorites/cooks; re-cluster cadence; how conservative the auto-proposals should be to avoid a robotic week. (Feeds Phase 2/5.)
- **Defaults — resolved (Phase 1 landed).** The spike's measured values are folded into the compiled constants: `DEFAULT_DIVERSIFY_PARAMS` (λ=0.65, protein cap 2, cuisine cap 3, course cap off, jitter 0.02) and `DEFAULT_CADENCE_PARAMS` (`forceDueAt 1.5 / debtCap 4 / debtSteepness 1.5 / debtFloor 0.25`, weather boost 0.6 / penalty 0.35, `minSampledSlots 1`). Residual sub-item: cap-tuning matters more than λ, so a smaller tenant whose corpus has ≤1 recipe in a cuisine will pinch that facet — revisit the caps (not λ) first if that surfaces.
- **Provenance granularity.** Whether only mains carry `from_vibe`, and how a dual-course (`[main, side]`) or corpus-side slot attributes satisfaction.
- **Skill integration timing.** Whether the chat `meal-plan` flow adopts `propose_meal_plan` as its spine in a fast-follow or the surfaces stay separate longer.
