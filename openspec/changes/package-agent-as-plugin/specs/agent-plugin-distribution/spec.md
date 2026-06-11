## ADDED Requirements

### Requirement: Agent behavior packaged as an installable plugin

The system SHALL package the agent's behavior as an installable Claude plugin bundling **skills** and the **`grocery-mcp` connector** configuration, installable in claude.ai web chat and Claude Desktop (Chat tab). The plugin SHALL NOT depend on hooks or sub-agents (Cowork-only features the agent does not use). Installing the plugin plus completing the OAuth invite-code handshake SHALL be sufficient to use the agent — no manual pasting of instructions and no manual connector addition.

#### Scenario: Member onboards by installing one plugin

- **WHEN** a new member installs the grocery-agent plugin and completes the OAuth invite-code flow
- **THEN** the agent's persona, flows, and connector are all available with no instruction text pasted and no connector added by hand

#### Scenario: No Cowork-only features required

- **WHEN** the plugin runs in the claude.ai web or Desktop Chat tab
- **THEN** all bundled skills and the connector function, and the plugin relies on no hooks or sub-agents

### Requirement: Skills generated from the canonical instructions source

`AGENT_INSTRUCTIONS.md` SHALL remain the single canonical source of agent behavior. The plugin's skills SHALL be **generated** from it by a build script (`scripts/build-plugin.mjs`), not hand-maintained as parallel copies. The build SHALL emit a `grocery-persona` skill, one skill per conversational flow, the `grocery-onboarding` skill, a `plugin.json` manifest, and the connector config, following the established build-from-source pattern of `build-indexes.mjs` / `build-site.mjs` (including a `--check` validate-only mode). The build SHALL fail if the source cannot be mapped to the expected skill set.

#### Scenario: Building produces the skill set from source

- **WHEN** `scripts/build-plugin.mjs` runs against `AGENT_INSTRUCTIONS.md`
- **THEN** it emits a plugin tree containing the `grocery-persona` skill, one skill per flow, the onboarding skill, a `plugin.json`, and the connector config

#### Scenario: Source and bundle do not drift

- **WHEN** a behavior change is made
- **THEN** it is made in `AGENT_INSTRUCTIONS.md` and the plugin is rebuilt from it, and no skill body is edited directly in the generated bundle

### Requirement: Persona loaded by reference from workflow skills

The core persona SHALL live in a single `grocery-persona` skill whose trigger description is intentionally minimal so that it never self-triggers and never competes for relevance-based auto-load. Every workflow skill SHALL reference the persona skill in its opening directive so that firing a workflow loads the persona alongside it. The persona SHALL NOT be carried in the MCP server `instructions` field, and this change SHALL make no modification to the Worker or MCP server.

#### Scenario: Firing a workflow loads the persona

- **WHEN** a workflow skill is triggered by a user request
- **THEN** the workflow's opening directive causes the `grocery-persona` skill to load, applying persona, modes, behavior rules, never-do, and tone for that interaction

#### Scenario: Persona does not self-trigger

- **WHEN** the model evaluates skills for relevance to a request
- **THEN** the `grocery-persona` skill is not auto-selected on its own (its description is minimal); it is loaded only via a workflow's reference

### Requirement: One skill per conversational flow

Each conversational flow SHALL be its own skill with a trigger description authored to load the skill when, and only when, that flow is relevant, so that a flow's body is not in context when the flow is inactive. The always-on persona SHALL NOT be fragmented across flow skills.

#### Scenario: Inactive flow bodies stay out of context

- **WHEN** a user makes a request relevant to one flow
- **THEN** that flow's skill body loads while the bodies of unrelated flow skills do not

### Requirement: Marketplace distribution with pull-based updates

The plugin SHALL be distributed via a marketplace (a GitHub repo) so that installed plugins receive updates by pulling, without members re-copying any instructions. The build output SHALL be publishable to that marketplace. Updating agent behavior SHALL reach installed members through a rebuild-and-publish, not a manual document re-copy.

#### Scenario: An update reaches members without re-copying

- **WHEN** the operator changes `AGENT_INSTRUCTIONS.md`, rebuilds, and publishes to the marketplace
- **THEN** members' installed plugins can pull the update with no manual instruction re-copying
