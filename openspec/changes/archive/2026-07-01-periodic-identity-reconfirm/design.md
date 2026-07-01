# Design — periodic identity re-confirm

The pass is a near-mirror of the capture job (`ingredient-normalize.ts`): drain a bounded batch, embed, retrieve neighbors, confirm, commit — the difference is *what* it drains (already-resolved under-connected nodes, not the novel-term queue) and that it must **never make things worse**. The decisions below are where that "never worse" is earned.

## D1 — Eligibility: edgeless concrete auto-nodes, stamped once

**What's eligible:** a node with `source='auto'`, `concrete=true`, **no edges** (neither `from_id` nor `to_id` in `ingredient_edge`), and a null `reconfirmed_at`. This is exactly the below-floor no-LLM population — a bare NOVEL mint has `edges: []` by construction — plus any concrete auto-node the capture confirm left edgeless. A node with edges is already connected; a `source='human'` node is authoritative; both are skipped.

**Why a stamp, not a queue.** Eligibility is *derivable* from the graph (edgeless + auto + un-stamped), so a separate queue would just duplicate state that can drift. A single `reconfirmed_at` column on `ingredient_identity` is the whole mechanism: the pass selects `WHERE source='auto' AND concrete=1 AND reconfirmed_at IS NULL AND <no edge>` (oldest `decided_at` first), and stamps `reconfirmed_at` after processing. That makes it **one-shot per node and self-quiescing** — once every eligible node is stamped, the select returns nothing and the pass is a cheap no-op, so the ≈0-LLM steady state holds.

**Re-eligibility (the growth question).** A node stamped while the graph was *still* fairly sparse might benefit from another look once the graph is much denser. v1 keeps it **one-shot** (stamp = done) for simplicity and a hard cost ceiling; a coarse re-eligibility (clear the stamp when the registry has grown by a large factor since it was set) is a **tuning open question**, not v1 — a `reconfirmed_at` timestamp is enough to add it later without a migration. Deferring it is safe because a still-edgeless node after re-confirm is genuinely isolated (world knowledge found no neighbors), and read-time reasoning still covers it.

## D2 — Actions: enrich, or merge via representative — never re-id

Per node the pass runs the **same `confirmIdentity`** the capture job uses (term vs the retrieved neighbors), then:

- **edges** from the confirm are committed onto the node — the core job (`kielbasa → sausage`). Additive only; re-confirm **never removes or downgrades** an edge.
- **`outcome: same`** → `mergeIdentities(loser=this node, survivor=match)` — the existing union-find `representative` pointer. This is re-key-free at the graph level (ids are append-only; the resolver resolves `this → survivor` transitively) and the data rows converge through the grocery/pantry re-key reconcile that already ships. Gated by the **same conservative-collapse bias** as capture (only a truly-interchangeable synonym; doubt → no merge).
- **`outcome: specialization`** → v1 does **not** re-home the node to `base::detail` (that changes its canonical id and is a bigger blast radius). Instead it takes the *safe subset*: add a `general` edge from this node to the matched base if that base is a known node (enrichment), and leave the id alone. Full re-home is a deferred extension.
- **`outcome: novel`** (still novel) → commit any proposed edges, stamp, done.

**Why enrichment-first, no id-change.** The high-value, low-risk win is *connecting* an isolated node, and edges + representative-merges are both handled by infrastructure that already exists (the edge table, the `representative` pointer, the re-key reconcile). Changing a bare node's *canonical id* (bare → `base::detail`) is the one action with a wide blast radius that isn't already absorbed, so it's held back until there's evidence the enrichment path is insufficient. This keeps v1 strictly "enrich or merge, never fragment," which is the property that makes re-confirm safe to run unattended.

## D3 — Failure & conservatism (mirror the capture job)

- A transient `env.AI`/D1 error on a node → **skip it, leave `reconfirmed_at` null** (re-tried next tick), never a partial write. Unlike the capture queue there's no "defer" row — un-stamped *is* the re-try state.
- A contract-invalid confirm → **fail safe to no-op** (stamp it, change nothing) rather than inventing a merge. Re-confirm must never *introduce* a bad edge/merge to a node that was fine-if-isolated.
- **Human immunity is absolute:** `source='human'` nodes are never selected, and a `same`-merge never picks a human loser (only this auto node is ever the loser).

## D4 — Budget, ordering, observability

- **Bounded** `RECONFIRM_MAX_PER_TICK` nodes/tick, sharing the internal `env.AI`/D1 budget; embeddings via `embedTexts` (off the 50-subrequest cap), one confirm per node. Runs in `scheduled()` **after** the capture pass (so it sees the freshest registry) — but ordering isn't load-bearing since it re-runs each tick.
- **`job_health`** row `ingredient-reconfirm` (ok/fail + `{ reconfirmed, edges_added, merged, still_novel }` summary), exactly like `ingredient-normalize`.
- **Audit:** every decision appends to `ingredient_normalization_log` with a marker distinguishing it from initial capture (e.g. a `reconfirm` outcome-variant or a boolean), so the Normalization **Decisions** view can label it. The *visual* label + any related Normalization-area surfaces are designed in the companion Claude Design project, not here.

## Non-goals (restated)

- No id-changing re-home beyond a representative-merge (D2).
- No operator "re-confirm now" trigger; no accuracy benchmark/eval harness.
- Re-confirm only **adds edges or merges** — it never deletes edges, splits a node, or overrides a human decision.
