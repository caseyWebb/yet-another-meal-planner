## MODIFIED Requirements

### Requirement: Insights aggregates group-wide across member-tenants

Insights figures SHALL aggregate over **all member-tenants** on the deployment (the group), not a single tenant — a deliberate stance: Insights is an **operator-trusted admin surface** (Access-gated, like the rest of `/admin`), sits OUTSIDE the member visibility lens, and is NOT a lens consumer; it exposes counts and titles only, never which member cooked what beyond what its per-recipe aggregates state today, and nothing from it feeds any member-facing read. A recipe's times-cooked and favorite counts SHALL sum every member's contribution regardless of household friendship structure or deployment profile. The reserved curated system tenant SHALL contribute nothing (it holds no cooking log, overlay, or member rows) and SHALL never appear as a member-tenant in any Insights figure.

#### Scenario: A recipe cooked by multiple members sums across the group

- **WHEN** two different members each have a `cooking_log` `type='recipe'` row for the same slug in the window
- **THEN** that recipe's times-cooked for the window is at least 2 (the group total), not a per-member value

#### Scenario: Favorites count distinct favoriting members

- **WHEN** N members have an `overlay` row with `favorite` set for a slug
- **THEN** that recipe's favorite count is N

#### Scenario: The operator dashboard is unaffected by the lens

- **WHEN** the operator opens Insights on a SaaS deployment where households have disjoint lenses
- **THEN** the aggregates still cover every member-tenant's activity deployment-wide — the admin surface reads outside the lens, and no member-facing surface gains access to these cross-lens aggregates

#### Scenario: The curated tenant never appears

- **WHEN** Insights aggregates run on a deployment with curated-tier grants
- **THEN** the reserved curated tenant contributes no cook events, favorites, or roster presence to any figure
