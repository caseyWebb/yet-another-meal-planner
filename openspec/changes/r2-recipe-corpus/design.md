## Context

GitHub plays a small, well-contained role for *content*: `read_recipe` reads a markdown body (`src/tools.ts`), `guidance.ts` lists/reads/writes guidance, and the recipe write tools commit via `src/commit.ts` — all behind the `GitHubClient` interface (`src/github.ts`). The *index* (frontmatter facets) is already projected into D1 by a CI build. So "drop the data repo for content" is mostly: retarget one interface to R2, and move the index projection from CI into the Worker.

The validation worry that usually blocks this is smaller than it looks: `src/validate.ts` **already** enforces the full required-field + vocab contract on `workerd` (it shares `recipe-contract.js` / `vocab.js` with the build). The *only* thing CI does that the Worker doesn't is **cross-corpus** checks (`pairs_with` slug resolution), which need the whole corpus — and the reconcile holds the whole corpus every pass. So moving projection into the reconcile lets one validator do everything CI did **and** the cross-corpus part, on `workerd`.

## Goals / Non-Goals

**Goals**
- Move authored markdown (`recipes`, `guidance`) to R2; delete the GitHub App for data access.
- Move index projection + corpus-wide validation from CI into the Worker reconcile; consolidate to one validator.
- Preserve the operator's bulk-edit workflow (a local folder of markdown) without git.
- Keep code + plugin marketplace on GitHub, untouched.

**Non-Goals**
- The **deploy substrate** (button+fork vs. control repo) — separate decision.
- Recipe **version history** — explicitly given up (operator confirmed it is not needed); R2 object versioning may be enabled but is not relied upon.
- Instant reprojection via Queues/event-notifications — noted as a paid alternative, not adopted.
- The authoring UI (`obsidian-authoring-vault`) and AI metadata (`ai-derived-recipe-metadata`) — separate changes that compose with this one.

## Decisions

1. **R2 is the authored-files tier; D1 keeps the derived index.** R2 *becomes* the tier the three-tier boundary already reserves for "authored markdown, hand-edited via Obsidian/native apps." D1's role (derived projections, queryable) is unchanged. **Content does not go into D1** — Obsidian edits *files*, and D1 has no file interface; storing markdown in D1 would defeat the entire authoring premise. (See the rejected option below.)

2. **Projection + validation move into the existing reconcile (eventual), not Queues.** The cron reconcile reads R2, validates each recipe with the shared contract **plus** `pairs_with` cross-resolution (it has the whole corpus), and projects `recipes`. This matches the system's accepted eventual-consistency model and adds no infrastructure. *Alternative considered:* R2 event-notifications → Queue → consumer Worker (near-instant) — rejected for v1 because it requires Workers Paid (Queues) for latency the system doesn't need; revisit only if reconcile lag becomes a real complaint.

3. **One validator; eventual human-edit feedback.** `validate.ts` is the single validator (agent writes + reconcile). A malformed human/Obsidian edit is **skipped** by the reconcile (not projected) and recorded to a D1 `reconcile_errors` row + `/health` + an ntfy push, and the agent surfaces it conversationally ("`thai-curry` failed to index: `protein: poltry` isn't valid"). This replaces red-CI feedback. *It is a real downgrade in immediacy* — mitigated by the agent-surfaced channel and, decisively, by `obsidian-authoring-vault` constraining values at the editing surface so most such errors can't be typed.

4. **Agent writes keep atomic single-file semantics; multi-file loses cross-file atomicity.** Recipe writes are single-object `R2.put` (fine). The commit engine's atomic *multi-file* batch (rare — chiefly guidance) has no R2 equivalent; sequence the puts and accept non-atomicity (low frequency, low stakes), or scope multi-file writes out. Document the change from `commit.ts`'s replay-on-conflict semantics.

5. **Conflict model: last-write-wins.** Agent-write-to-R2 vs. human-Obsidian-write-to-R2 is a genuine race with weaker semantics than git's merge (Remotely Save does "smart conflict," not a 3-way merge). Low probability at friend-group scale on a shared corpus mostly authored by one person; documented, not engineered around for v1.

