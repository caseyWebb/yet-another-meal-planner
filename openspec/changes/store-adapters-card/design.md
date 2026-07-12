## Context

The member app currently reads `preferences.stores` and Kroger refresh-token presence from `GET /api/profile`. The Profile page renders a flat preferred-store/ZIP block, while the Grocery page independently decides whether to show its Kroger button from `stores.primary` plus `profile.kroger.linked`. Store identity already lives in the shared D1 `stores` registry, Kroger Locations is available through the public client-credentials integration, and satellite cart-fill is selected today by `stores.primary=<slug>` plus `stores.fulfillment="satellite"`. There is no member-safe per-store satellite session-freshness observation yet; that additive wire field belongs to `member-satellites-tab`.

This change crosses Worker operations, an external Kroger read, member APIs, two app pages, offline policy, and persona/docs. It must preserve the repository's rules: member routes call named throw-free operations rather than D1 directly, secrets never enter app payloads, profile preferences remain a class (a) `If-Match` document, and externally effectful mutations never enter the offline replay queue.

## Goals / Non-Goals

**Goals:**

- Define one deterministic projection that contains both adapter-card data and grocery-launcher entries.
- Give members an exact Kroger location picker, connect/reconnect, and immediate local disconnect.
- Present truthful Satellite, Offline, and Instacart states without inventing data or parallel entities.
- Resolve preferred-store invalidation and all read/write/offline classifications before implementation.
- Leave stable seams for the later Instacart and satellite-freshness changes to extend additively.

**Non-Goals:**

- Instacart OAuth, retailer discovery, cart handoff, or launcher execution; its required feasibility spike and `instacart-adapter` change own these.
- Satellite member administration, session-freshness ingestion, helper URL/token storage, or cart-fill invocation; `member-satellites-tab` owns the freshness wire and administration.
- Aisle-map editing, offline-store creation/editing, and the store-walk implementation; `offline-stores-and-store-walk` owns those surfaces and shared shop-commit behavior.
- Persisting a launcher choice or per-trip override. This change projects standing configuration; a later launcher interaction may hold a one-trip choice in client state without rewriting preferences.
- A new adapter table or D1 migration.

## Decisions

### 1. One shared operation returns card data and launcher data

Add a workerd-pure wire module (for example `src/store-adapter-shapes.ts`) and a named `loadStoreAdapterProjection(env, tenant)` operation (for example `src/store-adapters.ts`). `GET /api/profile/store-adapters` calls that operation; neither Profile nor Grocery derives entries from raw preferences.

The projection is versioned by its discriminants rather than a numeric protocol version:

```ts
type StoreAdapterProjection = {
  adapters: {
    kroger: {
      kind: "kroger";
      linked: boolean;
      preferred: { location_id: string; name: string; address: string; zip: string } | null;
    };
    instacart: { kind: "instacart"; state: "coming_soon" };
    satellites: {
      kind: "satellites";
      state: "freshness_unavailable";
      stores: Array<{ slug: string; name: string; session_fresh: null }>;
    };
    offline: {
      kind: "offline";
      stores: Array<{ slug: string; name: string; label?: string; address?: string; selected: boolean }>;
    };
  };
  launcher: Array<{
    id: string;
    adapter: "kroger" | "satellite" | "offline";
    mode: "online_order" | "satellite_cart_fill" | "store_walk";
    store: { slug: string; name: string } | null;
    enabled: boolean;
    disabled_reason: "connect_kroger" | "choose_kroger_store" | "satellite_freshness_unavailable" | null;
  }>;
};
```

The exact exported TypeScript names may follow local idiom, but these data guarantees are fixed. Ordering is deterministic: Kroger first when configured, then satellite entries by display name/slug, then the selected Offline walk entry; Instacart produces no launcher entry while `coming_soon`. The generic manual-shop action is a grocery-list action, not an adapter, and is therefore outside this projection.

The operation reads `readPreferences`, Kroger refresh-token presence, and `listStoreRows` through existing data layers. It does not call Kroger, inspect secrets beyond token presence, or touch `env.DB` directly. This keeps every render bounded and deterministic.

Alternative considered: return raw profile/store/satellite records and let each page derive UI. Rejected because it recreates the drift this change exists to remove. Alternative considered: a new adapters table. Rejected because D6 defines Offline as the existing store registry and current standing selection is already represented by preferences.

### 2. Standing configuration stays in `preferences.stores`, with exact Kroger identity added compatibly

Keep the deployed `stores` JSON column. A selected Kroger result is stored atomically under the existing class (a) preferences patch as:

