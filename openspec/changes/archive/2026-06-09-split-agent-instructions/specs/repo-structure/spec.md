## MODIFIED Requirements

### Requirement: Canonical docs are committed at defined locations

The repository SHALL commit the canonical project docs. `AGENT_INSTRUCTIONS.md` SHALL reside at the repository root and SHALL be the canonical grocery-agent operational instructions consumed by the Claude.ai project (pasted into its project instructions). `CLAUDE.md` SHALL reside at the repository root as Claude Code development guidance for working in this repo, and SHALL point to `AGENT_INSTRUCTIONS.md` for the agent persona and conversational flows. `ROADMAP.md` (renamed from `BUILD-SEQUENCE.md`) SHALL reside at the repository root. The reference docs `PROJECT.md`, `SCHEMAS.md`, and `TOOLS.md` SHALL reside under a `docs/` directory. Any references to these docs (including each root doc's pointer to the tool inventory) SHALL resolve to their `docs/` paths.

#### Scenario: Root docs are present with their distinct roles

- **WHEN** Claude Code opens the repository directory
- **THEN** it finds `CLAUDE.md` at the repository root and reads it as repo-development context, `AGENT_INSTRUCTIONS.md` at the root as the grocery-agent instruction source, and `ROADMAP.md` at the root

#### Scenario: Agent instructions are sourced from AGENT_INSTRUCTIONS.md

- **WHEN** the Claude.ai "Grocery Agent" project instructions are set or refreshed
- **THEN** their canonical source is `AGENT_INSTRUCTIONS.md`, not `CLAUDE.md`

#### Scenario: CLAUDE.md points to the agent instructions

- **WHEN** a reader opens `CLAUDE.md` looking for the agent persona or conversational flows
- **THEN** it directs them to `AGENT_INSTRUCTIONS.md` rather than containing that prose itself

#### Scenario: Reference docs live under docs/

- **WHEN** a developer looks for the project, schema, and tool references
- **THEN** `docs/PROJECT.md`, `docs/SCHEMAS.md`, and `docs/TOOLS.md` are present

#### Scenario: Doc references resolve

- **WHEN** a reader follows a root doc's pointer to the tool inventory (`docs/TOOLS.md`)
- **THEN** the referenced file exists at that path
