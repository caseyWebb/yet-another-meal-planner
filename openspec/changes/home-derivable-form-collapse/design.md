# Design — home-derivable-form-collapse

## Context

Issue #215 (opened by the operator, 2026-07-08): "Lime should satisfy Lime::Form-Wedges … the specialization is inherently a derivation of the general form (you don't buy lime wedges, you buy limes) … we must still not generalize too much: lime juice in the pantry should not satisfy the general limes or lime wedges. It can be *suggested* as a swap."

Ratified design principle (architect): a `::detail` specialization is legitimate only if it names a **purchasable distinction** (pickle chips: you can buy them → keep). A **home-derivable cut/prep form** (lime wedges: knife work on a lime) is NOT a detail — it collapses to the base product **at capture**, extending the existing prep-vs-product rule. Pantry `lime` then satisfies the recipe by **plain resolved-id equality** — no new edge semantics, no reverse-traversal engine (the spec explicitly keeps `satisfies()` closure out of tools).

Grounding (verified on current main):

- Canonical ids `base::detail`, prep-vs-product rule, distinct-base rule: `packages/worker/src/ingredient-classify.ts` `SYSTEM_PROMPT` (the PREPARATION rule at line ~74; distinct-product rules at ~68–69). The one `confirmIdentity` serves capture (`ingredient-normalize.ts`) and the alias re-audit (`ingredient-alias-audit.ts`) alike.
- A specialization mints `base::detail` + the directed `general` edge to its parent: `ingredient-normalize.ts` (`buildResolution`, ~line 376).
- Pantry/recipe matching is exact resolved-id set membership, no edge traversal: `semantic-search.ts` `pantryOverlap` (~158–183), `diversify.ts` (~194–216), `use-it-up.ts` (~74–89).
- The only edge traversal is the depth-1, suggestion-only substitution walk: `substitutions.ts` (read-only by construction; a suggestion reaches the cart only as an explicit override).
- The alias re-audit re-decides un-stamped `source='auto'` alias rows via the hardened confirm, re-points them, and **merges a stranded auto node** (no remaining aliases) into the re-decision's resolved node: `ingredient-alias-audit.ts` (the `merge` dep + `mergedOrphan` path). Its lexical fast path is built over **surviving node ids only** (a variant's own alias row deliberately can't short-circuit its own re-decision).
- The edge-audit pre-pass (a) deletes any auto edge whose endpoints resolve to the same survivor — **regardless of audit stamp** — and (b) re-inserts structural edges only for **surviving** `X::detail` nodes (spec "Structural edge guarantee").
- The hot-path resolver (`corpus-db.ts` `readResolver`) maps alias variants → representative-resolved survivors; `ids` holds survivors only. A term that stops resolving is enqueued by the projection capture funnel each tick.

## Production spikes (read-only, `npx wrangler d1 execute DB --remote`)

All queries were SELECT-only against the production `grocery-mcp` D1 (binding `DB`, per `packages/worker/wrangler.jsonc`).

**1. Detail-node census.** `SELECT id, source, representative, concrete, detail, search_term FROM ingredient_identity WHERE id LIKE '%::%'` → **107 rows** (of 668 total nodes; 6 merged). Full list reviewed against the purchasable-distinction test:

- **Home-derivable (collapse expected): 2** — `lime::form-wedges` (auto, surviving, search_term "lime wedges") and `lime::form-zest` (auto, surviving). Everything else names a shelf product.
- **Purchasable (keep): ~104** — canned/dried/pickled/ground/frozen/freeze-dried forms (`tuna::form-canned`, `thyme::form-dried`, `jalapeños::form-pickled`, `black pepper::form-ground`, `pineapple::form-freeze-dried`, `mussels::storage-frozen`…), varietals/types (`rice::type-basmati`, `olives::type-kalamata`, `cabbage::type-napa`…), product forms sold as their own SKU (`pickles::form-chips`, `graham crackers::form-crumbs`, `tomatoes::form-diced` — canned diced tomatoes, `cinnamon::form-sticks`, `sesame seeds::form-toasted`…), brand/flavor/quality (`chicken bouillon::brand-knorr`, `olive oil::quality-extra-virgin`…).
- **Human-sourced (immune): 2** — `lime::calamansi`, `salad::type-spring-mix`.
- One overflow relic already merged (`dried fruit::type-strawberry::form-freeze-dried` → its prefix), one concept (`berries::form-fresh`, `concrete=0`).

**2. The lime family.**

| id | source | representative | notes |
|---|---|---|---|
| `lime` | auto | — | the base |
| `lime::form-wedges` | auto | — | **the defect node** |
| `lime::form-zest` | auto | — | home-derivable sibling |
| `lime::calamansi` | human | — | immune |
| `lime juice` | auto | — | distinct base — must stay |
| `lime juice::type-key` | auto | — | purchasable (bottled key lime juice) |

Aliases (all stamped `audited_at`): `lime`→`lime`, `limes`→`lime`, `lime wedges`→`lime::form-wedges` (its **only** alias), `lime zest`→`lime::form-zest`, `lime form-zest`→`lime::form-zest`, `lime juice`→`lime juice`, `key lime juice`→`lime juice::type-key`, `calamansi`→`lime::calamansi` (human).

