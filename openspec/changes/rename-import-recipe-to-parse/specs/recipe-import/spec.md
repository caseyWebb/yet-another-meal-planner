## MODIFIED Requirements

### Requirement: Importer surfaces the schema.org tool list as a hint

The `parse_recipe(url)` parse SHALL, when the page's schema.org `Recipe` carries a `tool` property, surface it in the parse result as a non-authoritative `tools_hint` for the classifying agent. `tools_hint` SHALL NOT be written to `requires_equipment` directly; it informs the conservative classification only.

#### Scenario: Tool property surfaced as a hint

- **WHEN** `parse_recipe(url)` parses a page whose `Recipe` JSON-LD includes a `tool` array
- **THEN** the parse result includes `tools_hint` with those tools, distinct from any field that is written to the recipe
