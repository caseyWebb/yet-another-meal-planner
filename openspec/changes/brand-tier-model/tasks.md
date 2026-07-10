> **Serial-surface note:** `src/preferences.ts`, `applyPreferencesPatch`/the `warnings` return mechanism, the TOOLS.md `update_preferences`/`read_user_profile` sections, the SCHEMAS.md preferences section, and the persona's `update_preferences` sites are shared with the sibling band-1 changes `meal-dimension-foundations` and `spend-capture-on-order-commit`. **Do not implement this change in parallel with them** — whichever lands first introduces the shared `warnings` field + TOOLS.md deprecation convention; the later ones extend it. Take the migration number (`NNNN`) as the next free number at implementation time (siblings also add migrations).

## 1. Migration + storage

- [x] 1.1 Add `migrations/d1/NNNN_brand_tiers.sql` — the rebuild-and-transform from design.md D2 verbatim (columns `tiers TEXT NOT NULL DEFAULT '[]'`, `any_brand INTEGER NOT NULL DEFAULT 0`; each legacy rank → its own singleton tier; `[]`/NULL/invalid `ranks` → `any_brand=1` with no tiers; `DROP` + `RENAME` keeps the `brand_prefs` name so `TENANT_TABLES` purge coverage is untouched).
- [x] 1.2 Verify locally: apply migrations through the previous one to a fresh local D1, seed the three production fixture rows plus one `[]` row (design.md D2 table), apply `NNNN_brand_tiers.sql`, and assert the post-migration rows match the expected tiers/any_brand exactly (including tier order).

## 2. Model + write path (worker)