Edges (all auto, stamped): `lime::form-wedges -[general]→ lime`, `lime::form-zest -[general]→ lime`, `lime::calamansi -[general]→ lime`, `calamansi -[general]→ lime::calamansi`, `lime juice::type-key -[general]→ lime juice`. **No edge in either direction between `lime` and `lime juice`** — the substitution walk cannot currently suggest juice for lime; that stays as-is (read-time LLM reasoning can still suggest it; the issue only requires it never *auto-satisfy*).

Normalization-log history: `lime wedges` → specialization → `lime::form-wedges` (2026-07-08 tick); `lime zest` → novel `lime::form-zest`, then `lime form-zest` → specialization onto it; the structural edges arrived via `edge_restore` replays.

**3. Audit-stamp scope.** `SELECT COUNT(*), SUM(audited_at IS NOT NULL) FROM ingredient_alias a JOIN ingredient_identity i ON a.id=i.id WHERE a.source='auto' AND i.detail IS NOT NULL` → **113 / 113 stamped**. The re-audit backlog is fully drained — the pass is quiesced, so a rule change alone converges nothing. **This is why the migration is required.**

**4. The defect fixture rows.**
- Pantry: tenant `casey` holds `name="Limes", normalized_name="lime"`; tenant `everett` holds `name="lime juice", normalized_name="lime juice"` — production exercises **both** sides of the issue.
- Recipes: `chicken-and-black-bean-stew` and `crispy-tofu-with-peanut-sauce` carry `lime::form-wedges` in `perishable_ingredients` (D1 `recipes`); `crispy-tofu-with-peanut-sauce` also carries `lime juice` in `ingredients_full` — one recipe exercises the collapse AND the never-collapse invariant on adjacent lines.
- The `recipe_facets` snapshot stores the **resolved id** `lime::form-wedges` (classify-time resolution), not the surface phrase — this shapes the convergence path (D4).
- `sku_cache`: no lime-keyed rows (nothing to re-key).

## Decisions

### D1 — The fix is a confirm-prompt rule, not new code paths

The purchasable-distinction test replaces the word-list framing in `SYSTEM_PROMPT`'s PREPARATION rule: a qualifier is load-bearing only when the qualified form is a **different product on the shelf**; a cut/prep form the shopper derives at home from the purchased base (wedges, slices, quarters, zest) is SAME on the base; the same word disposes either way by product (diced tomatoes = canned SKU → specialization; diced yellow onion = knife work → same); a home-derived **extraction that is also a distinct purchasable product** (lime juice) is NEVER SAME to the base in either direction (it extends the existing distinct-base rule, not the prep rule). Two few-shot additions pin it: `"lime wedges"` over candidates `[lime, …]` → `{outcome: "same", match: "lime"}`; `"diced tomatoes"` over `[tomatoes, …]` → specialization `form-diced` (the purchasable contrast). The shared `confirmIdentity` means capture and the alias re-audit are hardened in one place.

Rejected alternative: a deterministic prep-word suffix stripper (e.g. strip trailing "wedges"). It re-creates the word-list problem the census disproves — "pickle **chips**", "cinnamon **sticks**", "graham cracker **crumbs**" are purchasable forms with cut-shaped names. Purchasability is a per-product judgment; per the architecture, the LLM does the fuzzy work once at capture and the result is retrieved deterministically forever.

### D2 — Convergence via re-opening the existing re-audit gate (one migration), not a new pass

Spike 3 shows all 113 detail-target alias rows are stamped: the re-audit has quiesced and will never revisit them. The convergence lever ratified for this class is a migration clearing the relevant gate. Migration `0043_reopen_detail_alias_audit.sql`:

```sql
UPDATE ingredient_alias SET audited_at = NULL
 WHERE source = 'auto' AND id LIKE '%::%';
```

