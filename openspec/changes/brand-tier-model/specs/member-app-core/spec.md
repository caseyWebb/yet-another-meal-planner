## MODIFIED Requirements

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile (including the member's Kroger link state),
SHALL edit structured preferences via the existing merge-patch operation (single-select
`lunch_strategy` over the real vocabulary; dietary avoid/limit; rotation; stores), SHALL
provide the **Preferred-brands management card** editing brand tiers per product family —
per-family cards showing ordered tiers of equivalent brands, tier chips movable with ▲/▼
where moving past the edge creates a new tier (and a tier emptied by moves or removals
collapses), a per-tier add-brand input, an add-fallback-tier action, a per-family
"Any brand — cheapest wins" toggle, remove-family, and an add-family form — each edit
writing a family-scoped merge-patch of the canonical tier object (`{ tiers, any_brand }`;
remove-family writes `null`), SHALL edit the `taste` and `diet_principles` markdown fields,
SHALL render the derived taste read from the existing retrospective aggregation, and SHALL
obtain the Kroger consent URL from the existing builder. All whole-document writes on this
page are conditional (see the write-classes requirement).

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation
  over the real cooking log — no new aggregation is introduced

#### Scenario: Moving a brand chip past the edge creates a tier

- **WHEN** a member presses ▲ on a brand chip already in the family's top tier
- **THEN** a new top tier containing only that brand is created, and the family is written as a
  family-scoped merge-patch of the full tier object under the page's conditional write, leaving
  other families untouched

#### Scenario: The any-brand toggle is a partial family patch

- **WHEN** a member turns "Any brand — cheapest wins" on for a family that has tiers
- **THEN** the write patches `{ any_brand: true }` for that family only and the family's tiers
  are preserved
