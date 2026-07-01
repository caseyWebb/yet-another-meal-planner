# Tasks

## 1. Schema + eligibility

- [x] 1.1 Migration `0034_reconfirm.sql`: `ingredient_identity.reconfirmed_at INTEGER` (nullable, the one-shot stamp) + `ingredient_normalization_log.is_reconfirm INTEGER NOT NULL DEFAULT 0` (the decision marker, decision 5.2).
- [x] 1.2 `src/corpus-db.ts`: `readReconfirmBatch(env, limit)` — eligible = `source='auto' AND concrete=1 AND reconfirmed_at IS NULL` AND **edgeless** (the edgeless filter done in JS over the loaded rows + edge endpoints, so it's fake-D1-testable), oldest `decided_at` first, with the stored embedding. `stampReconfirmed(env, id, now)`. Both throw-mapped through `db()`.

## 2. The re-confirm pass

- [x] 2.1 `src/ingredient-reconfirm.ts` — `reconfirmIdentities(deps)` mirrors `reconcileNormalization`: drain a bounded batch (`RECONFIRM_MAX_PER_TICK = 10`), retrieve nearest neighbors by cosine over the identity embeddings **excluding self**, run `confirmIdentity`, apply: edges → additive commit (`commitReconfirmEdges` — edges insert-or-ignore + log only, no node/alias/queue writes); `same` → `mergeIdentities(loser=node, survivor=match)` (node is always the loser, so never a human loser); `specialization` → add a `general` edge to the matched base only when it's a known candidate, **no id change**; `novel` → edges only. Stamp `reconfirmed_at` after each. *(Uses the node's stored embedding rather than re-embedding — equivalent, one fewer subrequest; a node without a stored embedding is skipped until capture embeds it.)*
- [x] 2.2 Failure handling mirrors the capture job: a transient `env.AI`/D1 error skips the node leaving `reconfirmed_at` null (retried next tick), no partial write; a `validation_failed` confirm fails safe to a no-op (stamp it, change nothing).
- [x] 2.3 `runReconfirmJob` + `buildReconfirmDeps` (mirror `runNormalizeJob`): `ingredient-reconfirm` `job_health` + `job_run` rows with a `{ reconfirmed, edges_added, merged, still_novel }` summary; rethrows so cron status reflects a failure.
- [x] 2.4 Each decision logged with **`is_reconfirm=1`** (decision 5.2 — a boolean column, threaded through `commitReconfirmEdges` / `mergeIdentities`, defaulting 0 so the capture job is unaffected). `readNormalizationPage` exposes a `reconfirm: boolean` on each decision row.

## 3. Wire + tests

- [x] 3.1 `runReconfirmJob(env, buildReconfirmDeps(env))` wired into `scheduled()` Phase 1, **after** `runNormalizeJob` (so it sees the freshest registry), in the existing `Promise.allSettled`.
- [x] 3.2 `test/ingredient-reconfirm.test.ts` (injected-deps harness): edge enrichment + stamp, self-exclusion, `same` merge (node the loser), `specialization` general-edge without id change, unknown-base guard, transient-skip, fail-safe no-op, isolated-node stamp, self-quiesce.
- [x] 3.3 `readReconfirmBatch` eligibility tests against `test/fake-d1.ts` (taught the three re-confirm predicates): only edgeless + auto + concrete + un-stamped + embedded nodes returned; edged / human / stamped / concept / embeddingless excluded; limit honored. `test/normalize-admin.test.ts` asserts the `reconfirm` field.

## 4. Observability + docs

- [x] 4.1 Status page: the `ingredient-reconfirm` job appears in Background jobs automatically (reuses `job_health`; no page change). The Decisions data marker (`reconfirm`) is exposed by `readNormalizationPage`; the **visual** distinction is translated from the design bundle in the follow-on Nodes/Decisions PR (see 4.2).
- [x] 4.2 **Design handoff:** the consolidated Claude Design bundle (re-confirm decision marker + reconcile-observability + the node/relationship edges view) is received and is being translated into Basecoat markup as the **phased follow-on PRs** (reconcile observability, then the Nodes view + refined Decisions) — not hand-designed here. This change ships the backend + the data the visuals read.
- [x] 4.3 Docs: `docs/ARCHITECTURE.md` (the capture section gains the re-confirm pass — eligibility, enrich-first, one-shot/quiescent, human-immune) + `docs/SCHEMAS.md` (`ingredient_identity.reconfirmed_at` + `ingredient_normalization_log.is_reconfirm`).

## 5. Resolved questions

- [x] 5.1 Re-eligibility: **one-shot** (a set `reconfirmed_at` = done). The timestamp permits adding coarse re-eligibility later (clear the stamp on large registry growth) without a migration; deferred as tuning.
- [x] 5.2 Log marker: a boolean **`is_reconfirm`** column (least churn — outcome badges stay `same|spec|novel|merge|nollm|fail`; re-confirm is an orthogonal origin flag surfaced as `reconfirm` on the decision row).
