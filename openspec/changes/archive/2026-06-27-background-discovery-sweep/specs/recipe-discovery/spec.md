## REMOVED Requirements

### Requirement: RSS discovery returns a deduped candidate pool without scoring

**Reason**: Discovery is no longer a live, agent-time pull. `fetch_rss_discoveries` is retired from the agent tool surface; the background discovery sweep polls the shared `feeds` table itself (see the `discovery-sweep` capability: "Sweep intake polls feeds and drains the email inbox, deduped"). The agent no longer receives an RSS candidate pool to triage.

**Migration**: Feed configuration is unchanged (`update_feeds` still writes the shared `feeds` table). Candidates are classified, taste-matched, and auto-imported by the sweep; the agent reads results via the new-for-me read at plan time instead of `fetch_rss_discoveries`.

### Requirement: RSS candidates are deduped against the existing corpus

**Reason**: The dedup responsibility moves with the intake into the background sweep, which excludes candidates already present as a corpus `source_url`, in `discovery_rejections`, or in the `discovery_evaluated` set, and additionally deduplicates semantically (see the `discovery-sweep` capability: "Sweep intake polls feeds and drains the email inbox, deduped" and "Imports are deduplicated semantically, not just by URL").

**Migration**: No agent-facing behavior to migrate — dedup is performed by the sweep before import. Canonical-URL dedup semantics (tracker stripping, JSON-LD-declared source) are preserved in the sweep.

## MODIFIED Requirements

### Requirement: A discovery URL can be rejected group-wide

The system SHALL provide a `reject_discovery(url, reason?)` tool that records a **shared, group-wide** suppression of a discovery source URL in a `discovery_rejections` table keyed by the canonical URL. The background discovery sweep SHALL consult it: a rejected URL (and its tracker-wrapped variants) SHALL be excluded from intake so the sweep never re-imports it. Rejection SHALL be idempotent on the canonical URL and SHALL NOT, by itself, modify recipe content or any tenant's overlay. Because pre-import candidates are no longer surfaced to members for triage, rejection is reserved for suppressing a **source** that is not corpus-worthy for the group (a feed/site producing junk, broken, non-recipe, or duplicate results); suppressing an individual member's view of an already-imported recipe is `toggle_reject` (per-tenant), and removing a bad import from the shared corpus is a separate explicit action. A personal not-for-me is `toggle_reject`, never `reject_discovery`.

#### Scenario: A rejected source stops being imported

- **WHEN** a member calls `reject_discovery` on a source URL and the sweep later runs
- **THEN** that URL (and its tracker-wrapped variants) is excluded from sweep intake and is not re-imported for the group

#### Scenario: Rejection writes no recipe or overlay

- **WHEN** `reject_discovery` is called
- **THEN** only the shared `discovery_rejections` table is written; no recipe content and no tenant overlay changes

#### Scenario: Personal dislike of an imported recipe is toggle_reject, not reject_discovery

- **WHEN** a member wants to stop seeing an already-imported recipe that others may still want
- **THEN** the agent calls `toggle_reject` for that member, not `reject_discovery` (which is group-wide source suppression)
