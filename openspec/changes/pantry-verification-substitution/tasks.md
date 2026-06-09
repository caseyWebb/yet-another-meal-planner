## 1. Recipe-ingredient parser

- [x] 1.1 Add `parseRecipeIngredient(line)` (new module, e.g. `worker/src/recipe-ingredients.ts`) that strips trailing/leading prep descriptors, `(...)` parentheticals, and the `($x.xx)` price annotation, then calls `matching.ts`'s `normalizeIngredient()` for the quantity/unit strip + `aliases.toml` application
- [x] 1.2 Detect an `optional` marker (e.g. `(optional ...)`) and return it as a flag alongside the parsed name
- [x] 1.3 Add a helper to extract and parse the `## Ingredients` H2 section from a recipe body (reuse the existing markdown parsing in `parse.ts`)

## 2. Pantry matching core

- [x] 2.1 Implement exact normalized-name matching of a parsed ingredient against `pantry.toml` items → `in_pantry`, attaching `added_at`, `last_verified_at`, `days_since_verified`, `category`, `prepared_from`
- [x] 2.2 Implement the fuzzy/token-overlap candidate pass → `possible_matches` (candidate pairs only; never auto-promote to `in_pantry`, never silently drop to `not_in_pantry`)
- [x] 2.3 Compute `days_since_verified` from `last_verified_at` against the current date

## 3. verify tools

- [x] 3.1 Implement `verify_pantry_for_recipe(slug)` returning `in_pantry` / `possible_matches` / `not_in_pantry` / `optional` / `inventory_substitutes_available` (no `have_stale` bucket); route optional ingredients to `optional` and exclude them from `not_in_pantry`
- [x] 3.2 Implement `verify_pantry_for_candidates(slugs)`: aggregate + dedupe by parsed name, attach `for_recipes` to `not_in_pantry` / `possible_matches` / `inventory_substitutes_available`
- [x] 3.3 Wire `inventory_substitutes_available` to the substitution rule engine (section 4) in inventory mode
- [x] 3.4 Structured errors: `{ error: "not_found", slug }` for unknown slug; structured error when a recipe is missing its `## Ingredients` section; empty/comment-only pantry succeeds with all-required → `not_in_pantry`

## 4. propose_substitutions

- [x] 4.1 Implement the deterministic `substitutions.toml` rule engine returning `{ substitutes, unacceptable }`; empty/no-matching-rule → empty result (not an error)
- [x] 4.2 `inventory` mode: filter rule-acceptable substitutes to those present in `pantry.toml`
- [x] 4.3 `sale` mode: fetch Kroger flyer/price internally via kroger-integration, return rule-acceptable substitutes with `promo > 0`; structured error when the Kroger fetch fails (distinct from empty no-rules result)

## 5. Tool registration

- [x] 5.1 Register `verify_pantry_for_recipe`, `verify_pantry_for_candidates`, and `propose_substitutions` in `worker/src/tools.ts` with input schemas and descriptions matching `docs/TOOLS.md`
- [x] 5.2 Confirm `suggest_sequencing` remains unregistered (deferred to Change 13)

## 6. Tests

- [x] 6.1 Parser tests over real corpus lines, incl. prep/parenthetical/price stripping and `optional` detection
- [x] 6.2 Matching tests: exact → `in_pantry` with metadata; token-overlap → `possible_matches`; misleading overlap (`onion powder` vs `yellow onion`) not auto-matched
- [x] 6.3 verify tests: no `have_stale` bucket; presence-only (low item not netted); candidate aggregation + `for_recipes` attribution + dedupe; structured errors + empty-pantry resilience
- [x] 6.4 propose_substitutions tests (injected Kroger dep): rule application, inventory vs sale modes, sale self-fetch, dormant-empty result, sale-mode Kroger-failure propagation

## 7. Docs + orchestration

- [x] 7.1 Update `CLAUDE.md` menu-request orchestration: confirm `possible_matches`; ask before adding a missing `optional` ingredient to the order; suggest `aliases.toml` seeding on confirmed fuzzy matches; inventory-mode substitutions surfaced during the pantry pass, sale-mode held for the menu proposal; note sequencing arrives with Change 13
- [x] 7.2 Verify `docs/TOOLS.md` and `docs/PROJECT.md` match the implemented return shapes (reconciled `not_in_pantry` to `{ ingredient }` objects to match the implementation + aggregate `for_recipes`)

## 8. Deploy + verify

- [ ] 8.1 `wrangler dev` + MCP Inspector: `verify_pantry_for_recipe` on a real recipe returns the bucketed shape with age metadata; `propose_substitutions` returns empty against the unseeded `substitutions.toml`
- [ ] 8.2 Confirm CD deploy on push to `worker/**`; smoke `verify_pantry_for_candidates` against a small candidate set
