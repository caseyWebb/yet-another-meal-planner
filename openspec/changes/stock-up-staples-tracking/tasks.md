## 1. Schema and Docs

- [ ] 1.1 Add `staples.toml` schema section to `docs/SCHEMAS.md` (file format, `name` required, `perishable` optional, note it's per-tenant and independent of `stockup.toml`)
- [ ] 1.2 Add `read_staples` tool entry to `docs/TOOLS.md` (params, return shape, graceful-absent behavior)
- [ ] 1.3 Add `update_staples` tool entry to `docs/TOOLS.md` (add/remove params, dedup behavior, return shape)
- [ ] 1.4 Update `grocery_list.toml` notes in `docs/SCHEMAS.md` if needed to clarify `pantry_low` source is now staples-driven

## 2. Worker — read_staples tool

- [ ] 2.1 Implement `read_staples` handler in `src/` — reads `users/<username>/staples.toml`, returns `{ items: [] }` when absent (no error)
- [ ] 2.2 Register `read_staples` in the MCP tool registry
- [ ] 2.3 Add structural validation for `staples.toml` in `src/validate.ts` (name required string, perishable optional boolean)

## 3. Worker — update_staples tool

- [ ] 3.1 Implement `update_staples` handler — accepts `{ add?: [{ name, perishable? }], remove?: string[] }`, deduped by normalized name
- [ ] 3.2 Wire through the atomic commit engine targeting `users/<username>/staples.toml`
- [ ] 3.3 Return `{ added, removed, commit_sha }` (commit_sha null when nothing changed)
- [ ] 3.4 Register `update_staples` in the MCP tool registry

## 4. Agent Instructions — pantry update flow

- [ ] 4.1 Update the `update-pantry` skill in `AGENT_INSTRUCTIONS.md`: after recording a depletion, cross-reference against staples; if staple → ask "want me to add it to the shopping list?"; if not staple → silent
- [ ] 4.2 Ensure the flow degrades gracefully when `staples.toml` is absent (no extra tool call needed if `read_staples` is already loaded; otherwise load it lazily)

## 5. Agent Instructions — meal plan / shopping list flow

- [ ] 5.1 Add `read_staples()` to the menu-request context pre-pass parallel batch in `AGENT_INSTRUCTIONS.md`
- [ ] 5.2 Update the restocking callout step to cross-reference staples list against pantry (missing or low staples → surface in callout, confirm before adding)
- [ ] 5.3 Add perishable-staleness nudge step: for perishable staples with stale/absent `last_verified_at`, batch into one prompt before finalizing the list
- [ ] 5.4 Ensure fallback behavior is documented: no `staples.toml` → model-judgment restocking callout (existing behavior)

## 6. Agent Instructions — onboarding

- [ ] 6.1 Add optional staples-seeding area to the `configure-grocery-profile` skill in `AGENT_INSTRUCTIONS.md`: ask which items the member never wants to run out of, whether each is perishable, persist via `update_staples`
- [ ] 6.2 Mark the area skippable; note absent staples list degrades gracefully

## 7. Plugin rebuild

- [ ] 7.1 Run `npm run build:plugin` to regenerate `plugin/` from updated `AGENT_INSTRUCTIONS.md`
- [ ] 7.2 Verify the generated plugin reflects the pantry update, meal plan, and onboarding flow changes
