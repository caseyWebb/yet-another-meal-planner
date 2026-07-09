# Design — corpus-dedup-reconcile

## Context

Import-time dedup (`discovery-sweep.ts` `findDuplicate`, cosine ≥ `dedupThreshold` 0.9 over description embeddings) only protects the corpus against *incoming* duplicates. Nothing ever compares two recipes already inside the corpus, so pre-sweep pairs (the ReciMe import era) persist — issue #217's `fresh-pasta` / `homemade-pasta-dough` being the observed defect. The `recipe-import` spec's "Near-duplicate reconciliation without auto-merge" requirement has no implementing mechanism.

The machinery to build one already exists: every corpus recipe has a description embedding in `recipe_derived` (768-dim bge, `loadRecipeEmbeddings`), an effective `ingredients_key` on the projected `recipes` row, the shared `cosineSimilarity`, and an idempotent human-review queue (`pending_proposals` via `reconcile-db.ts` — stable `(kind, target)` hash id, `INSERT OR IGNORE`, dismissed proposals never re-surface). Per the repo's convergence rule, the fix is a pipeline change whose acceptance fixture is the observed defect pair, verified against production after deploy.

## Model identity: none

The scan is pure arithmetic over already-derived data (vectors + facet sets). No `env.AI` calls, no external subrequests, no LLM judgment in the detector. The *judgment* — is this really the same dish, which file survives, what folds across — stays with the human-gated, agent-guided merge, exactly where the determinism boundary puts fuzzy work.

## Production spike (read-only, `wrangler d1 execute DB --remote`)

Queries run during planning (2026-07-08), all read-only SELECTs against production D1:

1. `SELECT COUNT(*), SUM(embedding IS NOT NULL) FROM recipe_derived` → **205 recipes, all 205 embedded.** The scan's full-corpus load is ~3 MB of JSON vectors — the same load the discovery sweep already performs every tick (`loadCorpusVectors`).
2. `SELECT slug, title FROM recipes WHERE slug LIKE '%pasta%' OR slug LIKE '%dough%'` → the issue's pair exists as **`fresh-pasta`** ("Fresh Pasta") and **`homemade-pasta-dough`** ("Homemade Pasta Dough").
3. Pulled both rows' `recipe_derived.embedding` + `recipe_derived.description` and every `recipes.ingredients_key`; computed all C(205,2) = 20,910 pairwise cosines locally in Node.

Findings that shaped the detector:

