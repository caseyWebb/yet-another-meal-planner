# ingredient-normalization Specification

## Purpose
TBD - created by archiving change organic-ingredient-normalization. Update Purpose after archive.
## Requirements
### Requirement: Canonical nodes and the full-id join

The system SHALL model ingredient identity as a graph of canonical **nodes** named `base` or `base::detail` (e.g. `ground-beef`, `ground-beef::fat-80-20`, `cheese::cheddar`, `chicken::thighs`), where the string is a readable label. A canonical id SHALL contain at most one detail segment: no deterministic path (novel canonical validation, specialization construction, or any reconcile) constructs an id deeper than `base::detail`, and a deeper id observed in the registry is a defect the segment-overflow repair converges. The **deterministic join key** for `sku_cache`, `brand_prefs`, grocery-list dedup, and cross-recipe overlap SHALL be the **full canonical id**, after synonym-merge through the `representative` pointer. Deterministic code SHALL NOT use base equality (the id prefix up to the first `::`) as a blanket join, because same-base nodes may be non-interchangeable varieties. The **base** SHALL serve only as a readable grouping, the matcher's search-term fallback, and the "-any" anchor (an unqualified request resolves to the bare base node). A detail token's value SHALL NOT be parsed or interpreted by deterministic code — details are opaque labels; fit judgment is deferred to read-time reasoning over the visible labels and edges.

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

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm — or the deterministic lexical-identity fast path below — SHALL create an alias-to-existing id. As the one deterministic exception, a term whose lexical form exactly equals that of a surviving node id or a known alias variant SHALL resolve as SAME to that survivor with no model call — a mechanical identity, not a similarity collapse; when two distinct survivors share the lexical form, the fast path SHALL be skipped and the normal confirm flow applies. The lexical form SHALL be punctuation- and plural-insensitive: lowercased, punctuation collapsed to spaces, whitespace normalized, and each letters-only token of at least 4 characters folded by a conservative plural rule (`-ies` → `-y`, `-oes` → `-o`, else one trailing `-s` stripped unless the token ends `-ss`, `-us`, or `-is`) — the same pluralization-is-the-same-product rule the confirm prompt states, applied deterministically; an irregular plural the fold misses falls through to the classifier (fragmentation at worst, never a mis-collapse). Word-order folding SHALL NOT be attempted. The fast path SHALL apply at capture and at the alias re-audit alike. Within a capture tick, a node minted mid-batch SHALL join the batch's live lexical map immediately (its id, and its surface term when the form differs) — exactly as just-minted nodes join the retrieval set in-tick — so the second twin of a same-batch pair resolves through the fast path instead of minting; an appended key that collides with an existing entry for a different survivor SHALL make that key ambiguous (the fast path SHALL NOT fire on it for the rest of the tick), and a key already ambiguous at batch start SHALL stay ambiguous regardless of appends. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it names a **purchasable distinction** — the qualified form is a DIFFERENT product on the store shelf a shopper would buy (fat ratio, flour type, egg size, a varietal, or a canned/dried/pickled/ground/toasted form sold as its own SKU: pickle chips, canned tuna, dried thyme, cinnamon sticks). The judgment SHALL be per-product purchasability, not a word list: a **preparation or cut form** the shopper derives at home from the purchased base by ordinary kitchen work ("diced", "minced", "shredded", "softened", "wedges", "slices", "quarters", "zest") SHALL strip to the base — such a form is recorded for the recipe's sake, not the store's, and names the same purchase — and the SAME surface word MAY dispose either way by product ("diced tomatoes" names a canned shelf product and specializes; "diced yellow onion" is knife work and strips to the base). A home-derived **extraction that is also a distinct purchasable product in its own right** (lime juice — sold bottled, not reconstitutable into the fruit) SHALL remain a distinct base: it is NEVER SAME to its source product in either direction, and satisfaction between the two is expressible only through explicit satisfies edges or read-time reasoning, never by id equality. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`). A **distinct product** SHALL NOT be recorded as a SPECIALIZATION of a superficially-similar candidate — a specialization's detail narrows the SAME product, it never attaches a different product to a lookalike base (dried dates are not a variety of a dried-fruit blend; canned salmon is not a form of fresh skin-on fillets; a loaf of bread is not a type of bread flour; a finishing salt is not a kind of fish sauce) — the confirm prompt SHALL state this rule with counter-examples. The confirm prompt SHALL state the purchasable-distinction test and the home-derivable-form rule with examples (including the extraction carve-out). The confirm prompt SHALL also state that a term differing from a candidate only in punctuation, pluralization, or word order is the SAME product.

#### Scenario: High similarity does not force a collapse

- **WHEN** `"baking powder"` is queued and cosines very near `baking-soda`
- **THEN** the confirm returns NOVEL (distinct base) and no alias between them is written

#### Scenario: Preparation qualifier strips to base

- **WHEN** `"diced yellow onion"` is queued
- **THEN** it resolves to base `yellow-onion` (the dice is a preparation, not a product qualifier) rather than minting `yellow-onion::diced`

#### Scenario: A home-derivable cut form resolves to the base product

- **WHEN** `"lime wedges"` is queued (or re-audited) and `lime` is among the confirm's candidates
- **THEN** the confirm returns SAME on `lime` — wedges are knife work on the purchased lime, not a shelf product — so no `lime::form-wedges` node is minted (or the standing mapping is re-pointed to `lime`)

#### Scenario: The same word disposes by purchasability, not by list

- **WHEN** `"diced tomatoes"` and `"diced yellow onion"` are each confirmed against their bases
- **THEN** `"diced tomatoes"` keeps a specialization (canned diced tomatoes are a distinct shelf SKU) while `"diced yellow onion"` strips to `yellow-onion` — the word "diced" decides nothing by itself

#### Scenario: A purchasable extraction stays a distinct base

- **WHEN** `"lime juice"` is queued (or re-audited) and cosines near `lime`
- **THEN** the confirm returns NOVEL (a distinct purchasable product — bottled or fresh-squeezed), never SAME on `lime` in either direction, so a pantry `lime juice` can never equal-match a request for `lime` or any of its forms

#### Scenario: Doubt defaults to preserving the distinction

- **WHEN** the classifier is uncertain whether a qualified term is an alias of or a specialization of a candidate
- **THEN** it specializes (preserving the qualifier) rather than collapsing, so no distinction is destroyed

#### Scenario: A distinct product is not a lookalike's specialization

- **WHEN** `"dried medjool dates"` is queued and its nearest candidate is `dried fruit blend`
- **THEN** the confirm returns NOVEL (a distinct product), not a SPECIALIZATION like `dried fruit blend::type-medjool-dates`

#### Scenario: A punctuation-only variant resolves deterministically

- **WHEN** `"salmon fillets skin-on"` is queued (or re-audited) while the node `salmon fillets, skin-on` survives, and no other survivor shares its lexical form
- **THEN** it resolves SAME to `salmon fillets, skin-on` with no embedding comparison and no classifier call, and the fast-path resolution is logged

#### Scenario: A plural variant resolves deterministically

- **WHEN** `"onions"` is queued while the node `onion` survives, and no other survivor shares its lexical form
- **THEN** it resolves SAME to `onion` through the fast path with no classifier call

#### Scenario: A same-batch twin hits the fast path against a mid-batch mint

- **WHEN** `"onion"` and `"onions"` are drained in the same capture tick with neither in the registry, and `"onion"` mints first
- **THEN** `"onions"` resolves SAME to the just-minted `onion` through the in-tick lexical append and no second node is minted

#### Scenario: An in-tick lexical collision makes the key ambiguous

- **WHEN** a mid-batch mint's lexical form collides with an existing map entry for a different survivor
- **THEN** the key becomes ambiguous, later same-form terms this tick skip the fast path and take the normal confirm flow, and no deterministic alias is written on the collided key

### Requirement: Stable ids with union-find merges

