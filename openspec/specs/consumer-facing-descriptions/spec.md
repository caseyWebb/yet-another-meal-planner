# consumer-facing-descriptions Specification

## Purpose
TBD - created by archiving change strip-internal-paths-from-descriptions. Update Purpose after archive.
## Requirements
### Requirement: Consumer-facing text uses consumer ontology

Every surface read by the Claude.ai agent — MCP tool `description` strings, `AGENT_INSTRUCTIONS.md`, the generated plugin skills, and agent-facing `ToolError` `message`s — SHALL be written in the consumer's ontology (tools and concepts) and SHALL NOT reference a repo-internal filesystem path or file extension (e.g. `taste.md`, `skus/kroger.toml`, `recipes/<slug>.md`, `users/<u>/overlay.toml`). The consumer has no filesystem; a named path is an instruction it cannot act on.

#### Scenario: A tool description names no internal path

- **WHEN** any tool's `description` string is read
- **THEN** it contains no `.toml`/`.md` file extension and no slash-delimited repo path
- **AND** any datum it refers to is named by its concept or by the tool that provides it

#### Scenario: An agent-facing error surfaces no internal path

- **WHEN** a `ToolError` `message` is returned to the agent (e.g. a recipe missing its ingredients section)
- **THEN** the message identifies the subject by its concept or slug (e.g. the recipe slug), not by a repo path such as `recipes/<slug>.md`

### Requirement: Disposition by whether the agent has a verb for the datum

Each internal-file reference in consumer-facing text SHALL be dispositioned by whether the agent has a tool that acts on the named datum:

- **Tool-backed datum** — name it by its concept; where the text directs the agent to fetch or write it, name the **tool** rather than the file.
- **Datum with no agent tool** (operator-curated config) — describe its **behavior** and drop the filename.
- **Pure side-effect path** the agent never addresses — drop the reference entirely.

#### Scenario: Cross-tool reference points at the tool

- **WHEN** a tool description directs the agent to evaluate against the user's taste profile
- **THEN** it names the providing tool (`read_taste`) or the concept ("the user's taste profile"), not the file `taste.md`

#### Scenario: Operator config is described by behavior

- **WHEN** a description explains a behavior driven by operator-curated config the agent cannot edit (e.g. broad flyer category terms)
- **THEN** it describes the behavior ("broad curated category terms") and omits the backing filename (`flyer_terms.toml`)

#### Scenario: Side-effect path is dropped

- **WHEN** a tool persists data as an internal side effect the caller never addresses (e.g. caching a learned SKU mapping)
- **THEN** the description states the effect ("caches the learned SKU mapping") and omits the path (`skus/kroger.toml`)

### Requirement: Load-bearing intent-model nouns are preserved without decoration

The intent-model nouns — pantry, stockup, grocery list, meal plan, cooking log — carry the agent's observation→conditional→committed→realized mental model and SHALL be retained as concept nouns. The change strips only the path/extension decoration; it SHALL NOT remove or rename the noun or its semantics.

#### Scenario: Intent noun kept, extension stripped

- **WHEN** consumer-facing text refers to the committed buy list
- **THEN** it reads as "the grocery list" (optionally with its semantic gloss), never "grocery_list.toml"

### Requirement: Skills may name tools as a procedure

Workflow-skill bodies (generated from the flow sections of `AGENT_INSTRUCTIONS.md`) MAY name tools explicitly and read as a tool-call script where that aids execution. The standard SHALL NOT treat an explicit tool name as a violation: the invariant is that no internal filesystem path or extension appears — naming tools is permitted, naming files is not.

#### Scenario: Procedure names tools, not files

- **WHEN** a flow body walks the agent through a sequence of tool calls
- **THEN** it may reference tools by name (e.g. "call `read_pantry`, then `update_grocery_list`")
- **AND** it still references no internal filesystem path or extension

### Requirement: Developer-facing surfaces are out of scope

Surfaces read by developers/operators who have the repo checkout — `CLAUDE.md`, `README.md`, `ROADMAP.md`, `docs/SCHEMAS.md`, `docs/PROJECT.md`, `docs/SELF_HOSTING.md`, and `scripts/` — SHALL retain their filenames and paths; this standard does not apply to them. `docs/TOOLS.md` is synced to the reworded tool descriptions as documentation, but its prose is otherwise developer-facing.

#### Scenario: Developer doc keeps its paths

- **WHEN** `CLAUDE.md` or `README.md` references a data-repo file by path
- **THEN** that reference is left unchanged by this standard
