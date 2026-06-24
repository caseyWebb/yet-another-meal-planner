## Context

The `profile:<username>` KV bundle is a JSON envelope of TOML/markdown strings (`unified-user-profile-kv` lifted it verbatim from GitHub). `json-profile-bundle` proposed re-shaping it to JSON-in-KV; the `cloudflare-storage-architecture` reframe redirected that to D1. This slice does the move. The interface design from `json-profile-bundle` (the `update_preferences` merge-patch, the defined-top-level + `custom` schema, the brands tri-state) is settled and carried forward unchanged — only the persistence target is D1 instead of a KV blob.

The profile decomposes naturally into relational tables: a singleton row of scalars + freeform JSON, plus child tables for the lists/maps (brands, equipment, staples, overlay, ready-to-eat, stockup). Several of these are exactly the shapes that were awkward as TOML blobs and are natural as rows — overlay most of all, because group ratings are a cross-tenant aggregate.

## Goals / Non-Goals

**Goals:**
- The whole profile in normalized D1 tables; reads assemble it, writes mutate rows.
- `update_preferences` merge-patch (json-profile-bundle design) realized on D1; brands tri-state as UPSERT/DELETE.
- Group ratings as one indexed query.
- Delete the KV-bundle layer and its TOML codecs.

**Non-Goals:**
- Session state (pantry/meal_plan/grocery_list) — slice 5; `user-kv.ts`'s session helpers stay this slice.
- Recipe notes / store data — slice 6; `read_recipe_notes`' notes half still reads GitHub (ratings half moves here).
- Changing the agent-facing shape of `read_user_profile` (same returned object; different source).

## Decisions

### Decision: table layout

```sql
CREATE TABLE profile (
  tenant                      TEXT PRIMARY KEY,
  taste                       TEXT,     -- markdown
  diet_principles             TEXT,     -- markdown
  default_cooking_nights      INTEGER,
  lunch_strategy              TEXT,     -- leftovers | buy | mixed
  ready_to_eat_default_action TEXT,     -- opt-in | auto-add
  stores                      TEXT,     -- JSON: { primary, preferred_location, location_zip }
  dietary                     TEXT,     -- JSON: { avoid[], limit[] }
  custom                      TEXT,     -- JSON: arbitrary agent-added keys
  kitchen_notes               TEXT,     -- JSON: freeform cook-reasoning context
  freezer_capacity_estimate   TEXT
);
CREATE TABLE brand_prefs (
  tenant TEXT, term TEXT, ranks TEXT,   -- JSON array; '[]' = don't-care
  PRIMARY KEY (tenant, term)
);
CREATE TABLE kitchen_equipment (tenant TEXT, slug TEXT, PRIMARY KEY (tenant, slug));
CREATE TABLE staples  (tenant TEXT, name TEXT, normalized_name TEXT, perishable INTEGER,
                       PRIMARY KEY (tenant, normalized_name));
CREATE TABLE overlay  (tenant TEXT, recipe TEXT, rating INTEGER, status TEXT,
                       PRIMARY KEY (tenant, recipe));
CREATE TABLE ready_to_eat (tenant TEXT, slug TEXT, meal TEXT, name TEXT, status TEXT,
                       category TEXT, source TEXT, brand TEXT, notes TEXT,
                       PRIMARY KEY (tenant, slug));
CREATE TABLE stockup  (tenant TEXT, name TEXT, normalized_name TEXT, unit TEXT,
                       typical_purchase TEXT, notes TEXT, baseline_price REAL,
                       buy_at_or_below REAL, PRIMARY KEY (tenant, normalized_name));
CREATE INDEX idx_overlay_recipe ON overlay(recipe);   -- group-ratings aggregate
```

