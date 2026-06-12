## MODIFIED Requirements

### Requirement: Persona shipped as reference-loaded library skills

The shared persona SHALL ship as **library skills** — a `grocery-core` skill loaded by every workflow, plus depth skills (`grocery-cart`, `grocery-corpus`) carrying the rules only some flows need — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `grocery-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field, and this requirement SHALL make no modification to the Worker or MCP server.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `grocery-core` (and any depth tier it needs), supplying persona, modes, behavior rules, and tone — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: Library skills do not auto-select and are hidden from user discovery

- **WHEN** the agent evaluates which skill to load, or the user opens slash-command discovery
- **THEN** the `grocery-core` / depth library skills are not auto-selected on their own (their descriptions are minimal) and do not appear as user-invocable entries (`user-invocable: false`); they load only via a workflow's prerequisite line

#### Scenario: Hiding the library skills does not break reference loading

- **WHEN** a workflow's prerequisite line instructs the model to read a `user-invocable: false` library skill
- **THEN** the model still loads that library skill's content (the flag removes only the user entry point, not model loading)
