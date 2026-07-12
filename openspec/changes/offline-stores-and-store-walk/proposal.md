## Why

The existing agent-only store walk has no member completion path, and its ad hoc remove/restock choreography cannot safely survive offline replay or emit the D16 spend truth. Band 3 needs one exact shop-commit boundary plus a member walk and Offline-store map surface that reuse the shared grocery, store-note, and adapter contracts rather than inventing sessions or stores.

## What Changes

- Add one receipt-backed, idempotent shop-commit operation shared by the member `/api` surface and the agent voice walk. It consumes exactly the eligible checked rows, restocks grocery-kind pantry rows as verified, materializes best-effort estimated spend, and returns the same immutable receipt after a lost response or replay.
- Make walk navigation pure client state: a client-minted session id and store/mode live in URL/local state, while the grocery rows' `checked_at` values remain the durable cross-device truth. Starting and checking require no round trip; check-offs and completion queue and replay offline.
- Add the approved active-walk states to the member Grocery page: store/progress header, active aisle progression, collapsed completed aisles, cold-last and trailing Not mapped groups, quiet offline state, Pause, and an exact Finish confirmation/pending/result flow. Pantry coverage and substitution panels are hidden during a walk.
- Present Offline stores from the existing shared registry, enrich the common adapter projection with household display name and honest aisle-map `unknown | stale | mapped` state, and project the selected store/map context into the persisted Grocery snapshot for an offline start.
- Add a conditional whole-document aisle-map editor over attributed `store_notes`. It edits only the caller's layout contribution under `If-Match`, preserves every other author's notes, and derives the effective community map by per-aisle recency; household nicknames remain private preference data and never mutate shared store identity.
- Update the in-store agent choreography, store-tool wording, API/schema/architecture/persona documentation, migrations, and Worker/member/offline/Playwright tests in lockstep.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `in-store-fulfillment`: Converge member/manual and agent voice completion on one exact shop commit, add the attributed aisle-map document projection/editor, and present generic stores as Offline adapters.
- `grocery-list`: Define the checked-row eligibility, exact destructive sweep, immutable receipt, verified pantry restock, and post-commit grocery snapshot behavior.
- `spend-telemetry`: Materialize walk/manual-shop spend from the shop-commit price ladder through the one shared writer, with explicit estimated/unpriced provenance.
- `member-app-grocery`: Add the local active-walk, pause, finish, queued-completion, conflict, and receipt states and consume Offline-store placement/map truth.
- `member-app-offline`: Register shop completion as a session-id-keyed class-(b) queued write and persist the secret-free Offline walk context needed to start without connectivity.
- `store-adapter-projection`: Enrich existing Offline rows/launcher entries with household nickname display and deterministic aisle-map summary without creating another store entity.
- `member-app-core`: Add household-private Offline nicknames and the member aisle-map editor to the existing Store card.

## Impact

- **Data/contracts:** D1 migrations for durable shop receipts/receipt lines and additive store-note recency metadata; additive preferences nickname and adapter/Grocery snapshot fields; no walk-session or duplicate store table.
- **Worker/API/MCP:** shared shop-commit, aisle-map projection/reconcile, placement, and estimate operations through `src/db.ts`; session-gated shop-commit and aisle-map endpoints; a shop-completion MCP tool binding the same operation.
- **Member app:** Grocery walk route/local state, offline mutation registration and reconciliation, Store-card map/nickname controls, adapter projection enrichment, and persisted secret-free walk context.
- **Docs/persona/tests:** `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`, `AGENT_INSTRUCTIONS.md`, plugin check, Worker/API concurrency and pricing tests, offline replay tests, and app Playwright visual coverage.