```json
{
  "stores": {
    "primary": "kroger",
    "fulfillment": null,
    "location_zip": "76104",
    "preferred_location": "01400943",
    "preferred_location_name": "Kroger Marketplace",
    "preferred_location_address": "123 Main St, Fort Worth, TX 76104"
  }
}
```

`preferred_location` remains a string and becomes the exact provider `locationId`, which the shipped Kroger resolver already accepts without another Locations call. The additive display fields let the card render name/address without an external request. Existing label/ZIP preferences remain readable: the projection shows the existing string as the name with a missing address, and the next explicit picker selection converges it to the exact-id form. No bulk migration is needed.

The ZIP typed into the modal is search input only. `location_zip` changes only when a member selects a result, so closing a search or receiving zero results never invalidates the standing store. Selecting a result replaces all five Kroger location fields in one `If-Match` patch and clears a stale `fulfillment` marker. Selecting an Offline store writes its slug to `primary` and clears `fulfillment`; a future Satellite chooser may set the same slug plus `fulfillment="satellite"`.

If a selected shared Offline slug no longer exists, the projection preserves the stored preference but returns no enabled Offline launcher entry and the card marks the selection unavailable; it never silently chooses another store. Kroger disconnect preserves the preferred location so reconnect restores the standing choice.

Alternative considered: make `preferred_location` an object. Rejected because it would break every existing resolver/tool reader. Alternative considered: store chosen Kroger locations in the shared Offline registry. Rejected because selecting an online provider location must not create an unrelated shared-corpus write.

### 3. Kroger APIs are bounded, session-scoped, and normalized

Retain `GET /api/profile/kroger-login-url` as the canonical login/reconnect endpoint. Add:

- `GET /api/profile/kroger-locations?zip=NNNNN` — validates a five-digit US ZIP, requests at most 10 nearby Kroger locations through a new public-client `locationsNearZip` method, preserves the provider's nearest-first result order, and returns only normalized `{location_id,name,address,zip}` data. It never uses the member OAuth token and never writes preferences. Upstream failures use the existing structured `upstream_unavailable` mapping.
- `DELETE /api/profile/kroger-connection` — deletes `kroger:refresh:<tenant>` and evicts the tenant's isolate-held user access token/refresh-in-flight slot before returning `{linked:false}`. It is idempotent at the server but remains online-only because it changes credential state and must not replay later.

The modal searches on explicit submit (and supports Enter), not on each keystroke, avoiding accidental external request fan-out. Results are capped at 10 and displayed in the nearest-first order returned by Kroger; no fake mileage is calculated because the current client has no ZIP centroid. A zero-result response is `{locations:[]}`, while validation and upstream failures remain distinct structured errors.

Alternative considered: debounce live search. Rejected because submit is predictable, accessible, and cheaper while still meeting multi-location ZIP selection. Alternative considered: derive distance locally. Rejected because no authoritative ZIP-coordinate source exists in the Worker; provider ordering is honest while invented miles are not.

### 4. Satellite state degrades closed until D22 freshness lands

The only satellite store configuration currently visible to a tenant is the standing preference (`primary=<slug>, fulfillment="satellite"`). The projection may resolve that slug to shared store identity but MUST return `session_fresh:null`, adapter state `freshness_unavailable`, and a disabled launcher reason `satellite_freshness_unavailable`. It does not infer freshness from Worker liveness, sale scans, order-list history, or ingest-key use: none is the per-store browser-session observation D22 requires.

The Profile summary says status will become available after the Satellite reports it and links to the Satellites tab/authoring guide. The launcher says to re-open from the Satellites surface after status is available; it does not use the more specific "Re-run login" state until the boolean exists. The later change replaces `null` additively with a boolean and derives enabled/re-run-login states from that same field without changing consumers.

Alternative considered: treat a recent satellite push as session-fresh. Rejected because node liveness and a retailer login session are different facts. Alternative considered: omit Satellite entirely. Rejected because the card must honestly represent configured adapters and establish the future projection seam.

### 5. Offline and Instacart are deliberately shallow in this slice

Offline is D6's presentation of the existing shared `stores` registry. The tab lists grocery-domain store identities, identifies the standing selection, and offers a standing-store selection through the existing conditional preferences patch. It does not create a second store entity, expose shared-corpus mutation routes, calculate map state, or implement the aisle editor; the sibling offline-walk change owns add/edit/map behavior and can enrich the same projection later.

Instacart is always a visible `coming_soon` tab with explanatory copy and no connect control, retailer data, endpoint, or launcher entry. This prevents the painted-door mock from becoming a false integration before D7's required spike.

