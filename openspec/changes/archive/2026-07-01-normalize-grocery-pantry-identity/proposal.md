## Why

`organic-ingredient-normalization` made three of the four fragmentation stores ADR-0001 named key on the shared **canonical ingredient id** — `sku_cache`, `brand_prefs` (write sites brought into lockstep with the matcher's read), and recipe `ingredients_key`/`perishable_ingredients` — all resolving + capturing through the one `IngredientContext` funnel. The remaining two, **grocery-list dedup** and **pantry matching**, were deliberately left on the older `normalizeName` key (lowercase + whitespace-collapse only). So the exact fragmentation the identity graph exists to kill still bites there:

- "scallions" and "green onions" create **two grocery rows** (the ADR's "duplicate grocery rows" verbatim).
- a pantry "chicken breast" does not cancel a grocery / menu-need "2 lb chicken breast" from the to-buy set, because `computeToBuy` joins on `normalizeName` (quantity not stripped, no alias).
- `remove_from_grocery_list` / pantry remove/verify match by a bare `.toLowerCase()`, so "GROUND BEEF" finds "2 lb ground beef" only by luck and "scallions" never finds a pantry "green onions".

The carve-out was for two real reasons this change addresses head-on rather than ignores:

1. **Non-food pollution.** The grocery list holds `household` / `other` kinds and non-grocery domains (home-improvement, garden, pharmacy). Routing *every* grocery name through the *capturing* funnel would flood `novel_ingredient_terms` with "AA batteries", "potting soil", "duct tape" — junk the identity graph must never ingest.
2. **The dedup key is a D1 PRIMARY KEY.** `pantry` / `grocery_list` are keyed by `(tenant, normalized_name)`. Changing how `normalized_name` is computed re-keys the store, so existing rows need a migration, not just a code swap.

## What Changes

- **Food-item grocery + pantry rows key on the canonical id.** `normalized_name` for a food grocery/pantry row becomes `IngredientContext.resolve(name)` (normalize **and** capture) instead of `normalizeName(name)`, so surface-form variants of the same food merge into one row ("scallions" ≡ "green onions" ≡ `green onion`; "2 lb chicken breast" ≡ "chicken breast"), and the pantry ⊖ grocery ∪ menu-needs to-buy set math (`computeToBuy`) joins across surface forms.
- **Non-food stays on `normalizeName`, and never enters the graph.** A food guard on the grocery row's `kind` / `domain` routes `household` / `other` / non-grocery items to the existing lowercase+collapse key with **no capture**, so the identity graph only ever ingests real food vocabulary. Pantry is food by construction (kitchen inventory), so pantry normalizes wholesale.
- **Pantry + grocery remove/verify match through the funnel.** `pantry-write.ts matches()` and `remove_from_grocery_list` resolve both the query and the stored name to canonical ids (food) before comparing, so a case/quantity/alias-varying removal hits its row. This does **not** add cross-base reachability (a pantry "whole chicken" satisfying a "chicken thighs" need is the `satisfiesAmong` read path's job, explicitly out of scope) — only same-id matching improves.
- **Existing rows migrate.** A one-time per-tenant reconcile re-keys `pantry` / `grocery_list.normalized_name` for food rows from `normalizeName(name)` to `resolve(name)`, merging any rows that collapse to the same id under a deterministic collision-merge rule (grocery: union `for_recipes`, reconcile `quantity`, keep the earliest `added_at` / most-advanced `status`; pantry: keep the earliest `added_at`, freshest `last_verified_at`, latest `quantity`).

## Capabilities

### Modified Capabilities

- `grocery-list`: food-row dedup keys on the canonical id through the `IngredientContext` funnel (capture on add); non-food (`household` / `other` kind, non-grocery `domain`) stays on `normalizeName` and never captures; existing rows migrate with a collision-merge rule.
- `data-write-tools`: pantry add/remove/verify dedup + matching key on the canonical id (pantry is food); `mark_pantry_verified` / remove resolve the query through the funnel; the case-insensitive guarantee is preserved (the canonical id is lowercased).

## Impact

- **Affected code:** `src/grocery.ts` (`normalizeName` dedup → funnel for food; thread the resolver + food guard into the pure ops), `src/pantry-write.ts` (`matches()` via canonical id), `src/session-db.ts` (`normalized_name` computation on pantry/grocery upsert + the read path), `src/order.ts` / `src/order-tools.ts` (`computeToBuy` set math + the overrides-map key resolve through the same funnel), a small `isFoodItem(kind, domain)` guard helper.
- **Migration / reconcile:** a per-tenant backfill re-keying `pantry` / `grocery_list.normalized_name` for food rows with the collision-merge rule — pure code, run once (a Worker reconcile in the style of `recipe-projection`, or a migration paired with code). No column shape change.
- **Capture scope grows (intentionally):** food grocery/pantry adds now feed `novel_ingredient_terms`, so the graph grows from what people actually buy and stock — the highest-signal ingredient vocabulary there is. Non-food never does.
- **No new dependencies.** Reuses the `IngredientContext` funnel and the capture cron from `organic-ingredient-normalization`.
- **Docs:** `docs/SCHEMAS.md` (the `pantry` / `grocery_list` `normalized_name` semantics — canonical id for food, `normalizeName` for non-food), `docs/ARCHITECTURE.md` (the fragmentation-store list — all four now on the funnel).
- **Deferred / non-goals:** cross-base reachability in the to-buy math (`satisfiesAmong` read path, a separate consumer); brand/SKU on the grocery list (still order-time only); a UI for reviewing rows merged by the migration; capturing non-food into a *separate* household-identity space (no demonstrated need).

## Open Questions

1. **Migration strategy:** big-bang per-tenant reconcile vs lazy re-key-on-touch vs a dual-read transition window. Recommend the **reconcile-backfill** (bounded, the house "reconcile" pattern, deterministic collision-merge); lazy re-key-on-next-write is the low-risk fallback if the backfill's merge semantics prove contentious.
2. **Food-guard source of truth:** `kind === "grocery"` vs `domain === "grocery"` vs both. Recommend keying on **`kind`** (the reconcile-on-receive signal already in the schema) with a non-grocery `domain` as a secondary exclude, so a `kind: grocery, domain: pharmacy` edge case is caught.
3. **Capture volume:** food grocery/pantry adds are a new, higher-volume capture source than recipe imports — confirm the capture cron's per-tick bound absorbs it, or add a dedicated drain budget.
