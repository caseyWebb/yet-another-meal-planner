# ingredient-normalization Specification

## Purpose
TBD - created by archiving change organic-ingredient-normalization. Update Purpose after archive.
## Requirements
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

The system SHALL NOT collapse two terms into one identity on embedding similarity alone; only the classifier confirm SHALL create an alias-to-existing id. The confirm SHALL be biased toward **SPECIALIZATION or NOVEL on any doubt**, because a missed alias (fragmentation) is cheap and self-healing on a later tick while a wrong collapse is silent and costly (a wrong purchase). A qualifier SHALL be treated as load-bearing (→ SPECIALIZATION) only when it changes *which product a shopper would buy* (fat ratio, flour type, egg size, cut); a **preparation** qualifier that does not change the SKU ("diced", "minced", "shredded", "softened") SHALL strip to the base. The confirm SHALL NOT collapse across a distinct-base boundary even at high similarity (`baking-soda` ≠ `baking-powder`; `chicken-broth` ≠ `vegetable-broth`; `heavy-cream` ≠ `half-and-half`). A **distinct product** SHALL NOT be recorded as a SPECIALIZATION of a superficially-similar candidate — a specialization's detail narrows the SAME product, it never attaches a different product to a lookalike base (dried dates are not a variety of a dried-fruit blend; canned salmon is not a form of fresh skin-on fillets; a loaf of bread is not a type of bread flour; a finishing salt is not a kind of fish sauce) — the confirm prompt SHALL state this rule with counter-examples.

#### Scenario: High similarity does not force a collapse

- **WHEN** `"baking powder"` is queued and cosines very near `baking-soda`
- **THEN** the confirm returns NOVEL (distinct base) and no alias between them is written

#### Scenario: Preparation qualifier strips to base

- **WHEN** `"diced yellow onion"` is queued
- **THEN** it resolves to base `yellow-onion` (the dice is a preparation, not a product qualifier) rather than minting `yellow-onion::diced`

#### Scenario: Doubt defaults to preserving the distinction

- **WHEN** the classifier is uncertain whether a qualified term is an alias of or a specialization of a candidate
- **THEN** it specializes (preserving the qualifier) rather than collapsing, so no distinction is destroyed

#### Scenario: A distinct product is not a lookalike's specialization

- **WHEN** `"dried medjool dates"` is queued and its nearest candidate is `dried fruit blend`
- **THEN** the confirm returns NOVEL (a distinct product), not a SPECIALIZATION like `dried fruit blend::type-medjool-dates`

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

The system SHALL run a scheduled alias re-audit pass over `source='auto'` alias mappings that carry no audit stamp, bounded per tick and oldest-decided first, that converges pre-hardening decisions to the hardened rules with no operator action. A **self-alias** (the variant string equals the row's node id — the alias every mint writes for its own node) SHALL be stamped audited deterministically, with no embedding and no model call. **Every other** eligible mapping SHALL be re-decided by the hardened classifier confirm — candidates retrieved from the current registry by cosine over the variant's embedding, always including the currently-mapped (representative-resolved) node — with the confirm-distance guard applied to the pick exactly as at capture (a distant pick rejects to a verbatim NOVEL mint). The re-decision SHALL be applied via existing primitives only: re-pointing the alias (auto source, fresh `decided_at`), minting a node (canonical-id synthesis applies), or a `representative` merge — never deleting a node and never touching a `source='human'` row. When an applied re-point strands a `source='auto'` node with no remaining aliases, the pass SHALL merge that node into the re-decision's resolved node so it leaves the retrieval set. Every classifier re-decision SHALL be appended to the normalization log with an audit marker and the previous mapping in its detail. A contract-invalid confirm SHALL keep the existing mapping and stamp it (never destroy on an undecidable); a transient failure SHALL leave the row un-stamped for a later tick. Alias rows written by capture, re-confirm, and the re-audit itself SHALL be born already-stamped, so the pass drains its backlog and quiesces to a no-op.

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

### Requirement: Rolling re-audit of auto satisfies edges

The system SHALL run a scheduled edge re-audit pass over `source='auto'` edges that carry no audit stamp, bounded per tick, correcting the pre-hardening edge backlog. An edge whose endpoints resolve to the same node through the `representative` pointer SHALL be deleted deterministically, with no model call. An edge whose resolved reverse pair exists (any kind) SHALL be resolved: against a `source='human'` reverse edge the auto edge is deleted deterministically (human authority); otherwise one classifier direction-check ("does having FROM satisfy a request for TO?", under the hardened distinct-product rules) SHALL decide — the edge(s) matching the answered direction are kept and stamped, the rest deleted, with mutual satisfaction keeping both and "neither" deleting both. A standing edge SHALL be validated by the same direction check and deleted when the FROM→TO direction does not hold. `source='human'` edges SHALL never be selected or deleted. Every deletion SHALL be logged (an edge-audit outcome with the direction verdict in its detail); a contract-invalid check SHALL keep the edge and stamp it; a transient failure SHALL leave the edge un-stamped for a later tick. Edges written by capture and re-confirm SHALL be born already-stamped, so the pass drains its backlog and quiesces to a no-op.

#### Scenario: A representative-resolved self-loop is deleted with no model call

- **WHEN** an auto edge's endpoints resolve to the same surviving node
- **THEN** the edge is deleted outright, the deletion is logged, and no classifier call is spent

#### Scenario: A 2-cycle is resolved by one direction check

- **WHEN** the pass audits `whole cardamom pods -[containment]→ ground cardamom` while `ground cardamom -[general]→ whole cardamom pods` also exists (both auto) and the direction check answers that only whole-satisfies-ground holds
- **THEN** the containment edge is kept and stamped, the reverse edge is deleted, and one classifier call was spent on the pair

#### Scenario: A human reverse edge wins deterministically

- **WHEN** an auto edge's resolved reverse pair exists as a `source='human'` edge
- **THEN** the auto edge is deleted with no model call and the human edge is untouched

#### Scenario: A wrong-satisfies standing edge is dropped

- **WHEN** the direction check for `spaghetti -[general]→ rigatoni` (or `garlic powder -[membership]→ italian seasoning`) answers that FROM does not satisfy a request for TO
- **THEN** the edge is deleted and the drop is logged with the verdict

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
