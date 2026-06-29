## ADDED Requirements

### Requirement: Configured usage requests reach the Analytics API without a runtime binding error

The `GET /admin/api/usage` egress SHALL invoke the global `fetch` such that the runtime does not reject it for an incorrect `this` reference. With `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` configured and the Cloudflare Analytics API reachable, the endpoint SHALL return the day's usage payload rather than failing with an `upstream_unavailable` error caused by an "Illegal invocation". The default `fetch` implementation the endpoint uses SHALL remain callable when detached from any owning object, and an automated guard SHALL exercise it that way (the existing tests inject their own `fetch` and so cannot catch a `this`-binding regression).

#### Scenario: Configured snapshot succeeds rather than failing with a binding error

- **WHEN** `GET /admin/api/usage` runs on a deployment with `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` set and the Analytics API reachable
- **THEN** the outbound `fetch` is invoked with a correct `this` binding and the endpoint returns the usage payload, not an `upstream_unavailable` error caused by an "Illegal invocation: function called with incorrect `this` reference"

#### Scenario: A regression guard exercises the default fetch detached from its object

- **WHEN** the usage module's default `fetch` implementation is invoked as a bare reference, detached from any owning object
- **THEN** it does not throw an incorrect-`this` runtime error (the guard fails if `fetch` is stored and then invoked in a way that rebinds `this` to the holder)

### Requirement: The Usage page surfaces upstream failure detail

When `GET /admin/api/usage` fails upstream, it SHALL respond with a structured `upstream_unavailable` error whose body carries the upstream message, and the Usage page SHALL render that message together with the error code rather than a bare HTTP status. The page SHALL decode the `{ error, message }` body into a typed error carried in the failed state — not an untyped string or a discarded status — so the operator sees what actually failed without opening the browser console. This surface is admin-only behind the `/admin*` Access gate, so it MAY include full upstream error detail.

#### Scenario: An upstream failure shows its detail in the UI

- **WHEN** `GET /admin/api/usage` responds non-2xx with a JSON body `{ error, message }`
- **THEN** the Usage panel renders the `message` and the `error` code, not a bare "HTTP 500"

#### Scenario: Error detail is decoded into a typed failure state

- **WHEN** the panel handles a non-2xx response carrying a `{ error, message }` body
- **THEN** it decodes the body into a typed error held in the failed state (not a `Maybe String` and not a status-only `BadStatus`) and renders it
