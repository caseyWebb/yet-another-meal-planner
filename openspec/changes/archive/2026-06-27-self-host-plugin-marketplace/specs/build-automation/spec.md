## ADDED Requirements

### Requirement: Deploy builds and publishes the plugin bundle to the data-repo marketplace

The reusable **deploy** workflow SHALL, after the Worker deploy step succeeds, build the plugin bundle from the persona source with the operator's connector URL baked into `.mcp.json`, and publish it by committing `.claude-plugin/marketplace.json` and the generated `plugin/` bundle into the operator's data repository (reusing the deploy's existing `contents: write`). The build SHALL run **only after** the Worker deploy, so published skills never reference tools the deployed Worker does not yet serve. The published plugin version SHALL be derived from the data repository's own commit count, so each publish is strictly newer than the last. The build step SHALL require no secrets of its own — it uses the deploy's credentials to deploy the Worker, not to build the bundle.

#### Scenario: Deploy publishes the bundle after the Worker is live

- **WHEN** an operator runs the deploy
- **THEN** the Worker is deployed first, then the plugin bundle is built with the operator's connector URL and committed to the data repository's `.claude-plugin/marketplace.json` + `plugin/`

#### Scenario: Connector URL is baked per operator

- **WHEN** the deploy builds the bundle
- **THEN** `.mcp.json` carries that operator's `grocery-mcp` connector URL, identical to other operators' bundles except for the URL and the version

#### Scenario: Published version is monotonic

- **WHEN** the deploy republishes after a change
- **THEN** the bundle's version (the data repository's commit count) is strictly greater than the previously published version

## REMOVED Requirements

### Requirement: Reusable plugin-build workflow produces an operator-baked bundle artifact

**Reason**: The standalone artifact-producing build workflow (`data-build-plugin.yml`) is retired. The plugin build folds into the reusable **deploy** workflow, which publishes the bundle by committing it to the operator's **public data-repo marketplace** rather than uploading a downloadable artifact. The accepted-upload-layout concern is no longer load-bearing because the primary install path is the marketplace, not a file upload; the no-GitHub file fallback is preserved by the publicly fetchable bundle in the repo.

**Migration**: Remove the `data-build-plugin.yml` reusable workflow and the data repo template's `build-plugin.yml` caller. Operators publish via the deploy, which now builds and commits the bundle; members install via `/plugin marketplace add <operator>/groceries-agent-data`.
