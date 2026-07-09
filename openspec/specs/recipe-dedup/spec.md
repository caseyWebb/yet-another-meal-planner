# recipe-dedup Specification

## Purpose
TBD - created by archiving change corpus-dedup-reconcile. Update Purpose after archive.
## Requirements
### Requirement: A scheduled, bounded, watermarked corpus dedup scan

The Worker's scheduled handler SHALL run a corpus-wide near-duplicate scan (`dup-scan`) that compares recipes **already in the corpus** against each other — closing the gap left by import-time dedup, which only compares incoming candidates against the corpus. The scan SHALL run after the index projection and the recipe-derived embedding reconcile in the same tick (so it reads fresh `ingredients_key` facets and fresh description vectors), SHALL make no model calls and no external subrequests (pure arithmetic over D1 rows), and SHALL be **bounded and watermarked** rather than all-pairs-every-tick: each recipe carries a per-slug scan stamp — a hash of its embedded-description hash and its effective `ingredients_key` — and a tick SHALL scan at most a fixed per-tick cap of recipes whose stamp is missing or stale, comparing **each scanned recipe against the full current vector set**, then stamping them. A tick over a fully-stamped corpus SHALL plan zero comparisons. Stamps for recipes that have left the corpus SHALL be pruned. Because whichever member of a pair is stamped later is compared against a set containing the other, every corpus pair is covered without any tick exceeding the cap.

#### Scenario: The backlog drains bounded, then converges

- **WHEN** the scan first runs over an existing corpus of N embedded recipes with a per-tick cap of K
- **THEN** each tick scans and stamps at most K recipes, the whole corpus is covered within ⌈N⁄K⌉ ticks, and subsequent ticks over the unchanged corpus perform no pair comparisons

#### Scenario: A changed recipe re-queues itself

- **WHEN** a stamped recipe's description is regenerated and re-embedded, or its effective `ingredients_key` changes
- **THEN** its stored stamp no longer matches its current hash and a later tick re-scans it against the full corpus

#### Scenario: A new import is compared against every existing recipe

- **WHEN** a recipe enters the corpus after the initial convergence
- **THEN** it has no stamp, and its scan compares it against the full current vector set — so a duplicate of any pre-existing recipe is detected without re-scanning the rest

### Requirement: Corroborated near-duplicate detection

The scan SHALL detect a candidate pair with a **two-arm rule** over the description-embedding cosine and the recipes' effective `ingredients_key` sets: (arm 1) cosine at or above a high threshold alone (0.90 — the import-dedup analog, catching paraphrase twins regardless of ingredient wording), OR (arm 2) cosine at or above a corroborated threshold (0.72) AND ingredients-key Jaccard at or above 0.5 AND at least 2 shared ingredients. Ingredient sets SHALL compare case-insensitively over the write-normalized `ingredients_key`. Description cosine alone SHALL NOT be the sole signal below the high threshold — derived descriptions are a lossy proxy for dish identity (the production defect pair's cosine is 0.767, below any workable cosine-only cut) — and weak ingredient sets (fewer than 2 shared) SHALL NOT corroborate. The thresholds are code constants calibrated against the production pair distribution, not operator-tunable configuration.

#### Scenario: The observed defect pair is detected via the corroborated arm

- **WHEN** the scan compares `fresh-pasta` and `homemade-pasta-dough` (description cosine ≈ 0.767, shared key ingredients {flour, eggs}, Jaccard ≈ 0.67)
- **THEN** the pair clears the corroborated arm and is surfaced as a near-duplicate candidate

#### Scenario: A high-cosine paraphrase pair needs no ingredient corroboration

- **WHEN** two recipes' description vectors have cosine ≥ 0.90 but their `ingredients_key` wording overlaps weakly
- **THEN** the pair is surfaced via the high arm

#### Scenario: Same-cuisine neighbors below the rule are not surfaced

- **WHEN** two distinct dishes score a moderate description cosine (e.g. ≈ 0.85) with little ingredient overlap (Jaccard < 0.5 or fewer than 2 shared)
- **THEN** no candidate pair is produced for them

### Requirement: Detected pairs surface as operator merge proposals, never auto-merge

