## ADDED Requirements

### Requirement: Canonical nodes and the full-id join

The system SHALL model ingredient identity as a graph of canonical **nodes** named `base` or `base::detail[::detail…]` (e.g. `ground-beef`, `ground-beef::fat-80-20`, `cheese::cheddar`, `chicken::thighs`), where the string is a readable label. The **deterministic join key** for `sku_cache`, `brand_prefs`, grocery-list dedup, and cross-recipe overlap SHALL be the **full canonical id**, after synonym-merge through the `representative` pointer. Deterministic code SHALL NOT use base equality (the id prefix up to the first `::`) as a blanket join, because same-base nodes may be non-interchangeable varieties. The **base** SHALL serve only as a readable grouping, the matcher's search-term fallback, and the "-any" anchor (an unqualified request resolves to the bare base node). A detail token's value SHALL NOT be parsed or interpreted by deterministic code — details are opaque labels; fit judgment is deferred to read-time reasoning over the visible labels and edges.

#### Scenario: Full id is the join; synonyms merge, varieties do not

- **WHEN** `"scallions"` and `"green onions"` both resolve (via `representative`) to `green-onion`, while `"cheddar"` resolves to `cheese::cheddar` and `"mozzarella"` to `cheese::mozzarella`
- **THEN** the two onion forms share one join key (one SKU-cache/brand-pref/overlap entry), while the two cheeses remain distinct join keys and are NOT treated as the same ingredient despite sharing base `cheese`

#### Scenario: Unqualified request resolves to the bare base

- **WHEN** a recipe ingredient is just `"ground beef"` (no product detail)
- **THEN** it resolves to the bare base node `ground-beef` (the "-any" anchor), which the matcher searches as "ground beef" and buys cheapest-acceptable

#### Scenario: Detail values are opaque to deterministic code

- **WHEN** deterministic code compares `ground-beef::fat-80-20` and `ground-beef::fat-90-10`
- **THEN** it reports them as distinct ids without interpreting `80-20` vs `90-10`; whether one satisfies a request for the other is a read-time judgment over the visible labels and any captured edge

### Requirement: Directed satisfaction edges and concept nodes

The identity registry SHALL support directed **satisfies** edges between nodes — an edge `A → B` meaning "having A satisfies a request for B" — capturing asymmetric containment (`chicken::whole → chicken::thighs`), specialization-to-general (`chicken::thighs → chicken`), and concept membership (`cheese::mozzarella::fresh → ⟨fresh-soft-cheese⟩`). `satisfies(have, want)` SHALL be defined as reachability along these edges. **Concept nodes** (queryable attribute-classes such as "a fresh soft cheese", not buyable products) SHALL be marked distinct from concrete nodes so the SKU matcher resolves a concept to a member before purchasing and never tries to buy the concept itself. Edges SHALL be **open-world hints**: a missing or wrong edge SHALL degrade to the LLM reasoning from world knowledge, and SHALL NOT act as a hard gate or cause a wrong purchase. The capture job SHALL propose edges conservatively when placing a node (a doubtful edge is omitted, not asserted). Edges SHALL be **exposed via a read path** — `satisfiesAmong(ids)` on the `IngredientContext` accessor (a `src/`-level query, not yet an MCP tool or HTTP route) — so read-time consumers, the reasoning agent and a future web-app interface, can query the satisfies-edges among a loaded pantry + candidate set directly, rather than relying only on the model's implicit world knowledge. The read path SHALL return only edges whose BOTH endpoints, resolved through the `representative` pointer, are in the requested id set, and SHALL NOT load the edge table on the hot path (it is loaded lazily on first query). A deterministic reachability/traversal engine inside a tool is out of scope for this capability (evidence-gated); the read path exposes the edges, it does not compute `satisfies()` closure.

#### Scenario: Directional containment is asymmetric

- **WHEN** `satisfies` is evaluated for a pantry `chicken::whole` against a recipe needing `chicken::thighs`, and separately for a pantry `chicken::thighs` against a recipe needing `chicken::whole`
- **THEN** the first is satisfied (reachable `whole → thighs`) and the second is not (no reverse edge)

#### Scenario: A concept resolves pantry-first, then to options

- **WHEN** an ingredient resolves to the concept node `⟨fresh-soft-cheese⟩` and the pantry holds a member that satisfies it (e.g. ricotta)
- **THEN** the pantry item is used and nothing is bought; and **WHEN** no pantry member satisfies it, the concept's members (enumerated via incoming membership edges) are surfaced as user-facing options rather than a silent auto-pick — the matcher never attempts to purchase the concept itself

#### Scenario: Edges are queryable by read-time consumers

- **WHEN** the reasoning agent or the web-app interface calls `satisfiesAmong(ids)` on the `IngredientContext` for a loaded pantry + candidate ingredient set
- **THEN** the read path returns the satisfies-edges whose both endpoints (representative-resolved) are in that set — as data, so the consumer drives its own reasoning or UI — loading the edge table lazily on first call and never computing reachability closure

#### Scenario: A missing edge degrades gracefully