The system SHALL treat canonical ids as **append-only, stable join keys** — an id, once minted, SHALL NOT be renamed, because `sku_cache`, `brand_prefs`, `ingredients_key`/`perishable_ingredients`, and `grocery_list` key on it. When the capture job later discovers that two already-minted ids are the same identity (a synonym that surfaced after both bases were independently minted), it SHALL merge them by setting a **`representative` pointer** from one id to the other rather than rewriting any dependent row. Resolution SHALL follow the representative chain transitively to the surviving id. Dependent tables SHALL NOT be key-rewritten on a merge. A merge MAY be proposed by a signal **other than embedding similarity** — in particular, two distinct ids that repeatedly resolve to the **same Kroger SKU** in `sku_cache` are candidate synonyms — so cross-lexical synonyms that embeddings do not retrieve (e.g. `zucchini`/`courgette`) can still be collapsed, subject to the same conservative confirm. A co-resolution pair the confirm REJECTS SHALL be remembered in shared D1 state that survives restarts — keyed by the pair's surviving ids in canonical order, with the decision time — and SHALL NOT be re-proposed to the confirm while the rejection is fresh (a long backoff); a post-backoff re-proposal that is rejected again SHALL refresh the memory. A pair whose surviving ids change through later merges SHALL be eligible again immediately (the memory keys on survivors, so a materially-changed graph re-opens the question). Suppressed pairs SHALL be counted in the job summary; a transient confirm failure SHALL NOT record a rejection.

#### Scenario: Late-discovered synonym merges without key rewrites

- **WHEN** `scallion` and `green-onion` were minted as separate bases and the job later confirms they are the same
- **THEN** one id's `representative` is set to the other and all reads resolve transitively to the survivor, with no update to `sku_cache`/`brand_prefs`/`grocery_list` rows

#### Scenario: Minted ids are never renamed

- **WHEN** a better-structured id would be preferable for an existing base
- **THEN** the existing id is retained and new aliases point at it, rather than renaming the id and orphaning dependent rows

#### Scenario: Same-SKU co-resolution proposes a cross-lexical merge

- **WHEN** two distinct ids (e.g. `zucchini` and `courgette`, which embeddings do not retrieve as neighbors) repeatedly resolve to the same Kroger SKU in `sku_cache`
- **THEN** a merge is proposed from that signal and, on a conservative confirm, one id's `representative` is set to the other — collapsing a synonym the embedder missed

#### Scenario: A rejected pair is remembered, not re-asked every tick

- **WHEN** the confirm rejects the pair `pecorino romano`/`parmesan` (a shared SKU, distinct products)
- **THEN** the rejection is recorded with its decision time, later ticks suppress the pair without a classifier call (counted in the summary), the pair is re-confirmed once after the backoff elapses, and a merge of either id's family (changing a survivor) makes the pair eligible again immediately

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

### Requirement: Periodic re-confirm of under-connected nodes

The system SHALL run a scheduled **re-confirm pass** that re-examines eligible under-connected identity nodes against the current registry and **enriches** them, so a node minted before its neighbors existed (a below-floor no-LLM mint) gains the `satisfies` edges — or the synonym merge — that could not exist at mint time. The pass SHALL be **strictly non-destructive to the graph's correctness**: it may only ADD edges or MERGE a node into a clear synonym survivor; it SHALL NOT remove or downgrade an edge, split a node, change a node's canonical id (beyond a `representative` merge), or override a human decision. A node SHALL be **eligible** only when it is `source='auto'`, `concrete=true`, has no incoming or outgoing edge, and has not yet been re-confirmed (a null re-confirm stamp); `source='human'` nodes SHALL never be selected. Each eligible node SHALL be re-confirmed **at most once** and then stamped, so the pass drains its backlog and **quiesces to a no-op** (preserving the steady-state ≈0 LLM calls). The pass SHALL be **bounded per tick**, share the internal `env.AI`/D1 budget, record a `job_health` row, and append each decision to the normalization log **distinguished from an initial-capture decision**. It SHALL reuse the SAME classifier confirm + conservative-collapse bias as the capture job — a doubtful merge is not made. The pass SHALL apply the **confirm-distance guard** to its `same` and `specialization` picks exactly as the capture job does: a pick whose chosen candidate's own cosine (from the pass's ranked retrieval) is below the confirm minimum SHALL be rejected to a logged no-op — no merge and no edges committed, the node stamped, the guard rejection (rejected outcome, chosen candidate, score) recorded in the log detail.

#### Scenario: An edgeless early mint gains its family edges

- **WHEN** the re-confirm pass processes an eligible edgeless node (e.g. `kielbasa`) and the confirm proposes a `general` edge to a now-present neighbor (`kielbasa → sausage`)
- **THEN** the edge is committed onto the node, the node is stamped re-confirmed, and the decision is logged as a re-confirm

#### Scenario: A node is re-confirmed at most once and the pass self-quiesces

- **WHEN** a node has already been re-confirmed (its re-confirm stamp is set)
- **THEN** it is not selected again, and once every eligible node is stamped the pass selects nothing and performs no model calls that tick

#### Scenario: Human nodes and human overrides are immune

- **WHEN** the pass scans for eligible nodes
- **THEN** a `source='human'` node is never selected, and a synonym merge never makes a human node the loser — a human alias/override is never re-confirmed away

#### Scenario: A clear synonym merges via the representative pointer, conservatively

- **WHEN** the confirm returns `same` against a truly-interchangeable survivor for an eligible auto node
- **THEN** the node is merged into the survivor via the `representative` pointer (append-only, no cross-table rewrite; data rows converge through the grocery/pantry re-key reconcile), and a doubtful (not-clearly-interchangeable) candidate is left un-merged

#### Scenario: A distant merge pick is rejected to a logged no-op

- **WHEN** the confirm returns `same` (or `specialization`) against a candidate whose cosine to the node is below the confirm minimum
- **THEN** no merge is made and no edge is committed — the node is stamped, and the log records the guard rejection with the rejected outcome, candidate, and score

#### Scenario: Failures never make a node worse

- **WHEN** re-confirming a node hits a transient `env.AI`/D1 error
- **THEN** the node is skipped with its re-confirm stamp left null (retried a later tick), nothing is partially written; and **WHEN** the confirm is contract-invalid **THEN** the pass fails safe to a no-op (stamp it, change nothing) rather than introducing an edge or merge

#### Scenario: Re-confirm does not change a node's canonical id in v1

- **WHEN** the confirm judges an eligible bare node to be a specialization of a known base (it should arguably become `base::detail`)
- **THEN** the pass takes only the safe subset — it adds a `general` edge from the node to that base if present — and leaves the node's canonical id unchanged (a full id-changing re-home is out of scope)

### Requirement: Confirm-distance guard on collapse decisions

The capture job SHALL reject a classifier SAME or SPECIALIZATION decision when the chosen candidate's own cosine similarity to the queued term is below a confirm minimum (a constant calibrated above the worst observed wrong collapse and below the correct-decision band), and SHALL fall back to the NOVEL mint path for that term, recording the guard rejection — the rejected outcome, the chosen candidate, and its cosine — in the normalization log detail. The confirm prompt SHALL present each candidate together with its cosine similarity, with guidance that low similarity raises the bar for SAME/SPECIALIZATION. The guard SHALL NOT apply to the SKU co-resolution pass (its merge signal is deliberately non-embedding evidence).

#### Scenario: A distant pick is rejected and falls back to novel

- **WHEN** the classifier returns SPECIALIZATION against a candidate whose cosine to the queued term is below the confirm minimum (e.g. "flaky sea salt" specialized under "fish sauce" at 0.598)
- **THEN** the pick is rejected, the term is minted as a NOVEL base (verbatim), and the log detail records the guard rejection with the rejected outcome, candidate, and score

#### Scenario: A near pick is applied unchanged

- **WHEN** the classifier returns SAME or SPECIALIZATION against a candidate whose cosine is at or above the confirm minimum
- **THEN** the decision is committed exactly as before the guard existed

### Requirement: Canonical id synthesis for confirmed-novel mints

For a confirmed NOVEL outcome the classifier SHALL additionally propose a `canonical` id — the clean lowercase product name with packaging, quantity, and storage-condition noise stripped, in `base` or `base::detail` form. The job SHALL validate the proposal (non-empty after trimming; all-lowercase; no parentheses, commas, or newlines; bounded length; at most one `::` separator, each segment non-empty with no other colon use) and, when valid and not equal to an existing node id or alias variant, mint the node under the canonical id with `base`/`detail` derived from it and the search term flattened from it. The surface term SHALL always be written as an alias to the final node id, whichever id is chosen. An invalid or missing canonical, or one that collides with an existing node id or alias variant, SHALL fall back to the verbatim-term mint (a collision must never silently alias the term onto the existing node, and a standing alias variant must never shadow a freshly minted node of the same name). A malformed canonical SHALL never fail the mint or consume the corrective-retry budget. Below-floor mints (no classifier call) SHALL keep verbatim behavior.

#### Scenario: A valid canonical cleans a free-text mint