**Rationale:** scalars and freeform JSON live on the singleton `profile` row (one read for the bulk of `read_user_profile`); the list/map fields are child tables keyed by `(tenant, …)` so writes are row-level (no whole-blob rewrite) and admin edits/queries are first-class. `brands` is a child table rather than a JSON column specifically because the merge-patch tri-state is row UPSERT/DELETE and the matcher reads it per-term. `idx_overlay_recipe` powers the cross-tenant group rating. Normalized-name columns preserve the existing dedup semantics for staples/stockup.

### Decision: `update_preferences` merge-patch → D1 writes

The contract is `json-profile-bundle`'s verbatim (deep RFC-7396 merge, `null` deletes, staged validation: unknown top-level key → error toward `custom`; types validated on the merged result). The application maps onto D1:

```
  patch.default_cooking_nights / lunch_strategy / ready_to_eat_default_action
      → UPDATE profile SET … (null → SET NULL)
  patch.stores / dietary / custom (objects)
      → read JSON column, deep-merge the fragment, write back (null leaf deletes)
  patch.brands.<term> = [..]   → UPSERT brand_prefs(tenant, term, ranks)
  patch.brands.<term> = []     → UPSERT with ranks '[]'
  patch.brands.<term> = null   → DELETE brand_prefs row   (tri-state: back to ambiguous)
```

All within one D1 `batch` transaction so a patch applies atomically. The brands tri-state — the trickiest part of the KV design — becomes the most natural part on D1: value→UPSERT, `null`→DELETE.

### Decision: reads assemble; one batched round-trip where it matters

`read_user_profile` issues a `batch` of `SELECT`s (profile row + each child table for the tenant) and assembles the same object shape the agent sees today (preferences reconstructed from the `profile` columns + `brand_prefs` rows; kitchen from `kitchen_equipment` + `kitchen_notes`; etc.). The per-request lazy caches in `src/tools.ts` (`getPreferences`/`getOverlay`/`getOwnedEquipment`) become D1 queries. The matcher reads `brand_prefs` (`SELECT term, ranks WHERE tenant=?`).

### Decision: group ratings as a cross-tenant aggregate

`read_recipe_notes`' ratings half becomes `SELECT tenant, rating, status FROM overlay WHERE recipe=?` filtered to the caller's group (the tenant directory provides group membership; the query replaces reading each member's bundle). The "rated 4+ by others" signal is then computed over rows. The notes half still enumerates GitHub `notes/<slug>.toml` until slice 6, so `read_recipe_notes` is hybrid (D1 ratings + GitHub notes) after this slice.

### Decision: backfill reads the KV bundle, then deletes it

`migrations/0003-profile-d1.mjs` `up({ kv, d1, dataRoot, log })`: for each `profile:<username>` key, parse the TOML/markdown fields (the same coercion `json-profile-bundle`'s 0002 described, but into rows), `DELETE` the tenant's rows across the profile tables and INSERT fresh, then `kv.delete("profile:<username>")`. Idempotent: an absent KV key means already-migrated (D1 already authoritative), so skip. Reads the tenant list from the KV bundle keys (or the tenant directory). Session-state keys are untouched (slice 5).

## Risks / Open Questions

- **`read_user_profile` round-trips.** One KV get becomes a `batch` of `SELECT`s. D1 `batch` is one round-trip; at single-household scale this is comparable. If measured slow, a per-request assembly cache (already the pattern in `tools.ts`) covers it; no preemptive optimization.
- **Cross-tenant overlay read & privacy.** Group ratings read other tenants' overlay rows — already the case today (the KV scan did this); the D1 query is scoped to the caller's group via the tenant directory. No new exposure, but the query must apply the same group filter the scan did.
- **`rate_recipe` backend swap.** Slice 3 wrote the KV overlay via `applyOverlayEdit`; here it UPSERTs the `overlay` table. Keeping `rate_recipe`'s body behind a small `setOverlay(tenant, slug, {rating?,status?})` helper localizes the change.
- **`json-profile-bundle` archival.** Once this lands, `json-profile-bundle` is fully realized — archive it (and `finish-kv-migration`, already absorbed) so the change list reflects reality.
