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
- [ ] 0.1 Build the classification prompt for `env.AI` (full required frontmatter: controlled-vocab `protein`/`cuisine`/`season`/`requires_equipment`, `course`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`, `description`) reusing the recipe contract; few-shot + guardrails as in the description-gen spike.
- [ ] 0.2 Held-out eval over real recipes (needs the live corpus): vocab-validity rate (loud failures), facet accuracy with emphasis on the **silent**-failure fields (`requires_equipment`, `season`), and description quality. Pick the model (start from `mistral-small-3.1-24b`); record results in `design.md` like the description-gen Runs.
- [ ] 0.3 Calibrate thresholds from corpus data: taste τ (recall vs precision against favorites/taste vectors), dedup δ (pairwise corpus cosines — where genuine dups vs genuine variety fall), and the per-window rate cap. Record the chosen values + method.
- [ ] 0.4 Gate decision: confirm the accuracy bar is met (auto-import viable) or escalate the design fork. Do not start group 2 until this is recorded.

## 1. Schema (migrations, additive)
- [ ] 1.1 Promote `discovered_at` from `recipes.extra` to a queryable `recipes` column + index (projection writes it; the reconcile/projection owns it).
- [ ] 1.2 Match-attribution table `(recipe, tenant)` (sweep-owned; PK + index for the new-for-me query).
- [ ] 1.3 The sweep **log** table (timestamp, canonical url, title, source, outcome, detail JSON) with a retention window; design it to subsume `discovery_evaluated` (terminal-verdict subset) and `discovery_errors` (parked subset) — or sibling tables if cleaner. Decide and document.
- [ ] 1.4 Per-member taste-vector storage (`taste_derived(tenant, taste_hash, embedding)` sibling table — the leaning option in design Open Questions).
- [ ] 1.5 `profile.last_planned_at` column (per-tenant watermark).
- [ ] 1.6 Confirm the projection's wholesale `recipes` rebuild does not clobber any sweep-owned table (sibling-table discipline); local D1 migration apply green.

## 2. env.AI helpers
- [ ] 2.1 `src/discovery-classify.ts` (or beside `description.ts`): `classifyRecipe(env, pageOrBody) → frontmatter`, structured-error mapped, output run through `validateFile` before use; retry-with-corrective-reprompt budget.
- [ ] 2.2 Taste-vector derivation: embed `profile.taste` via `env.AI`, `content_hash`-gated like `recipe_derived`; a reconcile/sweep pass that refreshes on taste change and is a no-op in steady state.

## 3. The sweep core (`src/discovery-sweep.ts`)
- [ ] 3.1 Sweep core over injected `DiscoveryDeps` (mirror `flyer-warm.ts`'s testable shape): cursor + persisted plan, bounded batch on the external fetch leg AND per-tick caps on the `env.AI` leg, idempotent publish, advance-after-publish, refresh gate.
- [ ] 3.2 Intake: poll `feeds` + drain `discovery_candidates`; dedup vs corpus `source_url` (`recipeSourceMap`) ∪ `discovery_rejections` ∪ the evaluated set; canonicalize + prefer JSON-LD `source`.
- [ ] 3.3 Cheap triage: embed `title + summary`, `favoriteAffinity` vs each member's taste vectors (favorites ∪ taste-text), drop near-nobody **before** any fetch/classify; record the cheap verdict.
- [ ] 3.4 Classify survivors (fetch page or use inline email body) via 2.1; on invalid → retry → park.
- [ ] 3.5 Hybrid matcher: re-embed description, cosine recall (favorites ∪ taste vector), per-member dietary hard gate, then small-LLM confirm (negation-aware) → per-member attribution; reject-as-repel (don't attribute a near-dup of a member's reject).
- [ ] 3.6 Dedup: L2 cosine vs `recipe_derived` (δ) + L3 intra-sweep (vs other candidates + this tick's imports); log skips. Optional: seed the candidate embedding into `recipe_derived` at import (close the reconcile lag).
- [ ] 3.7 Import matched candidates via `buildNewRecipe` + `validateFile` + `put` + `seedRecipeDescription`; stamp `discovered_at`/`discovery_source`/attribution; governor: τ + rate cap with **deferred-and-logged** excess.
- [ ] 3.8 Write a per-candidate log entry for every terminal outcome (import/skip-*/park); record `discovery_evaluated` terminal verdicts so non-matches aren't re-evaluated.
- [ ] 3.9 `buildDiscoveryDeps(env)` wires the real feed/HTTP/Kroger-free clients + `env.AI` + D1 + KV.
- [ ] 3.10 Unit tests with in-memory fakes (mirror `flyer-warm.test.ts` / `recipe-embeddings.test.ts`): intake dedup, cheap-triage drop, classify-retry-park, match + attribution, dietary gate, dedup L2/L3, governor defer, log entries, idempotent retried tick.

## 4. Scheduled wiring + health
- [ ] 4.1 Add `runDiscoverySweepJob` to `scheduled()` in `src/index.ts` as the fourth job (phase placement: after the projection so corpus + `recipe_derived` are fresh for dedup/match); `Promise.allSettled` + rethrow posture unchanged.
- [ ] 4.2 `health:job:discovery-sweep` record (tenant-data-free summary: processed/imported/skipped/parked/deferred); register in `HEALTH_JOBS`; ntfy on failure + on a new parked error.

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
