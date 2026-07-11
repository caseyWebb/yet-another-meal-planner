# meal-planning Specification

## Purpose
TBD - created by archiving change cooking-log-and-retrospection. Update Purpose after archive.
## Requirements
### Requirement: Meal plan is stored in and served from D1

The meal plan SHALL be stored as rows in the per-tenant D1 `meal_plan` table with **per-slot row identity** (D26-final): PRIMARY KEY `(tenant, id)`, where `id` is an opaque string matching `^[0-9A-Za-z_-]{10,40}$` — canonically a client- or server-minted **ULID** (the one-time migration's SQL-minted 32-hex ids also satisfy the regex). Because id formats mix, no semantic SHALL parse or meaningfully sort an id: ordering always uses `planned_for`/`meal`, with `id ASC` as an arbitrary-but-deterministic final tiebreak. Each row carries `recipe`, `meal` (`breakfast|lunch|dinner|project`, default `dinner`), and the existing `planned_for`/`sides`/`from_vibe`. A recipe MAY occupy multiple rows, but ONLY by explicit user action — the **planner-no-duplicates invariant**. Writes are strongly consistent and row-level.

`update_meal_plan` SHALL apply ops with this contract (returning per-op `applied` / `conflicts`, never throwing):

**`add`** — deterministic resolution order (the commit-side no-duplicates enforcement):
1. A supplied `id` that exists (tenant-scoped) → **replay/update** that row: `planned_for` set when supplied, `sides` unioned, `meal`/`from_vibe` set when supplied. When the op's `recipe` does not slug-match the row's recipe (case-insensitive) → per-op conflict ("id addresses a different recipe"). Replaying a queued offline add is a no-op-shaped update — the class (b) idempotency property, in every branch.
2. Else `duplicate: true` → **insert** (supplied id or server-minted ULID) — the ONE wire spelling of explicit duplication. On redelivery the id exists → step-1 update, so an explicit duplication replayed never creates a second duplicate.
3. Else **slug-global coalesce** (case-insensitive, across ALL meals — no cross-meal duplication hole): **0** matching rows → insert (`meal` defaults `'dinner'` for meal-agnostic entry points); **exactly 1** → update it (`meal` supplied = move the row between meals, `sides` unioned, `planned_for`/`from_vibe` set when supplied), reporting the **surviving row's id** with `coalesced: true` — the client-supplied id is discarded and the caller adopts the survivor's; **>1** (explicit duplicates exist) → per-op **conflict with `candidates`** (`{ id, meal, planned_for, sides? }`) — never an earliest-due auto-pick; the caller re-issues by `id` or with `duplicate: true`.

Any applied add still stamps `profile.last_planned_at`.

**`remove`** — exactly one addressing field. By `id`: **idempotent** — applied with `removed: 0|1`; a missing id is never a conflict (replay safety). By `recipe` slug, optionally narrowed by `meal`: deletes **all** matching rows (D26-final's defined fan-out), applied with `removed: N` plus the removed ids; zero matches stays a conflict as today. Split idempotency is deliberate: id-addressed ops are the offline-replay surface and must replay silently; slug-addressed ops are the conversational surface where "nothing matched" is signal.

**`set`** — exactly one addressing field. By `id`: must exist (else conflict); may change **any** field including `recipe` (swap-in-slot) and `meal`; project constraints enforced as in `add` (the op may itself supply `planned_for: null` + `sides: []` to satisfy them). By slug (optionally narrowed by `meal`): **unique match required** — zero → conflict as today, **>1 → conflict with `candidates`**; slug-addressed `set` may NOT change `recipe` (recipe-swap requires id addressing). Field semantics unchanged: a supplied `sides` array replaces the row's sides wholesale (an empty array removes them all); a supplied `planned_for` sets and an explicit `planned_for: null` clears; `from_vibe` supplied sets (null clears) / absent preserves.

When a recipe is cooked, `log_cooked` SHALL clear at most one plan row deterministically (the `cooking-history` capability's clear order) in the **same D1 transaction** as the cooking-log insert.

#### Scenario: An id-addressed add replays idempotently

- **WHEN** the same `add` op with a client-minted id is delivered twice (an offline replay)
- **THEN** the first delivery inserts (or coalesces) and the second updates the same row in place — no duplicate row is ever created by replay

#### Scenario: A plain add coalesces across meals as a move

- **WHEN** `update_meal_plan` adds a recipe with `meal: "lunch"` and exactly one plan row for that slug already exists as a dinner
- **THEN** the existing row moves to lunch (sides unioned, `planned_for`/`from_vibe` set when supplied), the response reports the surviving row's id with `coalesced: true`, and no second row is created

#### Scenario: Explicit duplication is the one spelling

- **WHEN** `update_meal_plan` adds an already-planned recipe with `duplicate: true`
- **THEN** a second row is inserted for the slug — and without `duplicate: true`, an add against a slug with multiple existing rows returns a per-op conflict with `candidates`, never an auto-pick

#### Scenario: Remove fans out by slug, replays by id

- **WHEN** `remove` addresses a slug with three rows, and separately a `remove` by id is replayed after the row is already gone
- **THEN** the slug remove deletes all three (applied, `removed: 3`, ids listed) and the id remove applies with `removed: 0` — never a conflict

#### Scenario: A set by slug demands uniqueness

- **WHEN** `set` addresses a slug that matches two rows
- **THEN** the op returns a per-op conflict carrying both rows as `candidates`, and the caller re-issues by id

#### Scenario: An id addressing a different recipe is refused

- **WHEN** an `add` op supplies an existing id whose row holds a different recipe slug
- **THEN** the op returns a per-op conflict ("id addresses a different recipe") and writes nothing

### Requirement: Transient meal plan of committed cook intent

The meal plan SHALL be a transient record of committed cook intent (the D1 `meal_plan` table) at **slot grain**: each row carries its opaque `id`, a `recipe` slug, a **`meal`** (`breakfast | lunch | dinner | project`), and MAY carry an optional `planned_for` ISO date. A row MAY additionally carry an optional **`sides`** array of free-text **open-world side** names (e.g. `["roasted broccoli", "white rice"]`) — sides that accompany the main on the plate but are not themselves corpus recipes and therefore have no slug. The `sides` array SHALL be advisory free text only: it SHALL NOT be slug-resolved, and the `recipe` slug invariant (and the reconcile/cook flows that key off it) SHALL be unaffected by its presence. A **corpus side** (a `course: side` recipe with a slug) SHALL instead earn its own row, not an entry in another row's `sides`. The meal plan SHALL be distinct from the grocery list: the grocery list is ingredient-grain and holds only items to buy, so a planned recipe whose ingredients are all already in the pantry SHALL still appear in the meal plan. Rows SHALL be cleared as they resolve — removed when the recipe is cooked, or dropped when abandoned.

#### Scenario: Planned recipe recorded even when nothing must be bought

- **WHEN** the user agrees to cook a recipe whose ingredients are all in the pantry
- **THEN** a `meal_plan` row for that recipe is upserted even though nothing is added to the grocery list

#### Scenario: Cooking clears the planned row

- **WHEN** a planned recipe is cooked and logged
- **THEN** its `meal_plan` row is removed in the same D1 transaction as the cooking-log insert

#### Scenario: Open-world side rides on its main's row

- **WHEN** the user agrees to a main rounded out with an open-world side ("roasted broccoli") that is not a corpus recipe
- **THEN** the main's `meal_plan` row carries `sides = ["roasted broccoli"]`, no separate slug row is created for the side, and the row's `recipe` slug (and the reconcile) is unchanged

#### Scenario: Corpus side earns its own row

- **WHEN** the user agrees to a main paired with a `course: side` corpus recipe
- **THEN** the corpus side gets its own `meal_plan` slug row (not a `sides` entry on the main's row)

### Requirement: Read the meal plan

The system SHALL provide a `read_meal_plan` tool returning the current `meal_plan` rows so the agent can resume cook intent across sessions. The result SHALL be a **flat ordered array** — `{ planned: [{ id, recipe, meal, planned_for, sides?, from_vibe? }] }` — where "grouped by meal" is an **ordering guarantee**, not a nesting change: dated rows first by `(planned_for, meal order breakfast < lunch < dinner)`, then undated rows grouped by meal, then `project` rows last, with ties broken by `id ASC` (arbitrary-but-deterministic). The returned `id` SHALL be documented as **the** address for row-level edits and the class (b) offline-replay key. Project rows SHALL flow into the to-buy derivation like any planned row (no `read_to_buy` contract change).

#### Scenario: Plan readable in a fresh session, meal-ordered

- **WHEN** a new conversation begins and the `meal_plan` table has dated rows, undated rows, and a project row for the caller
- **THEN** `read_meal_plan` returns one flat array: dated rows by date then meal order, undated rows grouped by meal, the project row last — each row carrying its `id`, `recipe`, and `meal`

#### Scenario: Ordering is deterministic

- **WHEN** two rows tie on `planned_for` and `meal`
- **THEN** they order by `id ASC` — an arbitrary but stable tiebreak that no consumer reads meaning into

### Requirement: Plan and cook modes

`AGENT_INSTRUCTIONS.md` SHALL define two operating modes. **Plan mode** SHALL cover the existing inventory, recipe, menu, and order behavior, and SHALL write `planned` rows on menu agreement. **Cook mode** SHALL be triggered by the user asserting they are making or have made a dish ("I'm making X", "I made X"), and SHALL walk the user through confirming the cook and updating inventory, including asking whether the last of consumed ingredients was used. The full hands-free, voice-guided step-by-step walkthrough is out of scope for this change and SHALL be deferred to a later Guided cook mode change; cook mode here SHALL be the minimal confirm-and-capture flow.

#### Scenario: Cook-intent utterance enters cook mode

- **WHEN** the user says "I'm making the arroz caldo"
- **THEN** the agent enters the minimal cook-capture flow: confirm the dish, prompt pantry decrements, ask about using the last of ingredients, and log the cook on completion

#### Scenario: Guided walkthrough is not attempted

- **WHEN** the user is in cook mode in this change
- **THEN** the agent performs confirm-and-capture and does NOT attempt timed step-by-step guidance (deferred)

### Requirement: Stale-planned reconcile at session start

When a session begins with **due** planned rows in the `meal_plan` table, the agent SHALL surface them and ask whether any were cooked — structurally parallel to the order flow's stale-cart check. A row is **due** when its `planned_for` is on or before today, or when `planned_for` is unset; future-dated rows SHALL NOT trigger the reconcile. Recipes the user confirms cooked SHALL be logged and cleared; recipes the user abandons SHALL be dropped from the plan. The agent SHALL NOT silently assume planned recipes were cooked.

#### Scenario: Due plan prompts a reconcile

- **WHEN** a new session starts and the `meal_plan` table has rows with `planned_for` on or before today (or unset)
- **THEN** the agent asks which were cooked, logs and clears the confirmed ones, and drops the abandoned ones

#### Scenario: Future-dated plan does not nag

- **WHEN** the only planned rows have a `planned_for` after today
- **THEN** the agent does not prompt a reconcile for them

#### Scenario: No silent promotion

- **WHEN** the user does not confirm cooking a due planned recipe
- **THEN** the agent leaves it unlogged (its `last_cooked` unchanged) rather than recording a cook

### Requirement: Slot provenance on planned rows

A `meal_plan` row MAY carry an optional **`from_vibe`** field recording the night-vibe slot it was proposed to fill (the `night-vibe-palette` capability). `from_vibe` SHALL be advisory provenance only: it SHALL NOT be slug-resolved against recipes, SHALL NOT affect the `recipe` slug invariant or the reconcile/cook flows that key off it, and SHALL be optional (absent for a hand-picked or off-vibe plan). `update_meal_plan` SHALL accept and preserve `from_vibe` on an add/upsert. It exists so that cooking a planned row can attribute satisfaction back to the vibe that shaped the slot: at `log_cooked` (the `cooking-history` capability) `from_vibe` acts as a **guaranteed-reset prior** — the vibe it names always records satisfaction, even when the cook-time cosine match would be borderline — layered under the cosine attribution that additionally credits any other vibe the cooked recipe matches. Its absence is not a loss of attribution: an off-plan or hand-picked cook is still attributed by the cosine match alone.

#### Scenario: A vibe-sourced plan row records its provenance

- **WHEN** `update_meal_plan` adds a row that `propose_meal_plan` produced for a given vibe slot
- **THEN** the row carries `from_vibe` for that vibe, preserved on upsert, and cooking it guarantees that vibe resets regardless of the cosine borderline

#### Scenario: A hand-picked plan row omits provenance

- **WHEN** a member hand-picks a recipe with no vibe slot
- **THEN** the row omits `from_vibe`, and cooking it is still attributed by the cook-time cosine match alone

### Requirement: Project rows carry no date or sides

Projects (pages/03's "Baking, treats & drinks") are ordinary `meal_plan` rows with `meal = 'project'`. An op that would produce a project row with a non-null `planned_for` or a non-empty `sides` array (whether inserting, moving a row to `project`, or editing an existing project row) SHALL be refused with a per-op structured conflict ("project rows carry no date or sides") — **op-layer enforcement**, not a SQL CHECK and not a convention, so the caller gets a structured conflict rather than a raw storage failure. A `set` moving a row to `project` MAY itself supply `planned_for: null` and `sides: []` to satisfy the constraint in the same op. Project rows reach `read_meal_plan` and the to-buy derivation for free.

#### Scenario: A dated project is refused at the op layer

- **WHEN** `update_meal_plan` adds a recipe with `meal: "project"` and `planned_for: "2026-07-20"`
- **THEN** the op returns a per-op conflict ("project rows carry no date or sides") and writes nothing — a structured result, not a SQL error

#### Scenario: A move to project can clear the offending fields itself

- **WHEN** `set` addresses a dated, sided dinner row by id with `{ meal: "project", planned_for: null, sides: [] }`
- **THEN** the row becomes a project row with no date and no sides in one applied op

### Requirement: The migration mints row identity once

The meal-dimension migration SHALL rebuild `meal_plan` onto the `(tenant, id)` primary key exactly once, minting a 32-character lowercase-hex id per existing row in SQL, defaulting every existing row's `meal` to `'dinner'`, and preserving `recipe`, `planned_for`, `sides`, and `from_vibe` byte-for-byte. It SHALL add no unique index on `(tenant, recipe)` — uniqueness moves to the op layer's coalesce rule. The pre-migration production rows are the acceptance fixture (F1), asserted locally in tests and read-only against production after deploy.

#### Scenario: Production rows survive the mint (F1)

- **WHEN** the migration runs over the three production rows (two of casey's — one carrying sides — and one of everett's, all `planned_for` NULL)
- **THEN** exactly three rows remain, each with a distinct id matching `^[0-9a-f]{32}$`, `meal = 'dinner'`, `sides` byte-identical, and `planned_for`/`from_vibe` still NULL

