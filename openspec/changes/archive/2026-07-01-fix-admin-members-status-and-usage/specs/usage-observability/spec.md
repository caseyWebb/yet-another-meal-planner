## MODIFIED Requirements

### Requirement: KV namespace ids resolve to a friendly label and display color

Because the Cloudflare GraphQL Analytics API reports KV operations by an opaque `namespaceId` that the Worker cannot resolve to its `wrangler.jsonc` binding name at request time, the Usage payload SHALL resolve each known namespace id to a **friendly label** (the binding name, e.g. `KROGER_KV`) using a static mapping populated at deploy time from the operator's own merged wrangler config (`KV_NAMESPACE_LABELS`, an `id:BINDING,...` var the deploy's wrangler-config merge derives from the merged `kv_namespaces` array) — NOT a runtime Cloudflare REST API lookup. A namespace id with no resolvable label mapping SHALL still appear in the payload (its raw id as the label) rather than being dropped, so aggregate totals remain accurate even when labeling is incomplete.

Each namespace id observed in the payload SHALL additionally receive a **stable display color** from a small fixed categorical palette, assigned by the id's position in the sorted list of all namespace ids present in that payload (a deterministic, position-based cycling assignment), regardless of whether that id's friendly label resolves. Color assignment SHALL NOT depend on label resolution succeeding — an unlabeled namespace id SHALL still receive a distinct, non-generic color, never a uniform "grey/unlabeled" fallback shared by every unresolved id.

#### Scenario: A known namespace id resolves to its binding name

- **WHEN** the Usage payload includes a namespace id that matches the deploy-populated `KV_NAMESPACE_LABELS` mapping
- **THEN** that namespace's entries (snapshot and history) carry the mapped friendly label

#### Scenario: An unmapped namespace id still reports accurate totals and a distinct color

- **WHEN** the Analytics API reports a namespace id with no entry in the label mapping
- **THEN** that namespace's operation counts still appear in the payload (raw id as the label) with a distinct, non-generic color assigned by its position among the payload's namespace ids, and the per-action grand totals still include its counts

#### Scenario: Namespace color never depends on label resolution

- **WHEN** two namespace ids appear in the same Usage payload, one with a resolvable label and one without
- **THEN** both receive distinct colors assigned solely by their sorted position among the payload's namespace ids — never a shared grey/generic color reserved for "no label"

#### Scenario: Label resolution makes no additional Cloudflare API call

- **WHEN** the Usage payload resolves namespace labels
- **THEN** it uses only the `KV_NAMESPACE_LABELS` var (or the raw id, if unset/unmatched) and issues no additional outbound request beyond the existing Analytics queries — no runtime call to the Cloudflare KV-namespaces REST endpoint

## ADDED Requirements

### Requirement: Workers AI neuron consumption reports a 30-day history

`GET /admin/api/usage` SHALL report, in addition to the existing current-UTC-day Workers-AI neuron snapshot (`ai.neurons_used`/`ai.by_model`, unchanged), a **per-day neuron-consumption history** over the same trailing window of days the KV-operation history covers (`TRENDS_WINDOW_DAYS`), sourced from the Cloudflare GraphQL Analytics API by widening the existing `aiInferenceAdaptiveGroups` query from a today-only `datetimeHour` filter to a `date_geq`/`date_leq` range with `date` added to `dimensions` — mirroring how the KV-operation history widens `kvOperationsAdaptiveGroups`. The history SHALL be ordered ascending by day (oldest → newest) and SHALL omit no day in the window, even a day with zero recorded neuron usage (reported as zero, not absent). The Usage page SHALL render this history as a sparkline alongside the neuron meter, replacing any "today's value only" notice.

#### Scenario: Configured usage view reports a 30-day neuron history

- **WHEN** the operator opens `/admin/usage` with `CF_ACCOUNT_ID` and `CF_ANALYTICS_TOKEN` configured
- **THEN** `GET /admin/api/usage` returns, alongside today's neuron snapshot, a neuron-consumption series covering the trailing window of days, ordered oldest to newest, and the Usage page renders it as a sparkline next to the neuron meter

#### Scenario: A day with no recorded neuron usage reports zero, not a gap

- **WHEN** no Workers AI inference ran on some day within the window
- **THEN** that day's entry in the neuron history reports `0`, and the day is still present in the series (not omitted)

#### Scenario: The neuron history requires no new token scope

- **WHEN** the Worker fetches the widened `aiInferenceAdaptiveGroups` query for the neuron history
- **THEN** it requires only the "Account Analytics: Read" scope the existing snapshot query already requires — no additional Cloudflare API token scope
