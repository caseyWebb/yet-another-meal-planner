## Why

Store configuration and grocery fulfillment are currently split between a flat profile preference, Kroger-only UI logic, and agent-side store/satellite capabilities. Members need one truthful adapter model that drives both Preferences and the grocery launcher before the rest of Band 3 adds more fulfillment paths.

## What Changes

- Add one household-scoped store-adapter projection, assembled by a shared Worker operation and served to the member app, as the sole source for the Preferences Store card and grocery launcher entries.
- Replace the flat Store block with Kroger, Instacart, Satellites, and Offline tabs: Kroger supports connection state and exact preferred-location selection; Satellites is a secret-free read-only summary; Offline presents the existing shared store registry; Instacart is an explicitly unavailable placeholder pending its required spike and separate change.
- Add a bounded multi-location Kroger ZIP search endpoint and a Kroger disconnect endpoint alongside the existing session-bound login-URL endpoint. Selecting a location remains an `If-Match` preferences write; connect/disconnect and external search are online-only.
- Make the grocery launcher project the same adapter entries and availability reasons, including a deterministic disabled Satellite state until the later satellite freshness observation ships. It never guesses session freshness or exposes a helper URL/token.
- Define preferred-store change invalidation: list membership remains store-agnostic, store-dependent placement is refetched immediately, an open preview is discarded, and price/product resolution happens from fresh context on the next preview.
- Update current-state architecture/API documentation, agent shopping language, and the member-app Playwright harness in lockstep.

## Capabilities

### New Capabilities

- `store-adapter-projection`: Defines the shared adapter/launcher projection, its Kroger search and connection endpoints, degraded Satellite contract, Offline registry presentation, and mutation/offline classifications.

### Modified Capabilities

- `member-app-core`: Replaces the Preferences Store block with the adapter-tabbed card backed by the shared projection.
- `member-app-grocery`: Replaces the Kroger-only order affordance with a launcher whose entries and disabled reasons come exclusively from the shared adapter projection.

## Impact

- Worker: new shared store-adapter operation and wire shapes; session-gated profile/store endpoints; Kroger Locations API normalization; refresh-token deletion; shared store and store-note reads through existing data layers.
- Member app: profile Store card, Kroger ZIP modal, adapter query/data types, grocery launcher, query invalidation, online-only hints, styles, and generated typed route client.
- Contracts/docs: `openspec/specs/member-app-core`, `openspec/specs/member-app-grocery`, `docs/TOOLS.md` store-tool copy if not already landed, `docs/SCHEMAS.md` preferences store fields/wire projection, `docs/ARCHITECTURE.md` adapter model, and `AGENT_INSTRUCTIONS.md` Band-3 shopping language.
- Verification: Worker operation/endpoint tests, app unit/type checks, member Playwright coverage and screenshots, plugin build check, and OpenSpec validation. No D1 migration or new Worker-owned route prefix is required; all endpoints remain under the existing `/api*` Worker-first entry.
