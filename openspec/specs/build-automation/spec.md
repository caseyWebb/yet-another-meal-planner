# build-automation Specification

## Purpose

Defines the reusable CI workflow that builds the agent plugin bundle: a self-hoster's data repo calls it to produce a downloadable plugin artifact with their own connector URL baked in. Recipe validation and the recipe index are owned by the Worker reconcile (see the `recipe-index` and `r2-corpus-store` capabilities).
## Requirements
### Requirement: Reusable plugin-build workflow produces an operator-baked bundle artifact

The system SHALL provide a reusable (`on: workflow_call`) GitHub workflow that builds the grocery-agent plugin bundle with a **caller-supplied connector URL** and publishes it as a **downloadable artifact**. The workflow SHALL run **without secrets**, SHALL build from a caller-supplied code ref (default `main`), and SHALL NOT modify the committed marketplace bundle. A thin caller in an operator's private data repo SHALL invoke it with the operator's Worker URL.

#### Scenario: Operator builds their bundle from the data repo

- **WHEN** an operator runs their thin `build-plugin` caller with their Worker URL
- **THEN** a plugin bundle with that URL baked into `.mcp.json` is produced and published as a downloadable artifact in the run, with no secrets used and the committed marketplace bundle unchanged

#### Scenario: Bundle is packaged in the accepted upload layout

- **WHEN** the workflow packages the bundle
- **THEN** the archive contains `.claude-plugin/`, `.mcp.json`, and `skills/` at its root — the layout claude.ai accepts for an uploaded plugin file
