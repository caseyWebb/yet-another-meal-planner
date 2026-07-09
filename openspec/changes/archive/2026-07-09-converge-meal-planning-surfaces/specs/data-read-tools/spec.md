## MODIFIED Requirements

### Requirement: Unified profile read assembles from D1

`read_user_profile()` SHALL return the caller's full profile assembled from the D1 profile tables — `initialized`, `missing`, and all profile fields — in one batched set of queries. The structured fields (`preferences`, `kitchen`, `overlay`, `ready_to_eat`, `stockup`) are reconstructed from typed rows/columns (preferences from the `profile` row + `brand_prefs`); `staples` is returned as a bare `StaplesItem[]` array (not `{ items: [...] }`) from the D1 `staples` table; the markdown fields (`taste`, `diet_principles`) are returned as strings from the `profile` row. The payload SHALL additionally include the **night-vibe palette** — the caller's saved vibes plus each vibe's derived **cadence status** (`due | overdue | soon | ok`, computed from the vibe's `cadence_days` and its `last_satisfied` query, the `night-vibe-palette` capability) — so the agent reads the member's revealed-preference rhythm at session start as the basis for shaping a plan. The Worker SHALL NOT parse TOML on the profile read path, and SHALL NOT read a KV bundle. The `kitchen` field returns `{ owned: [...], notes: {...} }` from the D1 `kitchen_equipment` table and profile notes.

#### Scenario: Profile read assembles structured JSON from D1

- **WHEN** `read_user_profile()` is called for a set-up member
- **THEN** it returns `initialized`, `missing`, the structured fields from typed D1 rows, the markdown fields as strings, and the night-vibe palette with each vibe's cadence status — in one batched set of queries, parsing no TOML and reading no KV bundle

#### Scenario: Matcher and weather read preferences from D1

- **WHEN** the matcher or weather path needs preferences
- **THEN** it reads them from the D1 profile tables, not a KV bundle

#### Scenario: The palette rides the profile read

- **WHEN** a member with saved night vibes calls `read_user_profile()`
- **THEN** the payload includes those vibes and each vibe's cadence status, without a separate `list_night_vibes` call

### Requirement: profile_status reports initialization from D1

`profile_status()` SHALL return `{ initialized: boolean, missing: string[] }` — this is also the shape included in `read_user_profile()` results:

- `initialized` SHALL be `true` if and only if the caller's `preferences` record is present in D1 (the unconditional first onboarding area), and `false` otherwise.
- `missing` SHALL list the onboarding-area keys whose D1 data is absent, using the fixed mapping: `store` (preferences row), `taste`, `diet`, `equipment` (kitchen_equipment rows), `pantry` (pantry rows), `ready-to-eat`, `stockup`, `corpus` (overlay rows), and `vibes` (night_vibes rows — an empty palette is an onboarding gap that `suggest_night_vibes` fills).

#### Scenario: Brand-new member with no D1 profile

- **WHEN** `profile_status()` is called for a member with no `preferences` record
- **THEN** `initialized` is `false` and `missing` lists every onboarding area, including `vibes`

#### Scenario: Set-up member with an empty palette lists the vibes gap

- **WHEN** a member has preferences, taste, and equipment set but no night vibes
- **THEN** `initialized` is `true` and `missing` includes `vibes` (and any other empty areas)

#### Scenario: Fully set-up member reports no gaps

- **WHEN** a member has every onboarding area populated, including a non-empty palette
- **THEN** `initialized` is `true` and `missing` is empty
