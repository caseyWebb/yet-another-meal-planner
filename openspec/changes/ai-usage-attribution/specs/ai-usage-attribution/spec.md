## ADDED Requirements

### Requirement: Every Workers AI call emits a per-call attribution data point

Every `env.AI.run` inference the Worker performs SHALL emit **one tenant-clean data point** to a Workers Analytics Engine dataset (binding `AI_AE`, dataset `yamp_ai`), carrying the **activity** (a fixed enum finer than a job name — e.g. `classify`, `describe`, `confirm-match`, `embed-recipe`, `embed-search`), the **model**, the **trigger** (`cron` | `import` | `request`), the call **outcome** (`ok` | `error`), the call **duration** in milliseconds, the **calls/items** count (1 for a text-gen call; the batch size for a batched embedding call), the **input** and **output** token counts, and a derived **estimated neuron** figure. The emission SHALL be **best-effort** — an absent or throwing `writeDataPoint` SHALL be a swallowed no-op that does not change the call's result — and **non-blocking**, emitted after the result is in hand (via `ctx.waitUntil` on the request path) so it adds no latency. The point SHALL be **tenant-data-free** by construction: activity, model, trigger, outcome, and numbers only — never a username, tenant id, recipe slug, or input text. The emission SHALL consume neither the KV nor the D1 operation budget. The dataset's blob/double **slot layout is positional and a documented contract** (`docs/SCHEMAS.md`); a later change SHALL NOT reorder existing slots.

#### Scenario: A completed inference emits a tenant-clean data point

- **WHEN** the Worker completes an `env.AI.run` inference (success or failure)
- **THEN** it writes one `yamp_ai` point carrying the activity, model, trigger, outcome, duration, calls, tokens, and estimated neurons — and no per-tenant identifier or input text

#### Scenario: Emission never affects the call

- **WHEN** the `AI_AE` binding is absent or `writeDataPoint` throws
- **THEN** the AI call's result is unchanged and the call completes exactly as it would without instrumentation

#### Scenario: Emission consumes no KV or D1 budget and adds no latency

- **WHEN** an AI call emits its data point
- **THEN** the write goes only to Analytics Engine, performs no KV or D1 operation, and is emitted after the result is computed

#### Scenario: A failed inference emits an error-outcome point

- **WHEN** `env.AI.run` throws (including a Workers AI quota 4006)
- **THEN** an `outcome: "error"` point is emitted (duration recorded, token counts zero) and the error is rethrown so the caller's existing handling is unchanged

### Requirement: AI calls route through a single gateway seam

