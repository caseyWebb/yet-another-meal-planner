## Context

The Kroger Products API returns `items[].aisleLocation` and `items[].fulfillment.inStore` alongside the fields `normalizeProduct` already reads. Three shopping skills (`place-grocery-order`, `shopping-list`, `map-grocery-store`) cover what is logically one task — flushing the list — and the split prevents progressive disclosure: every branch body is always in context. The `in-store-fulfillment` spec (canonical) defines the store registry, notes model, and walk behavior this change builds on.

## Goals / Non-Goals

**Goals:**
- Unified `shop-groceries` skill with lean SKILL.md body and `references/` branch files loaded on demand.
- Kroger in-store branch: `kroger_prices` → `aisleLocation` → aisle-ordered voice walk → silent note seeding.
- `location_id` field on `Store` for resolved Kroger locationIds; `resolveLocationId` bypass.
- Human-friendly Kroger store slug registration (one-time, label-driven).
- Silent, idempotent `location` note seeding in both Kroger in-store and `map-grocery-store` branches.
- Build system `<!-- resource -->` extraction: AGENT_INSTRUCTIONS.md stays the single source of truth.

**Non-Goals:**
- Changing the Kroger online (curbside/delivery) flow — it is unchanged, just moved to a reference file.
- Cross-tenant layout sharing from API data (notes remain attributed, per existing spec).
- Surfacing `aisleLocation` in the `matching.ts` resolver or `place_order` cart path — those flows are online-only and don't care about aisle location.
- Changing `isFulfillable` in `matching.ts` — `inStore` does not enter the online resolver's filter; it's used only in the Kroger in-store branch to surface items available in-store vs. online-only.
- Pagination or batching strategy for `kroger_prices` — the existing per-item call behavior is reused.

## Decisions

### D1 — `<!-- resource: references/<file>.md -->` extraction in the build

The build system currently writes one `SKILL.md` per flow, containing the full body. To realize progressive disclosure, the SKILL.md body should be lean (the router) and the branch detail should land in `references/` files loaded on demand.

Keeping AGENT_INSTRUCTIONS.md as the single source of truth means the reference content must live *in* that file — not in separate source files the build copies. A fenced directive achieves this:

```
<!-- resource: references/kroger-instore.md -->
[full branch content]
<!-- /resource -->
```

The build extracts each block into `skills/<name>/references/<file>.md`, and in the emitted SKILL.md replaces the block with a single pointer line: `> For the Kroger in-store flow, read \`references/kroger-instore.md\`.` AGENT_INSTRUCTIONS.md reads naturally end-to-end; the build realizes the two-level structure.

*Alternative considered:* separate source files (`skill-src/<name>/references/`) that the build copies. Rejected: splits authorship across files, losing the "one file" property that makes AGENT_INSTRUCTIONS.md easy to audit and diff.

### D2 — Thread `aisleLocation` + `inStore` through `KrogerCandidate`

`normalizeProduct` already reads `items[0]` for price and fulfillment. Adding `aisleLocation` and `inStore` there costs nothing — the data is already in the API response. The alternative (a separate `locateItems` API call) would add round-trips for data we already have.

`KrogerCandidate` grows:
```ts
aisleLocation: { number: string; description: string; side?: string } | null;
fulfillment: { curbside: boolean; delivery: boolean; inStore: boolean };
```

`kroger_prices` returns this naturally. The matching/order pipeline ignores `aisleLocation` (it only uses `fulfillment.curbside | delivery` for `isFulfillable`); `inStore` is surfaced only in the Kroger in-store branch.

### D3 — `location_id?: string` on `Store`, `resolveLocationId` bypass

The Kroger Locations API resolves a ZIP to a `locationId`. Once resolved, re-resolving on every walk is wasteful. Storing the `locationId` in `stores/<slug>.toml` as `location_id` lets the Kroger in-store branch call `resolveLocationId` with a pre-known id — which the client caches anyway, but the store record makes it durable across isolate restarts.

`resolveLocationId(label)` already parses a ZIP from a `preferred_location` string. The bypass: if the store TOML carries `location_id`, pass it directly instead of constructing a label. The existing `preferred_location`-based resolution is unchanged for the online path.

`location_id` is a generic identity field (not `kroger_location_id`) — future API-backed chains could use it too.

### D4 — Human-friendly Kroger slug registration (one-time)

