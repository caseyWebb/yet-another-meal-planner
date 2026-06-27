## MODIFIED Requirements

### Requirement: Marketplace distribution with pull-based updates

The plugin SHALL be distributed via a marketplace that is **the operator's own data repository, made public** (`<operator>/groceries-agent-data`), so that installed plugins receive updates by pulling, without members re-copying any instructions. The marketplace SHALL NOT be hosted in the code repository. The operator's deploy SHALL publish the build output to that marketplace by committing `.claude-plugin/marketplace.json` and the generated `plugin/` bundle into the data repo. The published plugin version SHALL be **monotonically increasing per operator** — derived from the data repo's own commit count — so claude.ai's strictly-greater auto-update gate always recognizes a republish as newer. Updating agent behavior SHALL reach installed members through a rebuild-and-publish, not a manual document re-copy.

#### Scenario: An update reaches members without re-copying

- **WHEN** the operator changes `AGENT_INSTRUCTIONS.md`, redeploys, and the deploy republishes the bundle to the data-repo marketplace
- **THEN** members' installed plugins can pull the update with no manual instruction re-copying

#### Scenario: Members install from the operator's public data-repo marketplace

- **WHEN** a member runs `/plugin marketplace add <operator>/groceries-agent-data` and installs the plugin
- **THEN** the bundle resolves from `.claude-plugin/marketplace.json` → `./plugin/grocery-agent` in the operator's public data repo, with the operator's connector URL baked in

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

## ADDED Requirements

### Requirement: Fork-free self-hoster distribution via the operator's public data-repo marketplace

Self-hosters SHALL distribute the plugin **without forking the code repo** by publishing it to **their own data repository, made public**, which serves as a Claude plugin marketplace. The published bundle SHALL bake the operator's own `grocery-mcp` connector URL into `.mcp.json`, and SHALL be identical to any other operator's bundle except for that baked URL and the per-operator version. Members SHALL install with `/plugin marketplace add <operator>/groceries-agent-data` and SHALL NOT be required to have a GitHub account or to add the connector by hand. A no-GitHub fallback SHALL remain available (the publicly fetchable bundle in the repo, and `AGENT_INSTRUCTIONS.md` as a project-paste path).

#### Scenario: Self-hoster publishes a marketplace without forking

- **WHEN** a self-hoster deploys, which builds the bundle with their Worker URL and commits it to their data repo
- **THEN** their data repo is a working plugin marketplace with no fork of the code repo and no manually maintained bundle

#### Scenario: Friend without a GitHub account installs from the public marketplace

- **WHEN** a friend with no GitHub account adds the operator's public marketplace in claude.ai (which needs no GitHub authentication) and installs
- **THEN** the bundled `grocery-mcp` connector and all skills are available after the invite-code flow, with no file forwarding, no fork, and no connector added by hand

## REMOVED Requirements

### Requirement: Fork-free self-hoster plugin distribution via uploadable bundle

**Reason**: Replaced by fork-free distribution via the operator's **public data-repo marketplace**. With the data repo public and claude.ai adding a public marketplace without member authentication, members install (and auto-update) from the marketplace instead of manually uploading a bundle file. The no-GitHub-account case is preserved by the publicly fetchable bundle and the `AGENT_INSTRUCTIONS.md` project-paste fallback, so no capability is lost.

**Migration**: Operators publish via the deploy (which commits the bundle to the data repo) and share `/plugin marketplace add <operator>/groceries-agent-data` + the invite code instead of forwarding a `.zip`. The reusable `data-build-plugin.yml` artifact workflow and the data repo's `build-plugin.yml` caller are removed (see `build-automation`).
