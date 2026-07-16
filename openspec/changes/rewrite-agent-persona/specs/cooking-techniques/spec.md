## REMOVED Requirements

### Requirement: Capture flow distills member-supplied sources

**Reason**: Member guidance writes left the surface — `save_guidance` was removed from the member MCP surface in `narrow-mcp-surface` (the operator curates the guidance corpora via admin Data › Guidance), so the `save-technique` capture skill has no writer and is dropped in the 17→6 skill consolidation.
**Migration**: A member who posts a technique worth keeping is told the household's guidance is curated; the operator adds it via the admin panel. Cook-time surfacing of technique memories (the "Technique memories surfaced at cook time" requirement) is unchanged — the `cook` skill still reads them via `read_guidance`.