- **WHEN** no edge yet connects two nodes that are in fact related
- **THEN** deterministic joins are unaffected (they key on the full id) and read-time reasoning still resolves the relationship from world knowledge — the absent edge is a missed optimization, never a failure

### Requirement: Deterministic hot-path resolution with miss enqueue

The system SHALL resolve an ingredient term on the hot path deterministically: strip a leading quantity, then look the cleaned surface form up in the shared alias front-door (variant → id) and follow the identity registry's representative pointer to the canonical id. A **miss** (no alias entry) SHALL return the cleaned term unchanged (identical to the pre-change behavior — no regression, no added latency) AND SHALL record the cleaned surface form to the novel-term queue for later capture. The hot path SHALL NOT call an embedding model or an LLM. The alias + identity map SHALL be small enough to load wholesale per request (as `readAliases` does today); embeddings SHALL live in the identity registry for cron use only and SHALL NOT be loaded on the hot path.

#### Scenario: Hit resolves without any model call

- **WHEN** a term already has an alias entry
- **THEN** the hot path returns the canonical id (resolved through the representative pointer) with no embedding and no LLM call

#### Scenario: Miss returns cleaned term and enqueues

- **WHEN** a term has no alias entry
- **THEN** the hot path returns the quantity-stripped, lowercased term unchanged and enqueues that surface form to the novel-term queue (insert-or-ignore)

#### Scenario: Enqueue is a side effect, never a failure

- **WHEN** the novel-term enqueue write fails
- **THEN** normalization still returns the cleaned term (the enqueue is best-effort; a queue write error never breaks a read or a match)

### Requirement: Scheduled capture — embedding proposes, classifier disposes

The system SHALL run a scheduled capture job in the one `scheduled()` handler that drains the novel-term queue in a **bounded batch per tick**. For each term it SHALL embed the term (batched via `embedTexts`, an internal `env.AI` call off the external-subrequest budget) and cosine it against the identity registry's embeddings to retrieve nearest-candidate ids. When the top candidate's similarity is **below a floor**, the term SHALL be minted as a **novel base** with **no LLM call**. Otherwise a cheap classifier SHALL be asked to dispose the identity into exactly one of three outcomes: **SAME** as a candidate (a synonym), **SPECIALIZATION** of a candidate's base with an extracted detail, or **NOVEL** node. The chosen resolution SHALL be written once — an `ingredient_alias(variant → id)` row plus, for a new id, an `ingredient_identity` row (base, detail, reconstructed `search_term`, `concrete` flag) whose embedding is then stored — so every subsequent encounter of that surface form is a deterministic hot-path hit. For a SPECIALIZATION the job SHALL also record a `general` satisfies-edge from the new node to its parent, and MAY propose `containment`/`membership` edges to retrieved neighbors under the conservative bias (a doubtful edge is omitted).

#### Scenario: Below-floor term mints a novel base without an LLM call

- **WHEN** a queued term's nearest identity is below the similarity floor
- **THEN** it is registered as a new base id and embedded, and no classifier call is spent

#### Scenario: Confirmed alias collapses a synonym

- **WHEN** `"scallions"` is queued and cosines near `green-onion`, and the classifier returns SAME
- **THEN** an alias `scallions → green-onion` is written and future `"scallions"` reads resolve to `green-onion` with no model call

#### Scenario: Specialization preserves a product qualifier

- **WHEN** `"80/20 ground beef"` is queued and cosines near `ground-beef`, and the classifier returns SPECIALIZATION with qualifier `fat-80-20`
- **THEN** an identity `ground-beef::fat-80-20` (with `search_term` "80/20 ground beef") and an alias to it are written

#### Scenario: Amortized to a single call

- **WHEN** a surface form has been resolved once by the capture job
- **THEN** later encounters resolve deterministically on the hot path, spending zero embedding and zero LLM calls (steady state of the queue trends to ≈0 work)

