## REMOVED Requirements

### Requirement: Starter corpus bootstrap

**Reason**: The starter-corpus activation step existed because a new member's recipes were effective-`draft` (invisible) until activated — an artifact of the opt-in model. Under opt-out visibility the whole shared corpus is available to a new member by default, so there is nothing to activate. A new member's cold-start personalization comes from the captured taste/diet profile plus retrieval (the favorites re-rank is a cold-start no-op), not a one-time activation that goes stale.

**Migration**: The onboarding skill drops the "curate and bulk-promote ~12–18 starter recipes" step. It still points the member at the hosted recipe site as the browse-everything surface, and still degrades to discovery-source seeding when the shared corpus is empty (see "Sparse-corpus onboarding seeds discovery sources"). No `commit_changes`/overlay activation batch is issued.

## ADDED Requirements

### Requirement: A new member's corpus is available without activation

After taste/diet/equipment capture, the onboarding skill SHALL treat the whole shared corpus as immediately available to the new member (subject only to their makeability gate and any rejections they make later). It SHALL NOT require or perform a per-recipe activation step.

#### Scenario: First menu request works with no activation

- **WHEN** a freshly-onboarded member (who activated nothing) makes a menu request
- **THEN** the planner considers the whole non-rejected shared corpus, ranked by their taste/diet profile and retrieval, with no empty-active-set dead end
