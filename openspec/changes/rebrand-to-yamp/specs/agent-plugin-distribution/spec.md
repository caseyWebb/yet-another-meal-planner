## MODIFIED Requirements

### Requirement: Agent behavior packaged as an installable plugin

The system SHALL package the agent's behavior as an installable Claude plugin bundling **skills** and the **`yamp` connector** configuration, installable in claude.ai web chat and Claude Desktop (Chat tab). The plugin SHALL NOT depend on hooks or sub-agents (Cowork-only features the agent does not use). Installing the plugin plus completing the OAuth invite-code handshake SHALL be sufficient to use the agent — no manual pasting of instructions and no manual connector addition.

#### Scenario: Member onboards by installing one plugin

- **WHEN** a new member installs the yamp plugin and completes the OAuth invite-code flow
- **THEN** the agent's persona, flows, and connector are all available with no instruction text pasted and no connector added by hand

#### Scenario: No Cowork-only features required

- **WHEN** the plugin runs in the claude.ai web or Desktop Chat tab
- **THEN** all bundled skills and the connector function, and the plugin relies on no hooks or sub-agents

### Requirement: Skills generated from the canonical instructions source

`AGENT_INSTRUCTIONS.md` SHALL remain the single canonical source of agent behavior. The plugin's skills SHALL be **generated** from it by a build script (`scripts/build-plugin.mjs`), not hand-maintained as parallel copies. The build SHALL emit **persona-tier library skills** (`yamp-core` plus the `yamp-cart` / `yamp-corpus` / `yamp-discovery` depth tiers), one workflow skill per conversational flow (including the profile/onboarding flow), a `plugin.json` manifest, and the connector config (`.mcp.json`), including a `--check` validate-only mode. The set of depth tiers the build recognizes (`DEPTH_TIERS`) SHALL include `discovery`, so a flow may declare `needs: discovery` to load the shared recipe triage/import mechanics. The build SHALL fail if the source cannot be mapped to the expected skill set (missing `core`, a flow needing an absent depth tier, or a duplicate/invalid skill name). A flow's `<!-- resource -->` path SHALL be validated to stay within the flow's generated `skills/<name>/` tree: in addition to requiring the `references/` prefix and `.md` suffix, the build SHALL reject any path containing a `..` segment (or one whose resolved destination escapes the output tree), so a malformed source edit cannot write a file outside the bundle. A rejected path SHALL be reported as a build error, not silently written.

#### Scenario: Building produces the skill set from source

- **WHEN** `scripts/build-plugin.mjs` runs against `AGENT_INSTRUCTIONS.md`
- **THEN** it emits a plugin tree containing the persona-tier library skills (including `yamp-discovery`), one workflow skill per flow, a `plugin.json`, and the connector config

#### Scenario: A flow declaring an absent depth tier fails the build

- **WHEN** a flow declares `needs: discovery` but no `<!-- persona: discovery -->` block exists in the source
- **THEN** the build fails rather than emitting a workflow whose prerequisite line references a missing library skill

#### Scenario: Source and bundle do not drift

- **WHEN** a behavior change is made
- **THEN** it is made in `AGENT_INSTRUCTIONS.md` and the plugin is rebuilt from it, and no skill body is edited directly in the generated bundle

#### Scenario: A traversing resource path is rejected

- **WHEN** a flow's resource path is `references/../../../tmp/pwned.md` (passes the prefix/suffix checks but contains `..`)
- **THEN** the build reports a validation error and writes no file outside the flow's `skills/<name>/` tree

### Requirement: Persona shipped as reference-loaded library skills

The shared persona SHALL ship as **library skills** — a `yamp-core` skill loaded by every workflow, plus depth skills (`yamp-cart`, `yamp-corpus`, `yamp-discovery`) carrying the rules only some flows need — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. The `yamp-discovery` tier SHALL carry the shared recipe triage/import mechanics (cheap-first triage, `parse_recipe` → classify → `create_recipe`, source-URL dedup, and the disposition vocabulary) so the flows that import a recipe reference one source rather than restating it inline. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `yamp-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field, and this requirement SHALL make no modification to the Worker or MCP server.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `yamp-core` (and any depth tier it needs, e.g. `yamp-discovery` for a flow that imports) — supplying persona, modes, behavior rules, and tone — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: An importing flow reaches the shared mechanics at runtime

- **WHEN** the `meal-plan` or `import-recipe` workflow fires and its prerequisite line loads `yamp-discovery`
- **THEN** the triage/import mechanics are in context for that flow, so its in-body references to the shared mechanics resolve rather than pointing at a separate, un-loaded skill

#### Scenario: Library skills do not auto-select and are hidden from user discovery

- **WHEN** the agent evaluates which skill to load, or the user opens slash-command discovery
- **THEN** the `yamp-core` / depth library skills (including `yamp-discovery`) are not auto-selected on their own (their descriptions are minimal) and do not appear as user-invocable entries (`user-invocable: false`); they load only via a workflow's prerequisite line

#### Scenario: Hiding the library skills does not break reference loading

- **WHEN** a workflow's prerequisite line instructs the model to read a `user-invocable: false` library skill
- **THEN** the model still loads that library skill's content (the flag removes only the user entry point, not model loading)

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

### Requirement: Fork-free self-hoster distribution via the operator's public data-repo marketplace

Self-hosters SHALL distribute the plugin **without forking the code repo** by publishing it to **their own data repository, made public**, which serves as a Claude plugin marketplace. The published bundle SHALL bake the operator's own `yamp` connector URL into `.mcp.json`, and SHALL be identical to any other operator's bundle except for that baked URL and the per-operator version. Members SHALL install with `/plugin marketplace add <operator>/yet-another-meal-planner-deployment` and SHALL NOT be required to have a GitHub account or to add the connector by hand. A no-GitHub fallback SHALL remain available (the publicly fetchable bundle in the repo, and `AGENT_INSTRUCTIONS.md` as a project-paste path).

#### Scenario: Self-hoster publishes a marketplace without forking

- **WHEN** a self-hoster deploys, which builds the bundle with their Worker URL and commits it to their data repo
- **THEN** their data repo is a working plugin marketplace with no fork of the code repo and no manually maintained bundle

#### Scenario: Friend without a GitHub account installs from the public marketplace

- **WHEN** a friend with no GitHub account adds the operator's public marketplace in claude.ai (which needs no GitHub authentication) and installs
- **THEN** the bundled `yamp` connector and all skills are available after the invite-code flow, with no file forwarding, no fork, and no connector added by hand