- [x] 2.1 `src/preferences.ts`: replace the `brands` validation — each family value must be a tier object (`tiers` an array of non-empty arrays of non-empty strings; a brand in at most one tier per family, case-insensitive; `any_brand` boolean; `{tiers: [], any_brand: false}` rejected with a use-`null`-to-clear message) or, during the deprecation window, a legacy `string[]` (converted per design.md D3 before validation). Export the legacy→tier conversion helper so the merge path and tests share it.
- [x] 2.2 `src/write-tools.ts` `applyPreferencesPatch`: brands application per design.md D1 — for each term present in `patch.brands`, `null` → DELETE; otherwise UPSERT the **merged** family value (canonical form, both fields). Collect `warnings` entries (`{key: "brands.<term>", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }"}`) for each legacy-array family converted; return `{ updated: "preferences", warnings? }` (omit the field when empty). Keep the write keyed through `brandKey(ctx.resolve(term))`.
- [x] 2.3 `src/profile-db.ts`: `brandStmt` writes `tiers` + `any_brand` columns; `assemblePreferences` returns each brands entry as the canonical `{ tiers, any_brand }` (both fields always present; tolerate a malformed stored value as don't-care, mirroring the shipped tolerant parse); add a typed tier read (`readBrandTiers`) for consumers that want the model.
- [x] 2.4 `src/profile-db.ts` `readBrandPrefs`: becomes the matcher-facing **projection** (design.md D4): flatten tiers in order; `{tiers: [], any_brand: true}` → `[]`. Name and comment it as the interim projection consumed by `src/tools.ts` `resolve()` until band 3's `order-review-rework` moves the matcher onto tiers natively. `src/matching.ts` is NOT touched.
- [x] 2.5 `update_preferences` tool description (`src/write-tools.ts`): rewrite the brands paragraph — tier-object shape and semantics (top tier first; within a tier cheapest wins; `any_brand` = cheapest instead of asking when tiers exhaust; absent = ask; `null` clears; partial family patches merge), and note the one-window legacy-array acceptance with `warnings`.

## 3. Member app — Preferred-brands management card

- [x] 3.1 Replace `BrandsField` in `packages/app/src/routes/_app.profile.tsx` with the Preferred-brands card per design.md D5 / pages/09 §2 (design source: the committed mockup — `product-specs/screens/profile-prefs.png`, `tall-profile-prefs.png`, `product-specs/mockup/`): per-family cards, tier chips with ▲/▼ (past-edge creates a tier; an emptied tier collapses), per-tier add-brand input, "+ Add a fallback tier", "Any brand — cheapest wins" toggle, remove-family (`null`), add-family form, the "top tier first / same tier equally fine, cheapest wins" copy. Writes stay family-scoped merge-patches over the existing If-Match PATCH (`{ brands: { <term>: <object|null> } }`); update the stale comment in `packages/app/src/lib/mutations.ts`.
- [x] 3.2 Extend `app/visual/pages/profile.page.ts` + `app/visual/specs/profile.spec.ts`: tier chip past-edge move creates a tier; any-brand toggle preserves tiers (partial patch); remove-family clears; add-family + add-brand; seed fixture families in the suite's seed data. Run `aubr test:app` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).

## 4. Tests (worker)

- [x] 4.1 `test/preferences.test.ts`: tier-object validation (valid ladders; duplicate brand across tiers rejected; empty tier rejected; all-empty value rejected; `any_brand` type), legacy-array conversion (`[]` and ranked fixtures — assert the three production rows' expected outputs from design.md D2), partial-family merge preserving the sibling field.
- [x] 4.2 `test/profile-db.test.ts`: `brandStmt` column writes; `assemblePreferences` canonical both-fields form (including malformed-stored-value tolerance); `readBrandPrefs` projection — singleton-tier rows flatten byte-identical to the legacy lists; don't-care projects to `[]`.
- [x] 4.3 `test/matching.test.ts`: unchanged behavior over projected inputs — the existing tri-state gate scenarios still pass fed from the projection (absent → ambiguous; `[]` → cheapest-in-top-tier; ranked → highest-ranked available).
- [x] 4.4 `applyPreferencesPatch` coverage (where its existing tests live): UPSERT-from-merged / DELETE-from-patch; `warnings` emitted only for converted families and omitted otherwise.

## 5. Persona + plugin

- [x] 5.1 `packages/worker/AGENT_INSTRUCTIONS.md`: rewrite the brand-preference sites — the standing don't-care example (`{ brands: { yellow_onion: [] } }` → `{ brands: { yellow_onion: { any_brand: true } } }`), the ranked-preference example (`{ brands: { olive_oil: ["Cobram"] } }` → `{ brands: { olive_oil: { tiers: [["Cobram"]] } } }`), clearing via `null` (unchanged); keep the tool description as the semantics owner (the persona carries choreography only). Grep the persona for any other `brands:` patch examples.
- [x] 5.2 `aubr build:plugin --check`.

## 6. Docs lockstep (same pass)

- [x] 6.1 `docs/TOOLS.md`: `update_preferences` — brands param shape + semantics, the `warnings` return field, and the deprecation-convention entry for the one-window legacy-array acceptance (create the convention section if `meal-dimension-foundations` hasn't landed it yet; otherwise add this entry to it). `read_user_profile` — note the `preferences.brands` canonical tier-object shape.
- [x] 6.2 `docs/SCHEMAS.md`: the storage-overview brands paragraph (merge-patch mapping onto rows), the preferences section — `brand_prefs` DDL (`tiers`/`any_brand`), example rows (use the migrated production fixtures), and the "tri-state" paragraph rewritten for the tier model (states table from design.md D1, keying unchanged); the `sku_cache` section's don't-care cross-reference (`'[]' in preferences` → the any-brand family).
- [x] 6.3 `docs/ARCHITECTURE.md`: the "Confidence is legible and self-extinguishing" tri-state sentence — describe current state (row absent → ask; any-brand → cheapest; tiers → the ladder), no history narration.

## 7. Verification

- [x] 7.1 `aubr typecheck`, `aubr test`, `aubr test:app` green; `openspec validate "brand-tier-model"`.
- [ ] 7.2 Post-deploy production convergence check (read-only): `SELECT tenant, term, tiers, any_brand FROM brand_prefs` matches the design.md D2 fixture table exactly, and `read_user_profile` for the fixture tenant returns the canonical tier objects. *(Runs after the deploy — not part of the implementation pass.)*
