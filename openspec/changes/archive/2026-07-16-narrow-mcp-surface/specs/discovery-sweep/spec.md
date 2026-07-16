# discovery-sweep — delta

## MODIFIED Requirements

### Requirement: Failed candidates are retried then parked in an error surface

Because the sweep has no conversation to surface a failure into, a candidate whose classification fails validation SHALL be retried a bounded number of times (with a corrective reprompt) and, on continued failure, recorded in a `discovery_errors` table with enough context to diagnose it. Parked candidates SHALL surface in the **operator admin Discovery area's candidate-pipeline view** (with per-row retry/delete) — there is no `read_discovery_errors` MCP tool — and the system SHALL push an optional ntfy alert on a new parked candidate, the same out-of-band feedback model as `reconcile_errors`. A parked candidate SHALL NOT block the rest of the sweep.

A candidate the sweep cannot acquire as parseable recipe content SHALL be parked with a **specific** acquisition-failure reason — `unreachable` (the fetch threw or returned a non-2xx), `no_jsonld` (the page was fetched but exposes no JSON-LD), `not_a_recipe` (JSON-LD is present but contains no schema.org `Recipe`), or `incomplete` (a `Recipe` was found but yields no ingredients or no instructions) — the same taxonomy the manual `import_recipe` URL path returns, rather than a catch-all `unreachable` for every content failure. Where the failure is a non-2xx fetch, the parked detail SHALL also carry the HTTP status. The reason SHALL be recorded in the parked entry's `detail` so an operator can distinguish a walled/dead source from a feed entry that is simply not a parseable recipe.

#### Scenario: A persistently-unclassifiable candidate is parked, not lost

- **WHEN** a candidate fails classification validation after the retry budget
- **THEN** it is recorded in `discovery_errors`, surfaced in the admin Discovery area, and the sweep continues with other candidates

#### Scenario: Parked errors are operator-visible

- **WHEN** the operator opens the admin Discovery area's candidate-pipeline view
- **THEN** the parked candidates appear with their failure context, each offering retry and delete

#### Scenario: An unacquirable candidate is parked with a specific reason

- **WHEN** the sweep fetches a candidate page that returns 200 but contains no schema.org `Recipe` (a roundup or category page)
- **THEN** it is parked with `detail.reason` of `not_a_recipe` (not the catch-all `unreachable`), so the operator can tell it apart from a genuinely unreachable page

#### Scenario: A non-2xx fetch records its status

- **WHEN** the sweep's fetch of a candidate page returns a non-2xx (a bot wall or dead link)
- **THEN** it is parked with `detail.reason` of `unreachable` and the HTTP status recorded in the detail
