# Design — normalize grocery + pantry identity

The two hard decisions the carve-out was made to avoid. Everything else (thread the resolver into the pure ops, swap `normalizeName` → `resolve` at the food write sites) is mechanical.

## D1 — The food guard: which rows get the funnel

The identity graph must ingest only real food vocabulary. Grocery rows carry two orthogonal signals already in the schema: `kind` (`grocery` | `household` | `other` — the pantry-reconcile-on-receive signal) and `domain` (`grocery` | `home-improvement` | `garden` | `pharmacy` | … — which store-type walk includes it).

**Decision:** a single `isFoodItem(kind, domain)` predicate, `true` iff `kind === "grocery"` **and** `domain` is `grocery` (or absent/default). A non-food row keeps `normalized_name = normalizeName(name)` and is **never** resolved or captured. Pantry has no `kind`/`domain` — it is kitchen inventory, food by construction — so every pantry row funnels.

- *Why both signals.* `kind` is the primary intent, but a `kind: grocery, domain: pharmacy` row (e.g. "ibuprofen" a member filed as grocery) should not enter the food graph; the `domain` exclude catches it.
- *Why not capture non-food into its own space.* No consumer needs household identity (no household SKU cache, no household brand prefs). A second identity namespace is speculative infra — excluded until a trigger, matching ADR-0001's discipline.
- *Consequence.* A row that flips kind (household → grocery) re-keys on its next write (or the reconcile) — acceptable, low-volume, self-healing.

## D2 — Re-keying the existing rows

`(tenant, normalized_name)` is the D1 PRIMARY KEY, so changing the key's derivation re-keys the store. Existing rows are keyed by `normalizeName(name)`; new writes key by `resolve(name)`. The two forms coincide for a plain single-word food name and diverge exactly where the fix matters (quantity/alias/`::`).

**Decision:** a **one-time per-tenant reconcile** (Worker-side, `recipe-projection` style) re-keys every food `pantry` / `grocery_list` row from `normalizeName(name)` to `resolve(name)`, merging rows that collapse to the same id:

- **grocery collision-merge:** union `for_recipes`; reconcile `quantity` (prefer an explicit count over "1"); keep the earliest `added_at` and the **most-advanced** `status` (`ordered` > `in_cart` > `active`) so an in-flight order is never demoted; keep the first non-null `note`.
- **pantry collision-merge:** keep the earliest `added_at`, the freshest `last_verified_at`, the latest supplied `quantity`, and the first non-null `category` / `prepared_from` / `notes`.

The `name` (display) column is left untouched — only `normalized_name` (the key) changes — so nothing user-visible shifts except two rows becoming one.

- *Fallback (Open Question #1).* If the collision-merge proves contentious, **lazy re-key-on-touch** is the low-risk alternative: reads tolerate both key forms (dedup in code after `resolve`), writes emit the new key, rows converge as they are touched. Slower to converge, no big-bang, no merge-rule to agree on.
- *Idempotent.* Re-running the reconcile is a no-op once keys are canonical (`resolve` of an already-canonical id is identity), so it can ride an existing scheduled tick until drained.

## Non-goals (restated, to keep the blast radius small)

- **No cross-base reachability in the to-buy math.** Dedup/cancellation is same-id only. A pantry "whole chicken" (`chicken::whole`) cancelling a "chicken thighs" (`chicken::thighs`) need is `satisfiesAmong`'s job — a read-path consumer wired separately, not grocery/pantry dedup.
- **No non-food identity graph.** Household/other items stay on `normalizeName` forever unless a concrete consumer appears.