Kroger is currently `primary: "kroger"` (online-only). In-store Kroger trips need a store slug to anchor notes. Rather than deriving a slug from the locationId or ZIP (opaque to the user), the agent asks once: "What would you call this Kroger?" → user says "Forest Hills" or "the one on Main" → agent registers `kroger-forest-hills` (or similar kebab slug) with `chain: "kroger"`, `location_id`, and the user's label. This happens on the user's first in-store Kroger trip and is never repeated.

If the user has multiple Kroger stores, each gets its own slug. The agent recognizes a "Kroger in-store" signal (`"I'm at Kroger"`, `"shopping Kroger in person"`) and resolves the right slug by matching the label or asking if ambiguous.

### D5 — Silent, idempotent location note seeding

Both the Kroger in-store branch and `map-grocery-store` write `location`-tagged notes without per-note confirmation. The notes are the author's own subtree (self-scoped) and are correctable via `update_store_note`. Asking confirmation for every note added friction without protection.

**Idempotency:** before seeding a note for an item, check the notes already loaded by `read_store_notes` for the walk. If a `location`-tagged note already mentions the item name (case-insensitive substring), skip it. This is a client-side filter over already-fetched data — no extra round-trip.

**For `map-grocery-store`:** `layout` notes (per-aisle, triggered by the end-cap sign) continue to be written on user confirmation (the user is actively providing the aisle name — the confirmation IS the input). `location` notes for list items encountered in an aisle are written silently, same as the Kroger in-store branch.

### D6 — Unified `shop-groceries` skill: detection body

The SKILL.md body contains only:
1. The shared preamble (`read_grocery_list` + `read_preferences` in parallel)
2. A branching table keyed on signals from `preferences.primary`, the message, and any named store
3. One pointer per branch to the appropriate reference file

Branches:
| Signal | Reference |
|--------|-----------|
| `"place the order"` / `"send to cart"` / `primary == "kroger"` with no in-store signal | `references/kroger-online.md` |
| `"I'm at Kroger"` / named Kroger store slug / `primary` is a Kroger slug | `references/kroger-instore.md` |
| `primary` is a non-Kroger store slug, or user names a non-Kroger store | `references/instore-walk.md` |
| User is at an unmapped store and wants to map it | `references/map-store.md` |

Ambiguous (e.g. `primary == "kroger"` but user says "I'm heading to the store") → ask once: "Pickup/delivery, or shopping in person?"

The three retired skills (`place-grocery-order`, `shopping-list`, `map-grocery-store`) are removed. Their bodies become the four reference files, updated where needed (Kroger in-store is new; map-store drops per-note confirmation for location notes).

## Risks / Trade-offs

- **`aisleLocation` may be null for some items** (not all Kroger products have a known location in every store). The Kroger in-store branch degrades gracefully: items without a location are grouped at the end as "location unknown — check the store map."
- **`inStore` = false for some products** (online-only SKUs like alcohol in some states). These are surfaced during the walk as "this item is only available for pickup/delivery — want to remove it from the in-store list?" — never silently dropped.
- **Silent note seeding writes to the repo on every walk.** The idempotency check (skip items with an existing location note) bounds the write volume to genuinely new items. The first walk for a store may write many notes; subsequent walks write zero or a handful.
- **One-time Kroger slug registration is a new moment of friction.** Mitigated by it being truly one-time and the agent handling the slug generation automatically from the user's label. If the user declines to name the store, the agent can fall back to `kroger-<zip>` as a default.
- **`<!-- resource -->` extraction changes the build contract.** Existing skills with no resource blocks are unaffected (the extraction pass is a no-op for them). New skills opt in by using the markers. The `--check` validation should verify that resource pointers in SKILL.md point to files that exist in the bundle.

## Migration Plan

1. **Backend first (Worker + types):** `kroger.ts` → `stores.ts` → `stores-tools.ts` in one pass, with `docs/TOOLS.md` + `docs/SCHEMAS.md` updated together.
2. **Build system:** add the `<!-- resource -->` extraction to `build-plugin.mjs` and its tests. Validate that existing skills produce byte-identical output (no resource blocks → no change to their SKILL.md).
3. **Persona recut:** replace the three flows with `shop-groceries` + four resource blocks in `AGENT_INSTRUCTIONS.md`; rebuild. The three old skill names disappear from the bundle; `shop-groceries` is the new single entry point.
4. **No data migration needed.** `location_id` is optional in the store schema; existing store TOMLs without it continue to work. The Kroger online path is unchanged.
5. **Rollback:** Worker revert restores prior behavior; any location notes written by the new path remain valid store notes and do not need cleanup.

## Open Questions

- None blocking.
