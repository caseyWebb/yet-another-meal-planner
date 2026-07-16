# recipe-import — delta

## ADDED Requirements

### Requirement: import_recipe fuses parse, classification, and persistence

The system SHALL provide an `import_recipe` tool taking **exactly one of** `url` or `text` (plus an optional `title` hint), that runs the whole import pipeline in one call and returns the landed slug. The **URL path** SHALL run the egress-guarded fetch and schema.org JSON-LD extraction (handling `@graph`, top-level arrays, multiple script blocks, `@type` string/array, `HowToStep`/`HowToSection`/plain-string instructions), returning the structured acquisition errors on failure — `{ error: "unreachable" }` (fetch failure, or an outbound-guard refusal with no upstream status, indistinguishable from a dead host), `{ error: "no_jsonld" }`, `{ error: "not_a_recipe" }`, `{ error: "incomplete", missing: [...] }`. The **text path** SHALL classify the pasted content through the discovery sweep's classification (`classifyRecipe` — env.AI with corrective retry) into contract-valid frontmatter and body; unclassifiable text SHALL return a structured `validation_failed`, writing nothing. Both paths SHALL populate every required **authored** field before the write (the gates `dietary`/`requires_equipment` classified under the conservative rubric with any `tools_hint` as a non-authoritative input; `time_total`/`source`/`pairs_with` in explicit-empty form when underivable) and SHALL converge on the shared create operation: slug derived from the cleaned dish name (parenthetical gloss excluded), `slug_exists` refusal, `recipe_imports` attribution (`via 'agent'`, the resolved member) recorded beside the write, no `status` stamped, and the synchronous description/facet seed (`recipe-facet-derivation`) so the import is not facet-lagged. A duplicate `source` URL SHALL be **dedup-to-grant**: no second copy, the caller household's grant minted idempotently, and a **success** return `{ slug, already_existed: true }` naming the existing recipe to reuse. A fresh import returns `{ slug }`. The agent supplies no frontmatter: recipe **editing** is not part of this tool (the web app owns member edits; merge review lands on the fast-follow admin merge screen).

#### Scenario: A URL import lands in one call

- **WHEN** `import_recipe({ url })` is called for a reachable page carrying a schema.org Recipe
- **THEN** the recipe is parsed, classified, validated, and written — attribution and facet seed included — and the tool returns `{ slug }` with the recipe immediately findable via a vibe-less `search_recipes` spec

#### Scenario: A pasted recipe imports without a URL

- **WHEN** `import_recipe({ text })` is called with a recipe pasted from a bot-walled site
- **THEN** the classification path produces contract-valid frontmatter and body, the shared create operation persists it, and the tool returns `{ slug }`

#### Scenario: A duplicate source becomes a grant, reported as success

- **WHEN** `import_recipe({ url })` is called with a `source` URL already in the shared corpus
- **THEN** no second copy is written, the caller household's `recipe_imports` grant is minted (idempotently), and the tool returns `{ slug, already_existed: true }`

#### Scenario: Acquisition failures are structured

- **WHEN** the URL is unreachable, guard-refused, has no JSON-LD, carries no Recipe, or yields no ingredients/instructions
- **THEN** the tool returns the corresponding structured error (`unreachable` carrying no upstream status on a guard refusal) and writes nothing

#### Scenario: url and text are mutually exclusive

- **WHEN** `import_recipe` is called with both `url` and `text`, or neither
- **THEN** the tool returns a structured `validation_failed` and writes nothing

## MODIFIED Requirements

### Requirement: Importer surfaces the schema.org tool list as a hint

The URL-import parse SHALL, when the page's schema.org `Recipe` carries a `tool` property, surface it **internally** to the import classification stage as a non-authoritative `tools_hint`. `tools_hint` SHALL NOT be written to `requires_equipment` directly; it informs the conservative required-equipment classification only, and it is not returned to the caller (the fused `import_recipe` returns the landed slug, not parse output).

#### Scenario: Tool property informs classification without becoming the verdict

- **WHEN** `import_recipe({ url })` parses a page whose `Recipe` JSON-LD includes a `tool` array naming replaceable utensils
- **THEN** the classification stage sees the hint, applies the conservative rubric, and the written `requires_equipment` stays empty unless a genuinely-vital vocabulary tool is required
