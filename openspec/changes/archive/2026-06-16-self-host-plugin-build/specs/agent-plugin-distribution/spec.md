## ADDED Requirements

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
