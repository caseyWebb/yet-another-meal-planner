## ADDED Requirements

### Requirement: Operator probes a discovery feed from the edge

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured), an operator-only edge feed-probe `POST /admin/api/discovery/test-feed { url }` that runs **from the Worker's egress** and reports whether a feed URL is a viable discovery source. The probe SHALL fetch the feed URL with the same browser-headered fetch the sweep uses, report the fetch status and whether the body parses as RSS/Atom and how many items it yields, and then run the sweep's recipe-acquisition path against a bounded sample of the feed's entry pages — reporting **each sampled page's specific outcome** from the same taxonomy the sweep parks with (`ok` / `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete`). The probe SHALL reuse the exact acquisition logic the sweep uses (a shared helper, not a re-implementation) so its verdict matches what the sweep would actually do. The probe SHALL write nothing — it neither imports a recipe nor mutates the feed set. It is an operator/cross-tenant operation and SHALL NOT be exposed as an MCP tool; an unsupported method SHALL be rejected (`405`).

The Config › Feeds editor SHALL offer a **test action** — on each listed feed row and on the add form's drafted URL — that calls the probe endpoint and renders its verdict (feed reachable and item count; how many sampled entry pages parsed versus were walled or were not recipes). The test action's in-flight state and its result/failure SHALL be modeled per `admin/CLAUDE.md` (a single state type carrying which row is being tested and its outcome — never a `Bool` busy flag beside a `Maybe String`), and a test SHALL be read-only: it SHALL NOT add, remove, or refetch the feed rows.

#### Scenario: Probe reports the feed and a sample of its entry pages

- **WHEN** the operator triggers a test on a feed whose XML fetches and parses but whose entry pages are all bot-walled
- **THEN** the probe reports the feed as reachable with its item count, and the sampled entry pages as `unreachable`, so the operator sees the feed is not actually a viable source

#### Scenario: Probe distinguishes a non-recipe feed from a walled one

- **WHEN** the operator tests a feed whose entries are roundup/article pages (fetch 200, no schema.org `Recipe`)
- **THEN** the sampled pages report `not_a_recipe` (not `unreachable`), distinguishing an off-base source from a walled one

#### Scenario: Probe is Access-gated and writes nothing

- **WHEN** Access is configured and the operator calls `POST /admin/api/discovery/test-feed`
- **THEN** the verdict is returned and no feed row or recipe is written; and when Access is unconfigured the route responds `404` like the rest of `/admin*`

#### Scenario: The test action does not mutate the feed list

- **WHEN** the operator tests a drafted or existing feed URL in the Feeds editor
- **THEN** the verdict renders without adding, removing, or refetching the feed rows

### Requirement: Operator re-probes mislabeled parked discovery rows

The admin surface SHALL expose, gated by Cloudflare Access exactly like the rest of `/admin*` (404 when Access is unconfigured), an operator-only `POST /admin/api/discovery/reprobe-parked` that re-classifies existing parked `outcome='error'` discovery-log rows whose `detail.reason` is the legacy catch-all `unreachable`. For each such row it SHALL re-run the shared acquisition helper against the row's URL and update that row's `detail.reason` in place to the specific outcome (`no_jsonld` / `not_a_recipe` / `incomplete`, or leave `unreachable` when the page genuinely still cannot be fetched), recording the HTTP status where the failure is a non-2xx. The re-probe SHALL be bounded (it processes a capped batch of legacy rows per invocation so a large backlog cannot exhaust the subrequest budget in one call) and idempotent (a row already carrying a specific reason is skipped). It SHALL import nothing and SHALL touch only the `detail` of the targeted rows. It is operator/cross-tenant and SHALL NOT be exposed as an MCP tool; an unsupported method SHALL be rejected (`405`).

#### Scenario: A legacy unreachable row is re-classified to its specific reason

- **WHEN** the operator runs the re-probe and a legacy `unreachable` row's URL now fetches 200 with no schema.org `Recipe`
- **THEN** that row's `detail.reason` is updated to `not_a_recipe` in place, and nothing is imported

#### Scenario: A still-unreachable row keeps unreachable

- **WHEN** the re-probe re-fetches a legacy row's URL and it still returns a non-2xx or throws
- **THEN** the row keeps `detail.reason` of `unreachable`, with the HTTP status recorded where applicable

#### Scenario: Re-probe is bounded and idempotent

- **WHEN** the operator runs the re-probe twice
- **THEN** the first run processes a capped batch of legacy `unreachable` rows and the second skips rows already carrying a specific reason, so re-running does not redo settled rows
