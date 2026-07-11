## REMOVED Requirements

The `night-vibe-palette` capability is renamed to **`meal-vibe-palette`** (D21: the `night_vibe` tool family renames to `meal_vibe`; the palette itself gains the meal dimension and member assignment per D29-final). This is an OpenSpec capability rename: every requirement below is re-landed, updated, under `meal-vibe-palette` in this same change — nothing is lost; the archive keeps the history. The D1 tables are **not** renamed (`night_vibes` / `night_vibe_derived` keep their names — D21 is a tool-contract decision; SCHEMAS.md states "meal vibes — stored in the `night_vibes` table").

**Shared reason**: capability renamed; see `meal-vibe-palette` for the successor requirement.

**Shared migration**: the old `*_night_vibe` tool names remain registered as dispatch aliases onto the identical shared ops for one deprecation window (see `meal-vibe-palette` → "Deprecated night-vibe tool names dispatch onto the meal-vibe ops").

### Requirement: Night vibes are saved specs with lifecycle metadata

**Reason**: Renamed. Successor: "Meal vibes are saved specs with lifecycle metadata" (adds `meal` and `members`).

**Migration**: See shared migration.

### Requirement: Night-vibe embedding is derived on the cron

**Reason**: Renamed. Successor: "Meal-vibe embedding is derived on the cron" (hash still gates on vibe text; the added `meal` column triggers zero re-embeds).

**Migration**: See shared migration.

### Requirement: Cadence-as-debt scheduling

**Reason**: Renamed. Successor of the same name under `meal-vibe-palette` (debt math unchanged and meal-orthogonal per stories/02 Q3).

**Migration**: See shared migration.

### Requirement: Weather-weighted seeded sampling

**Reason**: Renamed. Successor of the same name under `meal-vibe-palette` (weather weighting scoped to the dinner palette per stories/02 Q4).

**Migration**: See shared migration.

### Requirement: Satisfaction is revealed at cook time

**Reason**: Renamed. Successor of the same name under `meal-vibe-palette` (attribution becomes meal-scoped).

**Migration**: See shared migration.

### Requirement: The palette is part of the profile

**Reason**: Renamed. Successor of the same name under `meal-vibe-palette` (export renders under meal-vibe naming with per-vibe `meal`/`members`).

**Migration**: See shared migration.
