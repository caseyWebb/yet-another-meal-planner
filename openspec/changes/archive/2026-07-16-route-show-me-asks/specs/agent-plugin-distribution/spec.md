# agent-plugin-distribution — delta

## MODIFIED Requirements

### Requirement: Persona shipped as reference-loaded library skills

The shared persona SHALL ship as **library skills** — a `yamp-core` skill loaded by every workflow, plus a depth skill for any depth tier the source declares (the shipped persona declares none; the generator retains the `cart`/`corpus`/`discovery` tier mechanism for future regrowth) — each with an intentionally minimal description so it never self-triggers or competes for relevance-based auto-load, **and each marked `user-invocable: false`** so it is hidden from user-facing slash-command discovery while remaining model-loadable by reference. Each workflow skill SHALL be prefixed with a **prerequisite line** that loads `yamp-core` plus any depth tier the flow declares it `needs`, hedged with "if you haven't already this session" so the shared content loads at most once per session rather than being re-inlined into every skill. The persona SHALL NOT be carried in the MCP server `instructions` field — the field carries at most the minimal tool-routing preamble the `mcp-server` capability defines (routing only: show-me asks render display tools, reads are internal, plain member-facing language), never voice, learning posture, or flow choreography.

The `user-invocable: false` frontmatter is emitted on library skills only (not workflow skills). Because the flag's behavior on claude.ai is not documented, its rollout SHALL be gated on a live confirmation that the target surface both hides the library skills from user discovery and still loads them via a workflow's prerequisite line; if the surface ignores the flag, the library skills remain visible as before with no functional regression.

#### Scenario: Firing a workflow loads its prerequisites once

- **WHEN** a workflow skill fires
- **THEN** its prerequisite line loads `yamp-core` — supplying persona, voice, learning posture, and behavior rules — and a tier already loaded earlier in the session is not re-loaded

#### Scenario: Instructions stay routing-only

- **WHEN** the server's initialize `instructions` are compared against the persona source
- **THEN** they contain only the tool-routing preamble — no persona voice, learning posture, or flow choreography
