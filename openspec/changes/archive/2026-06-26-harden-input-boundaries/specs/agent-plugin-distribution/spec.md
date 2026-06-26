## MODIFIED Requirements

### Requirement: Skills generated from the canonical instructions source

`AGENT_INSTRUCTIONS.md` SHALL remain the single canonical source of agent behavior. The plugin's skills SHALL be **generated** from it by a build script (`scripts/build-plugin.mjs`), not hand-maintained as parallel copies. The build SHALL emit **persona-tier library skills** (`grocery-core` plus the `grocery-cart` / `grocery-corpus` / `grocery-discovery` depth tiers), one workflow skill per conversational flow (including the profile/onboarding flow), a `plugin.json` manifest, and the connector config (`.mcp.json`), following the established build-from-source pattern of `build-indexes.mjs` / `build-site.mjs` (including a `--check` validate-only mode). The set of depth tiers the build recognizes (`DEPTH_TIERS`) SHALL include `discovery`, so a flow may declare `needs: discovery` to load the shared recipe triage/import mechanics. The build SHALL fail if the source cannot be mapped to the expected skill set (missing `core`, a flow needing an absent depth tier, or a duplicate/invalid skill name). A flow's `<!-- resource -->` path SHALL be validated to stay within the flow's generated `skills/<name>/` tree: in addition to requiring the `references/` prefix and `.md` suffix, the build SHALL reject any path containing a `..` segment (or one whose resolved destination escapes the output tree), so a malformed source edit cannot write a file outside the bundle. A rejected path SHALL be reported as a build error, not silently written.

#### Scenario: Building produces the skill set from source

- **WHEN** `scripts/build-plugin.mjs` runs against `AGENT_INSTRUCTIONS.md`
- **THEN** it emits a plugin tree containing the persona-tier library skills (including `grocery-discovery`), one workflow skill per flow, a `plugin.json`, and the connector config

#### Scenario: A flow declaring an absent depth tier fails the build

- **WHEN** a flow declares `needs: discovery` but no `<!-- persona: discovery -->` block exists in the source
- **THEN** the build fails rather than emitting a workflow whose prerequisite line references a missing library skill

#### Scenario: Source and bundle do not drift

- **WHEN** a behavior change is made
- **THEN** it is made in `AGENT_INSTRUCTIONS.md` and the plugin is rebuilt from it, and no skill body is edited directly in the generated bundle

#### Scenario: A traversing resource path is rejected

- **WHEN** a flow's resource path is `references/../../../tmp/pwned.md` (passes the prefix/suffix checks but contains `..`)
- **THEN** the build reports a validation error and writes no file outside the flow's `skills/<name>/` tree