### Requirement: Conservative collapse and prep-versus-product stripping

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm SHALL create an alias-to-existing id. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it changes *which product a shopper would buy* (fat ratio, flour type, egg size, cut); a **preparation** qualifier that does not change the SKU ("diced", "minced", "shredded", "softened") SHALL strip to the base. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`).

#### Scenario: High similarity does not force a collapse

- **WHEN** `"baking powder"` is queued and cosines very near `baking-soda`
- **THEN** the confirm returns NOVEL (distinct base) and no alias between them is written

#### Scenario: Preparation qualifier strips to base

- **WHEN** `"diced yellow onion"` is queued
- **THEN** it resolves to base `yellow-onion` (the dice is a preparation, not a product qualifier) rather than minting `yellow-onion::diced`

#### Scenario: Doubt defaults to preserving the distinction

- **WHEN** the classifier is uncertain whether a qualified term is an alias of or a specialization of a candidate
- **THEN** it specializes (preserving the qualifier) rather than collapsing, so no distinction is destroyed

### Requirement: Stable ids with union-find merges

The system SHALL treat canonical ids as **append-only, stable join keys** — an id, once minted, SHALL NOT be renamed, because `sku_cache`, `brand_prefs`, `ingredients_key`/`perishable_ingredients`, and `grocery_list` key on it. When the capture job later discovers that two already-minted ids are the same identity (a synonym that surfaced after both bases were independently minted), it SHALL merge them by setting a **`representative` pointer** from one id to the other rather than rewriting any dependent row. Resolution SHALL follow the representative chain transitively to the surviving id. Dependent tables SHALL NOT be key-rewritten on a merge. A merge MAY be proposed by a signal **other than embedding similarity** — in particular, two distinct ids that repeatedly resolve to the **same Kroger SKU** in `sku_cache` are candidate synonyms — so cross-lexical synonyms that embeddings do not retrieve (e.g. `zucchini`/`courgette`) can still be collapsed, subject to the same conservative confirm.

#### Scenario: Late-discovered synonym merges without key rewrites

- **WHEN** `scallion` and `green-onion` were minted as separate bases and the job later confirms they are the same
- **THEN** one id's `representative` is set to the other and all reads resolve transitively to the survivor, with no update to `sku_cache`/`brand_prefs`/`grocery_list` rows

#### Scenario: Minted ids are never renamed

- **WHEN** a better-structured id would be preferable for an existing base
- **THEN** the existing id is retained and new aliases point at it, rather than renaming the id and orphaning dependent rows

#### Scenario: Same-SKU co-resolution proposes a cross-lexical merge

- **WHEN** two distinct ids (e.g. `zucchini` and `courgette`, which embeddings do not retrieve as neighbors) repeatedly resolve to the same Kroger SKU in `sku_cache`
- **THEN** a merge is proposed from that signal and, on a conservative confirm, one id's `representative` is set to the other — collapsing a synonym the embedder missed

### Requirement: Contract-validated confirm with failure handling by kind

The classifier confirm SHALL be validated against a fixed output contract (one of the three outcomes, with a base reference and an extracted qualifier when SPECIALIZATION) with a bounded **corrective retry** that echoes the validation complaint back to the model. A **transient** failure (an `env.AI`/D1/storage error, a rate-limit or quota hit) SHALL leave the term **on the queue** (un-dequeued) so it retries on a later tick, and SHALL NOT write a resolution. A confirm that cannot satisfy the contract within the retry budget SHALL **fail safe** by minting the term as a NOVEL base (never a speculative collapse) and logging the park. The job SHALL record a `job_health` outcome for the tick.

#### Scenario: Transient error retries, writes nothing

- **WHEN** the embedding or classifier call fails with a transient error for a queued term
- **THEN** the term stays queued for a later tick and no alias or identity row is written for it

#### Scenario: Uncontractable confirm fails safe to novel

- **WHEN** the classifier cannot return a contract-valid outcome within the retry budget
- **THEN** the term is minted as a NOVEL base (fragmenting, never mis-collapsing) and the park is logged

### Requirement: Auto-derived, human-overridable, fully audited

The normalization layer SHALL grow with **no required user or operator action**. Every capture decision SHALL be appended to a normalization log (the term, the outcome, the candidate ids, their cosine scores, the model) serving as the audit trail and the evaluated-set. Each alias/identity row SHALL carry a `source` of `auto` or `human`; a `human` write (e.g. via `update_aliases`) SHALL take precedence over and SHALL NOT be overwritten by an `auto` decision. An operator SHALL be able to correct or reverse an auto decision, and the correction SHALL be group-wide (the store is shared corpus).

#### Scenario: Layer grows with no human in the loop

- **WHEN** members shop and cook without anyone editing aliases
- **THEN** the alias + identity store still grows as the capture job resolves novel terms, and every resolution is recorded in the normalization log

#### Scenario: Human override beats auto

- **WHEN** an operator sets a `human`-sourced alias for a term the job had auto-resolved differently
- **THEN** the human mapping wins and a later `auto` pass does not overwrite it

### Requirement: Bounded per-tick budget and backward-compatible bootstrap

The capture job SHALL bound its work per tick (a count cap and a wall-clock budget) and SHALL batch embeddings via `embedTexts`, drawing only on the internal `env.AI`/D1 bucket — it SHALL NOT consume the external-subrequest budget shared with the flyer and discovery fetches. Existing `aliases` rows SHALL migrate as **base-level ids** (no `::`), so pre-change data is valid unchanged. A one-time bootstrap SHALL seed the identity registry by resolving the existing corpus `ingredients_key` vocabulary, worked down under the same per-tick bounds.

#### Scenario: Capture rides the internal bucket, bounded per tick

- **WHEN** a large backlog of novel terms exists (e.g. right after bootstrap)
- **THEN** the job works a bounded batch per tick on the internal `env.AI`/D1 budget, deferring the rest to later ticks, without touching the 50 external-subrequest cap

#### Scenario: Existing aliases remain valid as base ids

- **WHEN** the migration runs over the current `aliases` table
- **THEN** each existing `canonical` becomes a base-level id with no qualifier, and current reads keep resolving unchanged
