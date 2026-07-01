## ADDED Requirements

### Requirement: Periodic re-confirm of under-connected nodes

The system SHALL run a scheduled **re-confirm pass** that re-examines eligible under-connected identity nodes against the current registry and **enriches** them, so a node minted before its neighbors existed (a below-floor no-LLM mint) gains the `satisfies` edges — or the synonym merge — that could not exist at mint time. The pass SHALL be **strictly non-destructive to the graph's correctness**: it may only ADD edges or MERGE a node into a clear synonym survivor; it SHALL NOT remove or downgrade an edge, split a node, change a node's canonical id (beyond a `representative` merge), or override a human decision. A node SHALL be **eligible** only when it is `source='auto'`, `concrete=true`, has no incoming or outgoing edge, and has not yet been re-confirmed (a null re-confirm stamp); `source='human'` nodes SHALL never be selected. Each eligible node SHALL be re-confirmed **at most once** and then stamped, so the pass drains its backlog and **quiesces to a no-op** (preserving the steady-state ≈0 LLM calls). The pass SHALL be **bounded per tick**, share the internal `env.AI`/D1 budget, record a `job_health` row, and append each decision to the normalization log **distinguished from an initial-capture decision**. It SHALL reuse the SAME classifier confirm + conservative-collapse bias as the capture job — a doubtful merge is not made.

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

#### Scenario: Failures never make a node worse

- **WHEN** re-confirming a node hits a transient `env.AI`/D1 error
- **THEN** the node is skipped with its re-confirm stamp left null (retried a later tick), nothing is partially written; and **WHEN** the confirm is contract-invalid **THEN** the pass fails safe to a no-op (stamp it, change nothing) rather than introducing an edge or merge

#### Scenario: Re-confirm does not change a node's canonical id in v1

- **WHEN** the confirm judges an eligible bare node to be a specialization of a known base (it should arguably become `base::detail`)
- **THEN** the pass takes only the safe subset — it adds a `general` edge from the node to that base if present — and leaves the node's canonical id unchanged (a full id-changing re-home is out of scope)
