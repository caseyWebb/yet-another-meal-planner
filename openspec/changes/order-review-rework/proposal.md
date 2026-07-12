## Why

The current order dialog can preview Kroger picks, but it flattens the shipped brand-tier model, offers no deterministic unavailable-item recovery or catalog search, and reports a coarse commit result that cannot keep a member or agent honestly synchronized. Band 3 needs one revalidating, dual-host review surface that stages decisions safely and teaches only from what the member actually sends.

## What Changes

- Replace the matcher's interim flat brand projection with native `{ tiers, any_brand }` semantics: cheapest acceptable within the first available tier, tier fall-through, then cheapest acceptable only when `any_brand` permits it; otherwise return a decision checkpoint.
- Add a versioned, stateless order-review preview contract with a fingerprint. Skips, quantity changes, candidate choices, broader/manual picks, and impulse lines remain local staged input; every re-preview and the final send recomputes against current list/store/price/availability state and reports divergence.
- Add deterministic unavailable-line recovery: a bounded canonical-id ancestor/base/search-term broadening ladder with explicit divergence notes, plus member-entered free-text Kroger catalog search with fulfillment/modality labels. Neither search path teaches until its selected SKU is included in a successful send.
- Add narrow save-preferred-brand write-back. Saving a chosen brand joins the existing family tier 1 (or creates `[[brand]]`) and sets `any_brand:false`, preserving every other family and lower tier; it is the only persistent pre-send review action.
- Extend `place_order` preview/send and the member API with app-callable review reads, broader/manual search, brand save, impulse-line staging, and final send. A successful send returns one honest structured result naming cart status, send id/snapshot totals and savings, learned SKU mappings, saved brands, and left-off lines independently.
- Extend D16 through the existing shared order commit operation: review-added bare extras snapshot as `impulse`; only carted lines advance and teach, preview/search never writes, and a failed/partial cart operation never claims learning or persistence it did not achieve.
- Add one plumbing-agnostic `@yamp/ui` Order Review component/controller that extends the grocery snapshot/controller seams and is mounted by thin member and MCP adapters. Add `display_order_review` / `ui://order/review`, D19 boot re-preview, D18 full-context updates for every staged or persistent interaction, and one completion message only after final send.
- Replace the mock's post-send **Back to review** with **Back to grocery**. A reopened review is always a fresh preview of the now-current to-buy set, so a sent order cannot be accidentally double-added from retained client state.
- Update the tool, schema, architecture, persona, contract, migration, shared-component, member-app, Worker, and MCP widget tests in lockstep.

## Capabilities

### New Capabilities

- `order-review-widget`: The shared Order Review component/controller, versioned preview and model-context contracts, member/MCP host adapters, `display_order_review` / `ui://order/review`, D18 staged-state mirroring, D19 boot re-preview, and safe degradation.

### Modified Capabilities

- `ingredient-matching`: Consume brand tiers natively and expose deterministic same-identity and broader-search candidate metadata without teaching during reads.
- `order-placement`: Accept fingerprinted staged review input, revalidate every final pick, commit impulse lines through the shared send operation, and return an exact per-step result with no post-send replay state.
- `member-app-grocery`: Replace the current order dialog with the shared review controller, decision/recovery/search flows, cleared-cart gate, savings presentation, and honest confirmation screen.
- `grocery-list-widget`: Extend the ratified grocery snapshot/controller seams with an order-review launcher, shared host adapter conventions, and fresh return-to-grocery behavior.
- `spend-telemetry`: Define review-added impulse provenance and ensure send-record totals/savings are the single persisted source rendered after send.

## Impact

- **Contracts/data:** add `OrderReviewData`, staged-input/fingerprint, search result, model-context, and send-result contracts in `@yamp/contract`; add only the send/cache metadata needed to report exact learning and snapshot results, preserving immutable send lines.
- **Worker/API/MCP:** refactor matcher brand input; add shared preview, broader/manual catalog reads, narrow brand-save, and send operations; extend `POST /api/grocery/order`; register app-callable bridge tools and `display_order_review`; serve one self-contained MCP App resource with no new Worker HTTP route.
- **UI/build:** add the shared controller/component in `packages/ui`, a member adapter around the grocery page modal, and an MCP adapter/bundle in `packages/widgets`, building on the grocery-first Band 3 foundation rather than forking it.
- **Docs/persona/tests:** update `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, `AGENT_INSTRUCTIONS.md` and authored order/grocery guidance; cover matching, revalidation, persistence boundaries, D16 snapshots, API/tool parity, shared UI, member Playwright, MCP bridge, version gates, and self-contained widget output.
