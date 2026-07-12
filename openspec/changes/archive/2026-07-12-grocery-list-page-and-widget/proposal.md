## Why

The grocery page still conflates a shopping check-off with the online-cart lifecycle, omits virtual plan needs from durable check state, and exposes a monolithic member-only implementation whose in-cart actions lose send provenance. Band 3 needs one truthful grocery state model and one shared interactive surface before the adjacent order-review and store-walk changes extend the same contracts.

## What Changes

- Add nullable per-row `checked_at` with a class-(b), offline-queued boolean write. Checking a virtual plan need first materializes its canonical row; the derived set becomes `(active list UNION plan needs) MINUS pantry MINUS checked`, while checked rows remain visible in the list until explicitly unchecked or swept by a later manual-shop/walk completion.
- Replace Category/Aisle list grouping with deterministic **Department | Recipe** modes. Department is the presentation placement section ordered by minimum numeric aisle, with Household and Not mapped fallbacks; Recipe assigns each line to its first stable recipe attribution, then No recipe, without duplicating multi-recipe lines.
- Re-home online `in_cart` rows between the active list and pantry coverage, grouped by send record with store/date/age, persisted quote totals and flyer savings, a send-wide idempotent **Mark order placed** purchase assertion, and per-line **Back to list**. Checked and `in_cart` remain orthogonal.
- Make list/header counts, attribution, pantry verification/Buy anyway, substitution decisions, household lines, add/remove, check progress, underived warnings, and send stats read from one versioned grocery snapshot. Pre-send estimates remain explicitly live quotes; only actual persisted send records render sent-estimate totals and savings.
- Introduce one plumbing-agnostic shared Grocery component/controller used by the member route and `ui://grocery/list`. Member mutations bind the normal `/api` adapters and offline registry; MCP mutations bind bridge tools, re-hydrate before writes, immediately mirror the full authoritative snapshot to model context, and reserve `ui/message` for completion boundaries.
- Add `display_grocery_list`, widget payload contract/version gate, app-callable reads/writes, aggregate snapshot revision plus per-row merge/version guards, and data-only/text fallbacks. Update tool/schema/architecture/persona contracts and the member/MCP/component/database test suites in lockstep.
- Preserve the D16 boundary: list-page mark-placed materializes persisted send quotes and never re-prices; per-line relist writes no spend and drops/voids only that line's send participation. Manual-shop/walk completion and order-review refinements remain follow-on Band 3 changes.

## Capabilities

### New Capabilities

- `grocery-list-widget`: The shared Grocery component/controller, member and MCP host adapters, `display_grocery_list` / `ui://grocery/list`, D18 full-context protocol, D19 boot re-hydration and contract-version degradation, and truthful grocery snapshot presentation.

### Modified Capabilities

- `grocery-list`: Add `checked_at`, virtual-line materialization on check, checked-aware set algebra, row/aggregate concurrency metadata, send-group reads, and exact batch/per-line online-cart lifecycle operations.
- `member-app-grocery`: Replace the route's monolithic Category/Aisle presentation with the shared Department/Recipe list, header/pantry/substitution/household behavior, and grouped in-cart layout from the approved local brief.
- `member-app-offline`: Register check/uncheck as a canonical-row class-(b) mutation, including atomic materialize-and-check for virtual plan lines; keep effectful purchase assertions and MCP-host writes online-only.
- `order-placement`: Define the list-page batch mark-placed assertion over exactly one send and the per-line back-to-list behavior against persisted send snapshots.

## Impact

- **Data/contract:** a D1 migration for `grocery_list.checked_at` and row revision metadata, an aggregate grocery revision, send-group query support, versioned `GroceryListData` in `@yamp/contract`, and additive endpoint/tool returns.
- **Worker/API/MCP:** shared grocery snapshot/read and mutation operations, `/api/grocery` adapters, `update_grocery_list` and `read_to_buy` contract changes, new batch mark-placed/relist operations, `display_grocery_list`, MCP resource serving, and app-callable bridge registration.
- **UI/build:** the grocery controller/component moves to `packages/ui`; the member page becomes a host shell; `packages/widgets` gains a self-contained grocery entry/resource and host adapter. No new Worker-owned HTTP route is needed for the `ui://` resource.
- **Docs/persona/tests:** `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, `AGENT_INSTRUCTIONS.md`, generated plugin inputs, migrations, Worker/API contract tests, shared component/controller tests, member Playwright coverage, and MCP widget harness/self-contained-bundle tests.
