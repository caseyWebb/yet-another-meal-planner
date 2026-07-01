## 1. Pure derivation engine (de-risk the math first)

- [ ] 1.1 `src/night-vibe-derive.ts` — pure, seeded functions over injected inputs: `clusterTasteSpace(vectors, k, seed)` (k-means, deterministic via `src/rng.ts`), `inferCadence(cookDates)` (median inter-cook gap → `cadence_days`, null when too sparse), and `dedupeAgainstPalette(candidates, paletteVectors, threshold)` (cosine drop). No I/O.
- [ ] 1.2 k-selection: size k to the member's favorites+cook footprint (start simple; leave the elbow/silhouette option noted). A cluster below a min-size is dropped.
- [ ] 1.3 Unit tests (`test/night-vibe-derive.test.ts`): deterministic clusters for a fixed seed; cadence inference (weekly-ish gap → ~7, sparse → null); dedup drops an already-covered centroid; empty/thin input yields no candidates.

## 2. Naming + cold-start (small model)

- [ ] 2.1 Cluster naming via `env.AI` (the small classifier, `generateDescription`-style): centroid → nearest recipe descriptions → `{ vibe phrase, suggested cadence_days }`. Injected AI dep so the logic stays testable; grounded in the cluster's actual descriptions.
- [ ] 2.2 Cold-start fallback: derive starter archetypes from the authored `taste` text when history is too thin to cluster; degrade to **nothing** (no fabricated archetypes) when there's neither history nor taste text.
- [ ] 2.3 Tests: naming maps a cluster fixture to a candidate (fake AI); cold-start path triggers below the history threshold; no-input → no candidates.

## 3. `suggest_night_vibes` tool (on-demand)

- [ ] 3.1 Register `suggest_night_vibes` — loads the caller's favorites (`overlay`) + cook history (`cooking_log`) + recipe vectors (`recipe_derived`) + existing palette vectors (`night_vibe_derived`), runs derivation, dedupes, and **enqueues `add_vibe` proposals** via the existing `enqueueProposal` (producer `edge`). Returns the candidates; never writes `night_vibes`. Throw-free, per-tenant.
- [ ] 3.2 Tests: candidates returned + enqueued; already-covered archetype deduped out; empty palette + thin taste → empty result with a note.
- [ ] 3.3 Docs lockstep: `docs/TOOLS.md` (`suggest_night_vibes`).

## 4. Scheduled generative reconcile pass

- [ ] 4.1 A bounded generative pass (the `edge` producer of `profile-reconciliation`): per member, derive → dedup → enqueue `add_vibe` proposals under a per-run cap. Wire into `scheduled()` (a new phase or an extension of the reconcile-signals job), drawing on the internal `env.AI` budget; register a `job_health`/`HEALTH_JOBS` entry and rethrow on hard failure.
- [ ] 4.2 Tests: the pass caps per-member enqueues; records health; a steady palette (all archetypes already covered) enqueues nothing.
- [ ] 4.3 Docs lockstep: `docs/ARCHITECTURE.md` (the generate half of the stated-vs-revealed reconcile loop; where naming sits on the model-frequency gradient).

## 5. Persona wiring (optional, separable)

- [ ] 5.1 `AGENT_INSTRUCTIONS.md`: the `configure-grocery-profile` onboarding flow calls `suggest_night_vibes` to seed a palette; the `cooking-retrospective` flow surfaces newly-derived `add_vibe` proposals alongside prune/adjust. Regenerate the plugin (`aubr build:plugin`). *(Depends on nothing in §1–4 at runtime; land last.)*

## 6. Verify

- [ ] 6.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` — all green.
- [ ] 6.2 Exercise `suggest_night_vibes` end-to-end against a seeded local corpus + a fake/thin member (MCP Inspector or a dev harness); confirm proposals land in `pending_proposals` and `confirm_proposal` applies an `add_vibe`.
- [ ] 6.3 `openspec validate "night-vibe-archetype-derivation"` passes.
