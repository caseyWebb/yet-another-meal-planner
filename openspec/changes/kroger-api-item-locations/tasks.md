## 1. Kroger client — `aisleLocation` + `inStore` normalization

- [ ] 1.1 Add `aisleLocation: { number: string; description: string; side?: string } | null` and `inStore: boolean` to the `KrogerCandidate` interface in `src/kroger.ts`
- [ ] 1.2 Update `normalizeProduct` to read `items[0].aisleLocation` (null when absent) and `items[0].fulfillment.inStore` (boolean, default false) alongside the existing `price` and `fulfillment` reads
- [ ] 1.3 Update `resolveLocationId` to accept an optional pre-resolved id: when called with a bare locationId string (no spaces, no Kroger store prefix), return it directly without hitting the Locations API — the existing ZIP-parse path is unchanged
- [ ] 1.4 Unit-test `normalizeProduct`: item with full `aisleLocation`, item with no `aisleLocation` (→ null), item with `inStore: false` (online-only), item with no fulfillment object
- [ ] 1.5 Unit-test `resolveLocationId` bypass: a call with a pre-resolved id string returns it without a fetch; a call with a `"Kroger - 76104"` label still parses the ZIP and fetches

## 2. Store model — `location_id` field

- [ ] 2.1 Add `location_id?: string` to the `Store` interface in `src/stores.ts`; update `toStore` to read it (`asString(parsed.location_id)`) and `serializeStore` to include it when present
- [ ] 2.2 Update `src/stores-tools.ts`: `add_store` input schema accepts optional `location_id: z.string().optional()`; `set_identity` in `storeOpShape` and `IDENTITY_FIELDS` include `"location_id"` so `update_store` can set it; update tool descriptions to mention `location_id` (Kroger stores should store their resolved locationId here)
- [ ] 2.3 Unit-test `toStore` / `serializeStore` round-trip with and without `location_id`; test `set_identity` for `location_id`

## 3. Build system — `<!-- resource -->` extraction

- [ ] 3.1 Add a `parseResourceBlocks(body: string)` export to `scripts/build-plugin.mjs`: finds `<!-- resource: <relpath> -->...<content>...<!-- /resource -->` blocks (multiline), returns `{ lean: string; resources: Map<string, string> }` where `lean` has each block replaced by a single pointer line (`` > For details, read `<relpath>`. ``)
- [ ] 3.2 Update `buildPluginFiles` to call `parseResourceBlocks` on each flow's body before rendering; emit each extracted resource as `skills/<name>/<relpath>` in the files map alongside the flow's SKILL.md
- [ ] 3.3 Update `validateParsed` to verify that any `<!-- resource: -->` paths are syntactically valid relative paths under `references/`; add to the existing error list, don't throw
- [ ] 3.4 Unit-test `parseResourceBlocks`: a body with no blocks (lean = body, resources empty); a body with one block (pointer injected, resource extracted); a body with two blocks; a block whose content contains markdown headings (preserved verbatim)
- [ ] 3.5 Regression-test that existing skills (no resource blocks) produce byte-identical SKILL.md output after the change

## 4. Agent persona — unified `shop-groceries` skill

- [ ] 4.1 In `AGENT_INSTRUCTIONS.md`, replace the three flows (`place-grocery-order`, `shopping-list`, `map-grocery-store`) with a single `### shop-groceries (the flush)` flow carrying:
  - A lean SKILL.md body: shared preamble (`read_grocery_list` + `read_preferences` in parallel); the fulfillment detection table (signals → branch); one pointer line per branch
  - Four `<!-- resource: references/<branch>.md -->` blocks: `kroger-online.md` (existing place-grocery-order body, unchanged), `kroger-instore.md` (new — see 4.2), `instore-walk.md` (existing shopping-list walk body, unchanged), `map-store.md` (existing map-grocery-store body updated per 4.3)
  - `needs: cart` (same as the retired order skill)
- [ ] 4.2 Author `kroger-instore.md` reference content (new branch):
  - Detect or register the Kroger store slug (one-time: ask user for a label → derive slug → `add_store` with `chain: "kroger"`, `location_id`, label; subsequent trips resolve by slug)
  - Call `kroger_prices` for each active grocery list item in parallel to retrieve `aisleLocation`
  - Group and order by `aisleLocation.number`; items with null location go at the end ("location unknown")
  - Surface `inStore: false` items as "pickup/delivery only — remove from in-store list?" before the walk; never silently drop
  - Voice walk (same hands-free pacing as `instore-walk.md`) one aisle at a time
  - Silent idempotent location note seeding: after `read_store_notes`, for each item resolved to an aisle, write `add_store_note(slug, "Aisle <N>: <item>", tags:["location"])` only if no existing `location` note already mentions the item name (case-insensitive)
  - Completion: `active → received`, pantry restock, storage tips (same as instore-walk.md)
- [ ] 4.3 Update `map-store.md` reference content: remove per-note confirmation for `location` notes — when a list item is matched to the current aisle, write the `location` note silently (same idempotency check as 4.2); keep the user-confirmation for `layout` notes (the aisle name is user-supplied input, so the confirmation IS the data)
- [ ] 4.4 Update all cross-references in `AGENT_INSTRUCTIONS.md` that mention `place-grocery-order`, `shopping-list`, or `map-grocery-store` by name → `shop-groceries`; keep the "two-flush" framing (capture vs. flush) intact
- [ ] 4.5 `npm run build:plugin --check` — verify `shop-groceries` emits with four `references/` files, the three retired skill names are gone, and the `needs: cart` prerequisite line is present

## 5. Docs (the contract — same pass as code)

- [ ] 5.1 `docs/TOOLS.md`: add `location_id` to `add_store` and `update_store` parameter docs; note that `kroger_prices` results carry `aisleLocation` (nullable) and `inStore` on each candidate
- [ ] 5.2 `docs/SCHEMAS.md`: add `location_id?: string` to the `stores/<slug>.toml` schema section; document its semantics (chain-specific external id, e.g. Kroger `locationId`) alongside the existing identity fields
- [ ] 5.3 `docs/ARCHITECTURE.md`: update the in-store-fulfillment section to note the Kroger in-store branch and the API-driven aisle ordering; note the `location_id` bypass for `resolveLocationId`

## 6. Verify and land

- [ ] 6.1 `npm test` — all Worker unit tests pass (including new tests from tasks 1, 2, 3)
- [ ] 6.2 `npm run typecheck` — no type errors
- [ ] 6.3 `npm run build:plugin` (with a real URL) — bundle emits cleanly; `shop-groceries` has four `references/` files; retired skill names absent
- [ ] 6.4 `npm run test:tooling` — build-indexes + build-plugin tests pass (including regression that existing skills are byte-identical)
- [ ] 6.5 After merge to `main`, kick the operator deploy per CONTRIBUTING (`gh workflow run deploy.yml --repo <data-repo>`) — Worker `src/**` changed
