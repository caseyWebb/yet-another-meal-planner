## ADDED Requirements

### Requirement: Review impulse lines use the shared D16 send operation

A bare item added during Order Review SHALL be classified `impulse` only when final send successfully materializes and advances it through the same shared D16 send operation as planned lines. Its send snapshot SHALL carry current resolved pick, package quantity, quote/savings, store, fulfillment, department and `provenance:impulse`; later purchase assertion SHALL materialize that immutable snapshot through the one shared writer. Preview, broader/manual search, staged selection, skip, unavailability, revalidation failure, cart failure with successful compensation, and UI confirmation SHALL emit no spend event and SHALL NOT write a standalone telemetry record.

#### Scenario: Sent impulse materializes only at purchase assertion
- **WHEN** a review-added extra reaches the Kroger cart and is later included in Mark order placed
- **THEN** its send line already carries impulse provenance and one spend event is materialized verbatim at the assertion

#### Scenario: Previewed or left-off impulse emits nothing
- **WHEN** an impulse is previewed but skipped, unresolved, or rejected by final revalidation
- **THEN** no send line or spend event exists for it

### Requirement: Order Review totals use the D16 quote source

The review preview MAY show a transient estimate produced by the same pure send-line quote builder, labeled as a current preview. After send, Order Review and Grocery SHALL derive item count, estimated total, and flyer savings from the persisted `order_send_lines` for that send id, which is the same source later copied into spend events. A missing send snapshot SHALL render those values unavailable; no surface SHALL substitute client arithmetic or stale preview totals.

#### Scenario: Confirmation and later spend share one quote
- **WHEN** a send records a promo-priced line and is later marked placed
- **THEN** Order Review confirmation totals that persisted line and the spend event copies the same quote verbatim

#### Scenario: Missing snapshot stays visibly unknown
- **WHEN** telemetry recording degrades but the Kroger cart write succeeds
- **THEN** confirmation reports the cart success and snapshot error while omitting persisted total/savings
