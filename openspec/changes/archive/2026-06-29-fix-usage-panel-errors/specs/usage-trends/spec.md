## ADDED Requirements

### Requirement: Configured trends requests reach the Analytics Engine without a runtime binding error

The `GET /admin/api/usage/trends` egress SHALL invoke the global `fetch` such that the runtime does not reject it for an incorrect `this` reference. With `CF_ACCOUNT_ID` and the analytics token configured and the Analytics Engine SQL API reachable, the endpoint SHALL return the per-job series rather than failing with an `upstream_unavailable` error caused by an "Illegal invocation". The default `fetch` implementation the endpoint uses SHALL remain callable when detached from any owning object, covered by the same regression guard as the snapshot surface.

#### Scenario: Configured trends succeed rather than failing with a binding error

- **WHEN** `GET /admin/api/usage/trends` runs on a deployment with `CF_ACCOUNT_ID` and the analytics token set and the AE SQL API reachable
- **THEN** the outbound `fetch` is invoked with a correct `this` binding and the endpoint returns the per-job series, not an `upstream_unavailable` error caused by an "Illegal invocation"

### Requirement: The trends panel surfaces upstream failure detail

When `GET /admin/api/usage/trends` returns its `upstream_unavailable` error, the trends panel SHALL render the upstream `message` together with the error code rather than a bare HTTP status. The panel SHALL decode the `{ error, message }` body into a typed error carried in the failed state — not an untyped string or a discarded status. This surface is admin-only behind the `/admin*` Access gate, so it MAY include full upstream error detail.

#### Scenario: An upstream failure shows its detail in the trends panel

- **WHEN** `GET /admin/api/usage/trends` responds non-2xx with a JSON body `{ error, message }`
- **THEN** the trends panel renders the `message` and the `error` code, not a bare "HTTP 500"
