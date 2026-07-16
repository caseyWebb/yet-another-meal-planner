## REMOVED Requirements

### Requirement: Capture flow distills member buying guides

**Reason**: Member guidance writes left the surface — `save_guidance` was removed from the member MCP surface in `narrow-mcp-surface` (the operator curates the guidance corpora via admin Data › Guidance), so the `save-buying-guide` capture skill has no writer and is dropped in the 17→6 skill consolidation.
**Migration**: A member who posts a buying guide worth keeping is told the household's guidance is curated; the operator adds it via the admin panel. Shop-time surfacing (the "Purchasing tips surfaced at shop time" requirement) is unchanged — the `shop` skill still reads entries via `read_guidance`, and the no-improvised-advice posture stands.
