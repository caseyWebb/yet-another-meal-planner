## RENAMED Requirements

- FROM: `### Requirement: import_recipe parses JSON-LD and returns data without writing`
- TO: `### Requirement: parse_recipe parses JSON-LD and returns data without writing`

- FROM: `### Requirement: import_recipe returns structured errors on bad input`
- TO: `### Requirement: parse_recipe returns structured errors on bad input`

## MODIFIED Requirements

### Requirement: parse_recipe parses JSON-LD and returns data without writing

`parse_recipe(url)` SHALL fetch the page, extract its schema.org `Recipe` JSON-LD, and return structured data — `title`, `ingredients` (array), `instructions` (array), and, when present, `servings`, `time_total`, `time_active`, and `source`. It SHALL handle JSON-LD wrapped in an `@graph`, supplied as a top-level array, and instructions expressed as `HowToStep`/`HowToSection` objects or plain strings. It SHALL NOT write any file and SHALL NOT create a commit. The tool name SHALL describe its read-only behavior (parse, not import); the corpus write remains `create_recipe`.

#### Scenario: Recipe page yields structured data

- **WHEN** `parse_recipe` is called on a page exposing a schema.org `Recipe` in a `@graph`
- **THEN** it returns the parsed `title`, `ingredients[]`, and `instructions[]` (and available metadata) and writes nothing to the repo

#### Scenario: HowToStep instructions are flattened to strings

- **WHEN** a recipe's `recipeInstructions` is an array of `HowToStep` objects
- **THEN** the returned `instructions` is an array of the step texts

### Requirement: parse_recipe returns structured errors on bad input

`parse_recipe` SHALL return a structured error rather than throwing or returning partial data when it cannot produce a usable recipe: `{ error: "unreachable" }` when the page cannot be fetched, `{ error: "no_jsonld" }` when no JSON-LD is present, `{ error: "not_a_recipe" }` when JSON-LD exists but contains no `Recipe`, and `{ error: "incomplete", missing: [...] }` when a `Recipe` is found but yields no ingredients or no instructions.

#### Scenario: Page without JSON-LD

- **WHEN** `parse_recipe` is called on a page that has no `<script type="application/ld+json">`
- **THEN** it returns `{ error: "no_jsonld" }`

#### Scenario: Recipe missing instructions

- **WHEN** a parsed `Recipe` has ingredients but no instruction steps
- **THEN** it returns `{ error: "incomplete", missing: ["instructions"] }`
