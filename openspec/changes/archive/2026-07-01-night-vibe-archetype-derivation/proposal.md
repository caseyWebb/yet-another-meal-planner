## Why

`propose_meal_plan` and the profile-reconciliation loop shipped with a **cold-start cliff and a missing half**. A brand-new member has no night-vibe palette, so `propose_meal_plan` returns an empty plan with "add some vibes first" — the whole "manageable by the user, but doesn't require direct configuration" promise depends on *someone* hand-authoring vibes. And Phase 5's reconcile only **prunes** and **adjusts** existing vibes; nothing ever **creates** one, so the palette can shrink but never grow from behavior. Both gaps are the same missing capability: **derive night-vibe archetypes from what a member actually likes and cooks**, then propose them. Doing it once at onboarding seeds a palette; doing it continuously completes the reconcile lifecycle (generate → adjust → prune).

This is almost entirely reuse: recipe embeddings (`recipe_derived`), favorites, and the cooking log already exist; the small classifier model is the established "quick summary" precedent (`generateDescription`); and the `pending_proposals` queue **plus the `add_vibe` apply-path** already exist from the `profile-reconciliation` capability. The engine is new; the plumbing is done.

## What Changes

- **NEW** an archetype-derivation engine — cluster a member's **taste-space** (their favorited + recently-cooked recipe vectors) with seeded k-means; each cluster centroid → its nearest recipe descriptions → a **small-model** call names the cluster into `{ vibe phrase, suggested cadence_days }`, the cadence inferred from that cluster's observed cook interval in the log. Clustering is deterministic arithmetic; naming is one small-model call per cluster.
- **NEW** cold-start seeding — when a member has too little history to cluster, derive a handful of **starter** vibes from their authored `taste` text (a small-model call). Surfaced as proposals, never auto-written.
- **NEW** a generative **reconcile producer** (the `edge` producer the `profile-reconciliation` capability left pluggable) — a scheduled pass that derives archetypes, **drops any centroid already covered by an existing palette vibe** (cosine dedup against `night_vibe_derived`), and enqueues `add_vibe` proposals into the existing `pending_proposals` queue, under a per-run cap so it can't flood a member.
- **NEW** an on-demand `suggest_night_vibes` tool so the onboarding / retrospective flow can seed or grow a palette immediately (returns candidate vibes as proposals; never writes).
- **Producer-pluggable, unchanged contract** — the operator's frontier can drive the same derivation via `reconcile_read_signals` + `reconcile_enqueue_proposal`; naming may run on the small edge model (data stays in the Worker) or the operator-frontier. Both feed the one queue the member confirms.

## Capabilities

### New Capabilities

- `night-vibe-archetype-derivation`: deriving night-vibe archetypes from a member's revealed taste (favorites + cooking log, with a taste-text cold-start fallback) — the clustering + small-model naming engine, cadence inference, existing-vibe dedup, the on-demand `suggest_night_vibes` tool, and the generative reconcile-producer pass that enqueues `add_vibe` proposals into `pending_proposals`.

### Modified Capabilities

<!-- None. This capability consumes the pending_proposals queue + add_vibe apply-path defined by
     profile-reconciliation (whose producer is already pluggable), without changing their contract. -->

## Impact

- **New `src/` modules:** `src/night-vibe-derive.ts` (pure clustering + cadence inference + dedup, injected AI naming) and its cron wrapper (the generative reconcile pass, `env.AI`, health-recorded); a `suggest_night_vibes` tool registration.
- **Reuses (no schema change):** `recipe_derived` (taste-space vectors), `overlay` (favorites), `cooking_log` (cook history + intervals), `night_vibe_derived` (existing-vibe dedup vectors), and `pending_proposals` + the `add_vibe` apply-path.
- **Cron:** a new phase (or an extension of `reconcile-signals` into a generative tier) in `scheduled()`, drawing on the internal `env.AI` budget alongside the recipe/night-vibe reconciles; a `job_health`/`HEALTH_JOBS` entry.
- **Docs (lockstep):** `docs/TOOLS.md` (`suggest_night_vibes`), `docs/ARCHITECTURE.md` (the generate half of the reconcile loop + where naming runs on the model-frequency gradient). No `SCHEMAS.md` change (no new tables).
- **`AGENT_INSTRUCTIONS.md`:** the onboarding / retrospective flows may call `suggest_night_vibes` to seed/grow the palette (persona wiring; can land with or after the engine).
