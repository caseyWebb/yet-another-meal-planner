# Tasks — corpus-dedup-reconcile

Ordered Worker-first: the watermark substrate and the scan (§1–§3) land and converge in production as
a surfacing-only change (nothing consumes a proposal until confirmed), then the confirm/apply seam +
projection tombstone (§4–§5), the app rendering (§6), persona + docs (§7–§8), and the production
acceptance check (§9). **No spike tasks** — the thresholds, the fixture pair's actual cosine/overlap,
the corpus size, and the full false-positive list at the chosen rule are settled in `design.md`
against the production spike (2026-07-08: 205 recipes; fixture cosine 0.7670, Jaccard 0.67; 7 pairs
at the chosen rule; 0 pairs at cosine ≥ 0.90).

## 1. D1: the scan watermark

- [ ] 1.1 Add `packages/worker/migrations/d1/0045_dup_scan.sql` (next available number) creating `dup_scan` (`slug TEXT PRIMARY KEY, scanned_hash TEXT NOT NULL, scanned_at TEXT NOT NULL`). Header comment: the dup-scan's per-recipe watermark — `scanned_hash` = `hashText(description_hash + "|" + ingredients_key JSON)` at scan time; a differing/missing stamp re-queues the recipe; rows for slugs no longer in `recipe_derived` are pruned by the job (never wholesale-replaced).

## 2. Worker: the dup-scan module (pure core + deps + job wrapper)

- [ ] 2.1 Add `packages/worker/src/dup-scan.ts` with the pure detection core, mirroring `reconcile-signals.ts`'s testable-core shape. Constants (module-level, NOT operator config — see design.md A): `DUP_COSINE_HIGH = 0.90`, `DUP_COSINE_CORROBORATED = 0.72`, `DUP_JACCARD = 0.5`, `DUP_SHARED_MIN = 2`, `DUP_SCAN_MAX_PER_TICK = 25`. Pure functions: `scanStampHash(descriptionHash, ingredientsKeyJson)` (via `src/hash.js` `hashText`); `isDuplicatePair(cosine, sharedCount, jaccard)` (the two-arm rule); `planDupScan(rows, cap)` → the ≤ cap slugs whose stamp is missing/stale; `detectPairs(scanSlugs, allRows)` → candidate pairs `{ a, b, cosine, shared, jaccard, detector }` with lexicographically-sorted pair members, comparing each scanned recipe against the full row set (skip self), reusing `cosineSimilarity` from `./embedding.js` and case-insensitive set overlap over parsed `ingredients_key`.
- [ ] 2.2 Add the injected deps + real wiring (`buildDupScanDeps(env)`): `loadScanState()` — one pass joining `recipe_derived` (slug, embedding, description_hash; embedded rows only) with `recipes` (title, ingredients_key) and `dup_scan` (scanned_hash), all reads via `src/db.ts`; `enqueuePair(pair, nowIso)` — builds the `merge_recipes` `ProposalDraft` (target = `"<a>+<b>"` sorted; payload `{ slugs, titles, cosine, shared_ingredients, jaccard, detector }`; rationale a human sentence naming both titles with the similarity and shared ingredients; evidence = the numbers + thresholds in force) and calls `enqueueProposal(env, operatorTenant, draft, "dup-scan", nowIso)`; `stamp(slugs→hash, nowIso)` (upsert); `pruneStamps()` (`DELETE FROM dup_scan WHERE slug NOT IN (SELECT slug FROM recipe_derived)`).
- [ ] 2.3 Add `runDupScanJob(env, deps)`: resolve the operator tenant from `env.OWNER_TENANT_ID` (normalized, as `reconcile-tools.ts` does); when unset, record health `{ ok: true, summary: { skipped: "no_operator" } }` and return WITHOUT scanning or stamping (design.md C). Otherwise: load state → plan → detect → enqueue (counting inserted vs ignored) → stamp the scanned slugs → prune orphan stamps → `writeJobHealth`/`writeJobRun`/`recordUsagePoint` under `"dup-scan"` with `{ scanned, pairs_found, enqueued, stamps_pruned }`; on throw record `ok: false`, `notifyFailure`, rethrow — the exact `runReconcileSignalsJob` shape.
- [ ] 2.4 Wire the job into `scheduled()` Phase 5 in `packages/worker/src/index.ts`, in the same `Promise.allSettled` as `runReconcileSignalsJob`/`runArchetypeDerivationJob` (after Phase 2 projection + Phase 3 embeddings — the freshness ordering the discovery sweep already relies on). Update the phase's comment block.
- [ ] 2.5 Worker unit tests (`packages/worker/test/dup-scan.test.ts`, in-memory deps like the sibling jobs): the two-arm rule (fixture-shaped corroborated pair passes at 0.767/0.67/2; a 0.85-cosine low-overlap pair does not; a 0.91-cosine no-overlap pair does); `planDupScan` respects the cap and skips fresh stamps; a changed `description_hash` or `ingredients_key` re-queues; `detectPairs` sorts pair members and compares scanned-vs-all (a new recipe finds an old duplicate); enqueue idempotence (re-detection of a pending/dismissed pair inserts nothing — through the real `proposalId` path); the no-operator run enqueues nothing AND stamps nothing; orphan stamps are pruned; health summary counts.

## 3. Deploy checkpoint: converge surfacing in production