### 6. Preferred changes invalidate derived presentation, never list membership

After a successful location or primary-store patch, the app invalidates `['store-adapters']` and the store-dependent enriched to-buy/placement query, while leaving stored grocery rows and the store-agnostic to-buy set intact. If Order Review is open, it closes and discards its preview/dispositions; the next open starts a new preview and resolves products/prices for the new exact location. No already-sent cart or in-flight row is rewritten.

Disconnect invalidates the adapter projection and closes an open Order Review. Grocery rows remain unchanged. Connect completion is observed on focus/refetch of the projection/profile; no cross-window credential message is trusted.

Alternative considered: re-resolve price/placement immediately on every preference edit. Rejected for prices because order preview is the freshness boundary and eager catalog calls would be wasteful; placement is a read projection and should refresh immediately.

### 7. Offline/write classification follows D15 explicitly

- `GET /api/profile/store-adapters`: online read, not added to the persisted query allowlist because it contains connection state; offline UI renders a disabled state/hint, never stale credential truth.
- `GET /api/profile/kroger-locations`: online-only external read, never persisted or replayed.
- `GET /api/profile/kroger-login-url`: online-only nonce/consent-link mint, never persisted or replayed.
- `DELETE /api/profile/kroger-connection`: online-only credential mutation, direct call outside the mutation cache even though deletion is server-idempotent.
- Preferred Kroger/Offline selection: class (a) preferences merge patch under `If-Match`; disabled offline and never queued.
- Adapter tab selection, modal input, and an uncommitted per-trip choice: pure client-local view state.
- Instacart placeholder and Satellite degraded summary: reads only; no mutation exists.

No class (b) write is introduced, so `member-app-offline` needs no delta in this change. The implementation still adds negative tests proving these operations cannot enter the persisted mutation registry.

### 8. Documentation, persona, and UI verification ship with the behavior

Update `docs/ARCHITECTURE.md` with the shared projection and adapter model; update `docs/SCHEMAS.md` with the additive `preferences.stores` display fields and projection wire contract; update `docs/TOOLS.md` only if D6's "offline adapter" store-tool copy has not landed from the serial sibling. Update `AGENT_INSTRUCTIONS.md` Band-3 shopping language: ready-to-eat is always offered rather than auto-added, receive/placed choreography uses the shared operations, and generic stores are called Offline stores. Run `aubr build:plugin --check`.

Extend the app page object and Playwright specs before marking the UI complete. The suite seeds preferences/shared stores and intercepts only the external Kroger-location endpoint with typed fixtures; projection, selection, disconnect, tab states, degraded Satellite state, and shared Profile/Grocery launcher output otherwise exercise the local Worker. Capture per-area screenshots under the existing app visual-review convention. No production-only fake is added.

## Risks / Trade-offs

- **[Legacy preferred-location strings lack exact display metadata]** → Preserve and show them tolerantly; converge only on explicit selection, avoiding a surprise migration or external read during projection.
- **[Disconnect cannot revoke an already-issued token at Kroger]** → Delete the only durable refresh token and evict the Worker's cached access token immediately; document that upstream account revocation remains Kroger-owned.
- **[Provider order may not expose numeric distance]** → Preserve Kroger's nearby-result ordering and omit invented mileage; pin request/result normalization in tests.
- **[Band-3 sibling order changes launcher affordances]** → Keep the projection mode-based and data-only; the grocery UI binds the modes already implemented on the branch and renders an honest disabled reason for an unavailable sibling surface.
- **[Satellite summary is temporarily less capable than the mock]** → Degrade closed with `session_fresh:null`; D22 explicitly prefers unknown over conflating liveness with login state.
- **[Shared store registry can contain non-grocery domains]** → Project only `domain === "grocery"` into Offline; preserve other domains for their existing tools/admin surfaces.

## Migration Plan

1. Land pure shapes/operation and tests while the existing pages continue using raw profile data.
2. Add the three session-gated reads/mutations under `/api/profile/*`, preserving the existing login-URL route and `/api*` Worker-first prefix.
3. Add projection/query hooks and switch Profile, then Grocery, to the same response; retain tolerant rendering for old preferences.
4. Update docs/persona, regenerate/check the plugin, and run Worker/type/app/Playwright verification.
5. Deploy additively. Rollback is code-only: the JSON preference fields are additive and harmless to the prior reader; disconnect has no rollback other than reconnecting, which is the intended user action.

## Open Questions

None. Instacart feasibility, Offline aisle editing, and the Satellite freshness wire are explicitly owned by their named later changes rather than deferred implementation decisions in this one.
