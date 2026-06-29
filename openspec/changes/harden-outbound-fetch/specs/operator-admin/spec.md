## MODIFIED Requirements

### Requirement: Shared-corpus editor endpoints served cross-tenant under Access

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured), a writable corpus namespace `/admin/api/corpus/<table>` where `<table>` is one of a fixed set (`aliases`, `flyer-terms`, `feeds`, `senders`, `members`): `GET /admin/api/corpus/<table>` lists the table's rows, `POST /admin/api/corpus/<table>` adds one validated row, and `DELETE /admin/api/corpus/<table>/<key>` removes the row with that primary key. An unknown `<table>` SHALL be a not-found error and an unsupported method SHALL be rejected (`405`). These are operator/cross-tenant operations writing group-wide config and SHALL NOT be exposed as MCP tools. They SHALL be distinct from the read-only `/admin/api/data/*` explorer namespace, which remains read-only.

The `POST` SHALL validate per table server-side and write nothing on a bad input: a non-empty primary key always; `aliases` a non-empty `canonical`; `feeds` a **public `http`/`https` URL** (rejecting a non-http scheme, embedded credentials, or a private/loopback/link-local host — the same write-time guard `update_feeds` applies, since both write through one helper) with a numeric `weight` (defaulting when absent) and `tags` as a string array; `senders`/`members` an address that is normalized (trimmed, lowercased) before storage. The `DELETE` SHALL normalize an address key the same way before matching, so a delete always targets the row an add produced. All writes SHALL go through the Worker's structured storage layer (returning structured errors, not throwing).

#### Scenario: Corpus endpoints are reachable only under Access

- **WHEN** Access is configured and an authenticated operator calls `GET /admin/api/corpus/feeds`
- **THEN** the feed rows are returned; and when Access is unconfigured every `/admin/api/corpus/*` route responds `404` like the rest of `/admin*`

#### Scenario: An invalid add is rejected without a write

- **WHEN** `POST /admin/api/corpus/aliases` sends a row missing its `canonical` (or an empty `variant`)
- **THEN** the endpoint returns a structured validation error and writes nothing

#### Scenario: A non-public feed URL is rejected without a write

- **WHEN** `POST /admin/api/corpus/feeds` sends a `url` with a non-http scheme, embedded credentials, or a private/loopback/link-local host
- **THEN** the endpoint returns a structured validation error and writes no feed row

#### Scenario: An unknown table or method is rejected

- **WHEN** a request targets `/admin/api/corpus/<unknown>` or uses an unsupported method on a valid table
- **THEN** the endpoint responds with a not-found error for the unknown table and `405` for the unsupported method, writing nothing

#### Scenario: Delete removes by primary key

- **WHEN** `DELETE /admin/api/corpus/flyer-terms/<term>` targets an existing term
- **THEN** that term's row is removed and the response reports the removal; a key that is absent reports no removal rather than erroring
