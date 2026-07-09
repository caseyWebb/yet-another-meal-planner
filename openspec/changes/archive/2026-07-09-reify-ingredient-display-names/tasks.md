## 1. D1 migration

- [x] 1.1 Add `migrations/d1/NNNN_display_names.sql`: `ALTER TABLE ingredient_identity ADD COLUMN display_name TEXT;`, and the same nullable `display_name TEXT` on `grocery_list` and `pantry` (three additive, nullable columns; no backfill in the migration).
- [x] 1.2 Apply locally (`npx wrangler d1 migrations apply DB --local`) and confirm the columns exist (`d1 execute … "PRAGMA table_info(...)"`); the deploy applies `--remote`.

## 2. Identity plane — reify `ingredient_identity.display_name` (Move A)

- [x] 2.1 `corpus-db.ts` `readResolver`: select `display_name` and carry it on the in-memory row (`rowOf`), plumbed like `search_term`.
- [x] 2.2 `corpus-db.ts` `labelOf`: return `row.display_name ?? (detail ? \`${base} (${detail})\` : base)` — synthesis becomes the fallback only. (Also exposes `IngredientContext.displayName(id): string | undefined` — raw curated value for the row plane.)
- [x] 2.3 `ingredient-classify.ts`: add a `display_name` field to the `IdentityConfirm` contract (alongside the existing human `reason`); update the classifier prompt to emit a clean human label.
- [x] 2.4 `ingredient-normalize.ts` `buildResolution`: thread the classifier's `display_name` onto the minted node; deterministic reshape passes (`repairSegmentOverflow`, `applyDisjunctionRepair`) set a deterministic `display_name` when they mint bases (same rule shape as `search_term`).
- [x] 2.5 `corpus-db.ts` `commitResolution`: INSERT `display_name`; `ON CONFLICT … COALESCE(ingredient_identity.display_name, excluded.display_name)` so an existing value is never downgraded (mirror `search_term`).
- [x] 2.6 `update_aliases` → `corpus-db.ts` `addAliases`: accept and write a `source='human'` `display_name` when supplied; verify "human wins" precedence holds (auto never overwrites a human value). Update the `update_aliases` tool description. (Tool wiring in `write-tools.ts` finished in group 5.2.)
- [x] 2.7 Add a bounded reconcile backfill pass for null-`display_name` nodes in `reconcileNormalization`, shaped like `backfillEmbeddings` (capped per tick), deriving a deterministic label for the backlog.

## 3. Row plane — split display from key on grocery/pantry rows (Move B)

- [x] 3.1 Thread the stored `normalized_name` into `GroceryItem`/`PantryItem` (`grocery.ts`, `session-db.ts` `groceryItemOf`/`pantryItemOf`, `pantry-write.ts` item shape) — carry the stored key, do not drop it.
- [x] 3.2 Rekey the pure ops on the STORED key: `findIndex`, advance/rollback (`session-db.ts`), and pantry `matches` (`pantry-write.ts`) use the row's stored `normalized_name` instead of re-deriving `resolve(item.name)` (closes coupling #2). Keep bare-name lookups (which have no stored key) resolving as today. (Via new `storedGroceryKey` helper.)
- [x] 3.3 Add `display_name` to the grocery/pantry row shapes and to `groceryUpsertStmt`/`pantryUpsertStmt` (persist it; default null).
- [x] 3.4 Merge = keep-first display: on grocery re-add and pantry add-merge, keep the surviving row's `name`/`display_name` (align pantry `applyPantryOperations`, which currently overwrites `name` with the latest surface form, to keep-first).
- [x] 3.5 Add-by-id write path: `GroceryAddInput` + `POST /api/grocery/items` (`api/grocery.ts`) accept an optional canonical `id`; when present, key = the given id validated via `validateCanonicalId` (NOT `resolve`), and `display_name` = the identity node's `display_name` (copied onto the row at write); when absent, today's behavior unchanged. Reject/soft-fall-back an `id` that no node backs (never store an unresolvable key).
- [x] 3.6 Add the same optional canonical `id` param to the MCP `add_to_grocery_list` tool (symmetric with the endpoint; lives in `grocery-tools.ts`); update the tool description to state the id-is-canonical-key + display-from-node semantics.