- **The defect pair's cosine is 0.7670** — far below the import threshold (0.9) and below any workable cosine-only cut. Root cause is visible in the derived descriptions: `fresh-pasta` reads "a simple **egg-and-flour** dough…", `homemade-pasta-dough` reads "a simple dough made with **olive oil instead of eggs**…" — the two descriptions *contradict* each other (and the latter contradicts its own `ingredients_key`, which includes eggs), so the embedding space legitimately separates them. Description text is a lossy, occasionally wrong proxy for dish identity; it cannot be the sole signal.
- **Cosine-only pair distribution:** ≥ 0.90 → **0 pairs**; ≥ 0.85 → 8 pairs (none the defect pair, several clear non-duplicates like `minestrone-soup`/`pasta-e-fagioli`); ≥ 0.80 → 59; ≥ 0.75 → 322; ≥ 0.70 → 1,803. A cosine-only threshold low enough to catch 0.767 floods the queue with hundreds of false pairs.
- **`ingredients_key` corroboration separates cleanly.** The defect pair: shared = {flour, eggs}, Jaccard 2/3 = 0.67, containment 1.0. Evaluated combined rules over all production pairs:
  - `cosine ≥ 0.75 AND Jaccard ≥ 0.5` → 5 pairs incl. the fixture — but the fixture clears 0.75 by only 0.017, too thin a margin against description regeneration drift.
  - `cosine ≥ 0.70 AND containment ≥ 0.8` → 9 pairs incl. junk (`fresh-pasta`/`offelle-di-parona` **butter cookies** — flour+eggs ⊆ cookie ingredients; containment over tiny sets is too permissive). **Rejected.**
  - **Chosen: `cosine ≥ 0.72 AND Jaccard ≥ 0.5 AND shared ≥ 2` → 7 pairs**, the fixture clearing with 0.047 margin:

    | cosine | pair | shared / Jaccard | read |
    |---|---|---|---|
    | 0.8372 | mussels-fra-diavolo · mussels-with-cannellini-beans-and-tomatoes | 4 / 0.67 | review, likely dismiss |
    | 0.8367 | moules-marinieres-mussels-in-white-wine-sauce · mussels-fra-diavolo | 4 / 0.67 | review, likely dismiss |
    | 0.8112 | butter-chicken · pressure-cooker-butter-chicken | 5 / 0.56 | **true near-dup** — the recipe-import spec's own canonical example |
    | 0.7988 | american-chop-suey · american-goulash | 4 / 0.67 | **true near-dup** (same dish, two names) |
    | 0.7670 | **fresh-pasta · homemade-pasta-dough** | 2 / 0.67 (containment 1.0) | **the fixture** |
    | 0.7395 | pasta-e-ceci · pasta-e-fagioli-tuscan | 4 / 0.57 | siblings, dismissible |
    | 0.7262 | fresh-pasta · spinach-fresh-pasta | 2 / 0.50 | variant, worth a look |

  ~7 one-time proposals on first convergence, each dismissal permanent (stable id). Tolerable review load; several are genuine catches.
- The unconditional high arm (≥ 0.90) fires on nothing today but stays as the paraphrase-twin catch (two files of the *same* recipe whose ingredient key wording drifted — Jaccard could read low while the descriptions are near-identical), mirroring the import-time δ.

## Decisions

### A. Two-arm calibrated detector, thresholds as module constants

A pair `(a, b)` is a candidate iff `cosine(a,b) ≥ DUP_COSINE_HIGH (0.90)`, or `cosine(a,b) ≥ DUP_COSINE_CORROBORATED (0.72)` AND `jaccard(ingredients_key_a, ingredients_key_b) ≥ DUP_JACCARD (0.5)` AND `|shared| ≥ DUP_SHARED_MIN (2)`. Ingredient sets compare lowercased; `ingredients_key` is already write-normalized (Kroger-matcher normalization) so cross-recipe overlap lines up. A recipe with fewer than 2 key ingredients can only match through the high arm — small sets never corroborate by accident (the containment-rule lesson above).

Constants live in `dup-scan.ts` like `reconcile-signals.ts`'s `STALE_NEVER_DAYS` — **not** operator-tunable D1 config. They were calibrated against the full production pair distribution in this spike; re-calibration is a code change with the same evidence trail. (The import-time `dedupThreshold` in `DiscoveryConfig` is untouched — it gates a different decision: silently *skipping* an import must stay high-precision, while *proposing a review* tolerates moderate precision.)

### B. Watermarked, bounded scan — never O(n²) per tick

New `dup_scan` table: `slug TEXT PRIMARY KEY, scanned_hash TEXT, scanned_at TEXT`. A recipe's **current** hash is `hashText(description_hash + "|" + ingredients_key JSON)` (`src/hash.js` — the same helper `proposalId` uses): `description_hash` is `recipe_derived`'s embedded-description gate, so a vector change always changes it; folding `ingredients_key` in separately covers the edge where facet re-derivation changes the key without changing the regenerated description text.

Per tick: load the corpus scan state (slug, vector, title, `ingredients_key`, `description_hash`, stamp — one pass over `recipe_derived` ⋈ `recipes` ⋈ `dup_scan`); queue = embedded recipes whose stamp is missing or differs from the current hash; take up to `DUP_SCAN_MAX_PER_TICK (25)`; compare **each queued recipe against the full vector set** (skipping self); enqueue proposals for hits; upsert the stamps; delete orphan stamps (`slug NOT IN recipe_derived`).