Each detected pair SHALL be surfaced as **one** `merge_recipes` proposal in the existing pending-proposals queue, addressed to the **operator tenant** — corpus curation is operator-trusted, and a merge mutates shared state no single member may confirm. The proposal's target SHALL be the lexicographically-sorted pair key (so detection order cannot mint two ids for one pair); its payload SHALL carry both slugs and titles plus the detection evidence (cosine, shared ingredients, Jaccard, which arm fired); its rationale SHALL be a human-readable sentence naming both dishes; its producer SHALL identify the scan. Enqueue SHALL reuse the queue's stable-id idempotence: re-detecting a pair with a live or resolved proposal SHALL be a no-op, and a dismissed pair SHALL never be re-surfaced. The scan SHALL write **nothing** to the corpus — surfacing is its only side effect. When no operator tenant is configured, the scan SHALL perform no comparisons and write no stamps (a recorded no-op), so the full backlog surfaces once an operator exists.

#### Scenario: A detected pair becomes one pending operator proposal

- **WHEN** the scan detects a candidate pair
- **THEN** a single pending `merge_recipes` proposal appears in the operator tenant's queue carrying both slugs, titles, and the numeric evidence — and no recipe file, index row, or derived row is modified by the scan

#### Scenario: Re-detection and dismissal are idempotent

- **WHEN** a later tick re-detects a pair whose proposal is still pending, or one the operator dismissed
- **THEN** the enqueue resolves to the same stable id and inserts nothing, and the dismissed pair does not reappear

#### Scenario: No operator tenant configured

- **WHEN** the scan runs on a deployment with no operator tenant configured
- **THEN** it enqueues nothing and stamps nothing, recording a skipped-run health summary, so configuring an operator later yields the full first-convergence sweep

### Requirement: A confirmed merge is agent-guided and non-destructive

Accepting a `merge_recipes` proposal SHALL apply **no automatic corpus write** — the apply path records the decision only. The merge itself SHALL be performed conversationally by the agent through existing write tools: reading both recipes and their notes, agreeing the survivor with the operator, folding what is worth keeping into the survivor (tags, `pairs_with`, body details) via `update_recipe`, re-pointing `pairs_with` references to the duplicate, and finally marking the duplicate's frontmatter with `duplicate_of: <survivor-slug>` — after which the proposal is confirmed accepted (merge-then-accept, so an interrupted flow leaves the proposal pending). The `duplicate_of` marker SHALL be reversible: it excludes the recipe from the projected index (see the `recipe-index` capability) while the R2 file, member notes, and cooking-log history remain intact, and removing the marker restores the recipe. A tombstoned recipe's derived row prunes with the existing orphan prune, so it SHALL NOT re-trigger detection. Rejecting the proposal SHALL keep both recipes and permanently suppress the pair.

#### Scenario: Accept writes nothing automatically

- **WHEN** `confirm_proposal` accepts a `merge_recipes` proposal
- **THEN** the proposal is marked accepted and no recipe file or index row is changed by the apply path itself

#### Scenario: The marked duplicate leaves the index and the detector's reach

- **WHEN** the agent-guided merge marks the duplicate `duplicate_of: <survivor>` and the next reconcile tick runs
- **THEN** the duplicate projects no index row, its derived embedding row is pruned, and no future scan can propose it again

#### Scenario: A tombstone is reversible

- **WHEN** the `duplicate_of` field is removed from a marked recipe
- **THEN** the next projection restores its index row and downstream derivation re-runs, with its notes and history intact throughout

### Requirement: The scan records job health

The scan SHALL record per-run health like the sibling scheduled jobs: a `job_health` upsert and a `job_runs` history row under its own job name with a counts summary (recipes scanned, pairs found, proposals enqueued, stamps pruned, or the skipped reason), plus a usage-trends point. A thrown tick SHALL record `ok: false`, notify, and rethrow so the platform's native cron status reflects it.

#### Scenario: A healthy tick records its summary

- **WHEN** a scan tick completes
- **THEN** `job_health` and `job_runs` carry its scanned/pairs/enqueued counts under the scan's job name

#### Scenario: A hard failure is loud

- **WHEN** a scan tick throws
- **THEN** the job records `ok: false` with the error and rethrows

