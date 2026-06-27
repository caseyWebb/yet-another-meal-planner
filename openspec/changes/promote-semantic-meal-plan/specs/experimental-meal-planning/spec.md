## REMOVED Requirements

### Requirement: The semantic meal-plan skill is experimental and invoke-by-name

**Reason**: The flow is promoted to the default, auto-routed meal-plan flow; there is no longer a separate experimental, invoke-by-name skill to A/B against a production flow.
**Migration**: Ordinary menu requests run the (now retrieval-based) `menu-generation` flow directly; the `semantic-meal-plan` skill name is removed.

### Requirement: Distill context into searches, retrieve, then compose

**Reason**: Migrated into the canonical `menu-generation` capability.
**Migration**: See `menu-generation` → "Distill context into searches, retrieve, then compose" (retrieval now via the unified `search_recipes` tool).

### Requirement: Recall is engineered into the search set

**Reason**: Migrated into the canonical `menu-generation` capability.
**Migration**: See `menu-generation` → "Recall is engineered into the search set".

### Requirement: Aggressive in-session import of preference-matched discoveries

**Reason**: Migrated into the canonical `menu-generation` capability.
**Migration**: See `menu-generation` → "Aggressive in-session import of preference-matched discoveries".

### Requirement: Disposition collapses into the import decision

**Reason**: Migrated into the canonical `menu-generation` capability.
**Migration**: See `menu-generation` → "Disposition collapses into the import decision".

### Requirement: An exploration allowance keeps the loop from over-tightening

**Reason**: Migrated into the canonical `menu-generation` capability.
**Migration**: See `menu-generation` → "An exploration allowance keeps the loop from over-tightening".

### Requirement: Discovery triage precedes retrieval and sizes it to the gap

**Reason**: Migrated into the canonical `menu-generation` capability, folded into its discovery requirement so the discovery-first ordering lives with the rest of the menu-request discovery behavior.
**Migration**: See `menu-generation` → "Discovery surfaced during menu requests" (rewritten to triage-and-import-before-retrieval, accepted picks claim slots first, retrieval sized to the remaining gap).
