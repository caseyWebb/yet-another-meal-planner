## ADDED Requirements

### Requirement: RSS discovery returns a deduped candidate pool without scoring

`fetch_rss_discoveries` SHALL read the feeds configured in `feeds.toml`, fetch each feed, and return a deduped pool of candidate recipes as `{ candidates: [{ url, title, source, feed_weight, summary }] }`. It SHALL NOT compute or return a taste `score` and SHALL NOT rank or pre-select a "top" subset — taste fit and the final selection are the agent's judgment. `feed_weight` SHALL be passed through from the feed's configured weight, not used by the tool to order results. When `feeds.toml` is absent or empty, the tool SHALL return an empty candidate list rather than erroring.

#### Scenario: Candidates returned without a score field

- **WHEN** `fetch_rss_discoveries` is called with feeds configured
- **THEN** each returned candidate carries `url`, `title`, `source`, `feed_weight`, and `summary`, and no candidate carries a taste `score`

#### Scenario: Empty feed config is not an error

- **WHEN** `feeds.toml` has no feed entries
- **THEN** the tool returns `{ candidates: [] }` and does not raise an error

### Requirement: RSS candidates are deduped against the existing corpus

`fetch_rss_discoveries` SHALL exclude any feed item whose link matches the `source:` URL of a recipe already in the corpus, so already-imported recipes are not re-surfaced. The deduplication SHALL be performed by the tool (deterministically on URL), not left to the agent.

#### Scenario: Already-imported recipe is filtered out

- **WHEN** a feed item's link equals the `source:` of an existing recipe in the corpus
- **THEN** that item is omitted from the returned candidate pool

### Requirement: import_recipe parses JSON-LD and returns data without writing

`import_recipe(url)` SHALL fetch the page, extract its schema.org `Recipe` JSON-LD, and return structured data — `title`, `ingredients` (array), `instructions` (array), and, when present, `servings`, `time_total`, `time_active`, and `source`. It SHALL handle JSON-LD wrapped in an `@graph`, supplied as a top-level array, and instructions expressed as `HowToStep`/`HowToSection` objects or plain strings. It SHALL NOT write any file and SHALL NOT create a commit.

#### Scenario: Recipe page yields structured data

- **WHEN** `import_recipe` is called on a page exposing a schema.org `Recipe` in a `@graph`
- **THEN** it returns the parsed `title`, `ingredients[]`, and `instructions[]` (and available metadata) and writes nothing to the repo

#### Scenario: HowToStep instructions are flattened to strings

- **WHEN** a recipe's `recipeInstructions` is an array of `HowToStep` objects
- **THEN** the returned `instructions` is an array of the step texts

### Requirement: import_recipe returns structured errors on bad input

`import_recipe` SHALL return a structured error rather than throwing or returning partial data when it cannot produce a usable recipe: `{ error: "unreachable" }` when the page cannot be fetched, `{ error: "no_jsonld" }` when no JSON-LD is present, `{ error: "not_a_recipe" }` when JSON-LD exists but contains no `Recipe`, and `{ error: "incomplete", missing: [...] }` when a `Recipe` is found but yields no ingredients or no instructions.

#### Scenario: Page without JSON-LD

- **WHEN** `import_recipe` is called on a page that has no `<script type="application/ld+json">`
- **THEN** it returns `{ error: "no_jsonld" }`

#### Scenario: Recipe missing instructions

- **WHEN** a parsed `Recipe` has ingredients but no instruction steps
- **THEN** it returns `{ error: "incomplete", missing: ["instructions"] }`

### Requirement: create_recipe persists a draft with a solo commit

`create_recipe(frontmatter, body)` SHALL write a new `recipes/<slug>.md` from the agent-supplied frontmatter and body and commit it on its own via the atomic commit engine — not staged into the end-of-session commit. The slug SHALL be derived from the title (or supplied). The tool SHALL refuse to overwrite an existing recipe, returning `{ error: "slug_exists", slug }` when a file already exists at the target path.

#### Scenario: Draft recipe is created and committed

- **WHEN** `create_recipe` is called with frontmatter (`status: draft`) and a body containing `## Ingredients` and `## Instructions`
- **THEN** a new `recipes/<slug>.md` is written and committed in a single commit, and the tool returns the slug

#### Scenario: Existing slug is not clobbered

- **WHEN** `create_recipe` targets a slug whose file already exists
- **THEN** it returns `{ error: "slug_exists", slug }` and leaves the existing file untouched

### Requirement: Imported recipes land in draft state

A recipe created through the discovery flow SHALL be written with `status: draft`, a populated `discovered_at` date, and a `discovery_source` identifying the feed. Discovery SHALL NOT auto-activate or auto-rate an imported recipe; promotion to `active` (with a rating) or `rejected` happens later via `update_recipe` on user direction.

#### Scenario: Discovery import is a draft

- **WHEN** a recipe is imported via the discovery flow
- **THEN** its `status` is `draft`, `discovered_at` is set, and `discovery_source` names the source feed

#### Scenario: Drafts are accessible but not auto-promoted

- **WHEN** the user later asks to see pending discoveries
- **THEN** `list_recipes(status: draft)` returns them, and none was promoted to `active` without user direction

### Requirement: Recipe parsing is runtime-agnostic with no Node-only dependencies

The discovery tools SHALL parse RSS/Atom feeds and extract HTML/JSON-LD using runtime-agnostic string parsing (regex + `JSON.parse`) that runs identically on `workerd` and in Node, and SHALL NOT depend on Node-only libraries (e.g. `recipe-scraper`, `cheerio`), on Node `Buffer`/`fs` APIs, or on `workerd`-only APIs such as `HTMLRewriter` (which would prevent unit testing in the project's Node test runner). No new XML/HTML parsing dependency is added — this mirrors `parse.ts` hand-rolling the frontmatter split rather than pulling in `gray-matter`.

#### Scenario: Parsing logic is pure and unit-testable in Node

- **WHEN** the feed parser and JSON-LD extractor are exercised by the Node test runner
- **THEN** they parse fixture XML/HTML strings with no reliance on `HTMLRewriter` or any Node-only or workerd-only API, and no new parsing dependency appears in the Worker's `package.json`
