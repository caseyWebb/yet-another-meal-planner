## 1. Document the widget contract

- [x] 1.1 Add a bottom section to `docs/TOOLS.md` documenting `recipe_display_v0`, flagged as a **claude.ai built-in (not part of grocery-mcp)**: the `ingredients[]` / `steps[]` / top-level fields, the enum for `unit`, the countable-noun and seasoning-as-tsp rules, the 4-char zero-padded `id` convention, the `{ingredient_id}` interpolation rule, and the proportional-rescale behavioral contract.

## 2. Rewrite the cook skill in AGENT_INSTRUCTIONS.md

- [x] 2.1 Keep pre-flight conversational and explicit: identify dish(es); confirm equipment from `read_user_profile().kitchen` (`owned` + `notes`), asking only about genuinely-unknown gear and offering `update_kitchen` on volunteered equipment; gather; **pin the serving count**; check sufficiency against the pinned count with sub/scale-down/swap, restarting pre-flight on a swap.
- [x] 2.2 Add the card-build instructions (only when `recipe_display_v0` is available): build `ingredients[]` with amounts normalized to the pinned count (`base_servings` = that count), `unit` from the enum or omitted for countables (noun in `name`), seasonings as concrete tsp, 4-char zero-padded `id`s; build one interleaved `steps[]` for prep (incl. a preheat step at the right lead time) and cook (one logical action each), `{ingredient_id}` refs in `content`, `title` as header/timer label, comprehensive `timer_seconds` on every waiting step; keep shared main/side ingredients as separate disambiguated lines.
- [x] 2.3 Add the guard/degrade branch: emit the card when `recipe_display_v0` is exposed; otherwise fall back to the retained plain-text one-step-at-a-time walk with no card and no error.
- [x] 2.4 Add the mode offer after emit (tap-through-solo vs hands-free voice walk over the same steps, card stays on screen as reference).
- [x] 2.5 Specify voice-mode timer behavior: agent never starts/claims a timer; states the duration; does NOT ask the user to confirm it's set; speaks again only when the timer should be going off, unless there's interleaved work to pace meanwhile.
- [x] 2.6 Confirm the hand-off to the `cooked` flow on completion is preserved unchanged (dish carried over).
- [x] 2.7 Verify the `cook` flow marker stays core-only (no new `needs:` tier) and names no new MCP tool; re-check against the `consumer-facing-descriptions` standard (no internal filesystem paths/extensions).

## 3. Regenerate and validate

- [x] 3.1 Run `aubr build:plugin` (with `$GROCERY_MCP_URL` set) and confirm the regenerated `plugin/grocery-agent/` cook skill reflects the rewrite; do not hand-edit `plugin/`.
- [x] 3.2 Run `openspec validate "cook-recipe-display-widget"` and confirm it passes.
