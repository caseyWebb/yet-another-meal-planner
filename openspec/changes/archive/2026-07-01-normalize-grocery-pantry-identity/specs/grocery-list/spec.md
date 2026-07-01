## MODIFIED Requirements

### Requirement: Grocery list CRUD tools

The system SHALL provide `read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, and `remove_from_grocery_list` for single-item live edits, each a row-level D1 operation that returns without a `commit_sha`. `add_to_grocery_list` SHALL be keyed by a **normalized name** and MERGE a re-added name into the existing row (union `for_recipes`, reconcile `quantity`) via upsert rather than creating a duplicate. The normalized key SHALL be resolved through the shared `IngredientContext` funnel (the canonical ingredient id — normalize **and** capture) for a **food** row, and through `normalizeName` (lowercase + whitespace-collapse) for a **non-food** row, where a row is food iff its `kind` is `grocery` and its `domain` is grocery (or absent). A non-food row SHALL NOT be resolved or captured, so the ingredient identity graph only ever ingests real food vocabulary. `remove_from_grocery_list` SHALL resolve its query through the same funnel so a case/quantity/alias-varying removal hits its row. New items SHALL be created with `status: active`. Because each write is a single-row D1 upsert/update/delete (no whole-file read-modify-write), several mutations in one turn are simply a sequence of row-level writes — there is no batch/commit tool and no full-file replay to drop concurrent updates.

#### Scenario: Re-adding an existing item merges

- **WHEN** `add_to_grocery_list` is called with a name already present on the list
- **THEN** the existing row is upserted (merged `for_recipes`, reconciled `quantity`) and no duplicate row is created

#### Scenario: Surface-form variants of a food item merge to one row

- **WHEN** a food item is on the list as "scallions" and `add_to_grocery_list` is called with "green onions" (or "2 lb chicken breast" when "chicken breast" is present)
- **THEN** both resolve to the same canonical id, so the add MERGES into the existing row rather than creating a second, surface-form-fragmented row

#### Scenario: A non-food item is not routed through the ingredient graph

- **WHEN** `add_to_grocery_list` is called with a `household`/`other` item or a non-grocery `domain` (e.g. "AA batteries", "potting soil")
- **THEN** the row is keyed by `normalizeName` and the name is NOT resolved or enqueued to the novel-term queue

#### Scenario: New item starts active

- **WHEN** a not-yet-present item is added
- **THEN** a `grocery_list` row is created with `status: "active"` and an `added_at` date, with no `commit_sha`

#### Scenario: Read returns the current list

- **WHEN** `read_grocery_list` is called
- **THEN** it returns the current rows with their fields, including `status` and `source`

#### Scenario: A multi-item capture is a sequence of row writes

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** each item is upserted as its own `grocery_list` row (no batch commit tool, no per-item git commit)
