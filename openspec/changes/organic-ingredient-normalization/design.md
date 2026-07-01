## Context

`normalizeIngredient(str, aliases) → str` is one exact-match dictionary lookup over the D1 `aliases` table, preceded by a leading-quantity strip. It is the identity key under four **non-loadable** stores — `sku_cache`, `brand_prefs`, the recipe index's `ingredients_key`/`perishable_ingredients`, and grocery-list dedup — so surface-form fragmentation there is invisible to the read-time LLM reasoning ADR-0001 leaned on. The table only grows when a human calls `update_aliases`, so in practice it stays sparse (ADR-0001's "curated tables go uncurated").

Two concrete, live failures motivate this:

- **Fragmentation.** `"scallions"` and `"green onions"` are distinct keys → duplicate SKU resolutions, brand prefs that don't carry across forms, missed perishable overlap.
- **Qualifier destruction.** The quantity stripper eats fractions: `stripLeadingQuantity("80/20 ground beef") === "ground beef"` (fat ratio gone), yet `"1 lb 80/20 ground beef" → "80/20 ground beef"` (survives) — the same ingredient normalizes two different ways.

ADR-0001 deferred an *ingredient knowledge graph* but named this exact revival trigger and pre-decided several design points (open-world accelerant-not-ceiling; qualifiers matter for baking; "caching world knowledge freezes the answer at the capturing model's competence"). It also kept the `aliases` layer deterministic as "the matcher's normalization key." This change grows **that kept layer** organically; it does **not** build the deferred substitution graph (substitution stays read-time LLM, per Phase 0).

The house pattern is *capture → retrieve → narrow* on a cron: flyer-warm, recipe-classify, recipe-derived reconcile, and the discovery sweep all capture LLM-derived knowledge on a bounded, hash-gated schedule, off the hot path. This change is that pattern applied to ingredient identity, reusing `src/embedding.ts` (`embedText`/`embedTexts`/`cosineSimilarity`, `@cf/baai/bge-base-en-v1.5`) and the `src/discovery-classify.ts` confirm machinery (small model, contract validation, corrective retry, negation-aware).

## Goals / Non-Goals

**Goals:**
- Grow ingredient normalization **organically** — no required user or operator action — amortizing one cheap LLM call per novel surface form, permanently.
- Preserve meaningful distinctions (`80/20` vs `90/10`, `baking-soda` vs `baking-powder`, `cheddar` vs `mozzarella`, `thighs` vs `whole`) while collapsing true synonyms (`scallion` = `green-onion`), via **canonical nodes joined by directed satisfaction edges**.
- Make the four non-loadable join stores line up across surface forms, keyed on the full canonical id (synonym-merged) — never a base-equality join that would fuse distinct varieties.
- Keep the hot path deterministic and zero-latency-added; keep the deterministic core trivial (full-id equality + synonym-merge on the hot path; graph reachability only where a consumer needs it).
- Stay safe: conservative-by-construction collapse, stable append-only keys, full audit, human override precedence.