- [ ] 3.1 Land §1–§2 through review → PR → merge (deploy auto-kicks; the migration applies `--remote`). This is safe to ship ahead of §4–§6: proposals surface but nothing consumes them destructively.

## 4. Worker: confirm/apply seam

- [ ] 4.1 Add the `merge_recipes` case to `applyProposal` in `packages/worker/src/reconcile-db.ts`: **no write** — return a description like `recorded merge decision for <target> (the merge itself is agent-guided via update_recipe)`. Unit test: accepting a `merge_recipes` proposal flips status and performs no night-vibe/corpus write.
- [ ] 4.2 Extend the `confirm_proposal` + `list_proposals` tool descriptions (`packages/worker/src/…tools`) so a skill-less agent is safe: `merge_recipes` accept records the decision only — the merge is performed FIRST via the corpus write tools, then confirmed (merge-then-accept); reject keeps both recipes forever.

## 5. Worker: the projection tombstone (`duplicate_of`)

- [ ] 5.1 In `packages/worker/src/recipe-projection.ts`, after a file parses + validates, skip a recipe whose frontmatter `duplicate_of` is a non-empty string: no `recipes` row, no `reconcile_errors` entry, counted in a new `tombstoned` field on the projection summary (rides into `job_health`/`job_runs`). Derived-row convergence needs no new code (the embed reconcile's `PRUNE_SQL` and §2's stamp prune both key off the slug leaving `recipes`/`recipe_derived`).
- [ ] 5.2 Projection unit tests: a `duplicate_of` file projects no row and no error and bumps `tombstoned`; removing the field restores the row on the next run; an EMPTY-string `duplicate_of` is ignored (projects normally). Plus one integration-shaped test asserting the downstream chain: after a tombstoned projection, the embed reconcile's orphan prune deletes its `recipe_derived` row.
- [ ] 5.3 Confirm (unit test, not code change) that `update_recipe` accepts adding a novel `duplicate_of` field through the pass-through frontmatter contract on an otherwise-compliant recipe — the merge flow's write path.

## 6. Member app: render the new kind (ships with app Playwright)

- [ ] 6.1 In `packages/app/src/routes/_app.profile.tsx` `ReconcileQueue`: add `merge_recipes` branches to `proposalTitle` (both titles from `payload.titles`, e.g. `Merge “Fresh Pasta” & “Homemade Pasta Dough”?`) and to the row's actions — rationale + a short "merge with your agent in chat" hint + **Dismiss only** (no accept button for this kind; D12 kind-specific-actions rule). Keep the existing kinds' rendering untouched.
- [ ] 6.2 Extend the member-app Playwright coverage (`packages/worker/app/visual/` + its seed) with a seeded `merge_recipes` proposal: the row renders the pair title and rationale, has no accept button, and Dismiss resolves it (queue row disappears; replay-safe). Run `aubr test:app` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).

## 7. Persona

- [ ] 7.1 In `packages/worker/AGENT_INSTRUCTIONS.md`, add the operator-facing merge-review guidance: when `list_proposals` shows a pending `merge_recipes` pair — read both recipes + `read_recipe_notes`; agree the survivor; fold what's worth keeping (tags, `pairs_with`, body details, a note) into the survivor via `update_recipe`/`update_recipe_note`; re-point any `pairs_with` references to the duplicate; mark the duplicate `duplicate_of: <survivor-slug>` via `update_recipe`; THEN `confirm_proposal(id, accept: true)`. "Keep both" = reject (permanent). Never merge unprompted — the proposal is the gate. The plugin rebuilds from source on deploy (no hand-edits to a generated bundle).

## 8. Docs in lockstep

- [ ] 8.1 `docs/SCHEMAS.md` — the `dup_scan` table; the `merge_recipes` proposal payload shape; the `duplicate_of` frontmatter field's semantics (operator-merge tombstone: excluded from the projection deliberately, reversible, written only through the confirmed merge flow).
- [ ] 8.2 `docs/ARCHITECTURE.md` — the dup-scan job in the scheduled-jobs inventory (Phase 5; bounded/watermarked; the two-arm detector; operator proposals; no model identity), and the note that near-dup dedup now exists at BOTH seams (import gate + corpus reconcile).
- [ ] 8.3 `docs/TOOLS.md` — `list_proposals`/`confirm_proposal` notes gain the `merge_recipes` kind (accept records the decision; the merge is agent-guided, merge-then-accept); `update_recipe` notes gain the `duplicate_of` semantics.

## 9. Production acceptance (the observed defect is the fixture)

- [ ] 9.1 After the §3 deploy converges (≤ ⌈205⁄25⌉ = 9 five-minute ticks), verify with a read-only production SELECT that the operator queue holds a pending `merge_recipes` proposal whose target is `fresh-pasta+homemade-pasta-dough` (`SELECT id, kind, target, status FROM pending_proposals WHERE kind = 'merge_recipes'`), and that the full first-convergence set matches the spike's expected ~7 pairs (design.md's table) — no flood, no miss. Verify `job_health` shows `dup-scan` ok with a drained backlog (`scanned` settling to 0).
- [ ] 9.2 Confirm the fixture end-to-end once §4–§7 land: run the agent-guided merge on the pair in chat (operator session), verify the duplicate leaves `recipes` on the next tick, its `recipe_derived` row prunes, the proposal is accepted, and nothing re-surfaces on later ticks.
