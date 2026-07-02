## Context

The identity graph merges nodes via the union-find `representative` pointer; keyed consumers converge to survivors through per-surface reconciles: grocery/pantry rows via `grocery-pantry-reconcile`, `sku_cache` keys via `sku-cache-rekey`. The alias front-door (`ingredient_alias`) has no such reconcile — its `id` values are read through `readResolver` (which bakes the chain in), so *resolution* stays correct, but the *stored* targets rot as merges land. Production carries ~6 rows pointing at merged-away losers, including retired 3-segment ids the segment-repair pass re-rooted. The admin renders the stored id, so operators see dead targets.

The admin's Normalize › Aliases listing renders every alias row; 513 of 590 production rows are canonical self-entries (`variant === id`, the row every mint writes for its own node) that carry no mapping information.

## Goals / Non-Goals

**Goals:**
- Stored `ingredient_alias.id` values converge to surviving ids every scheduled tick, deterministically, with no model calls and no metadata churn.
- The Normalize alias listing shows only real mappings, with the canonical self-entry population reduced to a count chip.

**Non-Goals:**
- No re-decision of any mapping (that is the alias re-audit's job); no node merges, no edge changes.
- No schema change — `ingredient_alias` keeps its shape; only stored `id` values move.
- No change to hot-path resolution semantics (`readResolver` already chased the chain; convergence makes stored state match what reads already computed).

## Decisions

**D1 — Host the step in the `sku-cache-rekey` job, not the alias-audit job.** The retarget is a pure function of the same two reads the sku pass already performs each tick (`readIdentitySources` → `representativeResolver`), it shares the pass's idempotent/stampless/no-LLM character, and it must run *every* tick forever — whereas the alias-audit is a MODEL-calling backlog drain that quiesces once `audited_at` is stamped everywhere and only loads its registry view when un-audited non-self rows remain. Folding into the audit would either resurrect those reads on quiesced ticks or leave convergence dead after the backlog drains. The sku pass is the closest sibling shape: same read, same tick, same "converged state plans nothing" contract. Alternative considered: a standalone job — rejected as a third job_health row and duplicate reads for a ~600-row table scan.

**D2 — Chase representatives only; never the alias front-door.** The target of a re-point is `representativeResolver(identities)(row.id)` — identity rows only. Consulting `readResolver`'s `toId` for the target could route an alias through *another variant's* mapping (front-door values are themselves what this pass repairs) and is semantically wrong: alias rows point at nodes, and node survivorship is defined solely by the representative chain. An `id` absent from the identity table resolves to itself and is left untouched.

**D3 — `UPDATE ... SET id = ?` only; no per-row normalization-log entry; `decided_at`/`audited_at`/`source`/`confidence` untouched.** Re-pointing at the survivor is key maintenance — the *decision* (which product the variant is) is unchanged; only the node's surviving name moved. The repo's audit-trail convention already draws this line: the sku re-key and grocery/pantry re-keys log nothing per row, while the alias *re-audit* (a genuine re-decision) writes log entries and refreshes `decided_at`. Logging ~500 mechanical re-points (every self-alias of a merged node) would flood the Decisions stream with non-decisions. The `alias_retargeted` summary count in `job_runs` is the audit trail, matching its siblings.

**D4 — Bounded by the pass's existing per-tick cap, sharing `truncated`.** Alias updates are single-row PK `UPDATE`s batched through `db.batch`, counted against `SKU_REKEY_MAX_PER_TICK` independently of the sku groups (each bound applies to its own plan; a deferred remainder sets the shared `truncated` flag and re-plans next tick — idempotence makes deferral free). This keeps the pathological-table guard the job already documents.

**D5 — Summary key `alias_retargeted` (snake_case) counted as work in the Audits observability.** Sibling job summaries use snake_case (`grocery_rekeyed`, `self_stamped`); the sku card's field list and the `tickOf`/`isSettled` derivation in `audit-admin.ts` include the new count so a retarget tick renders as work, not a settled no-op. Additive — existing consumers read their fields by name.

**D6 — Reader-side split: `NormalizationPage.aliases` becomes mappings-only (`variant !== id` on the *stored* row) plus `aliasSelfCount`.** Filtering in `readNormalizationPage` rather than JSX follows the panel's "make impossible states impossible" modeling — the page type cannot render a self-row because it never receives one. The self test uses the stored `variant === id` (the same definition the alias-audit's self-stamp uses), not the post-chain comparison: post-convergence the two agree, and mid-window a self-alias of a fresh loser is still a *stored* self-entry (it becomes a listed mapping only after the reconcile re-points it — the listing tracks stored state, same as the rest of the page). The Aliases stat tile keeps the full front-door count (it measures resolver coverage); the tab pill and table footer count mappings. The chip renders from `aliasSelfCount` as a Basecoat outline badge beside the source pills.

**D7 — Ownership scoping: only rows the re-audit no longer owns are retargeted.** The retarget plans only rows with `audited_at IS NOT NULL OR source='human'`. An un-audited auto row still belongs to the alias re-audit — its re-decision (capture's own commit, the alias upsert) IS the re-point — and racing it loses: the audit re-points a row to Y mid-tick, the retarget then lands its stale pre-tick chase Z, and with both rows ending stamped nothing ever revisits the clobber. Human rows are never audit-selected, so re-pointing their merged-away targets here is pure key maintenance (moving the target to the node's surviving name is not an auto override of the human decision — the decision is the variant→product mapping, which is unchanged). The eligible set converges everything eventually: the audit stamps or re-commits (born-stamped) every auto row, after which its targets are the retarget's to maintain forever.

## Risks / Trade-offs

- **[Convergence window]** A merge landing between reconcile ticks leaves stale targets (and hidden-from-listing loser self-rows) until the next tick → acceptable: reads already chase the chain, so behavior is unaffected; the window is one cron period, the same contract as the sku/grocery re-keys.
- **[Concurrent audit writes]** The alias re-audit re-decides un-audited auto rows the same tick the retarget scans → mitigated by the ownership rule (D7): the retarget plans only audited or human rows, so the two writers never touch the same row — the audit's writes are born-stamped and become retarget-eligible only on later ticks, when the retarget's chase is fresh again.
- **[Summary shape drift]** A new summary field could silently miss the admin derivations → `audit-admin.ts` field lists are updated in the same change, with a test asserting the retarget count feeds `worked`.
