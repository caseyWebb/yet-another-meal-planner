# brand-tier-model

## Why

Band 1 of the member-app redesign (product-specs/CHANGES.md `## brand-tier-model`). The shipped brand-preference model is a flat ranked list per ingredient family — `brand_prefs(tenant, term, ranks)` where `ranks` is tri-state: row absent = ambiguous (ask), `[]` = don't-care/cheapest, non-empty = ranked list, list order is rank. Pages/09 §2 replaces that with **tiers of equivalents**: "yamp tries your top tier first, then falls back. Brands in the same tier are equally fine, so the cheapest wins," plus a per-family **"Any brand — cheapest wins"** toggle. The flat list cannot express either "these brands are interchangeable — take whichever is cheapest" or "prefer these, but if none is available just grab the cheapest instead of asking."

This change ships the **data model, storage, and tool contract** only. The matcher rule internals that exploit tiers (within-tier cheapest, tier fall-through, any-brand terminal fallback) land with band 3's `order-review-rework`, together with the order-review "Save as preferred brand" / "don't care" write-backs that write into this model. Until then a projection preserves the shipped matcher behavior exactly (see design.md).

## What Changes

- **The brand-preference value becomes a tier object.** Per family (the existing `term` = `brandKey(canonical ingredient id)` — keying unchanged): `{ tiers: string[][], any_brand: boolean }`. `tiers` is an ordered array of tiers, each a non-empty array of brand names; `any_brand: true` means "after the tiers (if any), take the cheapest acceptable instead of asking." The confidence tri-state survives structurally: row absent = ambiguous/ask; `{ tiers: [], any_brand: true }` = don't-care (the old `[]`); non-empty `tiers` = the preference ladder. "Any brand" is **neither a tier nor an absence** — it is a per-family flag (see design.md D1).
- **Migration** `migrations/d1/NNNN_brand_tiers.sql` rebuilds `brand_prefs` with `tiers TEXT NOT NULL` + `any_brand INTEGER NOT NULL DEFAULT 0` columns, transforming in SQL: each legacy rank becomes its own singleton tier (`["A","B"]` → `[["A"],["B"]]`, exactly pages/09 §2's stated migration), legacy `[]` → `any_brand=1` with no tiers. The transform SELECT was executed read-only against production D1 during planning and produces the expected output for all existing rows (see design.md D2 — the three production rows are the named acceptance fixtures).
- **`update_preferences`**: `brands` entries take the tier object (RFC 7396 applies unchanged — a partial family patch like `{ any_brand: true }` merges into the stored family object; `null` still deletes back to ambiguous). Validation: brands must be objects of this shape, a brand may appear in only one tier of a family, and the all-empty value `{ tiers: [], any_brand: false }` is rejected (`null` is the one way to clear). **D21 shim**: for one deprecation window a legacy array value is **accepted-and-converted** (same mapping as the migration) and the return gains a `warnings` field — `{ key: "brands.<term>", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }" }`; after the window an array value is `malformed_data`. The `warnings` return field is the same mechanism `meal-dimension-foundations` uses for its retired keys (serial surface — see tasks.md).
- **`read_user_profile`** (and `GET /api/profile/preferences`): each `preferences.brands` entry is returned as the canonical tier object with **both fields always present** — never a bare array.
- **Matcher-facing projection, no rule change**: `readBrandPrefs` flattens tiers in order into the flat ranked list the shipped confidence gate consumes (`{tiers: [], any_brand: true}` → `[]`). For all migrated production rows the projection is byte-identical to today's input, so matcher behavior is unchanged by construction. `openspec/specs/ingredient-matching` is deliberately **not** deltaed here — band 3 rewrites its brand rules.
- **The Preferred-brands management card ships in this change** (see below): the member app's profile brands editor (`BrandsField` in `packages/app/src/routes/_app.profile.tsx` — flat ranked chips) is replaced by the mockup's per-family tier card: tier chips with ▲/▼ (moving past the edge creates a tier), per-tier add-brand input, "+ Add a fallback tier", the per-family "Any brand — cheapest wins" toggle, remove-family, add-family. Same PATCH `/api/profile/preferences` If-Match write path as today.
- **Persona**: `AGENT_INSTRUCTIONS.md`'s brand-preference teaching (the `{ brands: { yellow_onion: [] } }` don't-care and ranked-list examples) is rewritten to the tier shape; `aubr build:plugin --check`.
- **Docs lockstep, same pass**: docs/TOOLS.md (`update_preferences` brands param + `warnings` return, `read_user_profile` shape note, the D21 deprecation-convention entry), docs/SCHEMAS.md (storage overview brands paragraph, the preferences section's `brand_prefs` DDL + example rows + the tri-state paragraph, the sku_cache "don't-care commodities" cross-reference), docs/ARCHITECTURE.md ("Confidence is legible and self-extinguishing" — the tri-state sentence).

### Management-card placement (D25(2)) — decided: it ships here

DECISIONS.md D25(2) states it directly: "the brand-tier management card rides the brand-tier model change." Two facts make that the only sound option, not just the mandated one:

1. **The coupling rule bites concretely.** The shipped profile page already edits `preferences.brands` as `Record<term, string[]>` (`BrandsField`). This change retires that read shape — the page would break on read, not just write, and the write shim cannot cover a read. D25(2)'s coupling rule (a migration retiring a preference shape the shipped profile page edits ships with, or is immediately followed by, its member-UI update) therefore forces the UI into this change or an immediate sibling.
2. **No design is improvised.** The card's design already exists in the committed Claude Design mockup bundle — pages/09 §2 is its distilled UX contract, `product-specs/screens/profile-prefs.png` / `tall-profile-prefs.png` are the visual ground truth, and `product-specs/mockup/` carries microcopy and interaction states. Per D5 the mock's mechanics are painted-door; sourcing and writes follow this change's model. No design-requests.md entry is needed. The rejected alternative — adapting `BrandsField` to the new shape as throwaway interim UI and shipping the real card as a band-3 sibling — would be exactly the improvised-UI state the split is meant to avoid, and would violate D25(2)'s text besides.

The card lands in the current profile page layout where `BrandsField` sits today; the band-2/3 Preferences-tab restructure (`profile-planning-and-vibes-ui`, `store-adapters-card`) re-homes it unchanged.

### Deltas deliberately not carried

- **`member-app-offline`** — no delta. Brand tiers introduce **no new writable document**: they remain part of the preferences document, whose editor surface is already classified class (a) If-Match (D15; member-app-offline's write-classes requirement names the preferences editing surface). The tier card writes through the same conditional PATCH.
- **`ingredient-matching`** — no delta (per product-specs/CHANGES.md). The tri-state confidence requirement stays true under the projection; band 3's `order-review-rework` rewrites the brand rules to consume tiers natively.

## Capabilities

### Modified Capabilities

- `data-write-tools`: `update_preferences` brands entries become tier objects; family-level merge semantics; validation (one-tier-per-brand, no all-empty value); the one-window legacy-array shim + `warnings` return field.
- `data-read-tools`: `read_user_profile` assembles `preferences.brands` entries as canonical `{ tiers, any_brand }` objects.
- `member-app-core`: the profile page's brands editor becomes the Preferred-brands management card (tier chips, fallback tiers, any-brand toggle, family add/remove).

## Impact

- `migrations/d1/NNNN_brand_tiers.sql` (new — take the next free number at implementation time; sibling band-1 changes also add migrations).
- `packages/worker/src/preferences.ts` — brands validation (tier object, legacy-array window, forbidden empty state).
- `packages/worker/src/write-tools.ts` — `applyPreferencesPatch` brands application (merged family objects → UPSERT, patch `null` → DELETE), `warnings` return, `update_preferences` tool description.
- `packages/worker/src/profile-db.ts` — `brand_prefs` row shape, `assemblePreferences`, `brandStmt`, `readBrandPrefs` projection (+ a tier-shaped read for the card/API).
- `packages/worker/src/api/profile.ts` — no route change; response shape flows from `readPreferences`.
- `packages/app/src/routes/_app.profile.tsx` — `BrandsField` → the Preferred-brands card; `packages/app/src/lib/mutations.ts` comment.
- `packages/worker/app/visual/` — profile page object + spec coverage for the card; `aubr test:app`.
- `packages/worker/AGENT_INSTRUCTIONS.md` + `aubr build:plugin --check`.
- `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`.
- Tests: `test/preferences.test.ts`, `test/profile-db.test.ts`, `test/matching.test.ts` (projection), `test/write-tools.test.ts` if present for the apply path.
- Production convergence check after deploy: the three fixture rows read back in tier shape (design.md D2).

## Depends On

Nothing. Siblings `meal-dimension-foundations` and `spend-capture-on-order-commit` share the `update_preferences`/`read_user_profile` TOOLS.md + SCHEMAS.md sections, `src/preferences.ts`, and the `warnings` return mechanism — **implementation serializes on those surfaces** (planning does not).
