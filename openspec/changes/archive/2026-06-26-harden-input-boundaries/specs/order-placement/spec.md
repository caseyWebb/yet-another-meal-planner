## MODIFIED Requirements

### Requirement: Quantity and partial-stock prompting

`place_order` SHALL default the buy quantity to one package per item unless a package count is supplied. A package count MAY be supplied per item via `menu_needs[].quantity`, and the per-name `quantities` map SHALL override it when both are present (precedence: `quantities` map → `menu_needs[].quantity` → default 1; a non-positive value is treated as not supplied). A supplied package count SHALL be a positive integer within a sane upper bound; `place_order` SHALL reject a fractional, zero, negative, or oversized count with a structured `validation_failed` error and SHALL NOT write the Kroger cart with it. The `grocery_list` item `quantity` is a human need-annotation (e.g. "2 lbs") and SHALL NOT be interpreted as a package count.

Each to-buy and resolved line SHALL carry `assumed_quantity` — `true` exactly when no package count was supplied from either source and the line fell back to 1. The tool SHALL surface this fact but SHALL NOT itself classify a line as "by-the-each produce" or compute portion math; that judgment SHALL remain with the agent (consistent with the no-portion-math stance). At the `preview` step the agent SHALL reconcile `assumed_quantity` lines that are by-the-each produce against the recipe's required amount and set an explicit quantity before the real flush, rather than silently ordering one.

When the pantry holds a **partial** of an ingredient the plan needs, the agent SHALL tell the user how much the plan needs (aggregated from the recipes' stated amounts) and ask whether to buy more — it SHALL NOT silently net partials against the order.

#### Scenario: Partial triggers a prompt

- **WHEN** an ingredient on the to-buy set is also present in the pantry as a partial
- **THEN** the agent surfaces the plan's required amount and asks whether to add it, rather than auto-deciding

#### Scenario: menu_needs quantity is honored

- **WHEN** `place_order` is called with `menu_needs: [{ name: "anaheim peppers", quantity: 4 }]` and no `quantities` override for that name
- **THEN** the to-buy line for anaheim peppers has quantity 4 (not the default 1) and `assumed_quantity: false`

#### Scenario: quantities map overrides the per-need quantity

- **WHEN** `place_order` is called with `menu_needs: [{ name: "anaheim peppers", quantity: 4 }]` and `quantities: { "anaheim peppers": 6 }`
- **THEN** the to-buy line has quantity 6 (the explicit override wins) and `assumed_quantity: false`

#### Scenario: a defaulted line is flagged as assumed

- **WHEN** an item reaches the to-buy set with no package count from either source
- **THEN** its line has quantity 1 and `assumed_quantity: true`, so the agent can reconcile by-the-each produce against the recipe at preview

#### Scenario: an invalid package count is rejected before the cart

- **WHEN** `place_order` is called with a fractional (`1.5`), zero, negative, or oversized (e.g. `100000`) package count via `quantities` or `menu_needs[].quantity`
- **THEN** the tool returns a structured `validation_failed` error and writes no Kroger cart
