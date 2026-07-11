## REMOVED Requirements

The `night-vibe-archetype-derivation` capability is renamed to **`meal-vibe-archetype-derivation`** (D21 tool-family rename; the derivation now classifies each cluster's meal). Every requirement below is re-landed, updated, under `meal-vibe-archetype-derivation` in this same change; the archive keeps the history. The "member-tappable app trigger" clause is the one deliberate deletion (D8/D20: the cron carries generation — see `member-app-core`'s 410-stub requirement for the shipped route's rollout).

**Shared reason**: capability renamed; see `meal-vibe-archetype-derivation` for the successor requirement.

**Shared migration**: `suggest_night_vibes` remains a dispatch alias of `suggest_meal_vibes` for one deprecation window (see `meal-vibe-palette` → "Deprecated night-vibe tool names dispatch onto the meal-vibe ops").

### Requirement: Archetypes are derived from revealed taste

**Reason**: Renamed. Successor of the same name under `meal-vibe-archetype-derivation`.

**Migration**: See shared migration.

### Requirement: Naming uses a small model, gated by confirmation

**Reason**: Renamed. Successor: "Naming classifies phrase, weather bucket, and meal in one small-model call" (the generation gains the meal line, fail-closed to dinner; bucket discarded for non-dinner).

**Migration**: See shared migration.

### Requirement: Derived archetypes are deduped against the existing palette

**Reason**: Renamed. Successor of the same name under `meal-vibe-archetype-derivation` (dedupe key becomes `(meal, phrase-space)`).

**Migration**: See shared migration.

### Requirement: Cold-start seeding from taste text

**Reason**: Renamed. Successor of the same name under `meal-vibe-archetype-derivation` (starters carry `meal: 'dinner'` — taste notes carry no per-meal signal).

**Migration**: See shared migration.

### Requirement: On-demand and scheduled derivation, bounded

**Reason**: Renamed, with the "member-tappable app trigger" paragraph deleted (D8/D20 — the cron carries generation; producers are the cron and the agent-mediated tool). Successor: "On-demand and scheduled derivation, bounded" under `meal-vibe-archetype-derivation`.

**Migration**: The shipped `POST /api/vibes/suggest` route becomes a pinned 410 stub for one deprecation window (see `member-app-core`); band 2's `profile-planning-and-vibes-ui` removes the button.

### Requirement: Derivation runs converge near-duplicate pending suggestions

**Reason**: Renamed. Successor of the same name under `meal-vibe-archetype-derivation` (convergence key becomes `(meal, phrase-space)`; meal-less pending proposals treated as dinner).

**Migration**: See shared migration.
