## Why

The capture pipeline mints an identity node with whatever the graph knew **at mint time**. Early on the registry is sparse, so a term below the cosine floor is minted as a bare NOVEL node with **no LLM call and no edges** — the right call for not-blocking and not-mis-collapsing, but it freezes an under-connected node forever. Nothing revisits it: `captureIfNovel` only enqueues **unknown** surface forms, so a resolved node is never re-examined, and the capture confirm only ever proposes edges among the candidates *it* was handed. So an early `kielbasa` (minted bare when nothing else was in the graph) stays orphaned from the `sausage` / `andouille` / `bratwurst` family that fills in around it later — the graph under-connects its **oldest, sparsest-context entries**, which is exactly where it's weakest.

ADR-0001 named this as the accepted standing cost of caching world knowledge — it "freezes the answer at the capturing model's competence" — and pre-decided that **periodic re-confirm** is the remedy, to be built on a concrete trigger rather than speculatively. The sausage-family case is that trigger: the classifier back-link fix (#173) connects a family when the *general* term arrives, but does nothing for a specific term that was already minted bare before its family existed. Re-confirm closes that gap.

## What Changes

- **A new scheduled re-confirm pass** (`src/ingredient-reconfirm.ts`, a job in the one `scheduled()` handler) re-examines **eligible under-connected nodes** against the now-denser registry and **enriches** them — primarily by adding the `satisfies` edges that couldn't exist when they were minted (`kielbasa → sausage`).
- **Eligibility is narrow and gated.** It targets **edgeless concrete auto-nodes** (`source='auto'`, no incoming or outgoing edges) — precisely the below-floor bare mints. **Human nodes are never touched** (`source='human'` is authoritative). Each eligible node is re-confirmed and then **stamped**, so it is not re-processed every tick; the pass drains the backlog and **self-quiesces** to a cheap no-op, preserving the ≈0-LLM steady state (it spends only while an under-connected backlog exists).
- **Conservative, mostly non-destructive actions.** Per node it re-embeds the term, retrieves nearest neighbors (excluding itself), and runs the **same classifier confirm** the capture job uses, then applies:
  - **ADD edges** (enrichment) — always safe, no re-key. This is the core value.
  - **SAME → merge** via the existing `representative` pointer to a clear synonym survivor (append-only ids, no cross-table rewrite; data converges through the resolver + the grocery/pantry re-key reconcile). Same conservative-collapse bias as capture — a doubtful merge is not made.
  - A node that is **still NOVEL** just gains any proposed edges and is marked re-confirmed. **It does NOT re-mint or change a node's canonical id** on this path — a mis-mint that should become `base::detail` is out of scope for v1 (see Design).
- **Bounded, auditable, budget-shared.** Bounded re-confirms per tick sharing the internal `env.AI`/D1 budget; each decision appended to `ingredient_normalization_log` **distinguished as a re-confirm**; a `job_health` row recorded like the other passes.
- **Open-world + human override hold.** Edges stay accelerant-not-ceiling hints; a human alias/override always wins and is never re-confirmed away.

## Capabilities

### Modified Capabilities

- `ingredient-normalization`: adds the periodic **re-confirm pass** to the capture capability — eligibility (edgeless concrete auto-nodes, human-immune), the one-shot stamp + self-quiescence, enrichment-first with conservative representative-merge (no id-change), the shared-budget/bounded/auditable guarantees, and the open-world invariant that re-confirm only *enriches or merges*, never fragments or mis-collapses.

## Impact

- **Affected code:** new `src/ingredient-reconfirm.ts` (the pass + `buildReconfirmDeps`, mirroring `ingredient-normalize.ts`), wired into `scheduled()` in `src/index.ts`; new readers in `src/corpus-db.ts` for eligible nodes + the re-confirm stamp; reuse of `confirmIdentity` (`src/ingredient-classify.ts`), `embedTexts` (`src/embedding.ts`), and `commitResolution` / `mergeIdentities` (`src/corpus-db.ts`). No new external dependency.
- **New D1 migration:** a `reconfirmed_at` column on `ingredient_identity` (the one-shot stamp / eligibility filter). No table shape change beyond that column.
- **Observability:** a `job_health` row (`ingredient-reconfirm`) on the Status page (reuses the existing jobs list), and re-confirm decisions surfaced in the Normalization **Decisions** log **distinguished from initial-capture decisions**. The visual treatment of that distinction (and the related Normalization-area surfaces) routes through the companion Claude Design project per the panel's design workflow — it is not hand-designed here.
- **Budget:** rides the internal `env.AI`/D1 bucket, bounded per tick, `job_health`-reported — the same discipline as the capture/classify passes; a no-op once the eligible backlog is drained.
- **Docs:** `docs/ARCHITECTURE.md` (the ingredient-normalization capture section gains the re-confirm pass) and `docs/SCHEMAS.md` (the `ingredient_identity.reconfirmed_at` column + the re-confirm log outcome).
- **Deferred / explicit non-goals:** **id-changing re-home** (a bare mint that should become `base::detail`, changing its canonical id beyond a representative-merge); a manual "re-confirm this node now" operator trigger; a re-confirm **accuracy benchmark/eval** (the broader "periodic re-confirm as a benchmarking feature" ADR-0001 mentioned); re-confirming to *downgrade* or delete edges (re-confirm only adds/merges).
