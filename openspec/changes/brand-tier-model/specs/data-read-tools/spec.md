## MODIFIED Requirements

### Requirement: Unified profile read assembles from D1

`read_user_profile()` SHALL return the caller's full profile assembled from the D1 profile tables — `initialized`, `missing`, and all profile fields — in one batched set of queries. The structured fields (`preferences`, `kitchen`, `overlay`, `ready_to_eat`, `stockup`) are reconstructed from typed rows/columns (preferences from the `profile` row + `brand_prefs`); each `preferences.brands` entry SHALL be assembled as the canonical brand-tier object `{ tiers: string[][], any_brand: boolean }` with **both fields always present** — never a bare array; `staples` is returned as a bare `StaplesItem[]` array (not `{ items: [...] }`) from the D1 `staples` table; the markdown fields (`taste`, `diet_principles`) are returned as strings from the `profile` row. The payload SHALL additionally include the **night-vibe palette** — the caller's saved vibes plus each vibe's derived **cadence status** (`due | overdue | soon | ok`, computed from the vibe's `cadence_days` and its `last_satisfied` query, the `night-vibe-palette` capability) — so the agent reads the member's revealed-preference rhythm at session start as the basis for shaping a plan. The Worker SHALL NOT parse TOML on the profile read path, and SHALL NOT read a KV bundle. The `kitchen` field returns `{ owned: [...], notes: {...} }` from the D1 `kitchen_equipment` table and profile notes.

#### Scenario: Profile read assembles structured JSON from D1

- **WHEN** `read_user_profile()` is called for a set-up member
- **THEN** it returns `initialized`, `missing`, the structured fields from typed D1 rows, the markdown fields as strings, and the night-vibe palette with each vibe's cadence status — in one batched set of queries, parsing no TOML and reading no KV bundle

#### Scenario: Brand preferences read as canonical tier objects

- **WHEN** `read_user_profile()` (or the member API's preferences read) runs for a member with `brand_prefs` rows
- **THEN** each `preferences.brands` entry is `{ tiers, any_brand }` with both fields present — a don't-care family reads `{ tiers: [], any_brand: true }`, and no entry is ever a bare array

#### Scenario: Matcher and weather read preferences from D1

- **WHEN** the matcher or weather path needs preferences
- **THEN** it reads them from the D1 profile tables, not a KV bundle

#### Scenario: The palette rides the profile read

- **WHEN** a member with saved night vibes calls `read_user_profile()`
- **THEN** the payload includes those vibes and each vibe's cadence status, without a separate `list_night_vibes` call