The per-call instrumentation SHALL be applied by routing **every** `env.AI.run` through one gateway function (`src/ai.ts`), so that every present and future AI call is captured with no per-call-site instrumentation. Each call site SHALL pass its **activity** and **trigger** to the gateway; the gateway SHALL derive the metrics and emit the point, and SHALL NOT alter the response it returns (callers destructure the model's content field as before). The gateway SHALL sit **below** the KV embedding cache, so a cache hit — which performs no inference — emits no data point.

#### Scenario: Every AI call is captured from one seam

- **WHEN** the Worker performs any embedding or text-generation inference
- **THEN** it goes through the `src/ai.ts` gateway and emits a data point, with no instrumentation code at the individual call sites beyond passing the activity and trigger

#### Scenario: A cache hit emits nothing

- **WHEN** a request-path embedding is served from the KV embedding cache (no `env.AI.run`)
- **THEN** no `yamp_ai` point is emitted, so the attribution reflects only real inference spend

#### Scenario: A new AI call is captured automatically

- **WHEN** a new AI call is added through the gateway
- **THEN** it emits per-call data points without any additional instrumentation wiring

### Requirement: Per-call neuron cost is an estimate anchored to the account total

Because the Workers AI binding exposes **no per-call neuron count** for any model (and token `usage` only for text-generation output, not for embeddings), the estimated-neuron figure SHALL be **derived**: from the returned token `usage` for text-generation calls, and from an input-length token estimate for embedding calls, each multiplied by a **documented per-model neuron rate** held as one constant in `src/ai.ts`. The estimate SHALL be treated and labelled as an **estimate, not a billing figure**: the operator view SHALL render the summed estimate **against the account-level by-model neuron actual** (the GraphQL Analytics figure that is the canonical neuron source), so its fidelity is visible. Raw token counts SHALL be recorded alongside the estimate, so a later rate correction recomputes forward without a schema change.

#### Scenario: Text-generation neurons are estimated from real tokens

- **WHEN** a text-generation call returns `usage` token counts
- **THEN** the estimated neurons are derived from those tokens and the per-model rate, and the raw token counts are recorded on the data point

#### Scenario: Embedding neurons are estimated from input length

- **WHEN** an embedding call returns no token usage
- **THEN** the estimated neurons are derived from an input-length token estimate and the embed-model rate

#### Scenario: The view shows estimate against account actual

- **WHEN** the operator opens the attribution view
- **THEN** the summed per-activity estimate is shown against the account-level by-model neuron actual, and the estimate is presented as an estimate, not a billing total

### Requirement: Import-time and request-path AI spend is attributed

The **trigger** dimension SHALL make AI spend outside the cron path first-class: an inference driven by a member/agent request (e.g. `create_recipe`'s inline description/facet seeds) SHALL carry `trigger: "import"` (or `"request"` for the tool path), and a cron reconcile/audit inference SHALL carry `trigger: "cron"`. So spend that bypasses the `job_health`/`job_runs` ledger — notably import-time inline AI — SHALL still appear in the attribution view, distinguished by trigger.

#### Scenario: Import-time inline AI is attributed

- **WHEN** `create_recipe` seeds a description and facets inline via `env.AI`
- **THEN** those calls emit `yamp_ai` points with `trigger: "import"`, and the attribution view shows the import-time spend as its own line

#### Scenario: Cron and request spend are distinguished

- **WHEN** the same activity fires from a cron reconcile and from a member request
- **THEN** its points carry `trigger: "cron"` and `trigger: "request"` respectively, and the view can split spend by trigger

### Requirement: The AI-usage Analytics Engine binding propagates to every operator

The `AI_AE` dataset is a **third** `analytics_engine_datasets` binding instance the deploy config merge must carry. The merge (`scripts/merge-wrangler-config.mjs`) SHALL propagate **all three** dataset bindings — `yamp_usage`, `yamp_tool`, and `yamp_ai` — verbatim from code to every operator's deployed config (none carries an operator-owned id). A regression test SHALL assert that all three dataset instances survive the merge, guarding the silent-drop trap for the third instance.

#### Scenario: All three AE bindings survive the config merge

- **WHEN** the deploy merges the code config with an operator's config
- **THEN** the merged config retains the `yamp_usage`, `yamp_tool`, and `yamp_ai` Analytics Engine bindings from code

#### Scenario: A dropped third binding is caught by a test

- **WHEN** the merge would drop the `yamp_ai` dataset instance
- **THEN** the merge-config test fails (the binding would otherwise be silently absent from operators' deploys)

### Requirement: Operator AI-usage attribution view

The Worker SHALL serve a per-activity **AI-usage attribution** view on the Usage page (`/admin/usage`), backed by `GET /admin/api/usage/ai`, reporting each activity's **call count**, **token counts**, and **estimated neurons** over a recent window of days, split by **trigger** (`cron` | `import` | `request`). The endpoint SHALL source the series from the **Analytics Engine SQL API** (`/accounts/<id>/analytics_engine/sql`, reusing `CF_ACCOUNT_ID` and the analytics token) via an outbound request that performs **no KV or D1 operation**. It SHALL be **aggregate-only and tenant-data-free** (per-activity/per-day aggregates, never per-tenant or per-call rows) and inherit the `/admin*` Cloudflare Access gate.

#### Scenario: Configured view reports per-activity attribution

- **WHEN** the operator opens the AI-usage panel with `CF_ACCOUNT_ID` and the analytics token configured
- **THEN** it shows each activity's recent-window calls, tokens, and estimated neurons, split by trigger, sourced from the AE SQL API, with no per-tenant data

#### Scenario: Serving the view performs no KV or D1 operation

- **WHEN** `GET /admin/api/usage/ai` handles a request
- **THEN** it reaches only the Analytics Engine SQL API (and the existing account-total source) and performs no KV or D1 operation

### Requirement: The view distinguishes steady churn from a draining backlog

The AI-usage view SHALL pair each cron activity's neuron series with the corresponding job's **backlog depth** — the pending/remaining counts already carried in the `job_runs` summaries — so the operator can distinguish a **bounded backlog draining** (backlog present and falling, e.g. a whole-corpus reclassify after a schema change) from **steady churn** (spend with little or no backlog). This SHALL reuse the existing health/run readers; it SHALL add no new per-tenant data.

#### Scenario: A draining backlog is distinguishable from steady churn

- **WHEN** a cron activity is spending neurons while its job reports a non-zero, falling backlog
- **THEN** the view surfaces the backlog alongside the spend, so the operator reads it as a draining backlog rather than an unexplained spike

### Requirement: AI-usage view degrades gracefully when unconfigured

The AI-usage view SHALL be **opt-in**, reusing the usage-observability config (`CF_ACCOUNT_ID` + the read-only analytics token). When either is unset, `GET /admin/api/usage/ai` SHALL report an explicit not-configured result **without making a request**, and the panel SHALL render an explicit "not available" state rather than an error. A SQL/transport failure SHALL surface as a structured `upstream_unavailable` error whose detail the panel renders (code + message), not a bare HTTP status — mirroring the Usage page's existing panels. The emission side SHALL degrade independently: an unbound `AI_AE` binding is a silent no-op and never blocks capture from being added later.

#### Scenario: Unconfigured analytics renders a not-available state

- **WHEN** the operator opens the AI-usage panel with the analytics token (or account id) unset
- **THEN** `GET /admin/api/usage/ai` reports a not-configured result and the panel renders an explicit "not available" state, making no request

#### Scenario: A query failure is a structured upstream error

- **WHEN** the AE SQL request fails or returns an error
- **THEN** `GET /admin/api/usage/ai` responds with an `upstream_unavailable` error carrying the upstream detail, and the panel renders the code and message rather than a bare HTTP status
