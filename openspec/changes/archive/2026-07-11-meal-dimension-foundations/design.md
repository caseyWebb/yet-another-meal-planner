# Design — meal-dimension-foundations (band 1: schema + tool contracts + propose engine, NO UI)

## Context

Story 02 promotes meal type to a first-class axis. This design is the synthesis of an adversarial judge-panel process (three competing designs — `migration-first` the unanimous base winner — three judges, every fatal fixed; §10 logs each issue → resolution). DECISIONS.md's operator-ratification block (D26-final, D29-final, D21, D8/D20, D15, D25) is implemented verbatim. Parallel band-1 siblings (spend snapshot per D25(1), pantry disposition, brands→tiers) are **not** in this change and are named where their surfaces adjoin ours; this change implements **last in band 1**, so the sibling-introduced `warnings` field and TOOLS.md deprecation convention (from `brand-tier-model`) are extended here, not introduced, and the migration takes the next free `NNNN` after the siblings' migrations.

Production ground truth (read-only spike against the live D1, 2026-07-10): 3 `meal_plan` rows (all `planned_for`/`from_vibe` NULL), 7 `night_vibes` rows (all casey, all dinner-shaped, weather/pinned/season all unset), 3 `profile` rows of 5 tenants (`austin`/`jack` have none; `casey.custom.defaults.default_cooking_nights = 3` diverges from the column's 5), 4 `cooking_log` rows (all `type='recipe'`, `satisfied_vibe` NULL everywhere, `vibe_satisfaction` empty), and `ready_to_eat.meal` as live prior art for the `breakfast|lunch|dinner` vocabulary. These rows are fixtures F1–F5.

## Goals / Non-Goals

**Goals**: the `meal` dimension on plan/log/vibes/cadence; D26-final per-slot row identity with the planner-no-duplicates invariant; the D21 rename + retired-key shims (one deprecation window); the D29-final caller-neutral attendance contract with a band-1 singleton implementation that is byte-for-byte today's ranking; the suggest-vibes cron as a meal-classifying producer; the D8 value migration as terminating pipeline convergence; same-pass docs/persona/spec lockstep.

**Non-Goals**: any UI (band 2+ per D25(2); the attendance web control is Design-project-routed per D29-final); the members table and handle resolution (band 5); per-member taste vectors and real multi-profile blend math; budget/brand-tier/spend surfaces (siblings); `night_vibes`/`night_vibe_derived` D1 table renames (deliberately never — D21 is a tool-contract decision).

## Vocabulary & invariants (used everywhere below)

- **`meal` closed set:** `breakfast | lunch | dinner | project` on plan rows and log rows; `breakfast | lunch | dinner` on vibes (projects are never vibe-driven). Prior art: production `ready_to_eat.meal` already uses `breakfast|lunch|dinner` (spike §5) — reused, not invented.
- **Row id:** opaque string matching `^[0-9A-Za-z_-]{10,40}$`, unique per tenant (PK is `(tenant, id)`). Canonical mint is a **ULID** (client- or server-minted; ~20-line pure `ulid()` in new `packages/worker/src/ids.ts`, `crypto.getRandomValues`, workerd-safe, no dependency). The one-time migration mints 32-char lowercase hex in SQL. Because formats mix, **no semantic ever parses or meaningfully sorts an id**: ordering always uses `planned_for`/`meal`, with `id ASC` documented as an *arbitrary-but-deterministic* final tiebreak. No `created_at` column (rejected as speculative schema; the documented-arbitrary tiebreak suffices).
- **Earliest-due selector** (one definition, shared by `log_cooked`'s fallback and any tie among explicit duplicates): among candidate rows, `ORDER BY planned_for ASC NULLS LAST, id ASC`, take the first.
- **Planner-no-duplicates invariant (D26-final), both layers:** the propose engine never emits one recipe in two slots of one proposal (across all meals; explicit caller pins/locks exempt), and the `add` op coalesces **slug-globally** (across meals) unless the caller passes `duplicate: true` — exactly one wire spelling of explicit duplication, with no cross-meal loophole.
- **No D1 table renames.** `night_vibes`/`night_vibe_derived` keep their names (only the tool family renames — D21 is a tool-contract decision). SCHEMAS.md states current truth: "meal vibes — stored in the `night_vibes` table." This confines the deploy-skew window (including the failed-Worker-deploy-after-migration scenario) to plan writes only.
- **`warnings` convention (repo-wide; introduced to TOOLS.md by the `brand-tier-model` sibling, extended here):** `warnings: [{ key, reason, superseded_by }]` is the standard channel for *accepted-and-dropped* or *aliased* input on write tools. In this change it appears only on `update_preferences`; alias tool dispatch does **not** inject warnings (aliases are behavior-identical per D21's dispatch framing).

---

## 1. Migration — `migrations/d1/NNNN_meal_dimension.sql`

One forward-only file (`NNNN` = next free number at implementation time — the band-1 siblings implementing before this change will have taken the next slots after `0048_substitution_edges.sql`), applied `--remote` by the deploy before the new Worker activates.

```sql
-- meal_plan: per-slot identity (D26-final). SQLite cannot alter a PK: rebuild.
CREATE TABLE meal_plan_v2 (
  tenant      TEXT NOT NULL,
  id          TEXT NOT NULL,               -- opaque row id; new mints are ULIDs
  recipe      TEXT NOT NULL,
  meal        TEXT NOT NULL DEFAULT 'dinner'
              CHECK (meal IN ('breakfast','lunch','dinner','project')),
  planned_for TEXT,
  sides       TEXT,
  from_vibe   TEXT,
  PRIMARY KEY (tenant, id)                 -- per-tenant-table precedent; cross-tenant
);                                         -- id collision structurally impossible
INSERT INTO meal_plan_v2 (tenant, id, recipe, meal, planned_for, sides, from_vibe)
  SELECT tenant, lower(hex(randomblob(16))), recipe, 'dinner', planned_for, sides, from_vibe
  FROM meal_plan;
DROP TABLE meal_plan;
ALTER TABLE meal_plan_v2 RENAME TO meal_plan;
CREATE INDEX meal_plan_tenant_recipe ON meal_plan (tenant, recipe);

-- cooking_log: meal is nullable — existing rows stay NULL ("unknown"), never fabricated.
ALTER TABLE cooking_log ADD COLUMN meal TEXT
  CHECK (meal IN ('breakfast','lunch','dinner','project'));

-- night_vibes: meal dimension + band-5-ready member assignment (D29-final). NO table rename.
ALTER TABLE night_vibes ADD COLUMN meal TEXT NOT NULL DEFAULT 'dinner'
  CHECK (meal IN ('breakfast','lunch','dinner'));
ALTER TABLE night_vibes ADD COLUMN members TEXT;   -- JSON string[]; NULL = everyone

-- profile: per-meal cadence map. Shape backfill is legitimate one-shot SQL (identity/shape,
-- like the id mint); the VALUE migration for retired prefs is pipeline convergence (§4.2).
ALTER TABLE profile ADD COLUMN cadence TEXT;       -- JSON {breakfast, lunch, dinner}
UPDATE profile
  SET cadence = json_object('breakfast', 0, 'lunch', 0, 'dinner', default_cooking_nights)
  WHERE default_cooking_nights IS NOT NULL;
```

**Deliberately NOT in the migration:**
- No unique index on `(tenant, recipe)` or `(tenant, recipe, meal)` — duplicates are legal by explicit user action; uniqueness moves to the op layer's coalesce rule.
- No drop of `profile.default_cooking_nights` / `lunch_strategy` / `ready_to_eat_default_action`. `default_cooking_nights` is **frozen** (no writer post-deploy; the cadence read-fallback still reads it). `lunch_strategy` / `ready_to_eat_default_action` are frozen *and* converge to NULL via §4.2. All three drop in the window-close cleanup migration (§9).
- No project-row CHECK — enforced at the op layer, where it returns a structured conflict instead of a raw SQL failure.
- No `night_vibe_derived` change, and **zero re-embeds fire on migration**: `vibe_hash` gates on vibe *text*; adding `meal` changes no text. (Stated to foreclose a naive whole-row-hash alternative that would trigger a 7-row re-embed storm per tenant.)

**Deploy-gap analysis (old Worker × new schema).** Migrations apply `--remote` before `wrangler deploy` swaps the Worker; for seconds the old code runs against the new schema. The old `mealPlanUpsertStmt`'s `ON CONFLICT(tenant, recipe)` (session-db.ts) errors once that unique constraint no longer exists → plan *writes* fail as structured `storage_error` (tools are throw-free); reads succeed; class (b) clients replay on the next attempt. Because no table renames, vibe reads, propose, log attribution, and the cron phases all keep working through the gap — and stay working even if the Worker deploy fails after migrations apply. Accepted: structured, bounded, self-healing degradation against 3 production plan rows. New code does not tolerate the pre-migration schema (migration-before-code is the deploy contract).

### Acceptance fixtures (verbatim spike pre-states; local-D1 vitest seeds + post-deploy read-only `--remote` checklist in tasks.md)

| Fixture | Pre-state (spike) | Post-migration assertion |
|---|---|---|
| **F1-plan-mint** | 3 `meal_plan` rows: `casey/chicken-and-black-bean-stew`, `casey/honey-mustard-salmon` (sides `["steamed rice","green salad"]`), `everett/chicken-chile-verde`; all `planned_for` NULL | Exactly 3 rows; each `id` matches `^[0-9a-f]{32}$`, distinct; `meal='dinner'` on all; `sides` byte-identical; `planned_for`/`from_vibe` still NULL |
| **F2-vibe-meal** | 7 `night_vibes` rows, all `casey`, all dinner-shaped phrases | 7 rows, `meal='dinner'` (semantically correct for 100% of live rows, not just safe), `members` NULL; `night_vibe_derived` still 7 rows with **unchanged** `updated_at` (no re-embed) |
| **F3-cadence-backfill** | `casey.default_cooking_nights=5`, `caitie=4`, `everett=NULL`; `austin`/`jack` have **no profile row**; `casey.custom.defaults.default_cooking_nights=3` (live divergent shadow) | `casey.cadence={"breakfast":0,"lunch":0,"dinner":5}` (**column wins over `custom` — precedence, not merge**); `caitie` → `dinner:4`; `everett.cadence` NULL; `austin`/`jack` untouched (no row created); `custom` byte-identical everywhere |
| **F4-log-null** | 4 `cooking_log` rows, all `type='recipe'` | 4 rows, `meal` NULL on all; `retrospective` counts them in overall cadence and reports them under `meal_unknown` (§2.8) |
| **F5-pref-retire** | `casey.lunch_strategy='mixed'`, `ready_to_eat_default_action='auto-add'`; everett/caitie NULL; austin/jack no row | After **one cron tick**: casey has exactly two pending `add_vibe` proposals (targets `pref-retire:lunch_strategy` [meal `lunch`] and `pref-retire:rte` [meal `dinner`]) **and both retired columns are NULL**; everett/caitie/austin/jack untouched, zero `pref-retire:*` proposals; **second tick changes nothing** (columns-NULL is the convergence predicate); `casey.custom` byte-identical |

**Flag (deploy-config, not this change):** `wrangler.jsonc`'s `database_name: "yamp"` does not match the real production D1 name (`grocery-mcp`; binding is by `database_id`, so the migration lands correctly). Reported to the deploy-repo owner in the PR description; fixing it is out of scope.

---

## 2. Tool-contract delta

Everything below lands in `docs/TOOLS.md` in the same pass, extending the **"Deprecations"** convention section (table: alias/key → replacement → introduced-in → removal condition, per D21) and the **`warnings` convention** paragraph that the `brand-tier-model` sibling introduces (if this change somehow lands first, it introduces them — the content is identical either way). Tool-vs-skill boundary audit (CONTRIBUTING test) is a proposal checklist item: fan-out semantics, `duplicate: true` meaning, clear order, warnings semantics, attendance fail-open, empty-meal `empty_reason` all live in tool descriptions; skills own only choreography.

### 2.1 `update_meal_plan`

```
ops: [{
  op: "add" | "remove" | "set",
  id?: string,          // regex-validated. add: client-minted idempotency key.
                        // set/remove: exact row address (always AND tenant=?).
  recipe?: string,      // required on add; slug address on set/remove when id absent
  meal?: "breakfast"|"lunch"|"dinner"|"project",
  duplicate?: boolean,  // add only; default false — THE one spelling of explicit duplication
  planned_for?: string | null,
  sides?: string[],
  from_vibe?: string | null,
}]
→ { applied:   [{ op, id, recipe, meal, coalesced?: true, removed?: number }],
    conflicts: [{ op, recipe?, id?, reason, candidates?: [{ id, meal, planned_for, sides? }] }] }
```

**`add` — deterministic resolution order (this IS the commit-side no-duplicates enforcement):**
1. **`id` exists** (tenant-scoped) → **replay/update** that row: `planned_for` set when supplied, `sides` unioned, `meal`/`from_vibe` set when supplied. If the op's `recipe` doesn't slug-match the row's recipe (case-insensitive) → per-op conflict `"id addresses a different recipe"` (mirror of `log_cooked`'s mismatch guard). Replaying a queued offline add is a no-op-shaped update — the class (b) idempotency property, in every branch.
2. Else **`duplicate: true`** → **insert** (supplied id or server-minted ULID). On redelivery the id exists → step 1 update; an explicit duplication replayed never creates a second duplicate.
3. Else **slug-global coalesce** (case-insensitive, **across ALL meals** — closes the cross-meal duplication hole):
   - **0 matching rows** → insert (supplied id or server ULID); `meal` defaults `'dinner'` (story 02 §3's meal-agnostic entry points).
   - **Exactly 1** → update it: `meal` supplied = **move the row between meals**, `sides` unioned, `planned_for`/`from_vibe` set when supplied. Response reports the **surviving row's id** with `coalesced: true`; the client-supplied id is discarded and the caller must adopt the survivor's id (documented; the band-2/3 mutation registry rebinds on it).
   - **>1** (explicit duplicates exist) → per-op **conflict with `candidates`** — never an earliest-due auto-pick; the caller re-issues by `id` or with `duplicate: true`. Ambiguity is surfaced, exactly as `set`-by-slug requires.

`meal='project'` rows (insert or move-to) reject non-null `planned_for` and non-empty `sides` (existing or supplied) with a per-op conflict (`"project rows carry no date or sides"`) — op-layer enforcement, not convention. Any applied add still stamps `profile.last_planned_at`.

**`remove`** — exactly one addressing field:
- By `id` → **idempotent**: applied with `removed: 0|1`; a missing id is never a conflict (replay safety).
- By `recipe` slug, optionally narrowed by `meal` → deletes **all** matching rows (D26-final's defined fan-out), applied with `removed: N` + the removed ids; zero matches stays a conflict as today. **Split-idempotency rationale (kept):** id-addressed ops are the offline-replay surface and must replay silently; slug-addressed ops are the conversational surface where "nothing matched" is signal.

**`set`** — exactly one addressing field:
- By `id` → must exist (else conflict). May change **any** field including `recipe` (swap-in-slot, pages/03) and `meal`; project constraints enforced as in `add` (the op may itself supply `planned_for: null` + `sides: []` to satisfy them).
- By slug (optionally narrowed by `meal`) → **unique match required** (D26-final): zero → conflict as today; **>1 → conflict with `candidates`**. Slug-addressed `set` may **not** change `recipe` (recipe-swap requires id addressing).
- Field semantics unchanged from today: `planned_for` string sets / explicit null clears / absent preserves; `sides` supplied replaces wholesale; `from_vibe` supplied sets (null clears) / absent preserves.

### 2.2 `read_meal_plan`

Returns `{ planned: [{ id, recipe, meal, planned_for, sides?, from_vibe? }] }` — a **flat ordered array** ("grouped by meal" is an *ordering guarantee*, not a nesting change; spares every consumer a re-nest and keeps downstream diversity logic global): dated rows by `(planned_for, meal-order breakfast<lunch<dinner)`, then undated rows grouped by meal, then `project` rows last; ties by `id ASC` (arbitrary-but-deterministic). `id` is documented as **the** address for row-level edits and the class (b) replay key. Project rows hit the to-buy derivation for free (no `read_to_buy` contract change).

### 2.3 `log_cooked`

- New `meal?: "breakfast"|"lunch"|"dinner"|"project"` — optional; omitted stores NULL ("unknown / not a meal"). Valid on all `type`s. Cooking a planned project logs `{type:'recipe', meal:'project'}` (§8 Q2).
- New `plan_row_id?: string`:
  - Row exists, recipe slug-matches → clear exactly that row.
  - Row exists, recipe mismatches → structured `conflict`, **no log written** (never clear a different dish's slot).
  - Row **absent** → **no clear, log still written**, result notes the stale id (`cleared_plan_row: null` + note). Deliberately **no fall-through** to slug stages: on replay, the row was already cleared and the intent satisfied — falling through would consume an unrelated explicit duplicate.
- **Deterministic clear order** (recipe entries; D26-final):
  1. `plan_row_id` → as above.
  2. Else exact `(recipe, meal, date)` (requires the entry to carry both): slug match ∧ `meal = entry.meal` ∧ `planned_for = entry.date`; ties among explicit duplicates break by the earliest-due selector.
  3. Else **earliest-due row for the slug**, **excluding `meal='project'` rows unless `entry.meal='project'`** — cooking a dinner never silently consumes a same-slug project row.
  4. No match → no clear (off-plan cook, as today).
- **Clears at most ONE row** (an explicit "add again" duplicate survives the first cook — the point of duplication).
- `from_vibe` for vibe attribution is read from **the row actually cleared** (replacing the slug-global `LIMIT 1`); the delete is `DELETE ... WHERE tenant=? AND id=?` inside the same atomic batch (concurrent delete makes it a no-op — safe).
- Route-level dedupe identity becomes **per-`(date, meal, type, recipe|name)`** (NULL meal matches NULL only). Stated verbatim: *cooking_log dedupe identity only, never plan-row identity* (D26-final's own clarification).
- **Vibe-attribution meal-scoping:** cosine candidates restrict to vibes whose `meal` equals the entry's meal when set; NULL-meal entries match all vibes (fail-open, today's behavior); the `from_vibe` prior always resets regardless. Production impact: zero (`vibe_satisfaction` empty).
- Returns additively: `cleared_plan_row?: { id, recipe, meal, planned_for }`.

### 2.4 `meal_vibe` family (D21 rename + alias window)

New canonical names: `list_meal_vibes`, `add_meal_vibe`, `update_meal_vibe`, `remove_meal_vibe`, `suggest_meal_vibes`. Old names stay registered as **dispatch aliases onto the identical shared ops** (one op layer, no duplicated logic, **identical requests and responses** — no warnings injection; D21's dispatch framing), with descriptions replaced by one line: *"Deprecated alias of `<new name>` — identical behavior; use the new name."* Aliases accept and return the new `meal`/`members` fields, so a lagging plugin loses nothing but the name.

Op deltas:
- Every vibe carries `meal` (`breakfast|lunch|dinner`); `add_meal_vibe` accepts it, default `'dinner'` (correct for 100% of live rows — F2); `list_meal_vibes` returns it.
- `update_meal_vibe` gains **explicit-null field clearing** (Appendix A): `null` clears `cadence_days`, `base_weight`, `weather_affinity`, `weather_antipathy`, `season`, `facets`, or `members`; absent preserves. `meal` settable (moves the vibe between palettes; no re-embed — the hash covers the phrase), not nullable. `vibe` not nullable.
- New `members?: string[]` on add/update (D29-final readiness): non-empty strings, deduped, stored verbatim, NULL/absent = "everyone." Opaque handles — no band-5 schema dependency. Contribution rule in §3.
- Write-class (D15) unchanged: create/delete class (b), edit class (a); vibe id remains the key.
- Dedupe sweep (`night-vibe-dedupe.ts`): phrase-space convergence key becomes **(meal, phrase-space)**; pending proposals lacking `meal` are treated as `dinner`.

### 2.5 `update_preferences`

- **New defined key `cadence`**: `{ breakfast?, lunch?, dinner? }`, each int 0–7 (weekly counts). **Per-key merge, RFC 7396-consistent** with the documented merge-patch contract: `{cadence:{lunch:2}}` sets lunch only; `{cadence:{dinner:null}}` clears one key; `cadence: null` clears the map. (No wholesale replacement — consistent with the alias below, which merges.)
- **Retired-key shim (D21 verbatim):** `lunch_strategy` and `ready_to_eat_default_action` leave `DEFINED_PREFERENCE_KEYS`; a `RETIRED_PREFERENCE_KEYS` list is checked **before** `rejectUnknownPatchKeys`: the key is **accepted and dropped** — not validated, not written, not routed to `custom`, never `validation_failed`, never the nest-under-`custom` hint. Each dropped key appends `{ key, reason: "retired", superseded_by: "meal vibes" }` to `warnings`.
- **Alias key `default_cooking_nights: N`**: validated int 0–7, **merged as `cadence.dinner = N`** (preserving breakfast/lunch), never written to the frozen column; appends `{ key: "default_cooking_nights", reason: "aliased", superseded_by: "cadence.dinner" }`. Same warnings element shape — one uniform array.
- Return gains `warnings?: [...]`, present only when non-empty (extending the repo-wide convention `brand-tier-model` introduces).
- After the window closes: shim list empties; both keys fall through to generic unknown-key rejection — the standard fate of any unknown key.

### 2.6 `read_user_profile`

- Exports `preferences.cadence` — the stored map, or (when NULL, e.g. everett) the read-time derivation `{breakfast: 0, lunch: 0, dinner: default_cooking_nights ?? 5}`.
- **`default_cooking_nights` stays in the export for one window as a derived mirror of `cadence.dinner`** (read-path skew protection, not just write-path; Deprecations row), then drops with the cleanup change. `lunch_strategy` / `ready_to_eat_default_action` disappear from the export **now** (retired; a lagging reader degrades soft).
- The palette section renders under **meal-vibe** naming with per-vibe `meal` (and `members` when set). The export is LLM-read prose, so the heading rename degrades soft — no alias field needed; the `missing` label stays `"vibes"`.
- Budget / brand-tier / household-member export shapes (Appendix A) are owned by sibling/band changes — explicitly out of scope, stated in tasks so nothing reads as dropped.

### 2.7 `propose_meal_plan` / `display_meal_plan`

Params (both tools, one shared op; member `POST /api/propose` identical):
- **`meals?: { breakfast?, lunch?, dinner? }`** — per-meal slot counts, each int 0–14. **Counts are per-window, not week-scaled** (parity with today's `nights`); the planning `window` continues to bound recurrence caps, not counts. Default chain per meal: explicit `meals` → stored `cadence[meal]` → read-time derivation (`dinner`: `default_cooking_nights ?? 5`; `breakfast`/`lunch`: 0).
- **`nights?`** retained as a deprecation-window alias for `meals.dinner = N`; ignored when `meals` is supplied (documented, no error); Deprecations row.
- **`attendance?: { away?: string[] } | { only?: string[] }`** — §3 (the `away` form directly expresses D29-final's canonical "kids are gone this weekend").
- `ephemeral_vibes[]` entries gain `meal?` (default `dinner`); an ephemeral set still replaces palette sampling and now authors slots *with meals*.
- `lock`, `exclude`, `nudges`, `freeform`, `seed`, `slots[]`, `new_for_me`, `boost_ingredients` — **retained unchanged** (D8/D20: the cuts are member-surface controls only). String `lock`s and `new_for_me` force-placements are dinner slots (a lock is "cook this this week" intent — dinner-shaped by construction; per-meal pinning is available via `slots[].recipe` or `ephemeral_vibes[].meal` + a pin).

Engine (per-meal shape, shared fill):
- **Shape** runs per meal: the palette partitions by `meal`; `sampleWeek` samples each meal's slots from that meal's vibes with that meal's count, cadence-debt-weighted as today. **Weather quotas apply to the dinner pass only** (Q4); breakfast/lunch see a neutral all-`mild` histogram — the quota machinery degenerates cleanly rather than forking the code path. Stored `weather_affinity` on a non-dinner vibe is preserved but inert in allocation (documented).
- **Vibe-meal binding / empty-meal behavior:** a meal with count > 0 but zero vibes of that meal yields **explicit empty slots** (`empty_reason: "no_palette_for_meal"`) plus a `notes[]` entry naming the escapes (`add_meal_vibe` with that meal, or `ephemeral_vibes` with `meal`); never a silent fallback into another meal's palette.
- **Meal-aware course gate** (fill): dinner and lunch slots keep today's gate (`course` includes `main`, or empty → fail-open); **breakfast slots gate on `course` includes `breakfast`, or empty → fail-open** — keeps breakfast pools from filling with dinner mains. A vibe's explicit `facets.course` overrides, as today. Locks/pins exempt.
- **Fill + compose** stays one shared pass: `buildPool` per slot, then **one** `assembleProposal` across all meals — cross-slot MMR/diversify, facet-spread, at-risk set-cover, and the **engine-side no-duplicates invariant** (one recipe at most once per proposal; explicit pins/locks exempt, mirroring D26-final's user-action exception). Still at most one batched embedding call per request.

Returns: `plan[]` stays flat; each slot gains `meal`; ordering breakfast → lunch → dinner, position-stable within meal. `diagnostics` gains `meals: { <meal>: { requested, filled, empty } }` and `attendance: { effective, ignored }` — with `diagnostics.nights` kept as the dinner alias for the window (Deprecations row). `ProposeCardData` (SCHEMAS.md, same pass — data shape only, no widget work): slots gain `meal`; `request` carries `meals` + `attendance`.

**Commit path contract** (shared op; `member-app-propose` spec, no UI): committing a proposal maps each filled slot to an `add` op carrying a **client-minted ULID**, the slot's `meal`, and its `from_vibe`; the committer never sets `duplicate`, so §2.1's slug-global coalesce makes "commit updates an existing row rather than duplicating" **structural**. (If the member has explicitly duplicated a recipe, a commit touching that slug surfaces the candidates conflict — genuine ambiguity, resolved by id.)

### 2.8 `retrospective`

`cadence` becomes meal-aware: keeps overall `cooks_per_week` (definition unchanged), adds `by_meal: {breakfast, lunch, dinner, project}` over rows with `meal` set, and `meal_unknown: N` for NULL-meal rows (F4's 4 production rows land here — counted overall, reported unknown, never fabricated). Spend/waste aggregates: band 4 / spend-events sibling, not here.

### 2.9 Not touched (asserted)

`kroger_*`, guidance, weather tool, pantry/grocery tools, `confirm_proposal`/`list_proposals` contracts (`add_vibe` proposal *payloads* gain `meal` — a payload field the apply path writes, not a contract change).

---

## 3. Propose engine attendance contract (D29-final): band 1 vs deferred

Today's single tenant profile is exactly the degenerate case of the household-blend contract (tenant = household per D1/D9), so band 1 writes the contract in blend language and ships an implementation bit-identical to today.

**Lands in band 1:**
1. **One roster seam:** `householdRoster(env, tenant) → memberId[]`, returning `[tenant]` — grounded on D10's guarantee that the founding member's id EQUALS the tenant id. Band 5 changes this one function body, zero contract sentences.
2. **Contract text** (meal-plan-proposal + member-app-propose specs, TOOLS.md): hard constraints (dietary gates, equipment, rejects) are the **UNION across the roster** — and the hard floor **never varies with attendance** (absent members' hard constraints still apply; only soft weighting moves). Soft ranking is the household blend of member taste profiles, **uniform weights over the effective eating set**; absent an attendance signal, the blend covers all members equally. Implemented as `blendTasteProfiles(profiles, eating)` + `unionHardConstraints(profiles)` — pure functions fed a singleton array in band 1 (identity blend, today's ranking byte-for-byte), unit-tested now with synthetic multi-profile fixtures.
3. **`attendance` param** (§2.7 shape): exactly one of `away`/`only` (`validation_failed` otherwise); handles are opaque strings. **Fail-open semantics, fully defined:** unknown handles are **dropped, never errors**, echoed in `diagnostics.attendance.ignored`; the effective eating set is `only∩roster` or `roster−away`; an **empty effective set fails open to the full roster** (+ diagnostics note) — an attendance mistake can never produce a plan for nobody. Band-1 degeneracy: no handle is recognizable, so every call ranks as the whole household — today's ranking, observably (`diagnostics.attendance = { effective: [<tenant>], ignored: [...] }`).
4. **Vibe contribution rule** (`night_vibes.members` + §2.4 CRUD): an assigned vibe contributes slots and cadence-debt only when `members ∩ effective-eating ≠ ∅`; NULL = everyone = always. **Stale-members fail-open:** a vibe whose members are all unresolvable against the roster contributes as everyone (+ diagnostics note) — a stale reference never silently deletes a vibe from planning. Implemented as a real filter over the recognized set, so band 5 changes inputs, not code shape. With all production vibes `members` NULL: behavior unchanged.

**Explicitly deferred to band 5:** the members table and handle resolution/validation (tightening is additive — unknown-id handling is already drop-and-report); per-member taste vectors/overlays and the actual weighted-blend math over >1 profile (the loader grows a query; signatures are already plural); per-member hard-constraint storage (union computed now, over one profile); the web attendance control (D29-final routes it through the Claude Design project; band 2+).

---

## 4. suggest-vibes cron producer + the D8 value migration

### 4.1 Producer (no new job)

The cron producer is the existing `runArchetypeDerivationJob` (scheduled() phase 5). Delta:
- `nameCluster`'s single small-model call goes from two reply lines to **three**: vibe phrase, weather-bucket label, **meal label**. `parseMealLabel` mirrors `parseBucketLabel`: strict match against the closed set, **fail-closed to `'dinner'`** (misclassification cost = a mis-shelved suggestion the member retags; never a crash or dropped suggestion). **For a non-dinner classification the weather-bucket label is discarded** (weather is dinner-only; never store dead data).
- `starterVibesFromTaste` (cold start): `meal: 'dinner'` (taste notes carry no per-meal signal; never fabricate).
- Derived suggestions carry `meal` through the pending-proposal payload; dedupe keys on (meal, phrase-space).
- Idempotency unchanged: interval gate, per-run cap, `(tenant, kind, target)` enqueue idempotency, dedupe sweep. Same generation call — no new AI spend.

**Trigger deletion (D8/D20: "the cron carries generation").** Producers after this change: the agent-mediated tool (`suggest_meal_vibes` + alias) and the cron. Deleted in this pass: the `member-app-core` health-gated-trigger requirement, the `night-vibe-archetype-derivation` "member-tappable app trigger" scenario, ARCHITECTURE.md's health-gate sentence. **Rollout for the LIVE route + shipped button** (`src/api/vibes.ts` `POST /vibes/suggest`; `_app.profile.tsx` button): the route becomes a **stub for the deprecation window**, returning — **pinned to the member-API error convention** (`c.json({ error: <literal>, message }, status)`, route-level literals like `csrf_rejected`/`rate_limited`, not `src/errors.ts` ToolError codes) —

```ts
return c.json({ error: "gone" as const,
  message: "Vibe suggestions now arrive automatically; this trigger was retired." }, 410);
```

so the deployed SPA's button fails *explicably*, never the SPA-shell/404 trap. The worker route tests (`test/api-member.test.ts`) and the app suite's throttled-suggest coverage are **updated in this change** to assert the 410 stub. Band 2's `profile-planning-and-vibes-ui` removes the button; the window-close cleanup removes the stub (route then falls to the normal unknown-API 404).

### 4.2 The D8 value migration as pipeline convergence — **re-homed into this change**

CHANGES.md currently slots this pass under band 2's `profile-planning-and-vibes-ui`. **This change re-homes it** — the same pass that retires the write path must start the value convergence: leaving the member's stated lunch intent invisible to propose for a whole band (empty lunch palette, no seeds) exactly when per-meal planning goes live would be a regression, and the deprecation-window column drop is gated on convergence, which must not depend on an unrelated UI slice. The seeds need no UI (they ride the shipped proposal queue). **CHANGES.md's band ledger is edited in the same pass** (clause moves from the band-2 entry to this change's entry); D25(2)'s UI-coupling obligation is unaffected — band 2 still ships the preference UI.

New idempotent pass **`runPrefRetirementSeedJob`**, scheduled() **phase 5** (serial-implementation note for shared `scheduled()` wiring applies — `pantry-disposition-foundations`' `ingredient-category` job lands first). For each tenant with a profile row where `lunch_strategy IS NOT NULL OR ready_to_eat_default_action IS NOT NULL`:

1. **Enqueue vibe *suggestions*** through the existing pending-proposals channel (kind `add_vibe`, existing `(tenant, kind, target)` enqueue idempotency, deterministic targets) — **suggestions, not silent inserts**: the palette is member-curated; the member accepts or dismisses via the shipped queue. Mapping (total, decisive):

| Retired value | Seeded suggestion (target) | meal |
|---|---|---|
| `lunch_strategy='leftovers'` | "leftovers remixed into lunch" — `pref-retire:lunch_strategy` | lunch |
| `lunch_strategy='buy'` | "grab-and-go bought lunch" — same target | lunch |
| `lunch_strategy='mixed'` | "leftovers or something quick and easy" — same target | lunch |
| `ready_to_eat_default_action='auto-add'` | "a zero-effort heat-and-eat night" — `pref-retire:rte` | dinner |
| `ready_to_eat_default_action='opt-in'` | *no seed* (opt-in is the new universal behavior; band 3's always-offer-never-auto-add persona rule is its successor) | — |

2. **NULL both retired columns in the same D1 batch as the enqueue** — the convergence marker is the columns themselves (converged ⇔ both NULL). The pass **terminates**: converged tenants match nothing on later ticks; a member's dismissal is final (nothing re-reads the now-NULL columns, so nothing resurrects — no dependence on proposal-disposition retention); the crash window between enqueue and NULL is covered by the enqueue idempotency. Safe to NULL because, unlike `default_cooking_nights` (which the cadence read-fallback reads and therefore stays frozen-not-NULLed), **nothing reads these two columns after this deploy except this pass**.
3. The `custom` bag is **never read or written**: `casey.custom.defaults.lunch_strategy` (live free text), `custom.defaults.no_cook_days`, and `everett.custom.cooking.*` stay untouched — defined columns only, column wins (the F3 precedence rule, stated once). Absent profile rows (austin, jack) are skipped structurally by the WHERE clause.

**Fixture F5** (§1 table) asserts: two proposals for casey, both columns NULL, second tick no-op, `custom` byte-identical — verified `--remote` after deploy per the convergence doctrine; if casey accepts a seed, the next vector-reconcile tick embedding it is a cheap end-to-end pipeline probe (optional check, noted in tasks).

**Flag (D21 interpretation, not contradiction):** D21 says "seeded **lunch/breakfast** vibes." No retired preference carries breakfast signal (`lunch_strategy` is lunch; RTE is a convenience-dinner disposition; verified against schema + production). Breakfast-vibe seeding is the *onboarding/suggest* path (§7), not this convergence — fabricating a breakfast vibe from nothing would violate capture-don't-invent. Stated for ratifier visibility.

---

## 5. Offline replay (class b) keying

- **Key:** the class (b) key for plan ops becomes the **client-minted row id**. Continuity through the window is structural, not temporal: an id-keyed add replays idempotently (§2.1 step 1, and step-2 duplicates degrade to updates on replay); a queue serialized against the *old* slug-keyed op shape replays as slug ops, which remain valid with defined fan-out (add coalesces slug-globally, remove fans out, set demands uniqueness). The one wrinkle — a coalesced add returns the survivor's id and the client rebinds — is a band-2/3 mutation-registry obligation, recorded in the member-app-propose delta. No queued mutation becomes unreplayable across the deploy. (App-side registry code is band 2/3; this band fixes the contract both sides converge on.)
- **ARCHITECTURE.md class (b) sentence — BOTH clauses rewritten in one pass** (no partial-sentence drift): "…grocery/pantry rows by canonical ingredient id, **plan rows by client-minted row id (ULID; slug-addressed ops keep defined fan-out — remove-by-slug drops all matches, set-by-slug requires a unique match)**, favorites by slug with an explicit boolean, **log rows deduped on `(date, meal, type, recipe|name)`**, …". Same file, same pass: the menu-generation paragraph gains the meal dimension (per-meal counts, per-meal palettes, attendance input); the `POST /api/vibes/suggest` health-gate sentence is deleted. Current-truth phrasing only.
- **`member-app-offline`:** one-clause editorial addition making the key explicit ("plan ops keyed by the client-minted plan-row id") — an extra-list delta, flagged as such in the proposal (cheap insurance for the next reader).

---

## 6. Per-spec delta plan (12 + flagged extras)

1. **night-vibe-palette → renamed capability `meal-vibe-palette`** (OpenSpec rename: old requirements REMOVED, re-landed ADDED under the new name; archive keeps history). Vibe model gains `meal` (closed set, default dinner) and `members` (NULL = everyone; §3 contribution rule + stale-members fail-open); explicit-null clearing on `update_meal_vibe`; meal-scoped satisfaction attribution; **Deprecation aliases** requirement — `*_night_vibe` names dispatch onto the same ops for one window (scenario: `add_night_vibe` call → identical creation, identical response to `add_meal_vibe`).
2. **planning-cadence** — `default_cooking_nights` requirement rewritten to the `cadence` map (0–7 weekly counts, **per-key merge-patch**); migration-mapping scenario (`N → {0,0,N}`, absent-profile tolerance); read-fallback scenario (map absent → derived from frozen scalar → `{0,0,5}`); alias-with-warning scenario; "window bounds recurrence caps, not counts" generalized per meal; `occurrenceCap` unchanged and explicitly meal-orthogonal (Q3).
3. **weather-bucket-planning** — one new requirement closing Q4: allocation SHALL apply to **dinner slots only**; breakfast/lunch slots never carry `weather_category` or consume quotas (scenario: neutral-histogram degeneracy; stored non-dinner affinities preserved-but-inert).
4. **meal-plan-proposal** — `nights` → `meals` map (+ window-scoped alias scenario); per-meal palette partition + per-meal sampling; **vibe-meal binding** and empty-meal explicit-empty-slots + note scenario; **meal-aware course gate** (breakfast gate scenario); **engine no-duplicates** requirement (pins/locks exempt); the D29-final block: attendance shape (`away`/`only`), roster seam, union hard floor invariant under attendance, uniform blend, fail-open scenarios (unknown handles / empty effective set / stale vibe members), singleton-degeneracy scenario; `ephemeral_vibes[].meal`; per-meal diagnostics + `nights` alias.
5. **meal-planning** — "keyed by `(tenant, recipe)`" rewritten wholesale: row identity is `(tenant, id)` with client-mintable ULIDs; the full §2.1 op contract (add resolution order incl. **slug-global** coalesce, `duplicate: true`, >1-match candidates conflict, remove fan-out, set unique-or-candidates, id-addressed idempotency, id/recipe mismatch guard); project rows requirement (op-layer enforcement; read_meal_plan/to-buy for free); migration-mint requirement (scenario = F1).
6. **menu-generation** — persona-orchestration gains the meal dimension in full (Appendix C band 1): per-meal counts from cadence; vibe-meal binding; empty-meal nudge choreography; commit threads `meal` + row ids; `log_cooked` passes `meal`; **attendance settable conversationally**; `default_cooking_nights` references → cadence.
7. **cooking-history** — schema gains `meal` (nullable, closed set incl. `project`; pre-existing-NULL scenario = F4); `log_cooked` gains `meal` + `plan_row_id`; deterministic clear-order requirement (four scenarios: row-id incl. stale-id-no-fallthrough, exact triple, earliest-due-excluding-projects, clears-one-row-only); dedupe identity `(date, meal, type, recipe|name)` with the "dedupe identity only, never plan-row identity" sentence verbatim; meal-scoped attribution scenario (NULL → all vibes).
8. **meal-plan-widget** — `ProposeCardData` slots gain `meal` (flat, meal-ordered); request carries `meals` + `attendance`; "Widget-initiated iteration" control list re-enumerated per D8/D20 (cut dials removed from the enumeration; tool params unaffected — stated); `nights` dial → per-meal counts. Data shape only, NO UI.
9. **member-app-propose** — "idempotent upserts keyed by recipe slug" rewritten: commit maps each slot to an add op with client-minted ULID + slot `meal` + `from_vibe`, `duplicate` never set (coalesce guarantees no planner duplicates; survivor-id rebind noted as the band-2/3 registry obligation); per-meal session shape; attendance contract cross-reference (control deferred; D29-final Design-project routing noted).
10. **member-app-core** — (1) "row-level ops keyed by recipe slug" → row id (slug fan-out cross-reference); (2) health-gated vibe-suggest trigger requirement **deleted**, replaced by the **410 stub-for-one-window** requirement with the pinned `{ error: "gone" }` shape; (3) Profile-page `lunch_strategy` single-select clause deleted (band-2 slice per D25(2) noted as the coupling obligation, not satisfied here).
11. **profile-reconciliation** — `add_vibe` proposals gain `meal` (default dinner; cron + pref-retirement producers set it); **`runPrefRetirementSeedJob` registered as a named signal producer** with its enqueue+NULL-in-one-batch convergence requirement (scenario = F5); terminology pass night→meal.
12. **night-vibe-archetype-derivation → renamed capability `meal-vibe-archetype-derivation`** — three-line generation requirement (phrase / weather / meal; meal fail-closed dinner; **bucket discarded for non-dinner**); "member-tappable app trigger" paragraph deleted (two producers: cron + tool); (meal, phrase-space) dedupe; cold-start starters dinner.

**Flagged extras (same pass, outside the 12):** `member-app-offline` one-clause key statement (§5); `product-specs/stories/02-meal-dimension.md` Q2–Q4 struck through with resolutions (§8); `product-specs/CHANGES.md` band-ledger edit re-homing the pref-retirement pass (§4.2). Sibling band-1 changes (spend snapshot, pantry, brands→tiers) tracked for the band, not this change.

---

## 7. Docs & persona lockstep checklist (same PR)

**Docs:**
- `docs/TOOLS.md`: every §2 delta; the **Deprecations** section (rows: 4 vibe aliases + `suggest_night_vibes`, `propose.nights` + `diagnostics.nights`, `update_preferences.default_cooking_nights` alias, retired-key accept-and-drop, `read_user_profile.default_cooking_nights` mirror, `/api/vibes/suggest` 410 stub — each with the §9 removal condition); the **warnings convention** paragraph (extending `brand-tier-model`'s).
- `docs/SCHEMAS.md`: `meal_plan` new shape (id contract, project-row constraints, ordering), `cooking_log.meal` + dedupe-identity clarification, `night_vibes.meal`/`members` ("meal vibes — stored in the `night_vibes` table"), preferences `cadence` (per-key merge) + retired-keys window note, `ProposeCardData`.
- `docs/ARCHITECTURE.md`: the class (b) sentence — **both clauses** (plan-row id + log dedupe identity); menu-generation paragraph meal dimension + attendance; vibes-suggest health-gate sentence deleted. Current-truth phrasing only.

**Persona (`packages/worker/AGENT_INSTRUCTIONS.md` — actual path, not repo root):**
1. Meal-plan/menu-gen skill (~line 144): per-meal counts from cadence; vibe-meal binding; empty-meal nudge; thread `meal` + adopt returned row ids on commit; never duplicate without the member asking (`duplicate: true` is the spelling); **attendance capture conversationally** ("the kids are gone this weekend" → `attendance: { away: [...] }`; "just the two of us" → `only`).
2. Onboarding "Cooking rhythm" (~line 568): capture the per-meal `cadence` map, not `default_cooking_nights`; follow with a `suggest_meal_vibes` offer to seed lunch/breakfast vibes when those cadences are nonzero (the forward-looking half of Appendix C's replacement). **Grep-verified no-op:** no lunch-strategy or RTE-default question exists in persona prose — recorded in tasks as verified-absent, replacement added. The "Heat-and-eat acceptance" question (~line 583) is untouched (distinct concept).
3. Cooked/log flow: pass `meal` (infer from context/time of day; ask when ambiguous; omit for non-meal events — never guess `project`); mention `plan_row_id` when the conversation anchors on a specific slot/duplicate.
4. Terminology pass: "night vibe(s)" → "meal vibe(s)" persona-wide; **new tool names only** (aliases exist for lagging plugins, never for new prose).
5. Retrospective prose: per-meal phrasing off `by_meal`.
6. Gates, same task: `aubr build:plugin --check` **and** the Appendix-C grep gate — `grep -E 'lunch_strategy|ready_to_eat_default_action|night.vibe'` over the persona must come back clean before merge.
7. Budget capture (Appendix C band 1) belongs to the spend-snapshot sibling — not edited here, stated in tasks.

---

## 8. stories/02 open questions 2–4 — resolutions (file updated in this change, Q1-style strikethroughs)

- **Q2 (non-meal log events) — RESOLVED: no fourth "other" value; NULL is the answer.** `cooking_log.meal` is nullable; NULL means "not a meal / unknown." A baked loaf logs `{type:'ad_hoc', meal: null}` — `type` and `meal` are orthogonal axes. Cooking a *planned project* logs `{type:'recipe', meal:'project'}`, which routes the deterministic clear at the project row and gives project completion a clearing path. A fourth enum value would be a second spelling of NULL and would pollute per-meal aggregation; if NULL is acceptable for every pre-migration row, it is the natural home for non-meal events forever.
- **Q3 (per-meal cadence vs vibe-debt normalization) — RESOLVED: orthogonal, as today.** `cadence_days` stays absolute days; `debt = days_since(last_satisfied)/cadence_days` unchanged; per-meal counts shape *slot supply*, debt shapes *ranking within a meal's sampling*. Per-meal sampling already expresses scarcity (a lunch vibe only competes for lunch slots); `occurrenceCap` handles window-relative repeatability; normalizing debt by supply would double-count it, make "every 7 days" mean different real intervals per household configuration, and break the deterministic fixture-testable debt math. An unfittable vibe stays maximally overdue and wins the next available slot — correct, no new mechanism.
- **Q4 (weather scope) — RESOLVED: dinner-only, per Appendix A** (authoritative; DECISIONS.md is silent). Quotas run in the dinner pass only; breakfast/lunch never carry `weather_category`; non-dinner stored affinities preserved-but-inert; the cron discards bucket labels for non-dinner clusters. Closes the live stories/02-vs-Appendix-A inconsistency in Appendix A's favor.

---

## 9. Rollout order + deprecation-window definition

**Implementation order inside the change** (each step leaves the tree green; one serial track — shared surfaces `scheduled()`, `session-db.ts`, `tools.ts`; and band-serial with the three sibling changes, which land first):
1. Pure logic: `src/ids.ts` (ULID mint + id regex); `meal-plan.ts` rewritten to id-keyed rows/ops (slug-global add resolution, candidates conflicts, fan-out); `preferences.ts` shim list + per-key cadence merge + `warnings`; blend/roster/participation pure functions; unit tests over the full ops-resolution matrix + F1–F5-shaped fixtures.
2. Migration `NNNN_meal_dimension.sql` + local-D1 migration test (seed spike pre-states, apply, assert F1–F4).
3. D1 plumbing: `session-db.ts` re-keyed on `(tenant, id)` (upsert-by-id, delete-by-id, delete-by-slug fan-out, earliest-due selector); `cooking-write.ts` clear order + row-scoped `from_vibe`; `night-vibe-db.ts` meal/members.
4. Tools: `meal_vibe` rename + alias registration; `update_meal_plan`/`read_meal_plan`/`log_cooked`/`update_preferences`/`read_user_profile`/`retrospective` deltas; `tools.ts` wiring.
5. Propose engine: per-meal shape, meal-aware course gate, empty-meal slots, engine no-duplicates, attendance + roster seam + fail-opens + diagnostics, `ProposeCardData.meal`.
6. Cron + routes: `nameCluster` third line + fail-closed parse + non-dinner bucket discard; (meal, phrase) dedupe; `runPrefRetirementSeedJob` (enqueue + NULL, one batch) + phase-5 wiring; `/api/vibes/suggest` → pinned 410 stub **+ updated worker route tests and app-suite coverage**.
7. Same-pass lockstep: TOOLS.md/SCHEMAS.md/ARCHITECTURE.md; 12 spec deltas + flagged extras (member-app-offline clause, stories/02 strikethroughs, CHANGES.md re-home); persona edits + `build:plugin --check` + grep gate.
8. Post-merge: single deploy (migration → Worker → plugin publish); F1–F4 `--remote` acceptance queries; F5 after the first cron tick and re-checked after the second (idempotency/termination).

**Deploy skew:** accepted per §1's gap analysis (plan writes fail structured for seconds; everything else — vibe reads, propose, attribution, cron — survives, because no table renames).

**"One deprecation window," concretely.** Opens at this band's deploy: Worker W₁ (new names + aliases + shims + 410 stub + mirrors) and plugin P₁ (new names only) publish together, Worker-first. Closes when **both** hold: **(a)** a subsequent plugin publish P₂ has occurred (band 2's `profile-planning-and-vibes-ui` per D25(2) is the expected vehicle — refreshing marketplace pulls and aging out mid-conversation cached skills), **and (b)** ≥30 days have elapsed since P₁. The cleanup is a named follow-up change, **`remove-meal-dimension-shims`, created at this change's archive time** so it cannot be forgotten, and it is table-driven off TOOLS.md's Deprecations section (a grep, not archaeology). It removes: the `*_night_vibe` aliases, `propose.nights` + `diagnostics.nights`, the `default_cooking_nights` write alias and read mirror, the retired-key shim entries (keys fall through to generic unknown-key rejection), the `/api/vibes/suggest` 410 stub, and — migration `00NN` — the `profile.lunch_strategy`/`ready_to_eat_default_action`/`default_cooking_nights` columns. Preconditions verified in production first: the two retired columns NULL everywhere (F5 convergence — a checkable column-level predicate), and no NULL-`cadence` profile depends on `default_cooking_nights` (structurally guaranteed: the migration backfilled all non-NULL rows and the column is frozen; the read-time derivation's terminal fallback becomes `{0,0,5}`).

**Contradiction ledger** (nothing in DECISIONS.md contradicted): D21 "lunch/breakfast" phrasing read as illustrative (§4.2 flag); stories/02 Q4 superseded by Appendix A (§8); CHANGES.md band-ledger re-home of the pref-retirement pass, edited same pass (§4.2); `wrangler.jsonc` database-name mismatch escalated, not fixed (§1); Appendix C persona "question removal" grep-verified a prose no-op (§7); `AGENT_INSTRUCTIONS.md` actual path is `packages/worker/`.

---

## 10. Judge-issue resolution log

**Fatals raised against the base (`migration-first`) — all fixed:**

| # | Issue (judge) | Resolution |
|---|---|---|
| 1 | Cross-meal silent duplication: coalesce keyed on `(recipe, meal)` lets a plain/replayed add insert a duplicate without `duplicate: true` (J1, J2, J3) | §2.1 step 3: coalesce is **slug-global across all meals**; `meal` supplied on a coalescing add = *move*, matching pages/03. `duplicate: true` is again the only duplication spelling; pre-deploy slug-keyed offline queues replay onto the moved row instead of forking it. |
| 2 | Coalescing add silently auto-picks earliest-due among multiple matches, swallowing the ambiguity `set`-by-slug must surface (J3) | §2.1: **>1 match → per-op conflict with `candidates`** (engine-first's rule grafted wholesale); earliest-due auto-pick removed from `add` entirely. The commit path still updates structurally in the 1-match case; the >1 case is genuine member-created ambiguity, surfaced for id-addressing. |
| 3 | D8 seed pass never terminates; convergence predicate uncheckable; depends on proposal-disposition retention (J2) | §4.2: engine-first's mechanics grafted — enqueue the proposal **and NULL both retired columns in one D1 batch**. Columns-NULL is the crisp, production-checkable convergence predicate and the window-close gate; converged tenants match nothing; dismissals can't resurrect. Member confirmation preserved (suggestions, not silent writes). `default_cooking_nights` stays frozen-not-NULLed (the cadence read-fallback reads it) and drops at window close. |
| 4 | ARCHITECTURE.md lockstep gap: the adjacent log-dedupe clause left stale (J1) | §5: the class (b) sentence rewrite covers **both** clauses — plan rows by id AND "log rows deduped on `(date, meal, type, recipe|name)`" — one pass, no partial-sentence drift. |
| 5 | Persona omits D29-final's "attendance settable conversationally" (J1) | §7 item 1: explicit menu-gen skill line ("kids are gone this weekend" → `attendance: { away }`; "just the two of us" → `only`), grafted from engine-first. |
| 6 | `cadence` wholesale replacement contradicts the RFC 7396 merge-patch contract and the design's own merging alias (J3) | §2.5: **per-key merge** (`{cadence:{lunch:2}}` sets lunch only; per-key `null` clears a key; `cadence: null` clears the map) — consistent with the documented contract and the alias. Values pinned 0–7 (weekly counts); the propose `meals` override stays 0–14 per-window. |
| 7 | 410 stub's error shape unpinned against `src/errors.ts` / the member-API convention (J3) | §4.1: pinned to the member-API route-level convention verified in the repo (`c.json({ error: <literal>, message }, status)`, like `csrf_rejected`): `{ error: "gone", message: … }, 410`. Explicitly NOT a `ToolError` code; documented in the member-app-core delta. Route tests updated in-change. |
| 8 | Scope-ownership: CHANGES.md assigns the pref-retirement convergence to band-2's `profile-planning-and-vibes-ui` (J3) | §4.2: explicitly **re-homed** into this change with rationale (write-path retirement and window-close gating both live here; seeds need no UI), and CHANGES.md's band ledger edited in the same pass. D25(2)'s UI coupling stays a band-2 obligation. |

**Fatals raised against the non-winning designs — verified avoided in the final:**
- *contract-first:* false "spec-only" premise about `/api/vibes/suggest` → final treats the route as live code with the 410 stub + test updates (§4.1). Id-new+slug-planned conflict contradicting D26-final commit semantics → final's coalesce wins in the 1-match case (§2.1). Physical vibe-table rename skew → no table renames (§1). Silent palette insert → proposal-based seeds (§4.2). 7-day-only window → two-condition close incl. ≥30 days (§9). Stale `plan_row_id` writes-nothing → log-still-written with note (§2.3).
- *engine-first:* live-route deletion with no rollout → 410 stub (§4.1). Dated-project "convention not validation" → op-layer enforcement (§2.1), and the earliest-due clear excludes project rows (§2.3). `vibeParticipates` with no fail-open → stale-members fail-open-to-everyone + diagnostics (§3). Positive-only attendance shape → `{away}|{only}` (§2.7/§3). Speculative `created_at` → rejected; id tiebreak documented arbitrary-but-deterministic (§ Vocabulary). Alias-response warnings injection → rejected per J3 (aliases behavior-identical; warnings stay the `update_preferences` convention — the J2-vs-J3 conflict resolved in favor of the judge who flagged it as a D21-framing violation). Cadence 0–14 incoherence and alias dual-writing the frozen column → 0–7, alias never touches the column (§2.5). Window close with no minimum age → ≥30-day floor added to the archive-time follow-up change (§9).

**Grafts applied:** contract-first — warnings-as-convention, `householdRoster` seam (D10), attendance/unknown-id/empty-set fail-opens, stale-vibe-members fail-open, convergence-must-converge argument, `read_user_profile` `default_cooking_nights` mirror, `(tenant, id)` PK, per-window counts statement, tool-vs-skill audit checklist, vector-reconcile probe. engine-first — enqueue+NULL-in-one-batch convergence, meal-aware breakfast course gate, non-dinner bucket-label suppression, conversational-attendance persona line, add-resolution order with survivor-id rebind, grep gate, member-app-offline clause, archive-time cleanup change, flat-array meal-ordering guarantee, stale-`plan_row_id`-noted-in-result. migration-first (retained) — 410 stub, no-re-embed statement, F1–F5 fixtures, project-row clear exclusion, deploy-gap analysis, no table renames, `diagnostics.nights` alias, split idempotency by address mode, two-condition window + Deprecations table.
