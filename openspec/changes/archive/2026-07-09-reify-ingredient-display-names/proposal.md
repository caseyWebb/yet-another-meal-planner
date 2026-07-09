## Why

"What to show a human" is never stored anywhere in the system — a rendered ingredient name is either the raw string a member happened to type (preserved by luck) or synthesized on the fly from a canonical id (`labelOf(id)` → `base (detail)`), and the two keep leaking into each other. The member-app grocery list's inline substitute hints made the gap concrete: accepting a graph-sibling swap POSTs the sibling's canonical id (e.g. `cabbage::color-red`) as the row `name` so it resolves exactly for dedup — and the list then renders `cabbage::color-red` instead of "Red cabbage". Posting the sibling's `label` instead is worse: `labelOf(id)` is not a registered alias, so `resolve("cabbage (red)")` drifts to a garbage novel key and the row stops deduping against the sibling's identity. One field (`name`) is serving two masters — the human label **and** the sole input to the canonical key — and there is no third option because the key is a pure function of the displayed name.

This is a data-model gap, not a UI nit: the identity a surface dedups/joins on and the name it shows a human must be **separately stored**, with neither derived from the other at read time.

## What Changes

- **Reify a curated `display_name` on the ingredient identity graph.** `ingredient_identity` gains a nullable `display_name` column — the per-node human label — populated by the classifier at import (mirroring `search_term`: `COALESCE`-on-conflict, `source='human'` wins), overridable via `update_aliases`, and backfilled for the existing NULL backlog by a bounded reconcile pass. `labelOf(id)` becomes `row.display_name ?? (detail ? \`base (detail)\` : base)` — the synthesis becomes a fallback, not the source of truth.
- **Split display from key on grocery/pantry rows.** `grocery_list` and `pantry` gain a nullable `display_name` column. `name` keeps its current role (the member's surface form / resolver input); `normalized_name` stays the canonical key/PK; surfaces render `display_name ?? name`. Two surface forms that dedup to one row keep the surviving row's phrasing (pantry aligned to keep-first).
- **Thread the stored key into the in-memory item shapes.** `GroceryItem`/`PantryItem` carry `normalized_name` so the set-algebra (`findIndex`, advance/rollback, pantry `matches`) keys on the **stored** id instead of re-deriving `resolve(item.name)` — closing the second coupling that would otherwise break dedup whenever display ≠ `resolve(display)`.
- **Add-by-id write path.** `POST /api/grocery/items` accepts an optional canonical `id`; when present the key is the given id (validated as canonical, not re-resolved) and the display is the identity's curated `display_name`, so the member app can materialize a sibling swap with a clean name. When absent, today's behavior is unchanged.
- **Render the reified name at the audited read surfaces.** `read_grocery_list` and the **enriched** `read_to_buy` (new `display_name` field, incl. the two surfaces that render bare ids as human text today — `substitutes[].relation.via` and `placement.department`) show the curated label. The **default** `read_to_buy` output stays byte-identical.
- Docs (`SCHEMAS.md`, `ARCHITECTURE.md`) and a D1 migration adding `display_name` to the three tables land in the same change.

Not in scope (deferred to a follow-on): reifying store / aisle / department as first-class entities with their own display tables (Tier 3). `placement.department` is already an ingredient base id today, so its label falls out of this change; true store/aisle labels are a distinct data model.

## Capabilities

### New Capabilities
<!-- None — this change modifies existing specs only. -->

### Modified Capabilities
- `ingredient-normalization`: ADD a requirement reifying `display_name` as a first-class node attribute distinct from the canonical id (curated, classifier-at-import, `source='human'` override, reconcile backfill, inheriting the append-only-id invariant — the label is renameable precisely because the id is not). MODIFY the "Canonical nodes and the full-id join" requirement to decouple the "the string is a readable label" / "details are opaque labels" assertion.
- `grocery-list`: MODIFY the schema requirement's `name` gloss (currently "order-time search term") to name the reified `display_name`, and ADD a scenario for which display survives when two surface forms dedup to one row.
- `data-write-tools`: MODIFY the pantry write requirement for the `name` / `display_name` / `normalized_name` three-way split and keep-first merge.
- `member-app-grocery`: ADD how the to-buy view / enriched read surfaces `display_name`, preserving the shared-op byte-identical invariant on the default read.
- `ingredient-matching`: ADD a negative statement that `display_name` is NOT a matcher input (the matcher keeps using `search_term` + query content-tokens; identity-relevance scoring is untouched).

## Impact

- **D1 migration**: new `migrations/d1/NNNN_*.sql` adding nullable `display_name TEXT` to `ingredient_identity`, `grocery_list`, `pantry`. Deploy applies `--remote`.
- **Worker**: `corpus-db.ts` (`labelOf`, `readResolver`, `commitResolution`, `addAliases`, reconcile backfill), `ingredient-classify.ts` + `ingredient-normalize.ts` (classifier `display_name` field + commit threading + backfill pass), `grocery.ts` / `session-db.ts` / `pantry-write.ts` (row `display_name` column + item-shape key threading + keep-first merge), `api/grocery.ts` (`GroceryAddInput` + add-by-id), `order-shapes.ts` / `to-buy.ts` / `substitute-annotator.ts` (enriched read `display_name`).
- **Member app**: `packages/app/src/routes/_app.grocery.tsx` (swap posts `{ id }`; render `display_name ?? name`).
- **Invariants held** (verified by tests + negative spec scenarios): set-algebra keyed on the canonical id; append-only ids (never renamed); resolve-only matcher with `display_name` not a matcher input; default `read_to_buy` byte-identical shared op; `isFoodItem` guard keeps non-food off the graph.
- **Convergence** via the reconcile backfill, not hand-edits: the production row already stored as `cabbage::color-red` is the acceptance fixture verified against production after deploy.
- **Two open seams resolved in design.md**: (D) write-time copy vs read-time lookup of the curated display for add-by-id rows; whether the MCP `add_to_grocery_list` tool gets the explicit-`id` param symmetrically with the app endpoint.
