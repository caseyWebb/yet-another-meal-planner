## MODIFIED Requirements

<!-- NOTE (serial-surface): this requirement is also MODIFIED by
deployment-profiles-and-visibility-lens, which lands and archives before this change. The text
below builds on that change's ratified version; re-verify against the archived living spec at
implementation time. -->

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the group signal for a visible recipe — how many other households **within the caller's lens** have favorited it (a count) and the notes the caller may see under the note-tier rules (attributed, with author handles and tiers) — to inform surfacing of recipes the caller has not tried. The favorites half SHALL aggregate at read time over the caller's lens households only (own household plus friend households; every household under self-hosted — today's behavior), as a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale. The notes half SHALL follow the `recipe-notes` tier rules exactly: `friends` notes from the caller's own and friend households, `public` notes from **any** household (a public note on a lens-visible recipe is visible even when its author's household is outside the caller's lens — e.g. a public note on a curated recipe), the caller's own notes at every tier, and never another member's `private` note. Signal SHALL be reachable only for recipes inside the caller's lens.

#### Scenario: Aggregated group favorite count available within the lens

- **WHEN** several households in the caller's lens have favorited a visible recipe and the caller requests group signal for it
- **THEN** the caller receives the count of those other households' favorites and the tier-admitted attributed notes

#### Scenario: Non-lens households never contribute favorites

- **WHEN** a household outside a SaaS caller's lens has favorited a recipe the caller can see (e.g. a curated recipe)
- **THEN** that household's favorite is absent from the caller's group-signal count

#### Scenario: A public note crosses lens households

- **WHEN** a household outside a SaaS caller's lens holds a `public` note on a curated recipe the caller can see
- **THEN** that note appears in the caller's group signal (handle-attributed, `tier: "public"`), while the same household's `friends` notes on that recipe do not

#### Scenario: Others' private notes excluded

- **WHEN** another member has a `private` note on a recipe
- **THEN** that note is not included in the group signal returned to the caller
