## 1. Pure derivation engine (de-risk the math first)

- [x] 1.1 `src/night-vibe-derive.ts` — pure, seeded functions: `kmeans` + `clusterTasteSpace` (seeded spherical k-means via `src/rng.ts`, cosine metric), `inferCadence` (median inter-cook gap → `cadence_days`, null when sparse), `dedupeClusters` (cosine drop vs palette). No I/O.
- [x] 1.2 `chooseK` sizes k to the footprint (~√(n/2), clamped [2, maxK]); clusters below `minClusterSize` dropped. (Elbow/silhouette left as an Open Question — no per-tenant-data spike was feasible.)
- [x] 1.3 `test/night-vibe-derive.test.ts` (8): deterministic clusters/k-means; cadence inference; dedup drop; empty/thin → no clusters; `chooseK` clamps.

## 2. Naming + cold-start (small model)

- [x] 2.1 `src/night-vibe-naming.ts` `nameCluster` — `env.AI` (the same `mistral-small` classifier), grounded in the cluster's descriptions, **fail-soft** (null skips a candidate). `deriveArchetypes` (`night-vibe-derive.ts`) orchestrates cluster → dedup → name via an **injected** namer (testable).
- [x] 2.2 `starterVibesFromTaste` cold-start from the authored `taste` text; degrades to `[]` (no fabricated archetypes) on blank taste or a model failure.
- [x] 2.3 Tests (`test/night-vibe-derive.test.ts` `deriveArchetypes` + `test/night-vibe-naming.test.ts`, 8): fake-namer orchestration + dedup/cap/skip; real-parse naming with fake `env.AI`; fail-soft; cold-start line parsing.

## 3. `suggest_night_vibes` tool (on-demand)

- [x] 3.1 `src/night-vibe-suggest.ts` — `runDerivation` assembles the taste-space (favorites ∪ cooked, embedded; `readCookedDatesByRecipe` added), derives+names+dedupes (or cold-starts), and **enqueues `add_vibe` proposals** via `enqueueProposal` (producer `edge`); never writes `night_vibes`. `registerSuggestNightVibesTool` wired into `buildServer`; throw-free, per-tenant.
- [~] 3.2 The engine/naming/enqueue pieces are unit-tested (Phases 1–2 + the reconcile store round-trip); a full `runDerivation` integration test (fake-d1 backing 6 tables + fake AI) is **deferred to the manual §6.2 validation** — the assembly is thin orchestration over already-tested parts.
- [x] 3.3 Docs lockstep: `docs/TOOLS.md` (`suggest_night_vibes`).

## 4. Scheduled generative reconcile pass

- [x] 4.1 `runArchetypeDerivationJob` — per member `runDerivation` under the per-run cap, **self-gated to ~daily** via its own `job_health` stamp (naming spends `env.AI`; the pre-naming vector-dedup makes a steady palette a ~0-model no-op). Wired into `scheduled()` phase 5; registered as the `archetype-derive` `HEALTH_JOBS` job; rethrows on hard failure.
- [~] 4.2 The pass is bounded (per-run cap + daily self-gate) and health-wired; a dedicated cron-level test is folded into §6.2 (the per-member `runDerivation` behavior is covered by the engine tests + the daily-gate is a simple timestamp check).
- [x] 4.3 Docs lockstep: `docs/ARCHITECTURE.md` (the generate half of the reconcile loop + small-model naming on the model-frequency gradient).

## 5. Persona wiring (optional, separable)

- [ ] 5.1 **Deferred** — `AGENT_INSTRUCTIONS.md`: the `configure-grocery-profile` flow calls `suggest_night_vibes` to seed a palette; the `cooking-retrospective` flow surfaces newly-derived proposals. Persona/plugin work; nothing in §1–4 depends on it, and the tool + scheduled pass already produce the proposals members confirm.

## 6. Verify

- [x] 6.1 `aubr typecheck` + `aubr test` green (1341 passing).
- [ ] 6.2 Exercise `suggest_night_vibes` / the scheduled pass end-to-end against a seeded local corpus + a fake member (MCP Inspector or a dev harness); confirm proposals land in `pending_proposals` and `confirm_proposal` applies an `add_vibe`. *(Manual; also covers the deferred §3.2/§4.2 integration.)*
- [x] 6.3 `openspec validate "night-vibe-archetype-derivation"` passes.
