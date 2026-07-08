## MODIFIED Requirements

### Requirement: CI is workspace-aware across the monorepo packages

CI SHALL typecheck and test **every** workspace package (the Worker, the shared contract package, the satellite, the member app, the admin app, and the shared UI package), not only the Worker. CI SHALL build both frontend bundles (the member app and the admin app, each via its package's build into its own subtree of the Worker's merged assets root) on every run, so a broken bundle build fails before any deploy can fire. Path filters that gate the Worker deploy trigger SHALL be scoped to the packages the deployed Worker serves — the Worker's package paths **plus** the frontend packages (`packages/app/**`, `packages/admin-app/**`, `packages/ui/**`), since the deploy builds and serves both SPAs — so a satellite-only or docs-only change does NOT trigger a Worker deploy, and a Worker change does NOT rebuild the satellite image. A change to the **shared contract package** SHALL fan out to both pipelines (it can break either side), so contract changes SHALL run the Worker CI and be treated as affecting the satellite image. The satellite's tests SHALL use fixture pages and SHALL NOT hit live paid sources in CI.

#### Scenario: Every package is typechecked and tested

- **WHEN** CI runs on a push or PR
- **THEN** the Worker, contract, satellite, app, admin-app, and ui packages are each typechecked (and tested where they carry tests)

#### Scenario: A satellite-only change does not deploy the Worker

- **WHEN** a change touches only satellite-package paths
- **THEN** the Worker deploy trigger does not fire

#### Scenario: A frontend-only change deploys the Worker

- **WHEN** a change touches only `packages/app/**`, `packages/admin-app/**`, or `packages/ui/**`
- **THEN** the Worker deploy trigger fires (the deploy rebuilds and republishes the served bundles)

#### Scenario: A broken admin bundle never deploys

- **WHEN** the admin app fails to build
- **THEN** CI's build step fails the `test` job and the deploy trigger does not fire

#### Scenario: A contract change fans out to both sides

- **WHEN** a change touches the shared contract package
- **THEN** CI runs the Worker checks and treats the change as affecting the satellite image build
