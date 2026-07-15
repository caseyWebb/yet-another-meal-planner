## ADDED Requirements

### Requirement: Tenant (household) data isolation

Per-tenant data isolation SHALL be enforced in D1 with the tenant as the **household** boundary: every per-tenant table carries a `tenant` column, the MCP server instance and the `/api` session context are constructed for the resolved `(tenantId, memberId)` pair, and each query is scoped to that tenant — a tool or route resolved for one household cannot read or write another household's rows. The member is attribution within the household, never an isolation boundary of its own. Shared corpus content (R2 recipe/guidance markdown and the D1 projections derived from it) is deployment-shared by construction and crosses household boundaries ONLY through the defined visibility lens and aggregate reads (the `shared-corpus` capability); data derived from household behavior (cook activity, favorites, prices paid, follows) is memoized within its owning household and crosses households exclusively through those same lenses/aggregates. The Worker SHALL hold no GitHub credentials and make no GitHub API call on any data path: the authored corpus lives in R2 and operational state in D1/KV.

#### Scenario: Household writes are isolated in D1

- **WHEN** a tool for household A persists a change to A's state
- **THEN** the write is scoped to tenant A's rows and can never touch another household's rows

#### Scenario: Cross-household reads go through the lens

- **WHEN** a read surface exposes another household's recipe or cook activity to a member of household A
- **THEN** it does so only through the visibility lens or a defined counts-only aggregate — never by raw cross-tenant query reuse

#### Scenario: No GitHub credential exists

- **WHEN** the Worker's configuration, secrets, and data paths are inspected
- **THEN** there is no GitHub App, installation token, or PAT, and no data path performs a GitHub API call

## REMOVED Requirements

### Requirement: Tenant data isolation and GitHub App installation tokens

**Reason**: GitHub-era vestige (story 01 §4): the authored corpus moved to R2 (`r2-corpus-store`) and the Worker has no GitHub App code path — verified in `src/corpus-store.ts`/`src/env.ts`, which state no GitHub App, installation token, or GitHub API call exists on the data path. The D1 isolation half is carried forward, reworded for tenant = household, by the ADDED "Tenant (household) data isolation" requirement.
**Migration**: none — code already matches; no GitHub credential or installation-resolution behavior exists to retire.
