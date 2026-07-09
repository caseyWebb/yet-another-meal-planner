# recipe-card-widget Specification

## Purpose
TBD - created by archiving change add-recipe-card-widget. Update Purpose after archive.
## Requirements
### Requirement: Dedicated recipe-display tool

The Worker SHALL expose a `display_recipe` MCP tool that renders a recipe as an inline card. The tool SHALL reuse the existing recipe reader (`readRecipeDetail`) and SHALL NOT alter the contract of `read_recipe`, which remains a plain data read. The tool result SHALL carry `_meta.ui.resourceUri` referencing `ui://recipe/card`, a `structuredContent` payload with the recipe's display fields, and a text `content` fallback. Failures SHALL be returned as structured errors, not thrown.

#### Scenario: Displaying an existing recipe

- **WHEN** `display_recipe` is called with the slug of a recipe in the caller's corpus
- **THEN** the result carries `_meta.ui.resourceUri` equal to `ui://recipe/card`
- **AND** `structuredContent` contains the recipe's title, facets (protein/cuisine/course/season/dietary/tags as available), total time, and the recipe body
- **AND** `content` includes a text rendering of the recipe as a fallback for hosts that cannot render the widget

#### Scenario: Unknown slug

- **WHEN** `display_recipe` is called with a slug that resolves to no recipe
- **THEN** the tool returns a structured `not_found` error rather than throwing

### Requirement: Recipe card served as an MCP Apps resource

The Worker SHALL register a `ui://recipe/card` resource over MCP `resources/read` with the MCP Apps MIME type `text/html;profile=mcp-app`. The resource SHALL be a single self-contained HTML document. Serving SHALL NOT require a new Worker HTTP route or `run_worker_first` entry.

#### Scenario: Reading the card resource

- **WHEN** a host reads the `ui://recipe/card` resource
- **THEN** it receives one content item whose `mimeType` is `text/html;profile=mcp-app`
- **AND** whose text is a single HTML document

### Requirement: Self-contained, zero-external-request widget bundle

The recipe card widget SHALL be produced by a single-file build target that inlines all JavaScript and CSS into one HTML document and makes ZERO external network requests. The bundle SHALL use the canonical `@modelcontextprotocol/ext-apps` `App` client for the host bridge (not a hand-rolled bridge) and SHALL reuse the shared `packages/ui` component + token layer.

#### Scenario: The built widget makes no external requests

- **WHEN** the widget bundle is built
- **THEN** the emitted HTML contains no external stylesheet links, script `src` references, font imports, or other external resource URLs
- **AND** all JavaScript and CSS are inlined into the document

### Requirement: Read-only recipe rendering

The recipe card SHALL render read-only recipe content hydrated from the tool's `structuredContent`: the title, facet chips, total time and dietary tags, and the recipe body. The card SHALL NOT provide servings-scaling controls or step timers (that behavior belongs to the built-in `recipe_display_v0` and requires structured ingredient/step data the reader does not provide).

#### Scenario: Rendering a hydrated card

- **WHEN** the widget receives a recipe's `structuredContent`
- **THEN** it displays the recipe title, facet chips, time/dietary metadata, and the recipe body
- **AND** it presents no servings-scaling control and no per-step timer

### Requirement: Widget delivery is not capability-gated

The `display_recipe` tool SHALL return `_meta.ui.resourceUri` unconditionally, regardless of whether the connected client advertises the MCP Apps capability, because that capability signal is unreliable on the pinned SDK. Hosts that cannot render the widget SHALL still receive the text `content` fallback.

#### Scenario: Client does not advertise MCP Apps support

- **WHEN** `display_recipe` is called by a client that does not advertise the `io.modelcontextprotocol/ui` capability
- **THEN** the result still carries `_meta.ui.resourceUri`
- **AND** the text `content` fallback is present so a non-rendering host degrades to a readable response

