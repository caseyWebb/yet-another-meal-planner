## ADDED Requirements

### Requirement: toggle_favorite sets the per-tenant favorite boolean

The system SHALL expose `toggle_favorite(slug, favorite)` that sets (or clears) the caller's `favorite` boolean on a shared recipe, written as per-tenant overlay. There SHALL be no star-rating write tool. This is the only recipe-disposition write needed in the favorite model, dissolving the prior `update_recipe`-vs-`rate_recipe` question into a single boolean toggle.

#### Scenario: Favoriting is a per-tenant overlay write

- **WHEN** the caller favorites a shared recipe
- **THEN** `favorite: true` is recorded as the caller's overlay for that slug, without modifying shared content or any other member's overlay

#### Scenario: No star rating is accepted

- **WHEN** a caller attempts to write a 1–5 star rating
- **THEN** there is no such tool; disposition is expressed only as the `favorite` boolean

## MODIFIED Requirements

### Requirement: Writes are routed by data category

The system SHALL route each write to the correct location within the single data repo by data category: objective recipe **content** and shared reference/SKU data SHALL be written at the repo **root** (`recipes/`, reference files, `skus/`); per-tenant **overlay** (the `favorite` boolean, and any `hidden` flag), **notes**, personal recipes, and personal state (pantry, preferences, taste, diet_principles, grocery_list, stockup, cooking_log) SHALL be written under the caller's **`users/<username>/`** subtree (overlay lands in the `d1-profile` overlay store once that slice is in D1). There is no per-tenant substitution-override file and no star `rating` field. A subjective-field change to a shared recipe SHALL NOT modify shared content. (`last_cooked` is not written as overlay — it is realized by appending to the caller's `cooking_log`.)

#### Scenario: Content edit targets the shared root

- **WHEN** an objective edit to a shared recipe's content is persisted
- **THEN** it is committed to `recipes/` at the data-repo root

#### Scenario: Overlay, notes, and personal state target the user subtree

- **WHEN** a tenant's favorite toggle, note, pantry change, or preference edit is persisted
- **THEN** it is recorded as that tenant's overlay/personal state, never to the shared root or another member's data
