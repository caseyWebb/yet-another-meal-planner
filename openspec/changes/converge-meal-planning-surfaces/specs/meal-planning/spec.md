## MODIFIED Requirements

### Requirement: Slot provenance on planned rows

A `meal_plan` row MAY carry an optional **`from_vibe`** field recording the night-vibe slot it was proposed to fill (the `night-vibe-palette` capability). `from_vibe` SHALL be advisory provenance only: it SHALL NOT be slug-resolved against recipes, SHALL NOT affect the `recipe` slug invariant or the reconcile/cook flows that key off it, and SHALL be optional (absent for a hand-picked or off-vibe plan). `update_meal_plan` SHALL accept and preserve `from_vibe` on an add/upsert. It exists so that cooking a planned row can attribute satisfaction back to the vibe that shaped the slot: at `log_cooked` (the `cooking-history` capability) `from_vibe` acts as a **guaranteed-reset prior** — the vibe it names always records satisfaction, even when the cook-time cosine match would be borderline — layered under the cosine attribution that additionally credits any other vibe the cooked recipe matches. Its absence is not a loss of attribution: an off-plan or hand-picked cook is still attributed by the cosine match alone.

#### Scenario: A vibe-sourced plan row records its provenance

- **WHEN** `update_meal_plan` adds a row that `propose_meal_plan` produced for a given vibe slot
- **THEN** the row carries `from_vibe` for that vibe, preserved on upsert, and cooking it guarantees that vibe resets regardless of the cosine borderline

#### Scenario: A hand-picked plan row omits provenance

- **WHEN** a member hand-picks a recipe with no vibe slot
- **THEN** the row omits `from_vibe`, and cooking it is still attributed by the cook-time cosine match alone
