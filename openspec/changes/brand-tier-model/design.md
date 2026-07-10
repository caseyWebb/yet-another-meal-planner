# brand-tier-model — design

## Context

Shipped state (verified in code, specs, and production):

- **Storage**: `brand_prefs(tenant, term, ranks)` — `PRIMARY KEY (tenant, term)`, `ranks` a JSON string array (`migrations/d1/0004_profile.sql`). `term` is `brandKey(canonical ingredient id)` — spaces→underscores over the ingredient-identity resolve (`applyPreferencesPatch` keys writes through `ctx.resolve` + `brandKey`, so reads and writes land on the same key).
- **Semantics (tri-state)**: row absent → ambiguous (matcher asks); `[]` → don't-care, cheapest acceptable within the top identity-relevance tier; non-empty → ranked, first available brand wins (`src/matching.ts` step 6; `ingredient-matching` spec "Tri-state brand-preference confidence").
- **Write path**: `update_preferences` merge-patch (`src/preferences.ts` validation + `src/write-tools.ts` `applyPreferencesPatch`, shared by the MCP tool and `PATCH /api/profile/preferences`). Brands rows are written **from the patch** (value → UPSERT, `null` → DELETE) because the merged object no longer carries delete intent.
- **Read path**: `assemblePreferences` (`src/profile-db.ts`) rebuilds `preferences.brands` as term→array; `readBrandPrefs` feeds the matcher (`src/tools.ts` `resolve()`).
- **Member UI**: `BrandsField` in `packages/app/src/routes/_app.profile.tsx` edits the flat shape via the class (a) If-Match PATCH.
- **Production (spike, 2026-07-10, read-only against D1 `grocery-mcp`)**: `brand_prefs` holds exactly **3 rows, one tenant, zero `[]` rows** — see D2 for the rows. 3 tenants exist in `profile`.

Grounding set: product-specs pages/09 §2–3, pages/05 §3, DECISIONS.md D5/D15/D21/D25(2), CHANGES.md `## brand-tier-model`.

## D1 — the tier shape: `{ tiers: string[][], any_brand: boolean }`, keyed per family as today

Per family (`term`), the stored and wire value is:

```jsonc
{
  "tiers": [["Challenge", "Tillamook"], ["Kerrygold"]],  // ordered; within a tier, equally fine — cheapest wins
  "any_brand": false                                      // terminal fallback: cheapest acceptable instead of asking
}
```

