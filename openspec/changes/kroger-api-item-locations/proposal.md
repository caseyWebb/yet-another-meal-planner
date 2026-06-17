## Why

The Kroger Products API already returns per-item aisle location data (`items[].aisleLocation: { number, description, side }`) and an `inStore` fulfillment flag alongside the `curbside`/`delivery` flags we already capture. `normalizeProduct` silently discards all of it. This means Kroger shoppers who visit a store in person get the degraded department-grouped list with no aisle ordering — even though the API knows exactly where every item is in their store.

At the same time, the `shopping-list`, `place-grocery-order`, and `map-grocery-store` skills are three separate front doors for what is conceptually one task: flushing the grocery list. The split forces the routing logic into each skill's description and makes progressive disclosure impossible — the full flow body of every branch is always in context, even when only one branch will be taken. Adding a fourth branch (Kroger in-store) into this arrangement would make it worse.

Finally, the `map-grocery-store` flow asks the user to confirm before saving each location note. Given the notes system is already attributed, append-only, and self-correctable, that confirmation adds friction without value — the notes are always the author's own, and a wrong note is easily corrected.

## What Changes

- **Unify `place-grocery-order`, `shopping-list`, and `map-grocery-store` into a single `shop-groceries` skill** with a lean detection body and four `<!-- resource -->` blocks extracted by the build system into `references/` files. The skill reads fulfillment context, branches once, and loads only the branch reference needed — matching the progressive-disclosure pattern.
- **Add Kroger in-store as a new fulfillment branch.** When the user is shopping a Kroger store in person, the skill calls `kroger_prices` for each list item to retrieve `aisleLocation` data, groups and orders the list by aisle number, and walks the user through it hands-free. No manual mapping required.
- **Auto-seed `location`-tagged store notes from API data (silent, idempotent).** During a Kroger in-store walk, aisle locations learned from the API are written as `location`-tagged store notes without prompting — the same class of data the `map-grocery-store` flow collected manually. Future walks can use the notes even offline. Duplicate entries are skipped by checking for an existing note with the same item name.
- **Silent auto-seeding in `map-grocery-store` too.** Remove the per-note confirmation for `location` notes during mapping (already the author's own subtree, already self-correctable). Layout notes continue as-is; location notes for list items found in an aisle are written immediately.
- **Add `location_id` to the Store identity model** so API-backed stores (Kroger) can be resolved directly without re-hitting the Locations API on every walk. The Kroger `locationId` is stored alongside name/chain/address.
- **Support multiple Kroger locations with human-friendly slugs.** On a user's first Kroger in-store trip, the agent registers the store with a user-supplied label (e.g. "Kroger on Forest Hills" → slug `kroger-forest-hills`, `location_id` resolved once and stored). One-time friction, never repeated.
- **Extend `build-plugin.mjs` to extract `<!-- resource: path -->` blocks** from `AGENT_INSTRUCTIONS.md` into `skills/<name>/references/<file>` in the plugin bundle, replacing each block with a pointer line in the emitted SKILL.md. The source doc remains the single source of truth and reads naturally; the build realizes the progressive-disclosure structure.

## Capabilities

### New Capabilities
<!-- none — Kroger in-store is a new branch within in-store-fulfillment, not a new capability -->

### Modified Capabilities
- `in-store-fulfillment`: gains a Kroger in-store branch with API-driven aisle ordering and silent note seeding; `map-grocery-store` auto-seeds location notes without per-note confirmation; the three shopping/order skills are unified under `shop-groceries`; store registry gains `location_id` for API-backed stores.
- `kroger-integration`: `KrogerCandidate` gains `aisleLocation` and `inStore`; `resolveLocationId` bypasses the Locations API when a `location_id` is already known.
- `agent-plugin-distribution`: `build-plugin.mjs` gains `<!-- resource -->` block extraction, emitting `references/` files alongside SKILL.md.

## Impact

- **Worker (`src/`):** `kroger.ts` (`normalizeProduct` captures `aisleLocation` + `inStore`; `KrogerCandidate` type grows them; `resolveLocationId` accepts a pre-resolved id); `stores.ts` (`Store` interface + `toStore` + `serializeStore` grow `location_id?: string`); `stores-tools.ts` (`add_store` + `update_store` accept `location_id`; description updated).
- **Build (`scripts/build-plugin.mjs`):** `<!-- resource: references/<file>.md -->...<content>...<!-- /resource -->` extraction pass; `buildPluginFiles` emits resource files; `renderWorkflowSkill` replaces resource blocks with pointer lines in SKILL.md.
- **Persona (`AGENT_INSTRUCTIONS.md`):** `place-grocery-order`, `shopping-list`, `map-grocery-store` flows replaced by unified `shop-groceries` flow with four `<!-- resource -->` subsections; cross-references updated; `npm run build:plugin` regenerates the bundle.
- **Docs:** `docs/TOOLS.md` (add `location_id` to `add_store`/`update_store`; note `aisleLocation` in tool context); `docs/SCHEMAS.md` (add `location_id` to store schema); `docs/ARCHITECTURE.md` (update in-store-fulfillment section to note Kroger API-driven branch).
- **No new external dependencies, no new secrets.** The Kroger Products API already returns `aisleLocation` — this is pure normalization uplift. The Locations API is already called for `resolveLocationId`; with `location_id` stored, repeated calls are eliminated.
