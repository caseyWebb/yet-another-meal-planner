# Proposal — home-derivable-form-collapse

## Why

Issue #215: pantry **Lime** does not satisfy the recipe ingredient **`lime::form-wedges`**. This is live in production right now — two recipes (`chicken-and-black-bean-stew`, `crispy-tofu-with-peanut-sauce`) carry `lime::form-wedges` in `perishable_ingredients`, and a member's pantry holds `lime` — so the pantry lime is invisible to `pantryOverlap`, `diversify`, and use-it-up, all of which deliberately join on **exact resolved-id equality** with no edge traversal (the ingredient-normalization spec keeps `satisfies()` closure out of tools by design).

The mint was legal under today's rules: the confirm treats a "form" qualifier as a load-bearing detail. But **lime wedges are knife work on a lime** — the shopper buys a lime, not wedges. The prep-versus-product rule already strips "diced"/"minced"/"shredded"; it just doesn't reach *named cut forms*. The ratified principle closes that gap: **a `::detail` is legitimate only when it names a purchasable distinction** (you can buy pickle chips → `pickles::form-chips` stays; you cannot buy lime wedges → collapses to `lime`). The purchasability judgment is per-product, not a word list — "diced tomatoes" is a canned shelf SKU and stays a specialization, while "diced yellow onion" strips, resolving the standing tension between the prep word list and the preserved `form-diced` example.

The counter-invariant from the issue is equally load-bearing: **`lime juice` must never auto-satisfy `lime`**. Juice is a home-derived *extraction* that is also a distinct purchasable product (bottled); it stays a distinct base, reachable only as an explicit *suggestion* (the depth-1 substitution walk or read-time reasoning), never by id equality.

The production census (design.md spike) shows the blast radius is tiny and the fix is almost entirely a **rule** change: of 107 surviving detail nodes, only the two lime forms (`lime::form-wedges`, `lime::form-zest`) are home-derivable by the purchasability test — everything else (canned, dried, pickled, ground, freeze-dried, varietal, brand forms) names a real shelf product and must keep its distinction.

## What Changes

- **Confirm-prompt hardening** (`src/ingredient-classify.ts`): the prep-versus-product rule becomes the **purchasable-distinction test** — a cut/prep form the shopper derives at home from the purchased base (wedges, slices, quarters, zest) resolves SAME to the base; a form that names a distinct shelf product specializes; the same word may dispose either way by product (diced tomatoes vs diced yellow onion); a home-derived extraction that is also a distinct purchasable product (lime juice) is NEVER SAME to the base in either direction. New few-shot examples pin the three cases. The one shared confirm serves capture and the alias re-audit alike, so the rule applies at both.
- **Re-audit gate re-open** (one D1 migration): clear `audited_at` on `source='auto'` `ingredient_alias` rows whose target id contains a detail segment (113 rows in production), so the **existing** rolling alias re-audit re-decides the standing detail-node backlog under the hardened rule. No new pass, no new machinery, no manual data surgery.
- **Convergence rides existing machinery only**: a home-derivable mapping re-points to its base → the stranded detail node merges into the base via the representative pointer → its structural edge is swept as a representative-resolved self-loop by the edge-audit pre-pass → dependent keys (recipe facets, `sku_cache`, grocery/pantry `normalized_name`, alias targets) converge through the standing reconciles. A purchasable mapping re-derives its standing mapping and is kept + re-stamped (no churn).
- **No new edge semantics, no traversal engine, no matching-code change, no tool change.** Pantry `lime` then satisfies the recipe by plain resolved-id equality.
- The observed defect rows are the change's **acceptance fixture**, verified against production after deploy (design.md lists the read-only verification queries).

## Capabilities

### Modified Capabilities

- **`ingredient-normalization`** — the "Conservative collapse and prep-versus-product stripping" requirement's qualifier judgment becomes the **purchasable-distinction test** (per-product purchasability, not a word list; the lime-juice never-collapse carve-out). The "Structural edge guarantee" is clarified as **survival-agnostic** (it asserts edges for whatever detail nodes survive; which details *should* survive is owned by capture/re-audit — and a collapsed node's structural edge is swept, never re-inserted), with its stale scenario example refreshed. A new requirement covers the **one-time re-audit re-opening** (the migration clearing the audit stamps on detail-target auto aliases) and the expected organic convergence, with issue #215's rows as the acceptance fixture and the lime-juice equality invariant as a scenario.

## Impact

- **Worker:** `src/ingredient-classify.ts` only — the confirm `SYSTEM_PROMPT` rule text + `FEW_SHOT` additions. No changes to `ingredient-normalize.ts`, `ingredient-alias-audit.ts`, `ingredient-edge-audit.ts`, or any matching/read path — the convergence is entirely data-driven through the re-opened audit.
- **One D1 migration:** `packages/worker/migrations/d1/0043_reopen_detail_alias_audit.sql` (next available) — `UPDATE ingredient_alias SET audited_at = NULL WHERE source='auto' AND id LIKE '%::%'`. Data-gate change only; no schema shape change.
- **Tests:** unit fixtures for the alias re-audit's SAME-onto-base re-point + stranded-node merge in the lime shape; live-test hard cases (`lime wedges` → SAME `lime`; `diced tomatoes` stays a specialization; `lime juice` stays NOVEL/distinct) in `test/ingredient-normalize.live.test.ts`.
- **Docs: no drift.** No tool param/return change (`docs/TOOLS.md`), no file/D1 shape change (`docs/SCHEMAS.md` — the migration writes data, adds no columns), no architectural shift (`docs/ARCHITECTURE.md`).
- **Budget:** ≤113 classifier confirms worked through the re-audit's existing per-tick bound on the internal `env.AI`/D1 bucket, then the pass re-quiesces (born-stamped writes are untouched).