6. **`report_bug` → D1, surfaced by the admin panel.** Issues were the only non-content GitHub use on the write path; a `bug_reports` table read by `operator-admin-panel` replaces it. (If the admin panel isn't present, a minimal operator read path or email fallback.)

7. **Bulk edits via a local R2 mirror.** The operator's "all data in one workspace for easy migration" workflow is preserved with `rclone sync r2:corpus ./data` (R2 is S3-compatible) — edit with Claude Code — `rclone sync ./data r2:corpus`, or simply point the tooling at the Obsidian vault folder. The mechanism changes from `git pull/push` to `rclone`; the ergonomic (a local folder of markdown) is identical. Schema migrations of *derived* fields need no bulk edit at all now that `ai-derived-recipe-metadata` has landed.

## Risks / Trade-offs

- **[`r2_buckets` dropped from operator deploys]** the documented silent-drop trap. **Mitigation:** add `r2_buckets` to the `merge-wrangler-config.mjs` allowlist + a merge test asserting it survives.
- **[Lost CI feedback on human edits]** see Decision 3. **Mitigation:** agent-surfaced errors + the vault's client-side validation.
- **[Reconcile is now load-bearing for the index, not just embeddings]** a stalled reconcile means a stale index. **Mitigation:** the index is already reconciled-from-D1 today and tolerant of lag; `/health` already watches the job; the order path re-prices/validates live.
- **[Migration data loss]** a botched git→R2 copy. **Mitigation:** dual-read window (read R2, fall back to git) until parity is verified, then cut the fallback.
- **[Multi-file atomicity loss]** Decision 4. **Mitigation:** low frequency; sequence puts; consider a manifest write last.

## Rejected option: recipes in D1

Storing the markdown body as a D1 column was considered and **rejected**. It would (a) make Obsidian authoring impossible (no file interface for any sync plugin to target), defeating the change's main benefit; (b) misuse the relational tier as a document store; and (c) lose the "recipes are portable files that outlive the agent" property. R2 is the file tier; D1 stays the derived-index tier.

## Migration Plan

1. Add the R2 binding + the corpus store (`src/corpus-store.ts`) behind the same interface; deploy with **dual-read** (R2 first, git fallback).
2. One-time copy git corpus → R2 (`rclone`/script). Verify `read_recipe`/`list_guidance` parity across the corpus.
3. Move index projection + corpus validation into the reconcile; backfill the index from R2; retire `build-indexes.mjs` / `d1-rest.mjs` and the data-repo `build-indexes.yml`.
4. Retarget writes (`create_recipe`/`update_recipe`/`save_guidance`) to R2; retarget `report_bug` to D1.
5. Remove the git fallback and the GitHub App data path; move the cookbook off Pages.

Rollback before step 5 is a redeploy (git fallback still present).

## Open Questions

- **Deploy substrate — RESOLVED (lean): the featherweight control repo; the button is a deferred, documented quick-start, not a maintained path.** Rationale: the control repo keeps **conflict-free updates** (bump the pinned `code_ref`; `merge-wrangler-config.mjs` merges upstream code-level config — crons, compatibility, the R2 + `assets` bindings via the allowlist — into the operator's minimal `wrangler.jsonc`), which a fork's raw "Sync fork" cannot (it conflicts the moment the operator edits `wrangler.jsonc`). The button optimizes *first-run* at the cost of fork-maintenance + losing the config-merge story; after R2 + the admin panel the leftover manual config is tiny either way (Kroger secrets, Access, optional domain — mostly irreducible external accounts), so the button's edge is narrow. Supporting both would double the deploy test/doc surface for a friend-group project; the button stays a footnote ("if you insist on one-click, accept the fork-upgrade tradeoff").
  - **The App drop and the pin-back are independent of this choice and both hold under the control repo.** *App drop:* a consequence of R2 (the Worker reads the corpus via an R2 binding; `report_bug`→D1 and the cookbook→assets remove the App's other two jobs), so the App has no remaining runtime role — the Worker never reads the control repo at runtime. *Pin-back:* unchanged and now extended to R2 — `wrangler deploy` auto-provisions id-less KV/D1/**R2** on first deploy and (`contents: write`) commits ids back to the control repo's `wrangler.jsonc`.
  - **⚠ R2 pin-back is higher-stakes than KV/D1.** The open `zero-config-deploy` risk (auto-provision idempotency across redeploys) bites harder for R2: a non-idempotent second deploy that provisions a *new* bucket orphans the **entire recipe corpus**, not just tokens/state. Pin the bucket name back (and add a guard/test that a second deploy reuses it) — see `operator-provisioning`.
- **Cookbook host:** Worker static assets (reuse the `operator-admin-panel` `assets` binding) vs. Cloudflare Pages. Leaning Worker-assets for a single surface.
- **`report_bug` sink** final form if `operator-admin-panel` is not yet present.
- **Per-author R2 credentials — RESOLVED: scoped per-author R2 tokens** (not one shared operator sync identity). Revoking one author doesn't rotate everyone, and it composes with `operator-admin-panel` (mint/revoke an author's R2 token alongside their tenant). Open sub-question: whether the admin panel mints these or the operator creates them in the Cloudflare dashboard.
- **Guidance multi-file writes:** sequence-and-accept vs. scope out (Decision 4).
