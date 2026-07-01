## Context

The `propose-meal-plan-tool` change shipped the palette (`night_vibes`), the two-level `propose_meal_plan`, slot provenance, and a reconcile loop that **prunes** and **adjusts** existing vibes. Two gaps remain, and they're the same missing piece:

1. **Cold start.** An empty palette makes `propose_meal_plan` return an empty plan. A new member has to hand-author vibes — contradicting the exploration's core promise ("manageable without direct configuration").
2. **The missing *add*.** Reconcile can shrink/tune a palette but never grows one from behavior. The `profile-reconciliation` capability deliberately left an `edge` producer pluggable and defined an `add_vibe` kind that already applies — but nothing produces `add_vibe` proposals.

Both are solved by **deriving archetypes from revealed taste**: cluster the member's favorite + cooked recipe vectors, name each cluster, propose it. Once at onboarding → a seeded palette; continuously → the reconcile loop's *add* half. Everything expensive already exists (embeddings, favorites, log, the queue, the `add_vibe` apply-path); the new part is the clustering + naming engine.

## Goals / Non-Goals

**Goals:**
- A deterministic clustering + cadence-inference + dedup engine over a member's taste-space.
- Small-model naming of each cluster into a `{ vibe phrase, cadence_days }` candidate.
- A taste-text cold-start fallback for members with no history.
- An on-demand `suggest_night_vibes` tool + a bounded scheduled generative reconcile pass, both enqueuing `add_vibe` proposals into the existing queue.

**Non-Goals:**
- Auto-writing the palette. Everything is a **proposal** the member confirms (the repo's "suggest, don't write for taste" rule; reuses `confirm_proposal`).
- New tables or a schema change — this consumes `recipe_derived`, `overlay`, `cooking_log`, `night_vibe_derived`, and `pending_proposals`.
- Changing `propose_meal_plan` or the `profile-reconciliation` contract (the producer is already pluggable).
- Persona rewiring beyond an optional `suggest_night_vibes` call in onboarding/retrospective (can land after the engine).

## Decisions

### D1 — Cluster the taste-space, don't ask the model to invent archetypes
Archetypes are **empirical**: k-means (seeded, deterministic) over the member's favorite + recently-cooked `recipe_derived` vectors, one candidate per cluster. The model's only job is to *name* a cluster it's shown (its nearest descriptions), not to imagine a week from scratch — a quick-summary task the small classifier already does well (`generateDescription`). This keeps the frontier off the path and the output grounded in what the member actually cooks. *Alternative — prompt a model to read the whole log and propose vibes:* rejected; unbounded, non-deterministic, and it re-derives on every read instead of capturing.

### D2 — Cadence from the observed interval, not guessed
A cluster's `cadence_days` is inferred from the **median gap between cooks** of its member's dishes in that cluster (the log has dates). So "you cook a simple pasta about every 8 days" → a ~weekly cadence proposal, matching the cadence-as-debt model the planner already runs. A cluster with too few cooks to estimate an interval proposes no cadence (occasional).

### D3 — Dedup against the existing palette, and let the queue handle rejection
Before proposing, drop any candidate centroid within δ cosine of an existing `night_vibe_derived` vector — don't propose a vibe the member already has. Re-proposing a *rejected* archetype is prevented for free by the queue's stable id (`profile-reconciliation`), so derivation stays stateless. *Alternative — track "derived-and-rejected" separately:* unnecessary; the queue already is that record.

### D4 — Cold-start falls back to taste text, and degrades to nothing
With too little history to cluster, name starter archetypes from the authored `taste` text (one small-model call). With neither history nor taste text, propose **nothing** — never fabricate archetypes (garbage-in would poison retrieval). Behavior-derived archetypes supersede taste-text ones as the log grows (dedup handles the overlap).

### D5 — Two entry points, one engine, bounded
The same pure engine backs (a) an on-demand `suggest_night_vibes` tool (onboarding/retrospective can seed immediately) and (b) a scheduled generative reconcile pass (the `edge` producer). The scheduled pass is **capped per member per run** so it can't flood the queue, and records `job_health`. Naming runs on the small edge model by default (member data stays in the Worker); the operator-frontier path can drive the same engine via the existing operator tools.

## Risks / Trade-offs

- **Over-generation → a rigid, robotic week.** Too many pinned/cadenced vibes shrink the room for discovery. Mitigation: the confirm gate (proposals, not writes) + a conservative per-run cap + a high dedup threshold + preferring few, high-confidence clusters.
- **Naming quality → garbage phrase → garbage retrieval.** A vague name retrieves poorly. Mitigation: name from the cluster's actual nearest descriptions (grounded), and the member sees the phrase before accepting; a `suggest_night_vibes` preview can show what a candidate would retrieve.
- **k selection.** Fixed k over-/under-splits different members. Mitigation: size k to the member's corpus footprint (favorites+cook count), or a cheap silhouette/elbow pass; start simple and tune (an Open Question).
- **Thin corpus / cold start.** Few recipes per cuisine bounds cluster quality. Mitigation: the taste-text fallback + proposing nothing rather than noise.

## Migration Plan

1. **Pure engine (spike-friendly).** `src/night-vibe-derive.ts`: seeded k-means + cadence inference + dedup as pure functions over injected vectors/log; unit-tested with fixtures. (Same de-risk-the-math-first shape as the diversify/cadence spike.)
2. **Naming + cold-start.** Wire the small-model naming (injected AI dep) and the taste-text fallback; validate naming quality against a real member's clusters.
3. **`suggest_night_vibes` tool.** On-demand derivation → candidate proposals; enqueue via the existing `enqueueProposal`. Docs lockstep (`TOOLS.md`).
4. **Scheduled generative pass.** The bounded `edge` producer in `scheduled()`; `job_health`/`HEALTH_JOBS`; `ARCHITECTURE.md` (the generate half of the reconcile loop).
5. **Persona (optional, last).** Onboarding/retrospective call `suggest_night_vibes`; regenerate the plugin. Separable.

Rollback: additive throughout — no schema change; drop the tool + cron pass.

## Open Questions

- **k selection** — fixed, corpus-scaled, or a cheap elbow/silhouette pass? (Feeds Phase 1; a spike over real member data would settle it.)
- **Dedup threshold δ** and the **per-run cap** — tune against real palettes to balance coverage vs flooding.
- **Cold-start trigger** — the history threshold below which taste-text fallback kicks in.
- **Naming model** — small edge model vs operator-frontier as the default producer (data-locality vs richness), consistent with the `profile-reconciliation` model-frequency gradient.
- **Interval estimator** — median gap vs a more robust cadence estimate for sparse clusters.
