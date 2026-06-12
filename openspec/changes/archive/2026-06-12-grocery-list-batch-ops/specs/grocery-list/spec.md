## MODIFIED Requirements

### Requirement: Grocery list CRUD tools

The system SHALL provide `read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, and `remove_from_grocery_list` for single-item live edits. `add_to_grocery_list` SHALL be keyed by normalized `name`: re-adding an existing name MERGES into the existing entry (union `for_recipes`, reconcile `quantity`) rather than creating a duplicate. New items SHALL be created with `status: active`. All mutations SHALL persist via the atomic commit engine.

Multiple grocery-list mutations produced while resolving a single turn SHALL be persisted as **one** commit — via `commit_changes`' `grocery_list_ops` field — rather than as a sequence of single-item commits or as parallel single-item writes. Because grocery-list writes are full-file read-modify-writes of one file, concurrent single-item writes are not safe (the commit engine's full-file replay can drop updates); the single-item tools are for genuine one-off edits, and any batch SHALL go through `commit_changes`.

#### Scenario: Re-adding an existing item merges

- **WHEN** `add_to_grocery_list` is called with a name already present on the list
- **THEN** the existing entry is updated (merged `for_recipes`, reconciled `quantity`) and no duplicate entry is created

#### Scenario: New item starts active

- **WHEN** a not-yet-present item is added
- **THEN** it is created with `status: "active"` and an `added_at` date and committed

#### Scenario: Read returns the current list

- **WHEN** `read_grocery_list` is called
- **THEN** it returns the current items with their fields, including `status` and `source`

#### Scenario: A multi-item capture is one commit

- **WHEN** a menu capture adds several to-buy items at once
- **THEN** they are persisted through `commit_changes` `grocery_list_ops` as a single commit (together with the menu's other repo writes), not as one commit per item
