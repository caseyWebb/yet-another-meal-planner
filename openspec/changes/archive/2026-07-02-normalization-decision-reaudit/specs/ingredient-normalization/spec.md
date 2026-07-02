## ADDED Requirements

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

## MODIFIED Requirements

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
