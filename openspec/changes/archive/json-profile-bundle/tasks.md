## 1. Bundle types and KV helpers

- [ ] 1.1 In `src/user-kv.ts`, change `ProfileBundle` field types: `kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`, `preferences` become their structured object/array types; `taste` and `diet_principles` stay `string`. Update the file header comment (the bundle is "a JSON object of named structured fields", not "raw-content strings").
- [ ] 1.2 Confirm `readProfileBundle` / `writeProfileBundle` / `updateProfileField` need no logic change beyond types — they already `JSON.parse` / `JSON.stringify` the whole bundle. `updateProfileField` now stores objects, not strings.

## 2. Structured helpers drop TOML

- [ ] 2.1 `src/overlay.ts`: delete `parseOverlay`, `serializeOverlay`, `quoteKey`, `formatScalar`. Reads access `bundle.overlay` (an `Overlay` object) directly; `applyOverlayEdit` returns the object to store. Keep `mergeOverlay` / `applyOverlayEdit` / `DEFAULT_STATUS`.
- [ ] 2.2 `src/staples.ts`: `parseStaples` / `updateStaples` take and return `StaplesItem[]` (or the `{ items }` object) instead of TOML text; remove `parseToml`, `stringifyTomlWithHeader`, and `STAPLES_HEADER`.
- [ ] 2.3 `src/stockup.ts`: `addStockup` takes/returns the structured stockup object instead of TOML text; remove `parseToml`, `stringifyTomlWithHeader`, and `STOCKUP_HEADER`.
- [ ] 2.4 `src/kitchen.ts`: `toInventory` already takes a parsed object — confirm its caller passes `bundle.kitchen` directly (no `parseToml`).
- [ ] 2.5 `ready_to_eat` manager (`readyToEatManager` in `src/write-tools.ts` or its module): read from / serialize to a JSON object instead of TOML; `serialize()` returns the object (or null).
- [ ] 2.6 `src/serialize.ts`: delete `splitTomlHeader` and `stringifyTomlWithHeader`. Remove the file if nothing else lives in it; otherwise drop the now-unused `smol-toml` import. Keep `serializeMarkdown` / `stripEmptyVarietyDimensions` if still used by the recipe write path.

## 3. Read path: preferences as object

- [ ] 3.1 `src/tools.ts`: in `read_user_profile`, `read_preferences`, the weather location resolver, and the matcher wiring, read `bundle.preferences` as an object — delete every `parseToml(bundle.preferences, "preferences.toml")`. `read_preferences` `not_found` still keys off an absent/empty preferences object.
- [ ] 3.2 Verify `read_user_profile`'s returned shape is unchanged for the agent (it already returned parsed `preferences`); only the internal source changes from parse-on-read to direct object.

## 4. update_preferences → merge-patch

- [ ] 4.1 Add a pure `mergePatch(target, patch)` helper (RFC 7396: recursive object merge to arbitrary depth, `null` deletes a key, arrays/scalars replace). Unit-test it directly (deep nesting, null-delete, array replace, `custom` recursion).
- [ ] 4.2 Rewrite `update_preferences` in `src/write-tools.ts`: param becomes `patch: z.record(z.string(), z.unknown())` (object), not `content: string`. Apply staged validation — (1) reject any top-level patch key outside the defined set with a structured error pointing to `custom`; (2) `mergePatch` over the current preferences object; (3) validate the merged result's types; (4) store via `updateProfileField(..., "preferences", merged)`.
- [ ] 4.3 Add the structured `preferences` validator (defined-keys + types + `custom` object) to `src/validate.ts`; reuse it from both `update_preferences` and any write-time validation hook. Enums: `lunch_strategy ∈ {leftovers,buy,mixed}`, `ready_to_eat_default_action ∈ {opt-in,auto-add}`.

## 5. commit_changes drops config_updates

- [ ] 5.1 Remove the `config_updates` field from the `commit_changes` input schema and its handler block in `src/write-tools.ts`. Update the tool description (no more preferences/taste/diet/aliases batching — direct the agent to the standalone tools).
- [ ] 5.2 Grep for any internal caller / test referencing `config_updates`; update or remove.

## 6. Migration 0002 (hard cutover)

- [ ] 6.1 Add `migrations/0002-json-profile-bundle.mjs` (export `id`, `up({ kv, dataRoot, log })`): for each `profile:<username>` key, for each of the six fields still typed as a string, `parseToml` (markdown fields untouched) and replace with the structured value; reshape `preferences` into the `stores`/`brands`/`dietary`/`custom` layout, folding unrecognized top-level keys into `custom`. Write the bundle back. Idempotent: skip a field already object/array-typed.
- [ ] 6.2 Confirm `scripts/run-migrations.mjs` discovers `0002` by filename order and ledgers it in `migrations:applied` (no runner change expected — verify).
- [ ] 6.3 (Optional, implementer's call) Add a defensive guard in the read helpers: a profile field still typed as a string post-deploy is treated as empty rather than throwing, covering the deploy→migrate window. Note whether it is kept permanently or removed after first deploy.

## 7. Docs (same-pass, no drift)

- [ ] 7.1 `docs/SCHEMAS.md`: rewrite §preferences from the TOML block to the JSON schema (defined keys + `custom`); update the bundle field list (the `profile:<username>` description) from "raw TOML string" to JSON shapes for the six fields; document the merge-patch write contract and the brands tri-state under merge-patch.
- [ ] 7.2 `docs/TOOLS.md`: `update_preferences` param `content: string` → `patch: object` (merge-patch, null-deletes, custom-key rule); `commit_changes` loses `config_updates`.
- [ ] 7.3 `docs/ARCHITECTURE.md`: if it describes the bundle as TOML-string-valued, correct it to JSON (the determinism/data-model section).

## 8. Agent surface + plugin rebuild

- [ ] 8.1 `AGENT_INSTRUCTIONS.md`: update preference-write call sites to the patch shape; **delete** the `configure-grocery-profile` "read the current file first and write the complete content so a later write never clobbers the ZIP" instruction — the deep merge is the non-clobber guarantee. Each preference edit is now a minimal patch.
- [ ] 8.2 `npm run build:plugin` and commit the regenerated `plugin/` bundle (never hand-edit `plugin/`).

## 9. Tests

- [ ] 9.1 Unit-test `mergePatch` (task 4.1) and the staged `update_preferences` validation (unknown top-level key rejected; enum/type failures; brands tri-state via value/`[]`/`null`).
- [ ] 9.2 Update `test/write-tools.test.ts` and the staples/stockup/overlay/kitchen unit tests to the object-in/object-out helper shapes (no TOML text fixtures).
- [ ] 9.3 Add a migration test for `0002`: a TOML-string bundle migrates to structured JSON; a re-run is a no-op; a legacy flat-key `preferences` reshapes into `stores`/`brands`/`dietary`/`custom`.
