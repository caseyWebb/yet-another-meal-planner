## ADDED Requirements

### Requirement: Instacart Marketplace handoff is not an order lifecycle transition

Creating or opening an Instacart Marketplace shopping-list URL SHALL NOT be treated as an order/cart flush. The shared Instacart handoff operation SHALL NOT mutate grocery rows, advance `active → in_cart`, stamp `sent_in`, write `order_sends` or `order_send_lines`, invoke a purchase assertion, write or materialize spend events, or restock pantry. Its result and every calling surface SHALL state only that a shopping-list page is ready for member review; it SHALL NOT assert that any product was matched, added to a cart, checked out, ordered, or purchased. Kroger `place_order`, satellite cart-fill, manual/walk commit, and user-asserted lifecycle behavior SHALL remain unchanged.

#### Scenario: Successful handoff leaves active rows active

- **WHEN** Instacart returns a valid `products_link_url` for a tenant's active to-buy lines
- **THEN** the operation returns the URL while every stored grocery row, `sent_in`, and `ordered_at` remains unchanged

#### Scenario: No send or spend record exists for handoff

- **WHEN** a handoff URL is created, reused, or opened
- **THEN** no order send, send line, spend event, or purchase assertion is written for those actions

#### Scenario: Derived virtual lines remain virtual

- **WHEN** an Instacart request includes a plan-derived to-buy line with no grocery row
- **THEN** the handoff does not materialize a row or otherwise change the next derived to-buy view

#### Scenario: Existing fulfillment transitions are unchanged

- **WHEN** a tenant uses Kroger, satellite cart-fill, a store walk, or a user-asserted mark-placed action after this change
- **THEN** its existing lifecycle/send/spend contract applies exactly as before and never infers state from an Instacart URL
