## ADDED Requirements

### Requirement: Deploy builds the member app and stamps the build id

The operator deploy SHALL build the member SPA (after the admin bundle, before `wrangler deploy`) so the assets binding serves a fresh bundle on every deploy — the assets root is a build artifact, never committed. The deploy SHALL compute the code SHA once and stamp it into both the SPA build (the bundle's embedded build id) and the deployed Worker (a deploy-injected `APP_BUILD` var), so the two sides of the version-skew contract always carry the same id. CI SHALL also build the app on every run so a broken SPA build fails before any deploy can fire.

#### Scenario: The deploy serves a freshly built, stamped bundle

- **WHEN** an operator deploy runs
- **THEN** the SPA is built in the deploy (not read from the repo), its embedded build id equals the `APP_BUILD` var injected into the deployed Worker, and both equal the deployed code SHA

#### Scenario: A broken app build never deploys

- **WHEN** the member app fails to build
- **THEN** CI's build step fails the `test` job and the deploy trigger does not fire

## MODIFIED Requirements

### Requirement: CI is workspace-aware across the monorepo packages

CI SHALL typecheck and test **every** workspace package (the Worker, the shared contract package, the satellite, the member app, and the shared UI package), not only the Worker. Path filters that gate the Worker deploy trigger SHALL be scoped to the packages the deployed Worker serves — the Worker's package paths **plus** the member app and shared UI packages (`packages/app/**`, `packages/ui/**`), since the deploy builds and serves the SPA — so a satellite-only or docs-only change does NOT trigger a Worker deploy, and a Worker change does NOT rebuild the satellite image. A change to the **shared contract package** SHALL fan out to both pipelines (it can break either side), so contract changes SHALL run the Worker CI and be treated as affecting the satellite image. The satellite's tests SHALL use fixture pages and SHALL NOT hit live paid sources in CI.

#### Scenario: Every package is typechecked and tested

- **WHEN** CI runs on a push or PR
- **THEN** the Worker, contract, satellite, app, and ui packages are each typechecked (and tested where they carry tests)

#### Scenario: A satellite-only change does not deploy the Worker

- **WHEN** a change touches only satellite-package paths
- **THEN** the Worker deploy trigger does not fire

#### Scenario: An app-only change deploys the Worker

- **WHEN** a change touches only `packages/app/**` or `packages/ui/**`
- **THEN** the Worker deploy trigger fires (the deploy rebuilds and republishes the served SPA)

#### Scenario: A contract change fans out to both sides

- **WHEN** a change touches the shared contract package
- **THEN** CI runs the Worker checks and treats the change as affecting the satellite image build
