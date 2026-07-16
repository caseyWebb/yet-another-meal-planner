## MODIFIED Requirements

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

The shared persona SHALL ship as **library skills** — a `yamp-core` skill loaded by every workflow, plus a depth skill for any depth tier the source declares (the shipped persona declares none; the generator retains the `cart`/`corpus`/`discovery` tier mechanism for future regrowth) — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `yamp-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field, and this requirement SHALL make no modification to the Worker or MCP server.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `yamp-core` — supplying persona, voice, learning posture, and behavior rules — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: Library skills do not auto-select and are hidden from user discovery

- **WHEN** the agent evaluates which skill to load, or the user opens slash-command discovery
- **THEN** the `yamp-core` library skill is not auto-selected on its own (its description is minimal) and does not appear as a user-invocable entry (`user-invocable: false`); it loads only via a workflow's prerequisite line

#### Scenario: Hiding the library skills does not break reference loading

- **WHEN** a workflow's prerequisite line instructs the model to read a `user-invocable: false` library skill
- **THEN** the model still loads that library skill's content (the flag removes only the user entry point, not model loading)
