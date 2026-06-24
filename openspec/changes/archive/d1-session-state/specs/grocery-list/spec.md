## MODIFIED Requirements

### Requirement: Grocery list is stored in and served from D1

The grocery list SHALL be stored as rows in the D1 `grocery_list` table (per tenant), not as a `state:<username>:grocery_list` JSON array in KV. `read_grocery_list` SHALL query rows (status filter as a `WHERE` clause); `add_to_grocery_list` / `update_grocery_list` / `remove_from_grocery_list` and the order/cart status transitions SHALL be row-level upsert/update/delete (dedup by normalized name), not whole-array rewrites. Writes are strongly consistent (read-after-write).

#### Scenario: Adding an item inserts/updates one row

- **WHEN** `add_to_grocery_list` adds an item
- **THEN** a single `grocery_list` row is upserted for the caller, leaving other items untouched, and an immediately following read sees it

#### Scenario: Status filter is a query

- **WHEN** `read_grocery_list` is called filtered to `active`
- **THEN** the result comes from `WHERE tenant=? AND status='active'`, not by loading and filtering the whole list
