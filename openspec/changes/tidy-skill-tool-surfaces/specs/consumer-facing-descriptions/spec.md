## ADDED Requirements

### Requirement: Tool descriptions and skills own complementary halves of a fact

A given fact SHALL have exactly one canonical home across the MCP tool descriptions and the generated skills, allocated by the test: *could a different agent, with no skills loaded, use this tool correctly and safely from its description alone?*

- The **tool description** SHALL own what the tool does, its params/enums/returns, its guarantees — **including negative guarantees** ("never auto-applies", "rejects `last_cooked`", "returns facts not freshness verdicts") — and the **data-model field semantics it reads or writes** (e.g. `requires_equipment`, `perishable_ingredients`, `standalone`, `pairs_with`, the meaning of a status enum, and which read throws `not_found` when uninitialized).
- The **skill** SHALL own when in a flow to call the tool, sequencing across tools, how to act on the result, and what to confirm with the user.

A negative guarantee that reads like policy SHALL remain in the tool description (it is contract); its matching choreography SHALL remain in the skill. The two are complementary halves, not a duplicate, so de-duplication is bidirectional: choreography stranded in a tool description moves to the skill, and field-semantics stranded only in a skill move into the tool description.

#### Scenario: A guarantee stays in the tool, its choreography in the skill

- **WHEN** a tool never applies an action automatically (e.g. `propose_substitutions`)
- **THEN** the "never auto-applies" guarantee is stated in the tool description
- **AND** the "offer it and let the user pick" step is stated in the skill, not duplicated as policy in the tool

#### Scenario: Field semantics live in the tool, not only the skill

- **WHEN** a recipe-writing tool accepts a classified field (e.g. `requires_equipment`, `perishable_ingredients`)
- **THEN** the field's meaning and classification rule is documented in that tool's description so a caller without the skill can populate it correctly

#### Scenario: A pure arg-contract duplicate is removed from the skill

- **WHEN** the same arg-contract detail (e.g. a tool's period enum) appears in both a tool description and a skill body
- **THEN** it is kept in the tool description and removed from the skill, provided the skill retains its prerequisite-loading line and its choreography

### Requirement: De-duplication preserves a skill's prerequisite-loading and choreography

A de-duplication edit MAY remove a pure contract or guarantee sentence from a skill body, but SHALL NOT remove a skill's prerequisite-loading line or an orchestration step. A skill performs two jobs the tool cannot: loading its prerequisite library skills, and carrying cross-tool choreography.

#### Scenario: Stripping a contract sentence keeps the skill's load line intact

- **WHEN** a contract sentence is removed from a workflow skill during de-duplication
- **THEN** the skill's prerequisite line and its flow choreography remain unchanged
