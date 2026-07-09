Ordered by dependency, serial on the shared surfaces (`propose_meal_plan` / `scheduled()` / the identity graph) per the repo's working mode. Sections 1→4 land in sequence; section 5 (substitution capture + ADR amendment) is an independent thread that can plan and implement in parallel. **No spike tasks** — open data questions (the cook-time cosine threshold, the substitution-capture rate) are settled by planning-time spikes against production D1 where `CLOUDFLARE_API_TOKEN` is present, not deferred here.

## 1. Profile fold-in — palette + cadence as a revealed-preference pillar (D5)

- [x] 1.1 Extend `assembleUserProfile` (`src/tools.ts`) so `read_user_profile()` returns the night-vibe palette and each vibe's cadence status (`due | overdue | soon | ok`, the `statusOf` derivation the web app already computes over `readVibeLastSatisfied`), via a `readNightVibePalette` helper in `src/night-vibe-db.ts` — kept off `profile-db.ts`'s hot `readProfile` fan-out path.
- [x] 1.2 Add a `vibes` onboarding-area key to the `missing[]` mapping in `assembleUserProfile` (`src/tools.ts`), set when the palette is empty; keep `initialized` keyed off `preferences` only. (Note: the living spec's mapping lists `pantry`/`corpus`, but the code's `PROFILE_AREAS` never wired them — pre-existing drift, left out of scope.)
- [x] 1.3 Docs (lockstep): `docs/TOOLS.md` `read_user_profile` payload + `missing[]` mapping.

## 2. Cook-time cadence attribution (D4)

- [ ] 2.1 Add a cook→vibe satisfaction record (migration `packages/worker/migrations/d1/NNNN_vibe_satisfaction.sql`: `cooking_log_id`, `vibe_id`, `score`) via `src/db.ts` helpers; keep `last_satisfied` a derived `MAX(date)` query over it (never stored on the vibe).
- [ ] 2.2 In `src/cooking-write.ts` `log_cooked`, compute cosine of the cooked recipe against all palette vibes (reuse `rankCandidates` / the embeddings in `night_vibe_derived`), union the planned row's `from_vibe` as a guaranteed-reset prior, and write a satisfaction record per vibe at/above the threshold — in the same D1 transaction as the cooking-log insert + plan-clear.
- [ ] 2.3 Over-reset guard: full reset for the top match, gated resets for others; ship a default threshold, calibrated by a planning spike against production cook logs.
- [ ] 2.4 Update `readVibeLastSatisfied` (`src/night-vibe-db.ts`) to derive over the satisfaction records; keep `from_vibe` on the plan row (`meal-planning`).
- [ ] 2.5 Docs (lockstep): `docs/TOOLS.md` `log_cooked`; `docs/SCHEMAS.md` satisfaction record.

## 3. Engine convergence + new-for-me on both surfaces (D1, D2, D3, D10)

- [ ] 3.1 `src/meal-plan-proposal-tool.ts`: accept a Claude-authored **ephemeral vibe set** input (ordered `{ vibe, facets }`); when present it shapes the week, else `sampleWeek` schedules the saved palette. Fold the phrases into the existing single batched embedding call.
- [ ] 3.2 `src/night-vibe-schedule.ts` `sampleWeek`: add the new-for-me force-placement tier (pinned → new-for-me → overdue → weighted pool), respecting bucket quotas, seed-deterministic.
- [ ] 3.3 Thread `list_new_for_me` discovery seeds through both surfaces: the agent skill and the web app `/propose` (`src/api/propose.ts`) — the shared op already accepts them as soft-priority.
- [ ] 3.4 Rewrite the `meal-plan` skill in `AGENT_INSTRUCTIONS.md` to distill intent into the ephemeral vibe set and drive `propose_meal_plan` + the palette; retire the hand-compose steps (D10). Regenerate/verify the plugin via `aubr build:plugin --check`.
- [ ] 3.5 Parity check: a fixture week from the converged engine matches the intent of the retired hand-compose path (variety, plate composition, use-it-up, sides).
- [ ] 3.6 Docs (lockstep): `docs/TOOLS.md` `propose_meal_plan` input; `docs/ARCHITECTURE.md` the single converged engine + the palette-↔-authored spectrum.

## 4. The propose MCP App widget (D8)

- [ ] 4.1 Add a shared `@yamp/contract` type for the propose-widget payload (the `propose_meal_plan` result shape).
- [ ] 4.2 Add a `packages/widgets` component (single-file Vite build → `packages/worker/assets/widgets/`) reusing `packages/ui`; register the `ui://plan/propose` resource + a widget-bearing tool via `registerAppTool`/`registerAppResource` (new `src/meal-plan-widget.ts`, wired in `tools.ts`), returning `_meta.ui.resourceUri` unconditionally + a text fallback.
- [ ] 4.3 Wire widget-initiated iteration (lock / swap / exclude / per-slot vibe / reroll) to re-invoke the stateless propose op client-side; validate the callback mechanism against the pinned ext-apps SDK (D8 open question) and fall back to the text render if unavailable.
- [ ] 4.4 Docs (lockstep): `docs/TOOLS.md` the widget; note it needs no `run_worker_first` entry (served over `resources/read`).

## 5. Capture-first substitution edges + ADR amendment (D6, D7) — parallel thread

- [ ] 5.1 Migration extending `ingredient_edge` with the `substitution` kind + `weight` + optional `qualifier` (`packages/worker/migrations/d1/NNNN_substitution_edges.sql`).
- [ ] 5.2 Capture: at the `place_order` override commit, when a replacement crosses a canonical-id boundary that is not an existing identity neighbor, upsert a candidate `substitution` edge and increment weight on repeat (`src/corpus-db.ts` + the order path); candidate → promoted mirrors the `NORMALIZE_CONFIRM` band machinery.
- [ ] 5.3 Exclude `substitution` edges from `satisfies()` reachability (`src/corpus-db.ts` `satisfiesAmong` / `readIdentityNeighbors`); keep them out of any hard match.
- [ ] 5.4 Surface `substitution`-kind edges as a labeled relation in the depth-1 walk (`src/substitute-annotator.ts`), carrying weight/qualifier; do not add a transitive walk.
- [ ] 5.5 Append the `## Amendment — 2026-07-09` section (design.md) verbatim to `docs/adr/0001-determinism-boundary-capture-retrieve-narrow.md`; leave front-matter + `**Status:**` untouched.
- [ ] 5.6 Docs (lockstep): `docs/SCHEMAS.md` the edge kind; `docs/ARCHITECTURE.md` the *ingredient-normalization capture* section.

## 6. Acceptance (gates before PR)

- [ ] 6.1 `aubr typecheck`, `aubr test`, `aubr test:tooling`, `aubr test:app` (propose passthrough + new-for-me), and `aubr build:plugin --check` green; `npx @fission-ai/openspec validate converge-meal-planning-surfaces --strict` green; `/code-review` triaged.
- [ ] 6.2 Production convergence checks, post-deploy: (a) an off-plan cook resets the cosine-matched vibe's cadence (D4); (b) new-for-me imports claim slots in a live web-app propose (D3); (c) `read_user_profile` returns the palette + cadence and an empty palette shows in `missing[]` (D5); (d) a cross-canonical `place_order` override leaves a candidate `substitution` edge that repeated observation promotes, verified against the observed rows as the acceptance fixture (D6).