Properties:
- **Bounded:** ≤ 25 × 205 cosines/tick (~4 M multiply-adds — sub-millisecond-class CPU), one D1 read pass, ≤ a handful of writes. Backlog of 205 drains in ≤ 9 ticks (5-min cron → under an hour to converge after deploy). Steady state: a tick with no new/changed recipes plans zero comparisons.
- **Pair-complete:** for any pair, whichever member is stamped *later* is compared against a vector set containing the other (a new import is unstamped, so it sweeps the whole corpus once; both-new-same-tick each sweep the full freshly-loaded set). Re-detection of an already-proposed pair is an `INSERT OR IGNORE` no-op.
- **Self-healing:** a re-described/re-faceted recipe re-queues automatically; a deleted recipe's stamp prunes; a crashed tick loses only unstamped progress and repeats idempotently.
- **Ordering:** runs in `scheduled()` **Phase 5** beside `runReconcileSignalsJob`/`runArchetypeDerivationJob` — after Phase 2 (projection → fresh `ingredients_key`) and Phase 3 (embed reconcile → fresh vectors), the same freshness argument the discovery sweep uses. Structured as the standard testable core + injected deps + job wrapper (`runDupScanJob` records `job_health`/`job_runs`/usage point under `dup-scan`; hard failure records `ok:false`, notifies, rethrows).

### C. The proposal: kind `merge_recipes`, addressed to the operator tenant

- **Kind** `merge_recipes`; **target** = the sorted pair key `"<slugA>+<slugB>"` (slugs lexicographic, so detection order can't mint two ids for one pair); id = the existing `proposalId(kind, target)` — no cadence-bucket special case.
- **Payload:** `{ slugs: [a, b], titles: [ta, tb], cosine, shared_ingredients: [...], jaccard, detector: "cosine" | "corroborated" }`. **Rationale:** a human sentence ("“Fresh Pasta” and “Homemade Pasta Dough” look like the same dish — description similarity 0.77, sharing flour and eggs. Review and merge?"). **Evidence:** the raw numbers + the thresholds in force. **Producer:** `dup-scan`.
- **Tenant: the operator (`OWNER_TENANT_ID`, normalized).** The corpus is shared; a merge mutates it for everyone, so it cannot be any single member's confirmation. The operator is already the corpus-curation trust anchor (`reconcile_read_signals` / `reconcile_enqueue_proposal` gate on the same id; the admin data explorer). Enqueuing per-member would ask N people the same cross-cutting question and let any one of them mutate shared state — rejected. No member data appears in the payload (corpus-only facts), so operator-addressing leaks nothing.
- **No operator configured → recorded no-op, no stamps.** `OWNER_TENANT_ID` is optional; without it there is no queue to address. Stamping anyway would permanently swallow the backlog, so the job records health with a `skipped: no_operator` summary and does nothing — configuring the operator later gets the full first-convergence sweep.
- Dismissal permanence and idempotent re-surfacing come free from the existing queue mechanics (`INSERT OR IGNORE` on the stable id; `status='rejected'` rows block re-insert). A pair the operator genuinely resolves by *differentiating* the recipes (rather than merging) changes both recipes' descriptions/facets → new vectors → rescan; if they no longer trip the rule, nothing re-surfaces (and if they do, the dismissed row still suppresses).

### D. Confirming: agent-guided merge via existing tools, `duplicate_of` tombstone

The recipe-import spec forbids auto-merge, and merging *is* judgment (which file survives, which body/tags/notes fold across) — LLM work by the determinism boundary. So:

- **`applyProposal` gains a `merge_recipes` case that writes nothing** — it returns a "merge decision recorded; the merge itself is agent-guided" description. Accept = the human decision is made and the work is done (see flow below); reject = keep both, permanently.
- **The merge flow is conversational** (persona guidance, operator-facing): read both recipes + `read_recipe_notes`; agree the survivor with the operator; fold anything worth keeping (tags, `pairs_with`, body details, a note) into the survivor via `update_recipe`/`update_recipe_note`; re-point any `pairs_with` referrers of the duplicate; **mark the duplicate `duplicate_of: <survivor-slug>`** via `update_recipe` (frontmatter is a pass-through record — the field rides through today); **then** `confirm_proposal(id, accept: true)` to record completion. Merge-then-accept, so an interrupted chat leaves the proposal pending rather than silently half-done.
- **The projection treats `duplicate_of` as a deliberate exclusion:** a validated file whose frontmatter carries a non-empty string `duplicate_of` projects **no** `recipes` row and **no** `reconcile_errors` row (it is not a defect), counted in the projection summary. Downstream convergence is all existing machinery: the embed reconcile's orphan prune (`DELETE FROM recipe_derived WHERE slug NOT IN (SELECT slug FROM recipes)`) drops its vector — so a tombstoned recipe can never re-trigger detection — and the dup-scan's own stamp prune drops its watermark. Removing the marker restores the recipe on the next tick. Non-destructive and reversible, unlike a delete tool (which doesn't exist and isn't minted here); the R2 file, member notes, and cooking-log history stay intact.
- **Why not have accept auto-apply the tombstone?** The payload can't carry the survivor choice (the detector doesn't know it) and the fold step is judgment. An accept that writes would either guess the survivor or skip the fold — both worse than recording the decision and letting the agent do the guided work it's built for.

