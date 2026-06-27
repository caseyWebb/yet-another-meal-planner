# Tasks

> Ordering note: **group 0 (the classifier + threshold spike) gates the rest** — if a
> Workers AI model can't classify recipes into valid frontmatter at an acceptable accuracy,
> the design flips toward "background scoring, chat imports" and groups 2–8 change shape.
> Groups 1–6 land the sweep **dark** (importing for real, pull tools still present, dedup
> makes the dual-run safe) and the operator log **early** (so the operator can watch the
> dark sweep). Groups 7–8 retire the agent pull surface only after the sweep is trusted.
> Items needing a live deployed Worker with `env.AI` / the live corpus are called out and
> left honestly unchecked, as a code-repo session can't exercise them.

## 0. Classifier + threshold spike (GATING — Phase 0)
- [x] 0.1 Classification prompt built (`scripts/spike-discovery-classify/prompt.mjs`): full required FACETS (controlled-vocab `protein`/`cuisine`/`season`/`requires_equipment`, `course`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`) with vocab injected from `src/vocab.js` (single source of truth) + 4 few-shot exemplars + guardrails. `description` is deliberately NOT classified here — it stays the existing tuned `generateDescription` (already shipped); the classifier is facets-only.
- [x] 0.2 Eval run live (`scripts/spike-discovery-classify/`, 14-recipe curated set scoring vs the real `validateRecipeContract`): vocab-validity, facet accuracy (emphasis on the silent fields `season`/`requires_equipment`). **`mistral-small-3.1-24b` picked** — 100% contract-valid both runs, equipment 100%, season 93% after the Run-2 prompt fix; `llama-3.1-8b` disqualified (71% valid, off-vocab leaks); `llama-3.3-70b` no better on balance. Results recorded in `design.md` (Decision 7, Runs 1–2). A full-corpus eval remains a nice-to-have to confirm at scale, not a blocker.
- [ ] 0.3 Calibrate thresholds from corpus data: taste τ (recall vs precision against favorites/taste vectors), dedup δ (pairwise corpus cosines — where genuine dups vs genuine variety fall), and the per-window rate cap. **Still open — needs the live corpus embeddings; a lower-risk tuning step, not gating.** Method recorded in design.md.
- [x] 0.4 Gate decision: **auto-import is viable** — a small Workers AI model (`mistral-small-3.1-24b`) classifies into valid, accurate frontmatter unattended, with the contract validator as the hard backstop + retry-then-park for the rare loud failure. The design does NOT need to fall back to "background scoring, chat imports." Groups 1–9 may proceed; τ/δ (0.3) calibrate alongside the matcher/dedup work.

## 1. Schema (migrations, additive)
- [x] 1.1 Promote `discovered_at` from `recipes.extra` to a queryable `recipes` column + index (`migrations/d1/0016`); the projection writes it (`RECIPE_SCALAR_COLUMNS` in `recipe-projection.ts`) and the index read reconstructs it (`recipe-index.ts`) so the in-memory shape doesn't regress.
- [x] 1.2 Match-attribution table `discovery_matches(recipe, tenant, score, matched_at)` — PK `(recipe, tenant)` + `idx_discovery_matches_tenant` for the new-for-me query.
- [x] 1.3 ONE `discovery_log` table serves three roles (decided + documented in the migration + design Decision 11): operator audit log (idx on created_at), the dedup "already evaluated" set (idx on url), and the parked-error surface (idx on outcome → `WHERE outcome='error'`). Retention-pruned.
- [x] 1.4 `taste_derived(tenant, taste_hash, embedding, updated_at)` sibling table.
- [x] 1.5 `profile.last_planned_at` column (per-tenant watermark).
- [x] 1.6 Sweep-owned tables are siblings of `recipes` (projection can't clobber them); `discovered_at` is the lone projection-owned promotion. Local `wrangler d1 migrations apply DB --local` green; projection + index tests updated and passing (20).

## 2. env.AI helpers
- [x] 2.1 `src/discovery-classify.ts`: `classifyRecipe(env, input, source)` ports the spike-validated prompt (vocab from `src/vocab.js`, Run-2 few-shot/guardrails), validates each output against `validateRecipeContract`, and retries with a corrective reprompt (echoing the validator's complaints) up to `CLASSIFY_MAX_RETRIES`, then throws structured `validation_failed` (the sweep parks it). Handles object-or-string AI responses; AI failure → `storage_error`. Unit-tested (`test/discovery-classify.test.ts`): valid / string-with-fences / retry-then-succeed / park / AI-failure / no-JSON-retry.
- [x] 2.2 `src/taste-vector.ts`: `reconcileTasteVectors` (injected `TasteDeps`) embeds `profile.taste` via `env.AI`, `tasteHash`-gated (steady state ≈ 0), prunes members with no taste text; `readTasteVectors` is the matcher's read. Unit-tested (`test/taste-vector.test.ts`): new / steady / changed / prune / no-text.

## 3. The sweep core (`src/discovery-sweep.ts`)
- [x] 3.1 `runDiscoverySweep` over injected `DiscoveryDeps` (mirrors `flyer-warm`'s testable shape). No KV cursor needed: every processed candidate is recorded (import → corpus, terminal outcome → the dedup log), so the D1 log IS the progress state and a retried tick never reprocesses. Bounded by `classifyMaxPerTick` (env.AI) + `rateCap` (imports).
- [x] 3.2 Intake (`buildDiscoveryDeps.loadCandidates`): poll `feeds` + extract URLs from the email inbox; dedup vs corpus `source_url` (`recipeSourceMap`) ∪ `discovery_rejections` ∪ the evaluated set (`loadEvaluatedUrls`); canonicalize. *v1 note:* email is mined for URLs (page fetch yields the real title); inline-body-only assembly is deferred.
- [x] 3.3 Cheap triage: embed `title + summary`, `nearAnyMember` (favorites ∪ taste-text) at the looser `triageThreshold`, drop near-nobody **before** any fetch/classify (asserted: no classify on a triage drop).
- [x] 3.4 Classify survivors via `classifyRecipe` (group 2.1); persistently-invalid → park (logged `error`).
- [x] 3.5 Hybrid matcher (`matchMembers`, pure): cosine recall (favorites ∪ taste vector), reject-repel, per-member dietary gate → then `confirmMatches` (negation-aware LLM, fails open to cosine) → attribution.
- [x] 3.6 Dedup (`findDuplicate`, pure): L2 vs corpus `recipe_derived` (δ) + L3 intra-sweep (this tick's imports); skips logged with the matched slug. *v1 note:* embedding-seed-at-import deferred (reconcile owns it, as `create_recipe` does) — the cross-tick-pre-reconcile window is the accepted reconcile lag.
- [x] 3.7 Import via `buildNewRecipe` + `validateFile` + `put` + `seedRecipeDescription`; stamps `discovered_at`/`discovery_source`/attribution; governor: τ + `rateCap` with deferred-and-NOT-classified excess; import failure (slug collision) parks, never crashes the tick.
- [x] 3.8 Per-candidate log entry for every terminal outcome (`recordDiscoveryLog`); the same rows are the evaluated/dedup set (`loadEvaluatedUrls`) and the error surface.
- [x] 3.9 `buildDiscoveryDeps(env)` wires feeds/HTTP/JSON-LD/`env.AI`/D1/R2 (+ the `confirmMatchesAI` helper). *v1 note:* dietary-restriction derivation is conservative (defaults to no gate when the prefs shape is unclear); a per-tick feed refresh-gate is a future refinement.
- [x] 3.10 16-test fake-driven suite (`test/discovery-sweep.test.ts`): pure helpers + import / triage-drop-no-classify / unreachable-park / classify-park / dedup L2 / intra-sweep L3 / dietary_gated / confirm-rejection / partial attribution / rate-cap defer / classify-cap.

## 4. Scheduled wiring + health
- [x] 4.1 `runDiscoverySweepJob` added to `scheduled()` (`src/index.ts`) as **phase 3** — after the projection + embed so dedup/match see a fresh index AND fresh embeddings; `Promise.allSettled` + rethrow posture preserved. The job also refreshes taste vectors first and prunes the log (retention) after.
- [x] 4.2 `health:job:discovery-sweep` record (tenant-data-free counts: processed/imported/duplicate/no_match/dietary_gated/parked/deferred/taste_updated/log_pruned); registered in `HEALTH_JOBS` (health tests updated, full suite 733 green); ntfy best-effort on parked candidates + on a hard failure.

## 5. Agent read surfaces
- [ ] 5.1 `list_new_for_me` tool: `discovered_at > last_planned_at` ∧ attributed to caller ∧ no overlay row ∧ not in cooking_log; fixed-window floor for cold start; empty is not an error. Returns compact rows (already embedded/classified).
- [ ] 5.2 `read_discovery_errors` tool (mirror `read_reconcile_errors`) over the parked subset of the log.
- [ ] 5.3 Stamp `last_planned_at` when `update_meal_plan` saves an agreed plan.

## 6. Operator log view (admin)
- [ ] 6.1 `GET /admin/api/logs/discovery` in `src/admin.ts`: Access-gated like the rest of `/admin*` (404 when unconfigured), group-wide, most-recent-first, bounded count; reads the sweep log.
- [ ] 6.2 Admin SPA Logs area (`admin/src/**`): new top-level **Logs** route (`/admin/logs`, `/admin/logs/discovery`), left submenu (Discovery), `RemoteData` master/detail list, detail **dialog** — modeled per `admin/CLAUDE.md` (custom types for selected-source + open-dialog; no `Bool`/`Maybe String` state).
- [ ] 6.3 Worker serves the SPA shell for `/admin/logs/*` deep links (the existing client-route fallthrough already covers `/admin/*`; add a test).
- [ ] 6.4 Rebuild + commit `admin/dist/` via `aubr build:admin` (needs `package.elm-lang.org`; if unreachable, leave to CI and say so — don't commit a stale bundle).
- [ ] 6.5 Tests: `admin-tools.test.ts`-style coverage for the new endpoint (gated, bounded, shape).

## 7. Retire the pull surface + reframe reject
- [ ] 7.1 Remove `fetch_rss_discoveries` + `read_discovery_inbox` registrations from `src/discovery-tools.ts` (logic now lives in the sweep); update `discovery.test.ts`.
- [ ] 7.2 Reframe `reject_discovery`: source-suppression consulted by the sweep intake (already group-wide by canonical URL); update its description + the `recipe-discovery` reject scenario.
- [ ] 7.3 Keep `parse_recipe`/`create_recipe`/`update_feeds`/`update_discovery_sources` (manual import + config) — confirm unchanged.

## 8. Agent persona (`AGENT_INSTRUCTIONS.md` → rebuild `plugin/`)
- [ ] 8.1 `meal-plan`: replace step-2 triage/import with the `list_new_for_me` read in the step-1 context batch; fold new-for-me into selection (now retrievable); drop the "work from the parse, don't re-search" caveat; stamp `last_planned_at` on save.
- [ ] 8.2 `grocery-discovery` skill: retire the discovery triage/disposition section; keep the parse/classify mechanics only for the manual `import-recipe` flow; update the side-bootstrap ladder (drop the RSS tier → corpus → web parse).
- [ ] 8.3 `aubr build:plugin` and commit the regenerated bundle (needs `$GROCERY_MCP_URL`).

## 9. Docs (lockstep)
- [ ] 9.1 `docs/ARCHITECTURE.md`: determinism boundary (capture relocates to the cron); new §discovery-sweep beside the other crons; "three crons" → "four"; rewrite the Discovery and disposition section; admin §gains the Logs area.
- [ ] 9.2 `docs/TOOLS.md`: remove `fetch_rss_discoveries`/`read_discovery_inbox`; add `list_new_for_me` + `read_discovery_errors`; reframe `reject_discovery`.
- [ ] 9.3 `docs/SCHEMAS.md`: `discovered_at` column; attribution / sweep-log / taste-vector tables; `last_planned_at`.

## 10. Verify
- [ ] 10.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` green.
- [ ] 10.2 `openspec validate background-discovery-sweep --strict` passes.
- [ ] 10.3 (Needs live `env.AI` + corpus) end-to-end: seed feeds/inbox → run the sweep → matched recipe imports with attribution + a log entry → `list_new_for_me` surfaces it for the matched member only → admin Logs/Discovery shows the outcome; a near-dup and a no-match are skipped-and-logged; a malformed candidate parks. Deferred to a deployed Worker.
