## ADDED Requirements

### Requirement: Slot provenance on planned rows

A `meal_plan` row MAY carry an optional **`from_vibe`** field recording the night-vibe slot it was proposed to fill (the `night-vibe-palette` capability). `from_vibe` SHALL be advisory provenance only: it SHALL NOT be slug-resolved against recipes, SHALL NOT affect the `recipe` slug invariant or the reconcile/cook flows that key off it, and SHALL be optional (absent for a hand-picked or off-vibe plan). `update_meal_plan` SHALL accept and preserve `from_vibe` on an add/upsert. It exists so that cooking a planned row can attribute satisfaction back to the vibe that shaped the slot (the `cooking-history` capability's `satisfied_vibe`).

#### Scenario: A vibe-sourced plan row records its provenance

- **WHEN** `update_meal_plan` adds a recipe proposed for a night vibe's slot
- **THEN** the upserted row carries `from_vibe`, and the row's `recipe` slug invariant and reconcile behavior are unchanged

#### Scenario: A hand-picked plan row omits provenance

- **WHEN** a recipe is planned with no originating vibe
- **THEN** its row omits `from_vibe` and behaves exactly as it does today
