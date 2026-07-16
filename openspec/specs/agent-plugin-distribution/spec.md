# agent-plugin-distribution Specification

## Purpose
Defines how yamp's behavior is packaged and distributed as an installable Claude plugin: the bundle (persona-tier library skills + one skill per conversational flow + the `yamp` connector config) is generated from `AGENT_INSTRUCTIONS.md` and published to the operator's own public data-repo marketplace, so installed members receive updates by pulling — no fork, no manual connector addition, and no re-copying of instructions.
## Requirements
### Requirement: Agent behavior packaged as an installable plugin

The system SHALL package the agent's behavior as an installable Claude plugin bundling **skills** and the **`yamp` connector** configuration, installable in claude.ai web chat and Claude Desktop (Chat tab). The plugin SHALL NOT depend on hooks or sub-agents (Cowork-only features the agent does not use). Installing the plugin plus completing the OAuth invite-code handshake SHALL be sufficient to use the agent — no manual pasting of instructions and no manual connector addition.

#### Scenario: Member onboards by installing one plugin

- **WHEN** a new member installs the yamp plugin and completes the OAuth invite-code flow
- **THEN** the agent's persona, flows, and connector are all available with no instruction text pasted and no connector added by hand

#### Scenario: No Cowork-only features required

- **WHEN** the plugin runs in the claude.ai web or Desktop Chat tab
- **THEN** all bundled skills and the connector function, and the plugin relies on no hooks or sub-agents

### Requirement: Skills generated from the canonical instructions source

`packages/plugin/AGENT_INSTRUCTIONS.md` SHALL remain the single canonical source of agent behavior, owned by the `packages/plugin` workspace package alongside its generator. The plugin's skills SHALL be **generated** from it by a build script (`packages/plugin/scripts/build-plugin.mjs`), not hand-maintained as parallel copies. The build SHALL emit the **`yamp-core` persona library skill** plus a library skill for each depth tier present in the source (the recognized depth-tier set — `cart`, `corpus`, `discovery` — remains supported by the generator; the shipped persona carries a single `core` tier and no depth tiers), one workflow skill per conversational flow — `plan`, `shop`, `cook`, `pantry`, `setup` (the profile/onboarding flow), and `report-bug` — a `plugin.json` manifest, and the connector config (`.mcp.json`), including a `--check` validate-only mode. The build SHALL fail if the source cannot be mapped to the expected skill set (missing `core`, a flow needing an absent depth tier, or a duplicate/invalid skill name). A flow's `<!-- resource -->` path SHALL be validated to stay within the flow's generated `skills/<name>/` tree: in addition to requiring the `references/` prefix and `.md` suffix, the build SHALL reject any path containing a `..` segment (or one whose resolved destination escapes the output tree), so a malformed source edit cannot write a file outside the bundle. A rejected path SHALL be reported as a build error, not silently written.

#### Scenario: Building produces the skill set from source

- **WHEN** `packages/plugin/scripts/build-plugin.mjs` runs against `packages/plugin/AGENT_INSTRUCTIONS.md`
- **THEN** it emits a plugin tree containing the `yamp-core` library skill, one workflow skill per flow (`plan`, `shop`, `cook`, `pantry`, `setup`, `report-bug`), a `plugin.json`, and the connector config — and no depth-tier library skill, because the source declares none

#### Scenario: A flow declaring an absent depth tier fails the build

- **WHEN** a flow declares `needs: discovery` but no `<!-- persona: discovery -->` block exists in the source
- **THEN** the build fails rather than emitting a workflow whose prerequisite line references a missing library skill

#### Scenario: Source and bundle do not drift

- **WHEN** a behavior change is made
- **THEN** it is made in `packages/plugin/AGENT_INSTRUCTIONS.md` and the plugin is rebuilt from it, and no skill body is edited directly in the generated bundle

#### Scenario: A traversing resource path is rejected

- **WHEN** a flow's resource path is `references/../../../tmp/pwned.md` (passes the prefix/suffix checks but contains `..`)
- **THEN** the build reports a validation error and writes no file outside the flow's `skills/<name>/` tree

### Requirement: Persona shipped as reference-loaded library skills

