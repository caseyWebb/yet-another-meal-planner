## Why

The `profile:<username>` KV bundle is a JSON envelope whose field *values* are raw TOML (and markdown) strings — a verbatim fossil of the `unified-user-profile-kv` lift-and-shift, which moved each tenant's GitHub `*.toml` files into KV without re-examining their inner format. On every read the Worker does a TOML decode *inside* the JSON decode (`parseToml(bundle.staples)`, `parseOverlay(bundle.overlay)`, …); on every write it re-serializes to TOML and re-attaches a documentation header comment that **no human will ever read**, because these files no longer live in GitHub.

TOML was chosen originally for human editability of GitHub-tracked data. That rationale is moot for KV blobs: they are machine read/written only, never hand-edited (confirmed: no operator hand-editing path). The session-state keys (`state:<username>:pantry|meal_plan|grocery_list`) and the recipe index (`index:recipes`) are already native JSON. This change finishes the job for the profile bundle.

`preferences` is the one bundle field with real server-consumed structure (the Kroger matcher reads `[brands]`; weather reads `[stores]`/`location_zip`) yet the weakest write contract — the agent ships a whole TOML string, verbatim. Making it native JSON lets us give it a typed top-level schema plus an open `custom` object and replace whole-file-overwrite with a deep merge-patch.

## What Changes

- Six profile bundle fields move from **raw TOML strings → native JSON** values inside the `profile:<username>` object: `kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`, `preferences`. The two markdown fields (`taste`, `diet_principles`) stay JSON strings — they are prose, not records.
- **BREAKING** `update_preferences(content: string)` → `update_preferences(patch: object)`. The whole-file-overwrite verbatim string is replaced by a **JSON Merge Patch** (RFC 7396 semantics): arbitrarily-deep recursive object merge, a `null` value deletes a key, arrays replace wholesale. Applied atomically with staged validation.
- `preferences` gains a **defined top-level schema** (`default_cooking_nights`, `lunch_strategy`, `ready_to_eat_default_action`, `stores`, `brands`, `dietary`) plus a `custom` object for arbitrary agent-added keys. An unknown top-level patch key is a structured error directing it under `custom`.
- **BREAKING** `commit_changes` drops `config_updates` entirely — it is fully redundant with the standalone `update_preferences` / `update_taste` / `update_diet_principles` / `update_aliases` tools.
- The TOML comment-header-preservation machinery is **deleted**: `stringifyTomlWithHeader`, `splitTomlHeader` (`src/serialize.ts`), the `STAPLES_HEADER` / `STOCKUP_HEADER` blocks, and the hand-rolled `serializeOverlay` / `quoteKey` / `formatScalar` (`src/overlay.ts`). The structured helpers operate on objects directly.
- Hard cutover: migration **`0002-json-profile-bundle.mjs`** re-parses every existing tenant's six fields from TOML strings into JSON values in place. No dual-shape reads — post-migration the Worker assumes JSON.
- `smol-toml` stays a dependency (the shared GitHub corpus — recipes, stores, aliases, discovery files, `cooking_log.toml` — is still TOML); it is simply no longer on the KV read/write path.

## Capabilities

### Modified Capabilities

- `data-write-tools`: `update_preferences` becomes a merge-patch tool over structured JSON; `commit_changes` drops `config_updates`; the structured profile-write tools (`update_staples`, `update_stockup`, `update_kitchen`, `update_ready_to_eat`, recipe overlay rating/status) persist JSON objects into the bundle rather than serializing TOML strings.
- `data-read-tools`: `read_user_profile` and `read_preferences` return the `preferences` object directly from the bundle (no `parseToml`); profile bundle field values are JSON, parsed only by the outer `JSON.parse`.

## Impact

- `src/user-kv.ts`: `ProfileBundle` field types change from `string` to structured object/array types for the six fields; `taste`/`diet_principles` stay `string`.
- `src/serialize.ts`: delete `splitTomlHeader` / `stringifyTomlWithHeader` (and the file if nothing else remains).
- `src/overlay.ts`: drop `parseOverlay` (read becomes a plain object access) and `serializeOverlay`/`quoteKey`/`formatScalar`; `applyOverlayEdit`/`mergeOverlay` stay.
- `src/staples.ts`, `src/stockup.ts`, `src/kitchen.ts`: helpers take/return objects; drop `parseToml` calls and `*_HEADER` constants.
- `src/write-tools.ts`: rewrite `update_preferences` as merge-patch; remove `config_updates` from `commit_changes`; overlay/ready_to_eat/staples/stockup write paths store objects.
- `src/tools.ts`: `read_user_profile` / `read_preferences` / weather / matcher wiring read `bundle.preferences` as an object (drop `parseToml(..., "preferences.toml")`).
- `src/validate.ts`: write-time validation of the structured `preferences` shape (enums, `brands` map, `stores` strings, `custom` object) on the merged result.
- `migrations/0002-json-profile-bundle.mjs`: new; TOML→JSON coercion of the six fields per tenant, idempotent.
- `docs/SCHEMAS.md`: rewrite §preferences (TOML → JSON, defined keys + `custom`) and the bundle field list (lines ~12, ~281–319) from "raw TOML string" to JSON shapes; note the merge-patch write contract.
- `docs/TOOLS.md`: `update_preferences` param change (string → patch object); `commit_changes` loses `config_updates`.
- `AGENT_INSTRUCTIONS.md` + `plugin/` rebuild: the `configure-grocery-profile` flow no longer needs the "read the whole file and rewrite every field so a later write doesn't clobber the ZIP" instruction — the deep merge is the non-clobber guarantee. Update preference-write call sites; rebuild the plugin bundle.
