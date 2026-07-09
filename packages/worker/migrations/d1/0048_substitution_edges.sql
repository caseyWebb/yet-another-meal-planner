-- 0048_substitution_edges — capture-first taste-substitution edges (converge-meal-planning-surfaces,
-- D6/D7; the ingredient-normalization + member-app-differentiators capabilities). Extends the
-- identity graph's `ingredient_edge` with a FOURTH edge kind, `substitution`, distinct from the
-- factual satisfies kinds (`general` / `containment` / `membership`). A substitution edge is born
-- from a DETERMINISTIC backend observation — a purchasable swap whose replacement resolves to a
-- canonical id that is NOT already an identity neighbor of the wanted ingredient (pure set logic,
-- no classifier invention) — and records "X can stand in for Y, with caveats," a TASTE judgment,
-- NOT identity. It is therefore EXCLUDED from `satisfies()` reachability: it never gates a match,
-- never causes a purchase, and surfaces only as a labeled read-time suggestion (the depth-1 walk).
--
-- The ADR-0001 amendment pre-decided "granular nodes joined by edges … the strong-sub / weak-sub
-- edge-strength spectrum realized as accrued observation weight," so the spectrum lands as an
-- edge-strength `weight` on the existing edge row rather than a new table:
--   `weight`    — an integer OBSERVATION COUNT. A candidate edge is born at 1 and accrues on each
--                 repeat swap; it promotes past the candidate threshold on repeated observation
--                 (the read surfaces only PROMOTED edges), mirroring the capture pass's
--                 conservative confidence-band discipline. Factual (satisfies) edges default 1 and
--                 never read it.
--   `qualifier` — an OPTIONAL caveat authored LATER (a substitution ratio like `1:2`, a leavening
--                 or cook-time note): by a model when good enough, or left blank. A bare weighted
--                 edge is useful without one — the qualifier annotates an observed edge, it never
--                 gates it.
-- `kind` is an unconstrained TEXT column, so `'substitution'` needs no CHECK change; these two
-- additive columns complete the model.

ALTER TABLE ingredient_edge ADD COLUMN weight INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ingredient_edge ADD COLUMN qualifier TEXT;