- **Scope:** exactly the rows the rule change can re-dispose — auto aliases whose stored target carries a detail segment. Base-target rows are untouched (the hardening changes only the specialization judgment). Human rows are excluded twice over (the predicate AND the re-audit's own human-immunity).
- **Cost:** ≤113 confirms worked at the re-audit's existing per-tick bound on the internal `env.AI`/D1 bucket; the pass then re-quiesces (capture/re-audit writes stay born-stamped — this change does not alter that).
- **Expected outcomes:** ~110 keeps (the hardened confirm re-derives the standing mapping — a SAME on the survivor, a re-derived specialization, or a NOVEL canonical equal to it — applied as a keep + re-stamp per the existing "re-derives the standing mapping is a keep" rule; no churn), and the lime re-points (D3).
- Rejected alternatives: a new dedicated one-shot pass (duplicates the re-audit's selection/guard/logging machinery for zero benefit); clearing ALL auto alias stamps (re-spends hundreds of confirms on base-target rows the rule cannot affect); manual re-points/merges in production (off the table — masks whether the system can heal itself, and the fixture exists precisely to prove it can).

### D3 — Expected mechanical convergence of the lime family (all existing machinery)

1. Re-audit selects `lime wedges` → `lime::form-wedges` (un-stamped by 0042). The lexical fast path does not intercept (built over surviving **node ids** only: "lime wedges" folds to `lime wedge`; no node id folds to that — `lime::form-wedges` folds to `lime form wedge`). Cosine retrieval includes `lime` (near neighbor) and always includes the standing survivor; the hardened confirm returns SAME `lime` (well above `NORMALIZE_CONFIRM_MIN`).
2. The alias re-points to `lime` (fresh auto `decided_at`, re-stamped, logged with the audit marker + previous mapping). `lime::form-wedges` is stranded (its only alias moved) → the existing **stranded-orphan merge** sets its `representative = lime`.
3. The structural edge `lime::form-wedges -[general]→ lime` is now a representative-resolved self-loop → the edge-audit **pre-pass step (a)** deletes it (stamp-blind by spec), and **step (b)** never re-inserts (the from-node no longer survives).
4. `lime zest` → `lime::form-zest` re-decides likewise (expected SAME `lime` — zester work on the purchased fruit). The sibling alias `lime form-zest` **does** hit the re-audit lexical fast path (its fold `lime form zest` equals the node id's fold), so it keeps deterministically; `lime::form-zest` then retains one alias and survives un-merged. Accepted: the classifier owns zest's disposition, the defect fixture is wedges, and a surviving zest node harms nothing (its structural edge to `lime` stands for read-time reasoning). If its last alias later moves, the same stranded-merge converges it.
5. `lime juice`, `lime juice::type-key`, `lime::calamansi`: `lime juice` is a base-target row (not re-opened); `key lime juice` re-decides and re-derives its standing purchasable mapping (keep); `calamansi` is human (immune). **No path creates a `lime juice` ↔ `lime` merge or edge.**

### D4 — Dependent-key convergence, including the stale resolved-id facet snapshots

- **Recipe index:** the `recipe_facets` snapshot stores the resolved id `lime::form-wedges` (spike 4). After the merge that string stops resolving (it is not an alias variant and no longer a surviving id), so the **projection capture funnel** enqueues it; capture's hardened confirm disposes it SAME → `lime` (cosine-near, prep form), writing alias `lime::form-wedges → lime`; the next projection tick re-resolves the facet to `lime` in D1 `recipes`. Two organic round-trips, no backfill. (Had the snapshot held the surface phrase, the re-pointed `lime wedges` alias would converge it in one.)
- **`sku_cache` / grocery / pantry `normalized_name` / stored alias targets:** the standing re-key/retarget reconciles converge them through the representative chain; production currently has no lime-keyed `sku_cache` rows and the pantry row is already `lime` (nothing to move — the recipe side was the broken half).

### D5 — Risk posture

- **Under-collapse (classifier keeps `lime wedges`):** the standing mapping is kept + stamped — the defect persists but nothing breaks; the few-shot pins the case, and the live test asserts it against the real model. Failure mode is the status quo, not damage.
- **Over-collapse (classifier strips a purchasable form):** the danger case. Mitigations: the rule text names the contrast explicitly (diced tomatoes stays; juice never crosses); the "keep" path requires no model competence (re-deriving the standing mapping in any of three shapes counts as keep); the confirm-distance guard still gates any re-point; and the conservative-collapse bias (doubt → preserve the distinction) is restated adjacent to the new rule. Live-test hard cases cover `diced tomatoes` and `lime juice`.
- **`lime juice` invariant:** no matching code changes, so equality semantics cannot regress; the prompt carve-out prevents a capture-side collapse; no edge is minted between the bases by this change; the substitution walk remains suggestion-only. Encoded as a spec scenario and a post-deploy verification query.

## Acceptance fixture (verified against production after deploy, read-only)

1. `SELECT id FROM ingredient_alias WHERE variant='lime wedges'` → `lime` (auto, stamped, fresh `decided_at`).
2. `SELECT representative FROM ingredient_identity WHERE id='lime::form-wedges'` → `lime`.
3. `SELECT COUNT(*) FROM ingredient_edge WHERE from_id='lime::form-wedges'` → 0.
4. `SELECT perishable_ingredients FROM recipes WHERE slug IN ('chicken-and-black-bean-stew','crispy-tofu-with-peanut-sauce')` → contains `lime`, not `lime::form-wedges`.
5. Negative: `SELECT representative FROM ingredient_identity WHERE id='lime juice'` → NULL (unmerged); `SELECT id FROM ingredient_alias WHERE variant='lime juice'` → `lime juice`; `SELECT COUNT(*) FROM ingredient_edge WHERE (from_id='lime juice' AND to_id='lime') OR (from_id='lime' AND to_id='lime juice')` → 0.
6. Churn check: `SELECT COUNT(*) FROM ingredient_alias a JOIN ingredient_identity i ON a.id=i.id WHERE a.source='auto' AND i.detail IS NOT NULL AND a.audited_at IS NULL` → 0 once drained, with the purchasable mappings (`pickle chips`, `canned tuna`, `diced tomatoes`-class rows) still pointing at their detail nodes.
