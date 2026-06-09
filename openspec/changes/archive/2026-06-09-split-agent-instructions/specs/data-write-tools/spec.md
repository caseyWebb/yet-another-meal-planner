## MODIFIED Requirements

### Requirement: User-curated config writes are content-faithful

The user-curated `update_*` tools (`taste`, `diet_principles`, `preferences`, `substitutions`, `aliases`) SHALL write exactly the content supplied by the caller to the corresponding curated file and SHALL NOT infer or merge additional changes. The discipline of *when* these may be called (only on explicit user direction) is documented in `AGENT_INSTRUCTIONS.md`; the tools themselves are unconditional writers of provided content.

#### Scenario: Curated write persists provided content verbatim

- **WHEN** `update_preferences(updates)` is called with a directed edit
- **THEN** the tool writes the provided content to `preferences.toml` via the atomic commit and returns confirmation, without adding inferred changes