The shared persona SHALL ship as **library skills** — a `yamp-core` skill loaded by every workflow, plus a depth skill for any depth tier the source declares (the shipped persona declares none; the generator retains the `cart`/`corpus`/`discovery` tier mechanism for future regrowth) — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `yamp-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field — the field carries at most the minimal tool-routing preamble the `mcp-server` capability defines (routing only: show-me asks render display tools, reads are internal, plain member-facing language), never voice, learning posture, or flow choreography.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `yamp-core` — supplying persona, voice, learning posture, and behavior rules — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: Instructions stay routing-only

- **WHEN** the server's initialize `instructions` are compared against the persona source
- **THEN** they contain only the tool-routing preamble — no persona voice, learning posture, or flow choreography

### Requirement: One skill per conversational flow

Each conversational flow SHALL be its own skill with a trigger description authored to load the skill when, and only when, that flow is relevant, so that a flow's body is not in context when the flow is inactive. The always-on persona SHALL NOT be fragmented across flow skills.

#### Scenario: Inactive flow bodies stay out of context

- **WHEN** a user makes a request relevant to one flow
- **THEN** that flow's skill body loads while the bodies of unrelated flow skills do not

### Requirement: Marketplace distribution with pull-based updates

The plugin SHALL be distributed via a marketplace that is **the operator's own data repository, made public** (`<operator>/yet-another-meal-planner-deployment`), so that installed plugins receive updates by pulling, without members re-copying any instructions. The marketplace SHALL NOT be hosted in the code repository. The operator's deploy SHALL publish the build output to that marketplace by committing `.claude-plugin/marketplace.json` and the generated `plugin/` bundle into the data repo. The published plugin version SHALL be **monotonically increasing per operator** — derived from the data repo's own commit count — so claude.ai's strictly-greater auto-update gate always recognizes a republish as newer. Updating agent behavior SHALL reach installed members through a rebuild-and-publish, not a manual document re-copy.

#### Scenario: An update reaches members without re-copying

- **WHEN** the operator changes `AGENT_INSTRUCTIONS.md`, redeploys, and the deploy republishes the bundle to the data-repo marketplace
- **THEN** members' installed plugins can pull the update with no manual instruction re-copying

#### Scenario: Members install from the operator's public data-repo marketplace

- **WHEN** a member runs `/plugin marketplace add <operator>/yet-another-meal-planner-deployment` and installs the plugin
- **THEN** the bundle resolves from `.claude-plugin/marketplace.json` → `./plugin/yamp` in the operator's public data repo, with the operator's connector URL baked in

#### Scenario: A republish is always recognized as newer

- **WHEN** the operator republishes the bundle after any change
- **THEN** the published version (the data repo's commit count) is strictly greater than the previously published version, so claude.ai's auto-update gate re-pulls it

### Requirement: Worker and skills advance together, Worker first

Because skills invoke MCP tools by name, a self-hoster's plugin skills SHALL NOT be advanced ahead of the Worker that serves those tools. The publish SHALL be the **tail of the deploy**: the deploy SHALL redeploy the Worker first and only then build and commit the plugin bundle to the data-repo marketplace, so the ordering is enforced **structurally** rather than by operator discipline. A self-hoster's skills SHALL be sourced only from **their own** data-repo marketplace — advanced by their own deploys — never from a marketplace that advances them independently of those deploys.

#### Scenario: Deploy publishes skills only after the Worker is updated

- **WHEN** a self-hoster takes an upstream update that adds or changes tools and runs the deploy
- **THEN** the deploy redeploys the Worker first and only then builds and commits the plugin, so no published skill references a tool that is not yet deployed

#### Scenario: Self-hoster skills come from their own marketplace, not an independent upstream

- **WHEN** a self-hoster wants the agent's skills
- **THEN** they obtain them from their own data-repo marketplace, published by their own deploy, not by installing a marketplace that advances skills independently of their deploys

### Requirement: Fork-free self-hoster distribution via the operator's public data-repo marketplace

Self-hosters SHALL distribute the plugin **without forking the code repo** by publishing it to **their own data repository, made public**, which serves as a Claude plugin marketplace. The published bundle SHALL bake the operator's own `yamp` connector URL into `.mcp.json`, and SHALL be identical to any other operator's bundle except for that baked URL and the per-operator version. Members SHALL install with `/plugin marketplace add <operator>/yet-another-meal-planner-deployment` and SHALL NOT be required to have a GitHub account or to add the connector by hand. A no-GitHub fallback SHALL remain available (the publicly fetchable bundle in the repo, and `AGENT_INSTRUCTIONS.md` as a project-paste path).

#### Scenario: Self-hoster publishes a marketplace without forking

- **WHEN** a self-hoster deploys, which builds the bundle with their Worker URL and commits it to their data repo
- **THEN** their data repo is a working plugin marketplace with no fork of the code repo and no manually maintained bundle

#### Scenario: Friend without a GitHub account installs from the public marketplace

- **WHEN** a friend with no GitHub account adds the operator's public marketplace in claude.ai (which needs no GitHub authentication) and installs
- **THEN** the bundled `yamp` connector and all skills are available after the invite-code flow, with no file forwarding, no fork, and no connector added by hand