- **WHEN** "quick cooking oats (flavored)" is confirmed NOVEL with canonical "quick cooking oats"
- **THEN** the node is minted with id/base "quick cooking oats" and the alias "quick cooking oats (flavored)" → "quick cooking oats" is written

#### Scenario: An invalid canonical falls back to the verbatim term

- **WHEN** the classifier proposes a canonical that fails validation (e.g. contains parentheses or uppercase) or proposes none
- **THEN** the node is minted under the verbatim queued term (pre-change behavior) and the fallback reason is recorded in the log detail

#### Scenario: A colliding canonical falls back to the verbatim term

- **WHEN** the proposed canonical equals an existing node id (including a merged-away or not-yet-embedded node)
- **THEN** the node is minted under the verbatim queued term and no alias is written onto the colliding node

#### Scenario: Below-floor mints are untouched

- **WHEN** a queued term's nearest identity is below the similarity floor (no classifier call is spent)
- **THEN** the node is minted under the verbatim term exactly as before

### Requirement: Edge commit contradiction validation

Edge commits (the capture resolution commit and the re-confirm enrich commit) SHALL skip, rather than insert, any proposed edge whose reverse pair (to → from, regardless of kind) already exists in the edge table or earlier in the same commit, and any edge that resolves to a self-loop after following each endpoint's representative pointer. Skipped edges SHALL be recorded, with a reason, in the committed decision's normalization-log detail. Kept edges SHALL insert with their original (pre-resolution) endpoints.

#### Scenario: A reverse pair is skipped, not inserted

- **WHEN** the edge "whole cardamom pods" -[containment]→ "ground cardamom" exists and a commit proposes "ground cardamom" -[general]→ "whole cardamom pods"
- **THEN** the proposed edge is skipped and recorded in the log detail, while the commit's other writes proceed unchanged

#### Scenario: A post-merge self-loop is skipped

- **WHEN** a commit proposes an edge from A to B and B's representative chain resolves to A
- **THEN** the edge is skipped as a self-loop and recorded in the log detail

### Requirement: Embedding backfill for retrieval completeness

The capture job SHALL, each tick before draining the novel-term queue, embed a bounded batch of surviving identity nodes whose embedding is missing (e.g. nodes minted by a human `update_aliases` write) and store the vectors, so those nodes join the cosine retrieval set — including for terms drained later in the same tick. A backfill failure SHALL be logged and skipped without failing the tick (the rows stay unembedded and retry on a later tick), and the backfilled count SHALL be reported in the job summary.

#### Scenario: A human-minted node becomes retrievable

- **WHEN** a node inserted by `update_aliases` has a NULL embedding
- **THEN** a capture tick embeds it, and a related term queued afterwards retrieves it as a cosine candidate instead of re-minting the concept

#### Scenario: Backfill is bounded and non-fatal

- **WHEN** the embedding call fails transiently during the backfill
- **THEN** the queue drain still runs that tick, and the unembedded nodes remain eligible for backfill on a later tick

### Requirement: Rolling re-audit of pre-hardening alias decisions

