## ADDED Requirements

### Requirement: Conservative required-equipment classification on import

The recipe-add path SHALL classify `requires_equipment` as a judgment field during enrichment, under a conservative rubric: it SHALL default to empty and SHALL tag a controlled-vocabulary slug only when the dish is genuinely impossible without that equipment (no recipe-preserving workaround exists). The schema.org `tool` list and the instruction prose SHALL be treated as **hints, never the verdict** — they enumerate every utensil (bowls, whisks, knives) which are not vital and not in the vocabulary. When in doubt, the classifier SHALL leave the equipment out, because a missed requirement is caught later by the `cook` skill's equipment step whereas a wrong "vital" tag silently hides a makeable recipe. The classified `requires_equipment` SHALL be persisted via `create_recipe`, and SHALL be the same for sides imported through the `pairs_with` bootstrap (which reuse the same create pipeline).

#### Scenario: Most recipes get no equipment requirement

- **WHEN** a recipe is imported whose steps mention a bowl, whisk, and skillet (all replaceable)
- **THEN** the classifier assigns empty `requires_equipment` and the recipe is makeable by everyone

#### Scenario: A genuinely-vital tool is tagged

- **WHEN** a recipe is imported for churned ice cream that cannot be made without an ice-cream maker
- **THEN** the classifier assigns `requires_equipment: ["ice-cream-maker"]` (a vocabulary slug)

#### Scenario: schema.org tool list is a hint, not the verdict

- **WHEN** an imported page's schema.org `tool` list names "blender, mixing bowl, baking sheet" but the dish can be made by hand
- **THEN** the classifier does not tag those tools and leaves `requires_equipment` empty

### Requirement: Importer surfaces the schema.org tool list as a hint

The `import_recipe(url)` parse SHALL, when the page's schema.org `Recipe` carries a `tool` property, surface it in the parse result as a non-authoritative `tools_hint` for the classifying agent. `tools_hint` SHALL NOT be written to `requires_equipment` directly; it informs the conservative classification only.

#### Scenario: Tool property surfaced as a hint

- **WHEN** `import_recipe(url)` parses a page whose `Recipe` JSON-LD includes a `tool` array
- **THEN** the parse result includes `tools_hint` with those tools, distinct from any field that is written to the recipe