**Non-Goals:**
- The **taste-substitution** edge-graph (strong/weak flavor swaps with ratios — "gochujang for sriracha") — stays read-time LLM (ADR-0001 Phase 0). The graph here holds **factual identity/containment/membership** edges only.
- A **deterministic reachability engine** in the Worker hot path — edges are *exposed* (a read path — decision #7a) and consumed by read-time reasoning; graph traversal/`satisfies()` logic inside a tool is evidence-gated, not v1.
- Synchronous hot-path embedding/LLM read-through — cron-only first; revisit only if lag bites.
- Interpreting a detail token's *semantics* in code (fat %, protein content) — details are opaque labels; fit judgment is the read-time LLM's over the visible edges/labels.
- **Periodic model re-evaluation / re-confirm** (open question #8) — deferred entirely to a future, separate benchmarking feature ("re-run all benchmarks" with fixtures); this change's classifier test fixtures are that feature's seed. Captured decisions are stable/append-only and corrected on demand only.
- Brand-token extraction from ingredient strings, and base-level brand-pref cascading to qualified ids — deferred.

## Decisions

### D1 — A directed satisfaction graph over canonical nodes; the full id is the join key

Identity is a graph. **Nodes** are canonical ids named `base` or `base::detail[::detail…]` — the string is a *readable label*, not the join logic. The **deterministic join key is the full canonical id** (after synonym-merge via `representative`) for `sku_cache`, `brand_prefs`, dedup, and cross-recipe overlap. **Directed `satisfies` edges** (`A → B` = "A can be used where B is requested") capture the asymmetric and cross-node relations; `satisfies(have, want)` is reachability. Base is the id up to the first `::` — a readable grouping, the matcher's search-term fallback, and the "-any" anchor, **not** a blanket join.

- *Why the full id, not base-equality, as the join?* Base-equality is unsound for varieties: `cheese::cheddar` and `cheese::mozzarella` share base `cheese` but are not interchangeable — a base join would silently fuse them (and thus mis-dedup, mis-count perishable overlap, and tell the pantry "you have it"). Full-id join never makes a false merge; synonyms (`scallion`=`green-onion`) still collapse, via the representative pointer.
- *Why edges, not a string rule, for the rest?* Satisfaction is **directional** (`chicken::whole → chicken::thighs`, but not the reverse — a whole bird yields thighs, a thigh isn't a whole bird) and **multi-parent** (`cheese::parm → cheese::aged` *and* `→ cheese::grating`). A linear string can't encode a DAG; edges can. Code does reachability (dumb); the LLM captures edges (smart). This is ADR-0001's pre-decided "granular nodes joined by edges, not collapsed," scoped to **factual identity/containment/membership** — taste-substitution stays read-time.
- *Concept nodes.* A generic ingredient ("a fresh soft cheese", "a mild white fish") is a **concept node** with incoming member edges (`cheese::mozzarella::fresh → ⟨fresh-soft-cheese⟩`); resolving to it enumerates members. Concept nodes carry a `concrete=false` flag so the SKU matcher resolves them to a member before buying, never tries to purchase the concept.
- *No `:::` delimiter.* Once edges carry the relationship kind (variety / attribute / containment / membership), a second delimiter is redundant and can't express the DAG anyway. `::` stays a cosmetic label; relationship-kind lives on the edge/node in the registry.
- *Edges are open-world hints, not gates.* A missing or wrong edge degrades to read-time LLM reasoning from world knowledge — never a hard failure or a wrong purchase — so edge-capture errors are low-stakes, which is what makes capturing the richer graph safe. **v1 deterministic consumers are exact-id join + synonym-merge only**; directional/concept edges are captured now and surfaced to read-time reasoning, with any deterministic edge-consumer evidence-gated (ADR-0001).
- *Backward compatibility.* Today's aliases are all base-level nodes with no `::` and no edges — valid unchanged. `normalizeIngredient(str) → str` still returns the canonical id string, keeping its five call sites intact.

### D2 — Embedding proposes, cheap classifier disposes; cron-amortized

Embedding retrieves candidate nodes (cosine); it never decides identity — a pure threshold fuses `baking-soda`≈`baking-powder` (and `cheddar`≈`mozzarella`). The classifier makes the call embedding can't, returning one of **SAME (synonym) / SPECIALIZATION (new node + a `general` edge to its parent) / NOVEL**, and additionally proposes any `containment`/`membership` edges to the retrieved neighbors (e.g. minting `chicken::thighs` also proposes `chicken::whole → chicken::thighs`). Below a cosine floor there is no plausible candidate → mint NOVEL with **no LLM call** (the discovery triage trick). This runs as a fifth job in `scheduled()`, bounded per tick, on the internal `env.AI`/D1 bucket (embeddings batched via `embedTexts`), never the 50 external-subrequest cap.

- *Why cron, not synchronous?* The whole architecture keeps the LLM off the hot path. Synchronous read-through would add an embed + a small-LLM call to the first encounter of every novel ingredient on the user's turn. Cron-amortized costs a bounded lag (first shop for "scallions" may not yet dedup) that is consistent with the system's eventual-consistency posture and low-stakes per ADR-0001. Read-through remains a later option if lag proves painful.
- *Why reuse the discovery classifier?* It already does small-model + contract validation + corrective retry + negation-aware confirm — exactly the shape here.

### D3 — Conservative collapse, prep-vs-product stripping

Asymmetric costs drive the bias: a missed alias is cheap and self-heals next tick; a wrong collapse is silent and buys the wrong thing. So: embedding never collapses alone; the confirm defaults to **SPECIALIZE or NOVEL on doubt**; it never collapses across a distinct-base line even at high similarity (broths, creams, leaveners, dietary boundaries). A qualifier specializes only if it changes *which SKU you'd buy* — **preparation** qualifiers ("diced", "minced", "softened") strip to base. This is the one genuinely hard classification, and it is pure world-knowledge, hence the LLM's job. A **generality-direction rule** (spike-derived) is part of the contract: *never return SAME when the new term is more general than a candidate* — a general product is not a synonym of one of its specific varieties (general `mozzarella cheese` must not alias into the specific `fresh-mozzarella`); mint the general base instead. It also means `stripLeadingQuantity` is tightened to strip a leading number only when a unit follows, leaving `80/20` for the resolver.

### D4 — Stable append-only ids; union-find merges

Ids are join keys, so a rename orphans dependent rows. Ids are therefore append-only; a late-discovered synonym (both bases minted before the alias surfaced) merges via a **`representative` pointer** (`id → surviving id`), resolved transitively at read time — **zero cross-table key rewrites**. The alias+identity map is small and group-shared, already loaded wholesale, so term → id → representative resolves in-memory on the hot path. Path-compression on the pointer keeps chains short.

- *Why not rewrite keys on merge?* Rewriting `sku_cache`/`brand_prefs`/`grocery_list`/index rows transactionally across a merge is fragile and racy; a pointer is O(1), safe, and reversible.

### D5 — Store shape mirrors `recipes` + `recipe_derived`

- `ingredient_alias(variant PK, id, source[auto|human], confidence, decided_at)` — the hot-path exact-match front door; generalizes today's `aliases`.
- `ingredient_identity(id PK, base, qualifier, search_term, representative, concrete, embedding, …)` — the node registry; `concrete=false` marks a concept node (not buyable); embedding is **cron-owned**, cosine'd only by the capture job, never loaded on the hot path (exactly how `recipe_derived.embedding` is reconcile-owned).
- `ingredient_edge(from_id, to_id, kind[containment|general|membership], source, decided_at)` — the directed `satisfies` edges; consumed by read-time surfacing in v1.
- `novel_ingredient_terms(term PK, first_seen, attempts, …)` — the queue; insert-or-ignore on miss.
- `ingredient_normalization_log(…)` — audit + evaluated-set + operator surface (mirrors `discovery_log`).

All go through `src/corpus-db.ts` over `src/db.ts` (structured errors, tools never throw). `readAliases` becomes a resolver-map load (alias + representative), keeping its whole-map contract.

### D6 — Organic, but human-overridable and audited

`source` column: `human` beats `auto` and is never overwritten by a later auto pass. Every decision is logged (term, outcome, candidate ids, cosine, model). The admin surface reuses the discovery pattern (a per-decision stream with override/correct), but the layer never *depends* on the operator — that is the whole answer to ADR-0001's "tables go uncurated." `update_aliases` stays as the authoritative manual write.

### D7 — Failure handling by kind, backward-compatible bootstrap

Transient errors (env.AI/D1, quota) leave the term **queued** (retry next tick), write nothing. A confirm that can't satisfy the contract within the retry budget **fails safe to NOVEL** (fragment, never mis-collapse) and logs the park. Migration: existing `aliases` canonicals become base-level ids; a one-time bootstrap resolves the corpus `ingredients_key` vocabulary under the same per-tick bounds, so the registry has real neighbors to cosine against from the start.

### D8 — Table shape: a clean three-table set (decided)

Use `ingredient_alias` (variant → id) + `ingredient_identity` (node registry, with `representative`/`concrete`/`embedding`) + `ingredient_edge` (directed satisfies-edges), rather than extending the flat `aliases(variant, canonical)` in place. The `representative` pointer, the cron-owned embedding, and the edges do not fit the flat shape without nullable-column sprawl or a second table regardless; a clean split mirrors the proven `recipes` / `recipe_derived` precedent (one producer, one cadence per table); and a compatibility read over the migrated rows keeps existing resolutions working. `aliases` is superseded by `ingredient_alias` in the migration (its rows backfilled as `source: human` base-level nodes).

### D9 — The `IngredientContext` consumption funnel

Consumers touch the ingredient graph through **one accessor** — `ingredientContext(env)` in `src/corpus-db.ts` — rather than each re-wiring the pipeline (load `readResolver` → `normalizeIngredient` → remember to `enqueueNovelTerms` on a miss → thread `searchTerms` → read edges). The context, loaded once per request/tick, exposes `resolve`/`resolveList`/`resolveNames` (normalize **and** best-effort novel-term capture, deduped within the context), `base`/`searchTerm`, and `satisfiesAmong(ids)` (the §3.4 / #7a edge read path). This closes the scattered-consumer risk: a new consumer that funnels through `resolve()` cannot forget to feed the graph or fragment it, because capture is intrinsic to resolution.

- *Two list forms, one funnel.* `resolveList(value)` is the **write/build** normalizer — it passes a non-array or a non-string-bearing array **through unchanged** so the contract validator can reject the bad shape (matches `normalizeIngredientList`). `resolveNames(value)` is the **read-time set-builder** — it always returns a deduped `string[]`, silently dropping non-strings — for the ranking/planning set-math (`search_recipes`'s pantry overlap, `propose_meal_plan`'s perishable-vocab / key-ingredient / pantry-demand sets). Both capture novel terms through the same funnel, so a novel boost/index/pantry term is fed to the graph either way.

- *Pure core stays; the façade adds the impure edges.* The pure `normalizeIngredient(str, map)` / `normalizeIngredientList` / `baseOf` remain in `src/matching.ts` (used in pure contexts and tests); the façade **composes** them and layers on the env side-effects — the best-effort capture and the edge I/O. It is built from the existing `readResolver` (no duplicate representative logic).
- *The matcher stays pure over injected deps.* `matchIngredient(deps, …)` does **not** take the context; it keeps taking plain `aliases`/`searchTerms` data. The façade is the **caller-side** funnel: the tool layer builds the context, uses `ctx.resolve()` for the capture-check, and feeds `resolver.toId`/`searchTerms` into `MatchDeps` as before.
- *`satisfiesAmong` is lazy.* Edges are **not** loaded when the context is built (the hot path never needs them); the `ingredient_edge` table is read on the first `satisfiesAmong` call (memoized). It returns only edges whose both endpoints, resolved through the representative pointer, are in the requested set. This is a `src/`-level read for the reasoning agent and the future web-app; no MCP tool or HTTP route is added until a consumer is wired (that lands with the consumer, per the read-path scoping).

## Risks / Trade-offs

- **Wrong collapse buys the wrong thing (silent).** → Embedding never collapses alone; confirm biased to specialize/novel; hard distinct-base lines enumerated in the prompt; full audit + human override + reversibility via the representative pointer; and the whole thing is an *accelerant not a ceiling* — the matcher can `bypass_cache` and the read-time LLM always overrides.
- **"Freezes at the capturing model's competence"** (ADR-0001). → Identity ("scallion = green onion") is far more stable than substitution judgment; the store is re-derivable and overridable; only identity is frozen, while fit/substitution stays read-time and rides model improvements.
- **Cron lag on first encounter** (transient duplicate row before capture catches up). → Consistent with system-wide eventual consistency; low-stakes; read-through is the escape hatch if it bites.
- **Granularity ambiguity** (is `cheddar` a `cheese::cheddar` qualifier or its own base?). → Rule of thumb in the confirm: *distinct products a shopper chooses between are separate bases; specs of one product are qualifiers.* A wrong split is a missed base overlap (recoverable), not a wrong purchase. Flagged as an open question to pressure-test on real vocabulary.
- **Merge chains / churn.** → Path-compression keeps chains short; ids never rename; representative pointers are the only mutation.
- **Key migration risk** on generalizing `aliases`. → Existing canonicals are valid base ids unchanged; the migration is additive (new columns/tables), no destructive rewrite.

## Migration Plan

1. Migration: add `id`/`source` to `aliases` (or introduce `ingredient_alias` and view/rename), add `ingredient_identity`, `novel_ingredient_terms`, `ingredient_normalization_log`. Backfill existing canonicals as base-level identity rows + alias rows (`source: human`, since they were curated).
2. Ship the resolver (`normalizeIngredient` → structured id + base extractor), tighten `stripLeadingQuantity`, and wire miss-enqueue at every call site (matcher, recipe-classify, discovery, write-tools, grocery-list). Hot path behavior is unchanged for hits and for misses (cleaned term) — so this is safe to land before the cron does anything.
3. Add the capture job to `scheduled()` (embedding-propose → classifier-dispose, bounded, `job_health` record). Bootstrap pass over corpus `ingredients_key`.
4. Admin audit/override surface (reuse discovery pattern).
5. Docs: ARCHITECTURE (pipeline step 1 + a capture section), SCHEMAS (tables + id format), TOOLS (`update_aliases` id semantics), and the ADR-0001 amendment.
- **Rollback:** the resolver falls back to today's behavior on any miss, and the cron can be disabled independently; existing base-level ids keep working, so disabling capture degrades to today's static aliases without breaking reads.

## Spike findings (2026-07-01)

A throwaway spike hit the live Workers AI models — the embedder (`bge-base-en-v1.5`, plus `bge-m3`/`bge-large` for comparison) and the cheap classifier (`mistral-small-3.1-24b-instruct`) — against a 46-term labeled vocabulary covering every hard class. Two results are load-bearing:

- **The classifier is mandatory; embeddings are retrieval-only.** Cosine cannot gate merges — the danger pairs `baking-soda`~`baking-powder` (0.83) and `chicken-broth`~`vegetable-broth` (0.88) score *higher* than most true synonyms (0.575–0.80). Confirmed: no cosine threshold separates merge from must-not-merge, so the classifier gate is not optional. The classifier passed this: 7/8 hard cases zero-shot (refusing both danger merges despite the high cosine, finding `scallions`→`green-onion` through 6 noise candidates, getting the `whole → thighs` edge direction right, detecting the `concrete=false` cheese concept and excluding cheddar), and **8/8 after one added rule** (below).
- **Embedding retrieval has a cross-lexical blind spot that a bigger model does not fix.** Zero-token-overlap synonyms don't retrieve: `zucchini`→`courgette` ranks **#39 / #26 / #44** on base / m3 / large (m3 is *worse* — flatter cosines); `scallions`→`green-onion` stays #5–7. So the below-floor shortcut must use a **low floor (~0.50)** (the unrelated band ~0.60 overlaps the synonym floor 0.575), and it only safely skips the classifier for genuinely isolated new bases.

Two design changes fall out, folded into Decisions above:

1. **Confirm-prompt generality rule (D3).** The one spike failure was a general→specific inversion — the model aliased general `mozzarella cheese` into the more-specific `fresh-mozzarella`. Adding *"never return SAME when the new term is more general than a candidate — mint the general base instead"* fixed it with zero regression. This rule is now part of the confirm contract.
2. **SKU-cache co-resolution as a second merge signal (extends D2/D4).** Because embeddings can't bridge `zucchini`/`courgette`, the capture job also proposes a synonym merge when two ids repeatedly resolve to the **same Kroger SKU** in `sku_cache` — a deterministic, non-embedding signal that catches exactly the cross-lexical cases the embedder misses. Read-time frontier-model alias capture (enrich-on-encounter) and human `update_aliases` remain the further backstops.

## Resolved questions

*Resolved by the spike:* the granularity/detail rule and edge directionality (the classifier handles both on `mistral-small`, with the generality rule added); concept **detection** (correctly flags `concrete=false` + member edges); the cosine-floor/retrieval-k shape (low floor; large-k + classifier-filter; SKU co-resolution for the cross-lexical tail). *Decided since:*

- **#2 Table shape** → D8 (clean three-table set).
- **#4 Search-term fidelity** → rely on **Kroger's own search** (it is not naive string matching — it handles synonyms/qualifiers), feeding it the node's stored `search_term`. No per-detail denormalization rules. This has no adverse `sku_cache` impact: the cache is keyed by our canonical id and *populated* by the same match pipeline, so search quality only affects first resolution, never the cache shape — and when Kroger's fuzzy search lands two of our ids on the *same SKU*, that is exactly the co-resolution merge signal.
- **#5 Concept buy-time resolution** → **pantry-first, then options.** If a pantry item satisfies the ingredient/concept (via the graph), use it (don't buy); otherwise surface the concept's members as user-facing options rather than silently auto-picking. Generalizes beyond concepts (pantry-first is the resolution order for any ingredient). Concept *buying* remains a fast-follow; pantry-first is the v1 principle.
- **#7 Edge consumption** → **7a: surface edges explicitly.** Edges are exposed via a read path so read-time consumers use them directly, rather than relying on the model's implicit world knowledge. Motivation: beyond the frontier chat model, a planned **web-app interface** (interactive-but-AI-backed workflows) needs the explicit graph to drive UI affordances ("you need thighs; you have a whole chicken — use it?") — a UI can't lean on an LLM's latent knowledge. (Deterministic *traversal* logic in a tool stays evidence-gated; this is exposure, not a reachability engine — see Non-Goals.)
- **#8 Re-confirm cadence** → out of scope (see Non-Goals; future benchmarking feature).
