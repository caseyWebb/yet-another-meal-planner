# agent-plugin-distribution Specification

## Purpose
TBD - created by archiving change package-agent-as-plugin. Update Purpose after archive.
## Requirements
### Requirement: Agent behavior packaged as an installable plugin

The system SHALL package the agent's behavior as an installable Claude plugin bundling **skills** and the **`grocery-mcp` connector** configuration, installable in claude.ai web chat and Claude Desktop (Chat tab). The plugin SHALL NOT depend on hooks or sub-agents (Cowork-only features the agent does not use). Installing the plugin plus completing the OAuth invite-code handshake SHALL be sufficient to use the agent — no manual pasting of instructions and no manual connector addition.

#### Scenario: Member onboards by installing one plugin

- **WHEN** a new member installs the grocery-agent plugin and completes the OAuth invite-code flow
- **THEN** the agent's persona, flows, and connector are all available with no instruction text pasted and no connector added by hand

#### Scenario: No Cowork-only features required

- **WHEN** the plugin runs in the claude.ai web or Desktop Chat tab
- **THEN** all bundled skills and the connector function, and the plugin relies on no hooks or sub-agents

### Requirement: Skills generated from the canonical instructions source

`AGENT_INSTRUCTIONS.md` SHALL remain the single canonical source of agent behavior. The plugin's skills SHALL be **generated** from it by a build script (`scripts/build-plugin.mjs`), not hand-maintained as parallel copies. The build SHALL emit **persona-tier library skills** (`grocery-core` plus the `grocery-cart` / `grocery-corpus` depth tiers), one workflow skill per conversational flow (including the profile/onboarding flow), a `plugin.json` manifest, and the connector config (`.mcp.json`), following the established build-from-source pattern of `build-indexes.mjs` / `build-site.mjs` (including a `--check` validate-only mode). The build SHALL fail if the source cannot be mapped to the expected skill set (missing `core`, a flow needing an absent depth tier, or a duplicate/invalid skill name).

#### Scenario: Building produces the skill set from source

- **WHEN** `scripts/build-plugin.mjs` runs against `AGENT_INSTRUCTIONS.md`
- **THEN** it emits a plugin tree containing the persona-tier library skills, one workflow skill per flow, a `plugin.json`, and the connector config

#### Scenario: Source and bundle do not drift

- **WHEN** a behavior change is made
- **THEN** it is made in `AGENT_INSTRUCTIONS.md` and the plugin is rebuilt from it, and no skill body is edited directly in the generated bundle

### Requirement: Persona shipped as reference-loaded library skills

The shared persona SHALL ship as **library skills** — a `grocery-core` skill loaded by every workflow, plus depth skills (`grocery-cart`, `grocery-corpus`) carrying the rules only some flows need — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `grocery-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field, and this requirement SHALL make no modification to the Worker or MCP server.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `grocery-core` (and any depth tier it needs), supplying persona, modes, behavior rules, and tone — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: Library skills do not auto-select and are hidden from user discovery

- **WHEN** the agent evaluates which skill to load, or the user opens slash-command discovery
- **THEN** the `grocery-core` / depth library skills are not auto-selected on their own (their descriptions are minimal) and do not appear as user-invocable entries (`user-invocable: false`); they load only via a workflow's prerequisite line

#### Scenario: Hiding the library skills does not break reference loading

- **WHEN** a workflow's prerequisite line instructs the model to read a `user-invocable: false` library skill
- **THEN** the model still loads that library skill's content (the flag removes only the user entry point, not model loading)

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

### Requirement: Fork-free self-hoster plugin distribution via uploadable bundle

Self-hosters SHALL be able to obtain a plugin bundle with their own `grocery-mcp` connector URL baked in, built by CI **without forking the code repo**, and install it in claude.ai by **uploading the bundle file** — no marketplace and no public hosting required. The bundle SHALL be identical to the operator's marketplace bundle except for the baked connector URL, and installing it SHALL require no manual connector addition.

#### Scenario: Self-hoster installs a baked bundle by upload

- **WHEN** a self-hoster builds the bundle with their own Worker URL, uploads the file to claude.ai, and completes the OAuth invite-code flow
- **THEN** the bundled `grocery-mcp` connector and all skills are available, with no connector added by hand and no code fork

#### Scenario: Friend without a GitHub account installs the same file

- **WHEN** the self-hoster forwards the built bundle file to a friend who has no GitHub account
- **THEN** the friend can upload it to claude.ai and use the agent after completing the invite-code flow

### Requirement: Worker and skills advance together, Worker first

Because skills invoke MCP tools by name, a self-hoster's plugin skills SHALL NOT be advanced ahead of the Worker that serves those tools. On an upstream update that changes tools, the operator SHALL redeploy the Worker before rebuilding and redistributing the plugin. A self-hoster's skills SHALL NOT be sourced from an upstream marketplace that advances them independently of the self-hoster's own deploys.

#### Scenario: Update redeploys the Worker before redistributing skills

- **WHEN** a self-hoster takes an upstream update that adds or changes tools
- **THEN** they redeploy the Worker first, then rebuild and redistribute the plugin, so no shipped skill references a tool that is not yet deployed

#### Scenario: Self-hoster skills are not auto-advanced from upstream

- **WHEN** a self-hoster wants the agent's skills
- **THEN** they obtain them from a bundle they build and redistribute themselves, not by installing the operator's upstream marketplace plugin for its skills