State mapping (the tri-state survives structurally — the matcher's confidence gate keeps its three answers):

| State | Old | New |
|---|---|---|
| Ambiguous — ask | row absent | row absent |
| Don't-care — cheapest, never ask | `[]` | `{ tiers: [], any_brand: true }` |
| Preference ladder | `["A","B"]` (each rank one brand) | `{ tiers: [["A"],["B"]], any_brand: false }` — tiers generalize ranks to equivalence classes |
| Ladder with never-ask fallback | *(inexpressible)* | `{ tiers: [["A","B"]], any_brand: true }` |

**"Any brand" is a flag, not a tier and not an absence.** Decided here (pages/09 §2's open question). Rationale:
- Not an **absence**: absence is the ask state; the matcher's confidence gate reads row presence as the signal. Collapsing "any brand" into absence would delete the ask state — a shipped semantic every un-configured family depends on.
- Not a **sentinel tier** (e.g. a trailing `"*"`): magic values re-introduce impossible states (a `"*"` mid-ladder, `"*"` alongside brands in one tier) and force every consumer to parse strings for meaning.
- As a **family-level flag** it composes with tiers: `any_brand` on a family with tiers means "exhausted the ladder → cheapest acceptable instead of asking" — which cleanly subsumes the pure don't-care as the zero-tiers case and makes the old `[]` a degenerate point of the new model rather than a special case.

**Exactly one representation per state.** `{ tiers: [], any_brand: false }` expresses nothing and is rejected (`malformed_data`; the message directs to `null` to clear). Validation: `tiers` must be an array of **non-empty** arrays of non-empty strings (no empty tier — the UI removes an emptied tier); a brand may appear in **at most one tier** of a family (case-insensitive compare — two ranks for one brand is contradictory); `any_brand` boolean. On read, both fields are **always present** (canonical form; `any_brand` defaults false, `tiers` defaults `[]` at assembly if a row somehow lacks one).

**Merge-patch semantics need no special-casing** — they fall out of RFC 7396 exactly as shipped: the family value is now an object, so `{ brands: { butter: { any_brand: true } } }` merges into the stored family (tiers preserved); `tiers` is an array, so it replaces wholesale; `null` deletes the family row. One asymmetry carries over from the shipped code and grows slightly: `applyPreferencesPatch` writes brand rows from the **patch**; with object values the UPSERT payload must come from the **merged** family value (patch-only would drop the preserved sibling field), while DELETE intent still comes from the patch (`null` vanishes from the merged object). Concretely: for each term present in `patch.brands`, `null` → DELETE; otherwise UPSERT `merged.brands[term]` (validated canonical form).

**Keying is unchanged.** "Per product family" (pages/09) is the shipped `term` — `brandKey(resolve(surface))` per ingredient family. `PRIMARY KEY (tenant, term)` stays. No new keying dimension.

## D2 — storage: rebuild `brand_prefs` in one migration; transform proven against production

```sql
-- NNNN_brand_tiers.sql — brands→tiers model (brand-tier-model change).
-- Each legacy rank becomes its own tier; legacy '[]' (don't-care) becomes any_brand=1.
-- A NULL/invalid ranks value read as don't-care under the shipped tolerant parser, so it
-- migrates to any_brand=1 with no tiers (production holds none — defensive only).
CREATE TABLE brand_prefs_tiers (
  tenant    TEXT,
  term      TEXT,
  tiers     TEXT NOT NULL DEFAULT '[]',   -- JSON string[][]
  any_brand INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant, term)
);
INSERT INTO brand_prefs_tiers (tenant, term, tiers, any_brand)
SELECT
  tenant,
  term,
  CASE
    WHEN ranks IS NOT NULL AND json_valid(ranks) AND json_type(ranks) = 'array'
    THEN (SELECT json_group_array(json_array(value))
          FROM (SELECT value FROM json_each(brand_prefs.ranks) ORDER BY key))
    ELSE '[]'
  END,
  CASE
    WHEN ranks IS NULL OR NOT json_valid(ranks) OR json_type(ranks) != 'array' OR ranks = '[]'
    THEN 1 ELSE 0
  END
FROM brand_prefs;
DROP TABLE brand_prefs;
ALTER TABLE brand_prefs_tiers RENAME TO brand_prefs;
```

The transform `SELECT` (the exact subquery above) was executed **read-only against production D1 during planning** and returned the expected tiers for every row, so the expression's behavior on the production engine — including `json_group_array` over the ordered `json_each` subquery — is verified fact, not hope.

**Named acceptance fixtures** — the full production `brand_prefs` population (tenant `casey`), verified post-deploy to read back exactly as:

| tenant/term | legacy `ranks` | expected `tiers` | expected `any_brand` |
|---|---|---|---|
| `casey`/`butter` | `["Challenge","Tillamook","Kerrygold"]` | `[["Challenge"],["Tillamook"],["Kerrygold"]]` | 0 |
| `casey`/`canned_tomatoes` | `["DeLallo","Muir Glen","Cento"]` | `[["DeLallo"],["Muir Glen"],["Cento"]]` | 0 |
| `casey`/`paper_towels` | `["Viva"]` | `[["Viva"]]` | 0 |

Production holds **zero** `[]` don't-care rows, so that migration arm is covered by unit fixtures only (seed a `[]` row locally, assert `{tiers: [], any_brand: 1}`). Post-deploy check: the remote `SELECT tenant, term, tiers, any_brand FROM brand_prefs` matches the table above, and `read_user_profile` for the fixture tenant returns the tier objects.

**Rejected alternative — lazy dual-encoding** (keep `ranks`, write the new shape into it, read both forms forever): leaves two permanent encodings for SCHEMAS.md to describe and every reader to branch on, for zero benefit over a three-row, expression-verified one-shot migration. Migrations in `migrations/d1/` *are* the pipeline (applied `--remote` by the deploy); this is not manual data surgery.

## D3 — D21 posture: value-shape alias for one window, `warnings` on the return

D21's contract: renames/retired keys ship a one-deprecation-window shim because the plugin lags the Worker (Worker-first deploy, async marketplace re-pull, mid-conversation cached skills). Here the accepted key `brands` **survives** but its **value shape** changes — the right shim is the alias posture (like `default_cooking_nights` → `cadence.dinner` in the sibling change), accepted-and-**converted**, never accepted-and-dropped (dropping would discard data a stale agent meant to write):

- For one deprecation window, a `string[]` value for a family is accepted and converted by the exact migration mapping (`[]` → `{tiers: [], any_brand: true}`; `["A","B"]` → `{tiers: [["A"],["B"]], any_brand: false}`), then applied as if the caller had sent the object.
- The `update_preferences` return becomes `{ updated: "preferences", warnings?: [...] }`; each converted family appends `{ key: "brands.<term>", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }" }`. Never `validation_failed`, never a nest-under-`custom` hint — a stale agent's write must succeed and steer, not bounce (D21's exact stance for the sibling's retired keys).
- After the window (once the matching plugin version has been published one window — same clock as the sibling's shims), an array value is `malformed_data` like any other type error.
- Read-side has no shim by design: `read_user_profile` returns the new shape immediately. A stale agent reading `{tiers, any_brand}` where it expected an array degrades soft (the LLM reads JSON; the tool description carries the semantics), and the shipped SPA is updated in this same change — no consumer needs the old read shape.

The `warnings` mechanism (field name, entry shape `{key, reason, superseded_by}`, TOOLS.md deprecation-convention section) is **shared with `meal-dimension-foundations`** — whichever change lands first introduces it; the second extends it. Serial implementation surface, flagged in tasks.md.

## D4 — matcher consumption: projection now, tier rules in band 3

**Now (this change):** the matcher is untouched. `readBrandPrefs` becomes a projection to the shipped input shape `Record<term, string[]>`:

- `{ tiers: [], any_brand: true }` → `[]`
- non-empty `tiers` → tiers flattened in tier order (within a tier, stored order)
- (`{tiers: [], any_brand: false}` cannot exist — validation + migration exclude it)

For every migrated production row (singleton tiers) the flattening reproduces the pre-migration list **byte-for-byte**, so matcher behavior over existing data is provably unchanged. Two documented interim degradations, both only reachable through data written under the new model between band 1 and band 3: (a) a multi-brand tier flattens to ordered ranks — within-tier "cheapest wins" is honored only from band 3; (b) `any_brand: true` alongside non-empty tiers degrades to today's exhausted-ladder behavior (ambiguous/ask) rather than cheapest-fallback. The projection lives in one named function with a comment pointing at `order-review-rework`.

**Band 3 sketch (what the model must support — the rules land there, not here):** `MatchDeps.brands` becomes `Record<term, {tiers, any_brand}>`; step 6 walks tiers in order — candidates (within the top identity-relevance tier, as today) whose brand matches any brand of the current tier → `commodityPick` (cheapest/tiebreak) among them; no match → next tier; ladder exhausted → `any_brand ? commodityPick(topTier) : ambiguous`. All-unavailable-ladder-without-any_brand keeps falling back to ambiguous (the shipped scenario). Order review's write-backs go through `update_preferences` partial patches: "Save {brand} as my preferred brand" → `{ brands: { term: { tiers: [[brand]] } } }` on a no-preference checkpoint; the in-order "don't care" hint → `{ brands: { term: { any_brand: true } } }` (tiers preserved by the merge). Where a saved brand lands on a family that already has tiers (new tier 1, join tier 1, or new bottom tier — pages/09 §4 q1) is band 3's decision; the model supports all three as ordinary tier edits, so nothing here forecloses it.

`sku_cache` interplay is unchanged: a cache hit stays confident regardless of brand preference; don't-care families still carry no pinned SKU.

## D5 — the management card ships here, from the mockup design

Decision and rationale in the proposal (D25(2) is explicit; the shipped `BrandsField` breaks on the read-shape change, so the coupling rule forces same-change UI; the design exists in the committed mockup — pages/09 §2 is the UX contract, `screens/profile-prefs.png`/`tall-profile-prefs.png` the visual ground truth, `product-specs/mockup/` the microcopy source; D5 painted-door applies to its mechanics only). Implementation notes:

- The card replaces `BrandsField` in the current profile page layout; the band-2/3 Preferences-tab restructure re-homes it later, unchanged.
- Interactions (from pages/09 §2): per-family cards; tier chips with ▲/▼ where moving past the edge creates a new tier (and an emptied tier collapses); per-tier add-brand input; "+ Add a fallback tier"; per-family "Any brand — cheapest wins" toggle; remove-family (writes `null`); add-family form. Copy: "yamp tries your top tier first, then falls back. Brands in the same tier are equally fine, so the cheapest wins."
- Writes are the same class (a) If-Match `PATCH /api/profile/preferences` merge-patch the page already uses — family-scoped patches (`{ brands: { <term>: <object|null> } }`), never whole-document rewrites, exactly like the shipped `BrandsField`. No `member-app-offline` delta: no new writable document exists.
- App-suite coverage: extend `app/visual/pages/profile.page.ts` + `specs/profile.spec.ts` (tier move creates a tier; any-brand toggle preserves tiers; remove-family; offline behavior inherits the existing class (a) specs).

## Risks / notes

- **SQL-engine dependence of the migration transform** — retired: the exact expression was run against production D1 read-only and produced correct, correctly-ordered output; local `wrangler dev` verification is still tasked for the workerd engine.
- **Serial surfaces**: `src/preferences.ts`, `applyPreferencesPatch`, the `warnings` mechanism, TOOLS.md `update_preferences`/`read_user_profile` sections, SCHEMAS.md preferences section, and the persona's `update_preferences` sites are shared with `meal-dimension-foundations` (and `spend-capture-on-order-commit` for `weekly_budget`). Implementation of the three band-1 changes serializes on these files; migration numbers are taken at implementation time.
- **Admin purge**: `TENANT_TABLES` lists `brand_prefs` by name; the rebuild keeps the table name, so revoke/purge is unaffected.
- **ETag/If-Match**: the preferences document's representation changes, so any client holding a pre-deploy ETag gets a 412 and refetches — the normal class (a) path, no special handling.