The system SHALL run a scheduled alias re-audit pass over `source='auto'` alias mappings that carry no audit stamp, bounded per tick and oldest-decided first, that converges pre-hardening decisions to the hardened rules with no operator action. A **self-alias** (the variant string equals the row's node id — the alias every mint writes for its own node) SHALL be stamped audited deterministically, with no embedding and no model call. **Every other** eligible mapping SHALL be re-decided by the hardened classifier confirm — candidates retrieved from the current registry by cosine over the variant's embedding, always including the currently-mapped (representative-resolved) node — with the confirm-distance guard applied to the pick exactly as at capture (a distant pick rejects to a verbatim NOVEL mint). The re-decision SHALL be applied via existing primitives only: re-pointing the alias (auto source, fresh `decided_at`), minting a node (canonical-id synthesis applies), or a `representative` merge — never deleting a node and never touching a `source='human'` row. A re-decision that RESOLVES to the standing mapping's survivor — a SAME on the survivor, a SPECIALIZATION demoted by the segment guard onto it, or a NOVEL whose proposed canonical id (raw or validated — an existing id may legitimately fail mint validation, e.g. contain a comma) resolves to it — SHALL be applied as a keep (the mapping re-committed and stamped); in particular a NOVEL canonical equal to the standing id SHALL never fall through to a verbatim mint of the variant (a duplicate node that only re-derives the standing mapping). When an applied re-point strands a `source='auto'` node with no remaining aliases, the pass SHALL merge that node into the re-decision's resolved node so it leaves the retrieval set. Every classifier re-decision SHALL be appended to the normalization log with an audit marker and the previous mapping in its detail. A contract-invalid confirm SHALL keep the existing mapping and stamp it (never destroy on an undecidable); a transient failure SHALL leave the row un-stamped for a later tick. Alias rows written by capture, re-confirm, and the re-audit itself SHALL be born already-stamped, so the pass drains its backlog and quiesces to a no-op.

#### Scenario: A self-alias is stamped with no model call

- **WHEN** the pass selects an auto alias whose variant equals its node id (e.g. `olive oil` → `olive oil`)
- **THEN** the row is stamped audited with no embedding and no classifier call, and no log row is written

#### Scenario: A high-cosine distinct-product alias is re-pointed by the classifier

- **WHEN** the pass re-decides `'sesame seeds'` → `toasted sesame seeds::toast` (a mapping whose variant↔node cosine sits ABOVE the confirm minimum) and the hardened confirm returns NOVEL with canonical `sesame seeds`
- **THEN** a `sesame seeds` node is minted, the alias is re-pointed to it with a fresh auto `decided_at`, the row is stamped, and the log records the correction with the audit marker and the previous mapping

#### Scenario: A guard-rejected pick falls back to a verbatim novel mint

- **WHEN** the confirm for `'flaky sea salt'` picks a candidate whose cosine to the variant is below the confirm minimum
- **THEN** the pick is rejected, the variant is minted as a verbatim NOVEL node, the alias is re-pointed to it, and the guard rejection is recorded in the log detail

#### Scenario: A confirmed mapping is kept and stamped

- **WHEN** the confirm returns SAME against the currently-mapped node's survivor
- **THEN** the mapping stands (re-committed with a fresh `decided_at`), the row is stamped, and the decision is logged with the audit marker

#### Scenario: A re-decision that only re-derives the standing mapping is a keep

- **WHEN** the confirm for `'atlantic sockeye salmon fillets'` (standing survivor `salmon fillets, skin-on::species-atlantic-sockeye`) returns SPECIALIZATION on that survivor with a duplicate detail, or NOVEL with a canonical equal to it
- **THEN** the standing mapping is kept and stamped — no deeper id is constructed, no verbatim variant node is minted — and the keep is logged with the audit marker

#### Scenario: A stranded wrong-mint node is merged away

- **WHEN** a re-point moves the last alias off a `source='auto'` node (e.g. `fish sauce::type-sea-salt` after `'flaky sea salt'` is re-pointed)
- **THEN** that node's `representative` is set to the re-decision's resolved node — it exits cosine retrieval and stray references resolve through the chain — and the merge is logged; a human node, or a node retaining other aliases, is never merged this way

#### Scenario: Human aliases are immune

- **WHEN** the pass scans for eligible rows
- **THEN** a `source='human'` alias is never selected, re-decided, or stamped by the audit

#### Scenario: Failures never destroy a standing mapping

- **WHEN** the confirm for an eligible row is contract-invalid after the retry budget
- **THEN** the existing mapping is kept and the row is stamped (logged as a fail-safe keep); and **WHEN** the failure is transient (`env.AI`/D1) **THEN** the row is skipped un-stamped and retried on a later tick with nothing written

#### Scenario: Born-audited writes make the pass self-quiescing

- **WHEN** capture, re-confirm, or the re-audit itself writes an alias row after this change
- **THEN** the row carries the audit stamp at write time, and once the pre-hardening backlog is drained the pass selects nothing and spends no model calls

### Requirement: Purchasability re-audit re-opening for standing detail-node aliases

The system SHALL re-open the rolling alias re-audit for the pre-hardening detail-node backlog with a one-time D1 migration that clears `audited_at` on every `source='auto'` `ingredient_alias` row whose stored target id contains a detail segment, so the EXISTING re-audit pass re-decides each such mapping under the hardened purchasable-distinction confirm — no new pass, no new stamp, and no manual data edits. `source='human'` rows SHALL NOT be re-opened. Convergence SHALL ride existing machinery only: a home-derivable mapping is re-pointed to its base (fresh auto `decided_at`, re-stamped, logged with the audit marker), a re-point that strands an auto node with no remaining aliases merges it into the re-decision's resolved node via the representative pointer, the merged node's structural edge is swept as a representative-resolved self-loop by the edge-audit pre-pass, and dependent keys (recipe-index facets, `sku_cache`, grocery/pantry `normalized_name`, stored alias targets) converge through the standing reconciles — including a stale resolved-id facet snapshot (a stored id that stops resolving after the merge), which the projection capture funnel re-enqueues and the hardened capture confirm re-disposes onto the surviving base. A purchasable detail mapping re-decided by the re-opened audit SHALL re-derive its standing mapping and be applied as a keep (re-committed and re-stamped), so the re-opening produces no churn on legitimate specializations, and the pass SHALL re-quiesce once the re-opened backlog drains (capture and re-audit writes remain born-stamped). Satisfaction between a pantry item and a recipe ingredient whose home-derivable form has collapsed SHALL be plain resolved-id equality — this change SHALL introduce no new edge kinds, no reverse traversal, and no `satisfies()` closure in tools — and a distinct-base extraction (`lime juice`) SHALL never auto-satisfy its source product (`lime`) by equality or by any mechanism this change adds; it MAY surface only as an explicit suggestion (the depth-1 substitution walk or read-time reasoning).

#### Scenario: The issue-215 defect converges organically and is the acceptance fixture

- **WHEN** the migration ships and the re-opened audit re-decides `'lime wedges'` → `lime::form-wedges` while the production pantry holds `lime` and the recipes `chicken-and-black-bean-stew` and `crispy-tofu-with-peanut-sauce` carry `lime::form-wedges` in `perishable_ingredients`
- **THEN** the alias re-points to `lime`, the stranded `lime::form-wedges` merges into `lime` via the representative pointer, its structural edge is swept as a self-loop, the recipe facets re-converge to `lime` through the projection funnel and capture, and the pantry `lime` row satisfies those recipe lines by plain resolved-id equality — verified against production after deploy as this change's acceptance fixture

#### Scenario: A purchasable detail mapping is kept without churn

- **WHEN** the re-opened audit re-decides `'pickle chips'` → `pickles::form-chips` or `'canned tuna'` → `tuna::form-canned`
- **THEN** the hardened confirm re-derives the standing mapping (a SAME on the survivor, a re-derived specialization, or a NOVEL canonical resolving to it), the mapping is kept and re-stamped, and no node is minted or merged

#### Scenario: Pantry lime juice never auto-satisfies a lime request

- **WHEN** a pantry holds `lime juice` and a recipe line resolves to `lime` (or a formerly-collapsed form such as `lime::form-wedges`)
- **THEN** no equality match occurs and no matching code performs an edge traversal — `lime juice` remains a distinct surviving base with no auto-created edge or merge to `lime`, and it can reach the member only as an explicit suggestion, never as automatic satisfaction

#### Scenario: Human detail aliases are not re-opened

- **WHEN** the migration runs over a registry containing `'calamansi'` → `lime::calamansi` (`source='human'`)
- **THEN** that row keeps its audit stamp, is never selected by the re-opened pass, and its node is never re-decided, re-pointed, or merged

#### Scenario: The re-opened backlog drains and the pass re-quiesces

- **WHEN** every re-opened detail-target row has been re-decided and re-stamped
- **THEN** the alias re-audit selects nothing and spends no model calls on later ticks, and rows written by capture and the re-audit remain born-stamped

### Requirement: Rolling re-audit of auto satisfies edges

The system SHALL run a scheduled edge re-audit pass over `source='auto'` edges that carry no audit stamp, bounded per tick, correcting the pre-hardening edge backlog. An edge whose endpoints resolve to the same node through the `representative` pointer SHALL be deleted deterministically, with no model call. A **structural edge** — one whose `from_id` is exactly its `to_id` plus a single detail segment (`X::detail → X`) and whose `from_id` is itself a surviving node — SHALL be kept and stamped deterministically, with no model call, and SHALL never be deleted by the pass, including as the reverse side of a 2-cycle resolution. An edge whose resolved reverse pair exists (any kind) SHALL be resolved: against a `source='human'` reverse edge the auto edge is deleted deterministically (human authority); otherwise one classifier direction-check SHALL decide — the edge(s) matching the answered direction are kept and stamped, the rest deleted, with mutual satisfaction keeping both and "neither" deleting both (structural edges excepted as above). A standing edge SHALL be validated by the same direction check and deleted when the FROM→TO direction does not hold. The direction check SHALL define satisfies as "having FROM acceptably fulfills a request for TO" — NOT "FROM is the identical product": a member fulfills a request for a category concept it belongs to, and a more complete form fulfills a request for its derived form; the distinct-products refusal applies to same-level specific products only. `source='human'` edges SHALL never be selected or deleted. Every deletion SHALL be logged (an edge-audit outcome with the direction verdict in its detail, structured from/to/kind fields, and the replay-exempt mark); a contract-invalid check SHALL keep the edge and stamp it; a transient failure SHALL leave the edge un-stamped for a later tick. Edges written by capture, re-confirm, the structural guarantee, and the replay SHALL be born already-stamped, so the pass drains its backlog and quiesces to a no-op.

#### Scenario: A representative-resolved self-loop is deleted with no model call

- **WHEN** an auto edge's endpoints resolve to the same surviving node
- **THEN** the edge is deleted outright, the deletion is logged, and no classifier call is spent

#### Scenario: A structural edge is exempt from the model and from deletion

- **WHEN** the pass audits `rotel (original)::heat-mild -[general]→ rotel (original)` (or `snacking pickles::form-chips -[general]→ snacking pickles`) while the from-node survives
- **THEN** the edge is kept and stamped deterministically with no direction check, and no verdict — including a 2-cycle resolution on its pair — can delete it

#### Scenario: A structural-shaped edge from a merged-away node is not exempt

- **WHEN** the pass audits an edge shaped `X::detail → X` whose from-node has been merged away (its representative is set)
- **THEN** the exemption does not apply and the edge is handled by the resolved-endpoint rules (self-loop deletion or the normal direction check)

#### Scenario: A 2-cycle is resolved by one direction check

- **WHEN** the pass audits `whole cardamom pods -[containment]→ ground cardamom` while `ground cardamom -[general]→ whole cardamom pods` also exists (both auto) and the direction check answers that only whole-satisfies-ground holds
- **THEN** the containment edge is kept and stamped, the reverse edge is deleted, and one classifier call was spent on the pair

#### Scenario: A human reverse edge wins deterministically

- **WHEN** an auto edge's resolved reverse pair exists as a `source='human'` edge
- **THEN** the auto edge is deleted with no model call and the human edge is untouched

#### Scenario: A wrong-satisfies standing edge is dropped

- **WHEN** the direction check for `spaghetti -[general]→ rigatoni` (or `garlic powder -[membership]→ italian seasoning`) answers that FROM does not satisfy a request for TO
- **THEN** the edge is deleted and the drop is logged with the verdict

#### Scenario: A membership edge onto a category concept is kept

- **WHEN** the direction check evaluates `sweet maui mango habanero sauce -[membership]→ hot sauces (various)`
- **THEN** the recalibrated check answers that the member fulfills a request for the category and the edge is kept and stamped

#### Scenario: A valid standing edge is stamped

- **WHEN** the direction check confirms the FROM→TO satisfies direction holds
- **THEN** the edge is kept and stamped audited, and is never re-selected

#### Scenario: Undecidable and transient checks never delete

- **WHEN** the direction check is contract-invalid after the retry budget
- **THEN** the edge is kept and stamped (logged as a fail-safe keep); and **WHEN** the failure is transient **THEN** the edge is skipped un-stamped and retried on a later tick

### Requirement: SKU-cache key convergence

The system SHALL reconcile `sku_cache` keys to the current normalization resolution each scheduled tick, with plain code and no model calls: each row's `ingredient` key is resolved through the current alias front-door and `representative` chain, and a row whose resolution differs from its stored key is re-keyed to the resolved id. On a key collision — with an existing row for the same (resolved ingredient, `location_id`) or another re-keying row — the row with the newer `last_used` SHALL win whole (its `sku`/`brand`/`size` travel with it; a null `last_used` loses; a tie keeps the already-canonical row). The pass SHALL be idempotent (a second run over converged rows plans nothing), bounded per tick, and SHALL have **no capture side effect** — a key that resolves to nothing (a non-food or never-captured term) is left unchanged and is never enqueued as a novel term by this pass.

#### Scenario: A legacy raw-term key converges when its term is captured

- **WHEN** capture resolves `'whole milk'` into the identity graph and a `sku_cache` row is still keyed `whole milk` with a differing resolution
- **THEN** the next tick re-keys that row to the resolved canonical id, preserving its SKU, brand, size, and `last_used`

#### Scenario: A re-key collision keeps the newer mapping

- **WHEN** a re-keying row and an existing row share the target (resolved ingredient, `location_id`) key
- **THEN** the row with the newer `last_used` survives whole and the other is deleted

#### Scenario: Non-resolving rows are untouched, with no capture

- **WHEN** a row's `ingredient` has no alias resolution (a non-food or never-seen term)
- **THEN** the row keeps its key unchanged and the term is not enqueued to the novel-term queue

#### Scenario: The pass is idempotent

- **WHEN** the pass runs again over fully-converged rows
- **THEN** it plans no deletes and no upserts (a healthy run that re-keyed nothing)

### Requirement: The recipe index projection is a capture surface

The recipe-index projection SHALL funnel every projected recipe's effective `ingredients_key` and `perishable_ingredients` through the shared `IngredientContext`, so each term that does not resolve to a known surviving id is enqueued to the novel-term queue — best-effort, deduped within the pass, insert-or-ignore in the queue — making the projected corpus a standing capture surface: terms classified before capture existed, and terms missed during any capture outage, are re-encountered every tick until the capture job places them, so the corpus converges into the identity graph organically at the capture job's own bounded pace with no manual backfill. The projection SHALL NOT call an embedding model or an LLM (capture is by enqueue only; the scheduled capture job disposes). The food guard SHALL NOT apply — recipe ingredient facets are food terms by construction (derived from the recipe body's Ingredients section), with no `kind`/`domain` to gate on, the same wholesale funnel treatment pantry receives. An enqueue failure SHALL never fail the projection or skip a recipe (the term stays unresolved and re-enqueues on a later tick).

#### Scenario: Legacy corpus terms converge organically

- **WHEN** the projection encounters a stored derived ingredient term with no identity-graph entry (a recipe faceted before the capture funnel existed)
- **THEN** the term is enqueued for capture, a later capture tick places it, and the projection thereafter writes its surviving canonical id into the index

#### Scenario: The projection spends no model calls

- **WHEN** a projection pass funnels the corpus's ingredient facets and finds unresolved terms
- **THEN** the terms are enqueued for the scheduled capture job and the projection itself spends zero embedding and zero classifier calls

#### Scenario: A capture-outage gap self-heals

- **WHEN** terms that should have been captured were dropped by an earlier outage of any capture path
- **THEN** the next projection pass re-encounters them in the stored facets and re-enqueues them, so the gap closes without operator intervention

#### Scenario: An enqueue failure is invisible to the index

- **WHEN** the novel-term enqueue write fails during a projection pass
- **THEN** the recipe still projects with the cleaned term, and the term re-enqueues on a later tick because it remains unresolved

### Requirement: Specialization ids are bounded to a single detail segment

Resolution construction (the capture job and the alias re-audit, which share the same builder) SHALL NOT concatenate a specialization id onto a match that already carries a detail segment. When the classifier returns SPECIALIZATION and the chosen match id contains `::`, the decision SHALL be demoted to SAME with the match — the alias points at the match, no node is minted, and no deeper id is constructed — with the demotion recorded in the decision's log detail (the proposed detail and a demotion marker). A canonical id deeper than `base::detail` SHALL never be constructible by any deterministic path (the novel-mint path is already bounded by canonical-id validation).

#### Scenario: A re-specialization of an already-detailed match is demoted to SAME

- **WHEN** the confirm for `'atlantic sockeye salmon fillets'` returns SPECIALIZATION with match `salmon fillets, skin-on::species-atlantic-sockeye` and detail `species-atlantic-sockeye`
- **THEN** the resolution is SAME with `salmon fillets, skin-on::species-atlantic-sockeye` — no `salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye` id is constructed — and the log detail records the demotion with the proposed detail

#### Scenario: The guard applies at capture and at the alias re-audit alike

- **WHEN** either the capture job or the alias re-audit pass receives a SPECIALIZATION pick whose match id already contains `::`
- **THEN** both apply the same demotion (they construct resolutions through the same builder), and the alias re-audit counts the result as a kept mapping when the match resolves to the standing survivor

#### Scenario: A specialization of a bare base is unaffected

- **WHEN** the confirm returns SPECIALIZATION with a detail-less match (e.g. match `ground beef`, detail `fat-80-20`)
- **THEN** the id `ground beef::fat-80-20` is constructed exactly as before the guard existed

### Requirement: Segment-overflow repair reconcile

The capture job SHALL run a deterministic per-tick sub-pass (no model calls) that repairs any surviving `source='auto'` identity node whose id contains more than one detail segment (three or more `::`-separated segments) onto its two-segment prefix. When the prefix node exists and resolves to a different survivor, the overflow node SHALL merge into the prefix via the representative pointer. When the prefix node exists but currently resolves TO the overflow node (the overflow is its family's root), the pass SHALL re-root the family — clear the prefix's representative and point the overflow's representative at the prefix — in one atomic batch. When no prefix node exists, the pass SHALL mint the prefix (base and detail derived from the id, search term flattened, embedding NULL for the backfill) and point the overflow at it. Every repair SHALL be logged. `source='human'` overflow nodes SHALL never be modified. The pass SHALL be idempotent and self-quiescing: once no surviving auto node exceeds two segments it plans nothing.

#### Scenario: The live production overflow node is re-rooted under its prefix

- **WHEN** the pass finds surviving node `salmon fillets, skin-on::species-atlantic-sockeye::species-atlantic-sockeye` whose 2-segment prefix `salmon fillets, skin-on::species-atlantic-sockeye` exists with its representative pointing at the overflow node
- **THEN** the prefix's representative is cleared, the overflow's representative is set to the prefix, the repair is logged, and every alias or key that pointed at the overflow now resolves to the prefix through the chain

#### Scenario: An overflow whose prefix survives elsewhere merges normally

- **WHEN** an overflow node's 2-segment prefix exists and resolves to a survivor other than the overflow node
- **THEN** the overflow merges into the prefix via the representative pointer (the existing merge primitive, cycle-guard intact)

#### Scenario: A missing prefix is minted before the repair

- **WHEN** an overflow node's 2-segment prefix does not exist in the registry
- **THEN** the prefix node is minted (embedding NULL, embedded later by the backfill) and the overflow's representative is pointed at it, in the same batch

#### Scenario: The pass quiesces and never touches human nodes

- **WHEN** the pass runs over a registry with no surviving auto node deeper than two segments, or encounters a `source='human'` overflow node
- **THEN** it plans no writes for the converged registry and skips the human node (counted, unmodified)

### Requirement: Structural edge guarantee

The edge re-audit job SHALL run a deterministic per-tick pre-pass (no model calls) that (a) deletes any `source='auto'` edge whose endpoints resolve to the same survivor through the representative pointer — regardless of audit stamp — logging each deletion, and (b) ensures every surviving two-segment identity node `X::detail` has an edge of some kind from `X::detail` to its exact base `X`: when none exists, a `general` edge SHALL be inserted born-stamped (never re-entering the audit backlog), minting the base node `X` (embedding NULL, for the backfill) when it is absent, and logging each insertion. The guarantee SHALL NOT insert an edge that would be a representative-resolved self-loop: when the base `X` and the node `X::detail` resolve to the same survivor (the base was merged into its own child), the insertion is skipped — never guaranteeing an edge the self-loop sweep would delete, so an inverted family cannot oscillate between (a) and (b). The guarantee SHALL be **survival-agnostic**: it asserts the base edge for WHATEVER two-segment nodes survive and takes no position on whether a detail node ought to exist — which specializations are minted, kept, or collapsed is owned by the capture confirm and the alias re-audit under the purchasable-distinction test. When a home-derivable detail node is collapsed (merged into its base via the representative pointer), it no longer survives: step (a) sweeps its standing structural edge as a representative-resolved self-loop and step (b) SHALL NOT re-insert an edge for it. The pre-pass SHALL run every tick including when the audit backlog is empty, SHALL be write-capped per tick, and SHALL be idempotent — a converged registry plans nothing.

#### Scenario: The wrongly-dropped structural class is restored deterministically

- **WHEN** the pre-pass runs while surviving nodes `rotel (original)::heat-mild`, `snacking pickles::form-chips`, and `tomatoes::form-diced` (purchasable forms that survive the purchasable-distinction test) have no edge to their bases (the audit dropped them as "distinct products")
- **THEN** a `general` edge from each node to its exact base is inserted born-stamped with no model call, and each insertion is logged

#### Scenario: A missing base node is minted for the guarantee

- **WHEN** a surviving node `X::detail` has no edge to `X` and no node `X` exists
- **THEN** the base node `X` is minted (embedding NULL, embedded later by the backfill) and the structural edge is inserted in the same pass

#### Scenario: A stamped self-loop left behind by a repair is swept

- **WHEN** the segment-overflow repair points the overflow node at its prefix, turning the overflow's born-stamped structural edge into a representative-resolved self-loop
- **THEN** the pre-pass deletes that edge even though it carries an audit stamp, and logs the deletion

#### Scenario: A collapsed home-derivable node's edge is swept, never re-guaranteed

- **WHEN** the purchasability re-audit merges `lime::form-wedges` into `lime` while the structural edge `lime::form-wedges -[general]→ lime` still stands
- **THEN** step (a) deletes that edge as a representative-resolved self-loop (its audit stamp notwithstanding) and step (b) does not re-insert it, because the from-node no longer survives

#### Scenario: An inverted family is never guaranteed a self-loop edge

- **WHEN** the pre-pass runs over a family whose base's representative chain resolves to its own surviving `::detail` child (the production serrano inversion) while the stamped structural edge `X::detail → X` still stands
- **THEN** step (a) sweeps that edge as a representative-resolved self-loop, step (b) skips the re-insert because `X` and `X::detail` resolve to the same survivor, and the delete/re-insert churn quiesces in one tick — before and independent of the disjunction shape sweep

#### Scenario: A converged registry is a no-op

- **WHEN** the pre-pass runs and every surviving two-segment node already has its base edge and no auto edge self-loops
- **THEN** it plans no writes and spends no model calls

### Requirement: One-shot replay of edge-drop decisions

The edge re-audit job SHALL re-evaluate every pre-existing `edge_drop` decision in the normalization log exactly once under the recalibrated direction check, bounded per tick and oldest-first, and SHALL mark each processed row in its log detail (a replay timestamp plus the outcome) so the pass drains its backlog and quiesces to a no-op. The edge SHALL be parsed from the row's `from -[kind]-> to` term with a strict pattern; an unparseable row SHALL be marked and skipped with no model call. Rows dropped deterministically (self-loop, human-reverse), rows whose edge is structural with a surviving from-node (the guarantee restores those), and rows whose from-endpoint is missing or merged away SHALL be marked with no model call. Every other row SHALL get one recalibrated direction check over the resolved endpoints: when the FROM→TO direction holds and no resolved reverse edge exists, the edge SHALL be re-inserted with its original endpoints, born-stamped, and the restoration SHALL be logged as a distinct outcome referencing the replayed row; when the direction does not hold, the row is marked with the verdict and nothing is inserted. When a resolved reverse edge EXISTS, the replay SHALL NOT withhold — it SHALL re-decide the pair with that same single direction check under the 2-cycle semantics: a forward-only verdict restores the dropped edge AND deletes the standing reverse (logged, born-marked, referencing the replayed row) even when the reverse carries an earlier keep stamp; a mutual verdict restores the dropped edge and keeps the reverse; a reverse-only verdict marks the row and leaves the reverse; a neither verdict marks the row and deletes the reverse. A `source='human'` standing reverse SHALL win deterministically (no model call, no restore), and a structural standing reverse SHALL never be deleted and SHALL block the restore (no model call). A transient failure SHALL leave the row unmarked for a later tick; a contract-invalid check SHALL mark the row without restoring. Edge-drop rows written after this change SHALL be born-marked, and edge decision log rows SHALL carry structured from/to/kind detail fields going forward.

#### Scenario: A wrongly-dropped containment edge is restored by the recalibrated check

- **WHEN** the replay processes the drop row for `honey raisins -[containment]-> raisins` and the recalibrated direction check answers that FROM satisfies TO
- **THEN** the edge is re-inserted born-stamped with its original endpoints, a restoration log row referencing the replayed row is appended, and the source row is marked replayed

#### Scenario: A both-deleted 2-cycle is restored in the true direction only

- **WHEN** the replay processes the two cardamom drop rows (`whole cardamom pods -[containment]-> ground cardamom` and `ground cardamom -[general]-> whole cardamom pods`)
- **THEN** the whole→ground edge is restored and the ground→whole row is marked with a not-holding verdict and stays deleted

#### Scenario: A replayed drop with a standing reverse is re-decided as a pair

- **WHEN** the replay processes the drop row for `whole frozen chicken -[containment]-> chicken tenderloin` while the wrongly-kept reverse `chicken tenderloin -[general]-> whole frozen chicken` stands (auto, non-structural), and the recalibrated direction check answers forward-only
- **THEN** the dropped edge is restored born-stamped, the standing reverse is deleted despite its earlier keep stamp (logged with the pair marker and the replayed row's id), the row is marked, one model call was spent, and no 2-cycle exists afterward

#### Scenario: Human and structural standing reverses are immune in a pair re-decision

- **WHEN** the replay finds the standing reverse of a drop row is `source='human'`, or is a structural edge with a surviving from-node
- **THEN** no model call is spent, the reverse is untouched, the restore does not happen, and the row is marked with the deterministic reason

#### Scenario: Deterministic and dead rows are marked without model calls

- **WHEN** the replay encounters a drop row noted self-loop or human-reverse, a structural row whose from-node survives, a row whose from-node was merged away (e.g. `fish sauce::type-sea-salt -[general]-> fish sauce`), or a row whose term does not parse
- **THEN** each is marked replayed with its reason and no classifier call is spent

#### Scenario: The replay is one-shot and self-quiescing

- **WHEN** every pre-existing drop row carries the replay mark and new drop rows are born-marked
- **THEN** the pass selects nothing and spends no model calls, and a partially-completed tick resumes exactly where it stopped (unmarked rows only)

### Requirement: Alias target convergence

The sku-cache re-key pass SHALL, in the same scheduled tick and with plain code and no model calls, re-point every `ingredient_alias` row whose stored `id` no longer survives the representative chain: the target is the id reached by chasing `representative` pointers over the identity rows only — the alias front-door SHALL NOT be consulted for the target — and a row is rewritten only when the chased survivor differs from the stored `id`. The step SHALL retarget only rows the alias re-audit no longer owns — `audited_at` set, or `source='human'` (human rows are never audit-selected) — leaving un-audited auto rows untouched: those are re-pointed by the re-audit's own re-decision, and racing it could overwrite a same-tick re-decision with a stale chase that, with both rows then stamped, would never be revisited. The re-point SHALL write only the `id` column, preserving `source`, `confidence`, `decided_at`, and `audited_at` (key maintenance, not a re-decision), and SHALL NOT append per-row normalization-log entries; the pass's job summary SHALL carry an additive `alias_retargeted` count as the audit trail. The step SHALL be idempotent (a pass over converged rows writes nothing), bounded per tick with the deferred remainder flagged `truncated` and converged on later ticks, and an alias `id` absent from the identity registry SHALL be left unchanged.

#### Scenario: A loser-targeted alias converges through the chain

- **WHEN** an audited (or human-sourced) alias row's stored `id` is a merged-away node (including a retired multi-segment id re-rooted by segment repair) whose representative chain ends at a survivor
- **THEN** the next tick rewrites the row's `id` to the surviving id, leaving `source`, `confidence`, `decided_at`, and `audited_at` unchanged and writing no normalization-log entry

#### Scenario: A self-alias of a merged node becomes a real mapping

- **WHEN** an audited row whose `variant` equals its stored `id` points at a node that was merged into a survivor
- **THEN** the row is re-pointed to the survivor, becoming a `variant → survivor` mapping whose variant no longer equals its target

#### Scenario: Un-audited auto rows stay with the re-audit

- **WHEN** an alias row with `source='auto'` and a NULL `audited_at` points at a merged-away node
- **THEN** the retarget step does not touch it, and the row converges through the alias re-audit's own re-decision (which stamps it, making any later drift this step's to maintain)

#### Scenario: Converged rows are untouched

- **WHEN** the pass runs over rows whose stored `id` already resolves to itself, or whose `id` has no identity row at all
- **THEN** it plans no alias writes and the tick's `alias_retargeted` count is zero

#### Scenario: The retarget count is visible as work

- **WHEN** a tick re-points at least one alias row
- **THEN** the run's job summary reports the count under `alias_retargeted` and the tick is presented as work performed, not a settled no-op

### Requirement: Disjunctive terms resolve to satisfaction concepts

A surface term or canonical id containing the standalone disjunctive token ` or ` (including comma-separated lists ending in ` or `) SHALL never be confirmed or minted as a concrete identity — a disjunction "X or Y" is a satisfaction constraint, not a product. The capture job SHALL dispose a pattern-matching queued term deterministically, with no classifier call, AFTER the lexical fast path and BEFORE the similarity floor: mint an abstract concept node (`concrete=0`) under the cleaned term verbatim, with the node's `search_term` set to the FIRST disjunct (so the matcher's search phrase is always a member phrase, never the disjunctive phrase), the term's embedding stored, and the surface form aliased to it. Disjunct terms SHALL be derived by plain code splitting on the token with head-noun distribution — the final fragment's tokens after its first token are appended to any fragment with fewer tokens than the final fragment. The `and`-compound and slash (`X/Y`) forms SHALL NOT match the pattern (and-compounds are real products; slash forms collide with protected ratio qualifiers). The confirm prompt SHALL state that a disjunctive term or canonical is never a concrete product, and a classifier-proposed NOVEL canonical matching the pattern SHALL be rejected to the verbatim fallback with the rejection recorded in the log detail. The alias re-audit SHALL apply the same deterministic disposal to an eligible pattern-matching variant — re-pointed to its disjunction concept (minted when absent) with no model call, stamped, and logged with the audit marker.

#### Scenario: A disjunctive term captures as an abstract concept with no model call

- **WHEN** the queued term `white or yellow onion` is drained and does not hit the lexical fast path
- **THEN** an abstract node `white or yellow onion` (`concrete=0`, `search_term` `white onion`) is minted with its embedding, the alias is written, no classifier call is spent, and the decision is logged with a disjunction marker and the disjunct list

#### Scenario: Head-noun distribution splits the disjuncts

- **WHEN** the splitter processes `white or yellow onion`, `anaheim or cubanelle peppers`, and `olive oil or butter`
- **THEN** it yields `white onion`/`yellow onion` and `anaheim peppers`/`cubanelle peppers` (the shared head noun distributed onto the shorter fragments), while `olive oil`/`butter` split verbatim (no fragment is shorter than the final one)

#### Scenario: The lexical fast path still wins over the gate

- **WHEN** a punctuation-only variant of an existing disjunction concept is queued
- **THEN** it resolves SAME to that concept through the lexical fast path and no second concept is minted

#### Scenario: And-compounds stay concrete

- **WHEN** `half and half` or `pecans (halved and pieces)` is queued
- **THEN** the disjunction gate does not match and the term proceeds through the normal floor/confirm flow as a buyable product

#### Scenario: A disjunctive classifier canonical is rejected

- **WHEN** the confirm returns NOVEL for a non-disjunctive term with a proposed canonical of the form `X or Y`
- **THEN** the canonical is rejected (reason recorded), the node is minted under the verbatim term, and no disjunctive concrete identity is created

#### Scenario: The alias re-audit disposes a disjunctive variant deterministically

- **WHEN** the re-audit selects an un-audited `source='auto'` alias whose variant matches the disjunctive pattern
- **THEN** the variant is re-pointed to its disjunction concept (minted abstract when absent) with no classifier call, the row is stamped, and the disposal is logged with the audit marker

### Requirement: Disjunction membership reconcile

The capture job SHALL run a deterministic per-tick sub-pass (no model calls, bounded writes, runs even on an empty queue) that, for every surviving abstract node whose id matches the disjunctive pattern, recomputes the disjunct terms from the id and resolves each through the full front door (exact alias lookup plus the representative chain). A disjunct resolving to a surviving id other than the concept SHALL gain a `membership` satisfies-edge from the member to the concept — inserted born-stamped, skipped when any edge already stands between the pair in either direction, and logged. A disjunct that does not resolve SHALL be enqueued to the novel-term queue (insert-or-ignore, best-effort, never failing the tick) on every tick until the capture job places it, so member edges converge organically with no manual backfill. The sub-pass SHALL be idempotent — a converged registry plans no writes.

#### Scenario: A member edge appears once the disjunct is captured

- **WHEN** the disjunct `serrano peppers` resolves through the front door to a surviving node after a capture tick places it
- **THEN** the next reconcile tick inserts `serrano peppers`'s survivor `-[membership]→ serrano or jalapeño peppers` born-stamped, logs the insertion, and a rerun inserts nothing

#### Scenario: Unresolved disjuncts are enqueued until placed

- **WHEN** a disjunction concept's disjunct has no front-door resolution
- **THEN** the term is enqueued insert-or-ignore each tick, and once the capture job resolves it the enqueue stops and the member edge is inserted instead

#### Scenario: Members satisfy the concept line at read time

- **WHEN** a pantry holds a member of a disjunction concept and `satisfiesAmong` is queried over the pantry set plus the concept id
- **THEN** the member → concept membership edge is returned (representative-resolved), so the consumer sees the pantry item fulfilling the disjunctive line

### Requirement: Retroactive disjunction shape sweep

The same sub-pass SHALL converge existing wrongly-concrete disjunction nodes with no operator action and no manual data edits: every surviving `source='auto'` `concrete=1` node whose id matches the disjunctive pattern is repaired — a bare node is FLIPPED (`concrete=0`, `search_term` = first disjunct); a `::detail` child of a disjunctive base is FOLDED into the (flipped) base via the representative pointer; a family whose base was merged INTO its own child is RE-ROOTED at the base (clear the base's representative, point the child at it, flip the base) in one atomic batch; a child whose base node is missing has the base MINTED abstract (embedding NULL, backfilled) and the child pointed at it. Every repair SHALL be logged. `source='human'` nodes SHALL never be flipped or folded (skipped and counted). Existing aliases SHALL keep resolving through the resulting chain, and dependent keys (grocery/pantry `normalized_name`, `sku_cache`, stored alias targets) SHALL converge through the existing reconciles. The sweep SHALL be self-quiescing with no new stamp: repaired rows no longer match the selection predicate (`concrete=1` and surviving), so a converged registry selects nothing.

#### Scenario: The production families converge organically

- **WHEN** the sweep first runs over production, which holds `white or yellow onion` and `anaheim or cubanelle peppers` (bare concrete disjunctions) and the serrano family (base merged into its surviving `::form-diced` child)
- **THEN** the two bare nodes flip abstract with member-phrase search terms, the serrano family re-roots at the abstract base with the child folded into it, both serrano aliases resolve to the base, and a second pass plans nothing

#### Scenario: The structural-edge churn loop quiesces after the fold

- **WHEN** the fold makes the disjunction child a non-survivor while its old structural edge to the base still stands
- **THEN** the edge-audit pre-pass sweeps that edge as a representative-resolved self-loop at most once more and the structural guarantee does not re-insert it (the child no longer survives), ending the per-tick delete/re-insert cycle

#### Scenario: Human-pinned disjunctive nodes are immune

- **WHEN** the sweep encounters a pattern-matching node with `source='human'`
- **THEN** it is skipped and counted, never flipped, folded, or re-rooted

#### Scenario: Dependent rows converge through the existing reconciles

- **WHEN** a grocery or pantry row's `normalized_name` is a folded child's id
- **THEN** the existing grocery/pantry re-key reconcile converges it to the surviving abstract base on a later tick, with no writes from the sweep itself

### Requirement: Concept-concrete merge guard

A representative merge SHALL NOT be proposed between a concept node (`concrete=0`) and a concrete node by the merge-proposing passes: the SKU co-resolution pass SHALL skip a candidate pair whose surviving ids differ in `concrete` (a member and its concept legitimately co-resolve to one SKU once a concept-keyed cache row exists — shared SKU is not synonym evidence across the concrete boundary), counted in the job summary with no confirm call spent; and the re-confirm pass SHALL reject a `same` outcome whose survivor is a concept node to a logged no-op (the node stamped, nothing merged). The merge primitive itself SHALL remain general (deterministic shape repairs may merge across the boundary by design).

#### Scenario: A mixed-concreteness co-resolution pair is skipped

- **WHEN** a concept-keyed `sku_cache` row and a member's row resolve to the same SKU and surface as a co-resolution candidate pair
- **THEN** the pass skips the pair before any confirm call, counts the skip, and no merge is proposed

#### Scenario: Re-confirm cannot merge a concrete node into a concept

- **WHEN** the re-confirm's classifier returns `same` for an eligible concrete node against a concept-node candidate
- **THEN** no merge is written — the node is stamped and the rejection is logged with the outcome and candidate

### Requirement: Retroactive lexical-twin merge reconcile

The capture job SHALL include a bounded, deterministic per-tick reconcile (no model calls, running even on an empty queue) that converges surviving lexical twins: two surviving nodes whose ids share one lexical form are the same product by the same mechanical evidence the lexical fast path acts on, so the pair SHALL be merged via the representative pointer. The pass SHALL merge only pairs where both nodes are auto-sourced and both share the same concreteness (both concrete or both concept); a pair involving a human-sourced node, a pair of mixed concreteness (consistent with the concept-concrete merge guard), and a lexical form shared by three or more survivors SHALL be skipped and counted, never guessed. The survivor SHALL be the lexicographically smaller id (the co-resolution auto/auto convention; for suffix twins this prefers the singular), so a rerun is stable and independent of mutable alias state. The pass SHALL be bounded per tick, SHALL log each merge through the standard merge machinery, SHALL count merges and deliberate skips in the job summary, and SHALL leave a transiently-failed merge unmerged for a later tick (unmerged is the retry state). Merged losers leave the surviving set, so the pass self-quiesces; dependent aliases, edges, and keyed surfaces SHALL converge through the existing representative-chain machinery, never by key rewrites in this pass.

#### Scenario: A plural twin pair collapses to the singular survivor

- **WHEN** `onion` and `onions` both survive as auto concrete nodes sharing one lexical form
- **THEN** the reconcile merges `onions` into `onion` (the lexicographically smaller id) with no classifier call, and the merge is counted in the job summary

#### Scenario: Twin abstract concepts merge

- **WHEN** `chile` and `chiles` both survive as auto concept nodes (`concrete = 0`) sharing one lexical form
- **THEN** the reconcile merges `chiles` into `chile`, consolidating the duplicated membership fan-in through representative resolution

#### Scenario: Mixed concreteness never merges

- **WHEN** two surviving auto nodes share a lexical form but one is a concept and the other concrete
- **THEN** the pair is skipped and counted, and no merge is written

#### Scenario: Human nodes never merge away

- **WHEN** a surviving human-sourced node shares a lexical form with a surviving auto node
- **THEN** the pair is skipped and counted, and neither node is merged

#### Scenario: An ambiguous lexical form is never guessed

- **WHEN** three or more surviving nodes share one lexical form
- **THEN** the group is skipped and counted, and no merge is written

#### Scenario: The reconcile self-quiesces

- **WHEN** the reconcile runs on a registry whose twins were merged on an earlier tick
- **THEN** it finds no surviving twin pair, writes nothing, and reports zero merges

#### Scenario: Bounded per tick

- **WHEN** more twin pairs survive than the per-tick cap
- **THEN** the pass merges at most the cap this tick and converges the remainder on later ticks

### Requirement: Capture-first taste-substitution edges

The identity graph SHALL support a `substitution` edge kind, distinct from the factual satisfies kinds (`general` / `containment` / `membership`), born from **deterministic backend observation** rather than model speculation. The concrete capture trigger is **agent-side, at the moment the member accepts the swap**: an `add_to_grocery_list` annotated with `substitutes_for` (the recipe ingredient X the added item stands in for). The write path SHALL resolve the added item to a canonical id Y and `substitutes_for` to X through the existing normalization pipeline, and — when Y ≠ X **and** Y is **not already an identity neighbor** of X (not reachable as a synonym / containment / membership sibling — pure set logic against the existing graph, no classifier) — record a candidate `substitution` edge X → Y. Detection SHALL be set logic only; the system SHALL NOT invent substitution edges from a small-model classifier over the corpus. The edge is **operator-global** (observations from different members accrue to one edge) and SHALL carry a **weight** that accrues on repeated observation (candidate → promoted, following the same conservative confidence-band discipline as the identity capture pass), and MAY carry an optional **qualifier** (a substitution ratio like `1:2`, a leavening or cook-time caveat) authored later — by a model when good enough, or left blank; a bare weighted edge is useful without one. Capture SHALL be **best-effort**: any resolution, read, or write failure SHALL be swallowed and SHALL NOT fail the grocery add it rides alongside.

#### Scenario: A cross-canonical accepted swap mints a candidate edge

- **WHEN** a member accepts a swap via `add_to_grocery_list(item, substitutes_for: X)` where the added item resolves to a canonical id Y that differs from X and is not an identity neighbor of X
- **THEN** a candidate `substitution` edge X → Y is recorded with initial weight

#### Scenario: A same-identity swap mints no substitution edge

- **WHEN** the `substitutes_for` add's item resolves to the same canonical id as X, or to an existing identity neighbor of X (a synonym/containment/membership relation)
- **THEN** no `substitution` edge is recorded — that is a product/price swap, not a taste substitution

#### Scenario: Repeated observation promotes the edge

- **WHEN** the same cross-canonical swap X → Y is accepted again
- **THEN** the edge's weight accrues and it promotes past the candidate threshold, still without a required qualifier

#### Scenario: A qualifier is annotation, not a gate

- **WHEN** a promoted `substitution` edge has no qualifier
- **THEN** it is still surfaced as a suggestion; a qualifier MAY be authored later and never blocks the edge's use

#### Scenario: A capture failure never fails the grocery add

- **WHEN** the substitution capture fails (a resolution error, an identity-graph read error, or the edge write fails) while an item is being added with `substitutes_for`
- **THEN** the grocery add still succeeds and the failure is swallowed — the capture is best-effort, never a gate on the primary operation

### Requirement: Substitution edges are excluded from satisfies() reachability

A `substitution` edge SHALL NOT participate in `satisfies(have, want)` reachability. It SHALL NOT gate or complete a Kroger match, SHALL NOT cause a purchase, and SHALL NOT be treated as identity — a substitute is a taste judgment ("A can stand in for B, with caveats"), not "having A satisfies a request for B." `substitution` edges SHALL surface only as **labeled read-time suggestions** (the depth-1 walk of the `member-app-differentiators` capability), where the narrower — the member or the LLM — decides fitness. This keeps the substitution *decision* at read-time reasoning and keeps identity separable from substitution, consistent with ADR-0001's open-world-hint stance (a missing or wrong edge degrades to world knowledge).

#### Scenario: satisfies() ignores substitution edges

- **WHEN** `satisfies(have, want)` is evaluated and the only path from `have` to `want` is a `substitution` edge
- **THEN** `satisfies` returns false — the substitution never completes a match or causes a purchase

#### Scenario: A substitution surfaces as a labeled suggestion only

- **WHEN** a resolved ingredient has an outgoing promoted `substitution` edge
- **THEN** the target surfaces as a labeled substitution suggestion for the narrower, not as an automatic swap

### Requirement: Substitution edges are excluded from the identity edge audit

Because captured `substitution` edges are written into the same `ingredient_edge` table as the factual satisfies edges, the rolling edge-audit passes SHALL exclude them **by kind**. A `substitution` edge SHALL NOT be selected by the edge re-audit batch, SHALL NOT appear in the audit's reverse-pair lookup set, SHALL NOT trip the commit-time reverse-exists 2-cycle guard against a factual edge, SHALL NOT count a concrete node as connected for the re-confirm edgeless probe, and SHALL NOT be counted in the un-audited edge backlog. The operator Nodes/Normalization admin lenses SHALL likewise exclude `substitution` edges from their satisfies-adjacency, orphan detection, and `satisfies` edge count. This keeps the satisfies-edge audit — whose direction check can DELETE an edge — from ever selecting or deleting a captured substitution edge, keeps the orphan audit from masking a below-floor concrete node behind a substitution edge, and keeps the audit backlog converging (a substitution edge is never audited, so it never carries an `audited_at` stamp).

#### Scenario: The edge re-audit never selects a substitution edge

- **WHEN** the edge-audit batch is read for auto, un-audited edges and a `substitution` edge is auto and un-audited
- **THEN** the substitution edge is not in the batch — the satisfies-direction re-audit can never select or delete it

#### Scenario: The orphan audit is not masked by a substitution edge

- **WHEN** a concrete node has no factual satisfies edge but is the endpoint of a `substitution` edge
- **THEN** the Nodes lens still reports it as an orphan and the un-audited edge backlog count omits the substitution edge

