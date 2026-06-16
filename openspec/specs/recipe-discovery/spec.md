# recipe-discovery Specification

## Purpose
TBD - created by archiving change discovery-and-disposition. Update Purpose after archive.
## Requirements
### Requirement: RSS discovery returns a deduped candidate pool without scoring

`fetch_rss_discoveries` SHALL read the feeds configured in the **shared** `feeds.toml` at the data-repo root — read through the shared GitHub client, not a per-tenant `users/<id>/` path — fetch each feed, and return a deduped pool of candidate recipes as `{ candidates: [{ url, title, source, feed_weight, summary }] }`. Discovery feeds are a shared, top-level concern: any member's configured feeds contribute to one group pool, and the candidates are judged against the calling member's taste at menu time. It SHALL NOT compute or return a taste `score` and SHALL NOT rank or pre-select a "top" subset — taste fit and the final selection are the agent's judgment. `feed_weight` SHALL be passed through from the feed's configured weight, not used by the tool to order results. When the shared `feeds.toml` is absent or empty, the tool SHALL return an empty candidate list rather than erroring.

#### Scenario: Candidates returned without a score field

- **WHEN** `fetch_rss_discoveries` is called with feeds configured
- **THEN** each returned candidate carries `url`, `title`, `source`, `feed_weight`, and `summary`, and no candidate carries a taste `score`

#### Scenario: Feeds are read from the shared root, not a per-tenant path

- **WHEN** `fetch_rss_discoveries` resolves its feed configuration
- **THEN** it reads `feeds.toml` from the data-repo root via the shared client, and no `users/<id>/feeds.toml` is consulted

#### Scenario: Empty feed config is not an error

- **WHEN** the shared `feeds.toml` has no feed entries
- **THEN** the tool returns `{ candidates: [] }` and does not raise an error

### Requirement: RSS candidates are deduped against the existing corpus

`fetch_rss_discoveries` SHALL exclude any feed item whose canonical link matches the `source:` URL of a recipe already in the corpus, so already-imported recipes are not re-surfaced. The deduplication SHALL be performed by the tool (deterministically on the canonical URL), not left to the agent.

#### Scenario: Already-imported recipe is filtered out

- **WHEN** a feed item's canonical link equals the `source:` of an existing recipe in the corpus
- **THEN** that item is omitted from the returned candidate pool

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

### Requirement: Discovery feeds are writable via update_feeds

The system SHALL provide an `update_feeds` tool that adds RSS/Atom discovery feeds to the **shared** `feeds.toml` at the data-repo root — written through the shared GitHub client, not a per-tenant `users/<id>/` path — so a member can wire up discovery sources during onboarding without hand-editing the data repo. It SHALL be **add-only with dedup by canonicalized feed `url`** (existing feeds untouched), mirroring the add-only `update_discovery_sources`, and SHALL accept per feed a required `url` and optional `name`, `weight` (default 1), and `tags`. It SHALL return `{ added, commit_sha }` and SHALL make no commit when no new feed is added. Because feeds are a shared, top-level concern, any member trusted with the MCP MAY widen the group feed set, consistent with `update_discovery_sources`.

#### Scenario: New feed is added to the shared feeds.toml

- **WHEN** `update_feeds` is called with a feed `url` not already present
- **THEN** the feed is appended to the data-repo-root `feeds.toml` via the shared client, and the tool returns `{ added, commit_sha }`

#### Scenario: Duplicate feed is a no-op

- **WHEN** `update_feeds` is called with a `url` that canonicalizes to one already in `feeds.toml`
- **THEN** no duplicate is written, no commit is made, and the result reports nothing added

#### Scenario: Feed write targets the shared root, not a tenant subtree

- **WHEN** any member calls `update_feeds`
- **THEN** the write targets the shared `feeds.toml` at the data-repo root and no `users/<id>/feeds.toml` is created