## 4. Read plane — render the reified display (Move C)

- [x] 4.1 `read_grocery_list` / `GET /api/grocery`: render each row's label as `display_name ?? name`. (Item already carries `display_name`; GET serializes it — app coalesces.)
- [x] 4.2 Enriched `read_to_buy` (`to-buy.ts` enrich path, `order-shapes.ts`): add a `display_name` field; source it from the row (`display_name ?? name`) for list/both lines and from the identity node for plan/by-id lines. (Extended to `pantry_covered` + `in_cart` too, per the holistic audit.)
- [x] 4.3 Enriched read: render the two previously-raw-id surfaces via the node `display_name` — `substitutes[].relation.via` (`via_label`) and `placement.department` (`department_label`) (`substitute-annotator.ts`, `to-buy.ts` placement). `substitutes[].label` already flows from `labelOf`, now curated.
- [x] 4.4 Guard the byte-identity fence: the DEFAULT `read_to_buy` (`to_buy[].name`, `pantry_covered[].name`, `in_cart[].name`) keeps its existing sourcing and gains NO new field; display additions ride only on the enriched read + the stored-row read.
- [x] 4.5 Member app (`packages/app/src/routes/_app.grocery.tsx`): `swapSibling` posts `{ id: sib.id, name: sib.label, … }` (not `{ name: sib.id }`); render sites use `display_name ?? name`.

## 5. Contract docs (same change, no drift)

- [x] 5.1 `docs/SCHEMAS.md`: add `display_name` to the `ingredient_identity` schema; add `display_name` to `grocery_list` and `pantry`; fix the double-gloss where grocery `name` is annotated "order-time search term (display name; required)" (name = surface form / search-term input; display = `display_name ?? name`).
- [x] 5.2 `docs/TOOLS.md`: document the `add_to_grocery_list` optional `id` param and the `update_aliases` `display_name` field.
- [x] 5.3 `docs/ARCHITECTURE.md`: update the ingredient-normalization capture prose and the Kroger matching step-1 prose to reflect `display_name` as a reified node attribute (current-state only, no history narration).

## 6. Tests

- [x] 6.1 Worker unit (`vitest`): `labelOf` prefers stored `display_name`, falls back to synthesis; `commitResolution` COALESCE protects an existing/human `display_name`; the reconcile backfill fills a null value.
- [x] 6.2 Worker unit: item-shape key threading — a row whose display ≠ `resolve(display)` (an add-by-id row) still dedups, advances, and rolls back via its stored key; keep-first merge holds for grocery and pantry.
- [x] 6.3 Worker unit: add-by-id keys on the validated canonical id and sets `display_name` from the node; an unbacked `id` does not persist an unresolvable key.
- [x] 6.4 Worker unit: negative matcher guard — changing a node's `display_name` changes no match result, ranking, `sku_cache`, or `brand_prefs` key.
- [x] 6.5 Worker unit: DEFAULT `read_to_buy` shared-op output is unchanged (same lines, no new default field) — the pre-existing to-buy tests pass unmodified.
- [x] 6.6 App Playwright (`app/visual/`): accepting an inline substitute renders the clean label (e.g. "Red cabbage"), not the canonical id; run `aubr test:app` (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
- [ ] 6.7 Acceptance fixture: the production row already stored as `cabbage::color-red` (and any peers surfaced by `read_grocery_list`) — after deploy, verify the reconcile + read path renders "Red cabbage" against production (convergence, not a hand-edit). **[post-deploy — deferred until the change is merged + deployed]**

## 7. Validate

- [x] 7.1 `openspec validate reify-ingredient-display-names --strict` passes.
- [x] 7.2 `aubr typecheck` and `aubr test` green (2124 passed); the app Playwright swap spec drives the swap flow end-to-end.