### E. The member app renders `merge_recipes`, minimally

The operator is also a member; their profile screen lists their queue, and today's `ReconcileQueue` would render an unknown kind as "Adjust …" with an accept button that applies nothing — a lie on both counts. The fix honors the existing "kind-specific actions only — no synthetic action without a backing op" rule: a `merge_recipes` row renders the pair title from the payload, the rationale, a hint that merging happens with the agent in chat, and **Dismiss only** (backed by confirm-reject). No accept button in the app — accept's meaning ("the merge was performed") only exists in the chat flow. Ships with app Playwright coverage per the member-app gate.

## Risks / Trade-offs

- **Threshold brittleness.** The fixture clears the corroborated arm by 0.047 cosine and sits exactly at the Jaccard boundary's safe side (0.67 vs 0.5). A future description regeneration could shift the cosine; the `ingredients_key` corroboration is the stabler signal (write-normalized, ingredient identity). Accepted: the acceptance fixture is verified against production *after deploy*, and thresholds are code constants with a documented calibration trail if the corpus drifts.
- **False positives cost operator attention, once each.** ~7 proposals at first convergence, 3–4 of them dismissible. Dismissals are permanent by construction. Accepted as tolerable for a human-review queue; the alternative (higher thresholds) misses the fixture.
- **Full-vector load each active tick** (~3 MB) duplicates the discovery sweep's identical load in the same tick. Accepted: same cost class as the existing job, and only ticks with queued work pay the comparison cost; a converged tick still pays the (cheap, indexed) state read. Not worth cross-job plumbing.
- **`duplicate_of` is status-adjacent.** The repo deliberately has "no `status` field and no `draft` limbo"; `duplicate_of` is narrower — a redirect marker naming a survivor, excluded at projection, reversible, and only ever written through the operator-confirmed merge flow. It is not a general lifecycle state and the specs word it that way.
- **Dangling references to a tombstoned slug** (`pairs_with`, meal-plan rows, overlays). The merge guidance re-points `pairs_with` referrers before marking; the projection's existing unresolved accounting surfaces any missed ones; overlays/log rows keyed by the dead slug are inert history, not breakage.
- **Cross-member notes on the duplicate.** The agent flow folds *the operator's view* of what's worth keeping; other members' notes stay attached to the tombstoned slug (readable history) rather than migrating. Accepted for now — migration tooling would be a new write surface for marginal value.
