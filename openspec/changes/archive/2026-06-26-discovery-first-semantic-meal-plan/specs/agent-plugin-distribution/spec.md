## MODIFIED Requirements

### Requirement: Skills generated from the canonical instructions source

`AGENT_INSTRUCTIONS.md` SHALL remain the single canonical source of agent behavior. The plugin's skills SHALL be **generated** from it by a build script (`scripts/build-plugin.mjs`), not hand-maintained as parallel copies. The build SHALL emit **persona-tier library skills** (`grocery-core` plus the `grocery-cart` / `grocery-corpus` / `grocery-discovery` depth tiers), one workflow skill per conversational flow (including the profile/onboarding flow), a `plugin.json` manifest, and the connector config (`.mcp.json`), following the established build-from-source pattern of `build-indexes.mjs` / `build-site.mjs` (including a `--check` validate-only mode). The set of depth tiers the build recognizes (`DEPTH_TIERS`) SHALL include `discovery`, so a flow may declare `needs: discovery` to load the shared recipe triage/import mechanics. The build SHALL fail if the source cannot be mapped to the expected skill set (missing `core`, a flow needing an absent depth tier, or a duplicate/invalid skill name).

#### Scenario: Building produces the skill set from source

- **WHEN** `scripts/build-plugin.mjs` runs against `AGENT_INSTRUCTIONS.md`
- **THEN** it emits a plugin tree containing the persona-tier library skills (including `grocery-discovery`), one workflow skill per flow, a `plugin.json`, and the connector config

#### Scenario: A flow declaring an absent depth tier fails the build

- **WHEN** a flow declares `needs: discovery` but no `<!-- persona: discovery -->` block exists in the source
- **THEN** the build fails rather than emitting a workflow whose prerequisite line references a missing library skill

#### Scenario: Source and bundle do not drift

- **WHEN** a behavior change is made
- **THEN** it is made in `AGENT_INSTRUCTIONS.md` and the plugin is rebuilt from it, and no skill body is edited directly in the generated bundle

### Requirement: Persona shipped as reference-loaded library skills

The shared persona SHALL ship as **library skills** — a `grocery-core` skill loaded by every workflow, plus depth skills (`grocery-cart`, `grocery-corpus`, `grocery-discovery`) carrying the rules only some flows need — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. The `grocery-discovery` tier SHALL carry the shared recipe triage/import mechanics (cheap-first triage, `parse_recipe` → classify → `create_recipe`, source-URL dedup, and the disposition vocabulary) so the flows that import a recipe reference one source rather than restating it inline. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `grocery-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field, and this requirement SHALL make no modification to the Worker or MCP server.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `grocery-core` (and any depth tier it needs, e.g. `grocery-discovery` for a flow that imports) — supplying persona, modes, behavior rules, and tone — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: An importing flow reaches the shared mechanics at runtime

- **WHEN** the `semantic-meal-plan` or `import-recipe` workflow fires and its prerequisite line loads `grocery-discovery`
- **THEN** the triage/import mechanics are in context for that flow, so its in-body references to the shared mechanics resolve rather than pointing at a separate, un-loaded skill

#### Scenario: Library skills do not auto-select and are hidden from user discovery

- **WHEN** the agent evaluates which skill to load, or the user opens slash-command discovery
- **THEN** the `grocery-core` / depth library skills (including `grocery-discovery`) are not auto-selected on their own (their descriptions are minimal) and do not appear as user-invocable entries (`user-invocable: false`); they load only via a workflow's prerequisite line

#### Scenario: Hiding the library skills does not break reference loading

- **WHEN** a workflow's prerequisite line instructs the model to read a `user-invocable: false` library skill
- **THEN** the model still loads that library skill's content (the flag removes only the user entry point, not model loading)
