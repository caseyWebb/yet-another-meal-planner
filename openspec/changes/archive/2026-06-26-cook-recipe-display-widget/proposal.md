## Why

The guided `cook` flow walks the user through a dish text-only, one step at a time — fine for voice, but it gives no on-screen scaffold (no ingredient list that rescales, no per-step timers, no measure reference). Claude.ai now exposes a `recipe_display_v0` widget purpose-built for this. Reworking `cook` to emit that card — with an optional hands-free voice layer over the same steps — turns the walkthrough into a glanceable, scalable cook surface while preserving the conversational pre-flight that actually catches problems before the pan is hot.

## What Changes

- Rework the `cook` skill in `AGENT_INSTRUCTIONS.md` so the **prep + cook** half of the walkthrough is scaffolded by the `recipe_display_v0` widget instead of paced purely as text.
- Keep **pre-flight conversational and unchanged in spirit**: identify dish(es), confirm equipment (`read_kitchen`), gather, **pin the serving count**, and check sufficiency against that count — offering subs/scale-down/swap (with a restart on a swap). Deliberately NOT moved into the card: a static card cannot read the kitchen, offer a sub, or restart.
- Build the card from the recipe(s): `ingredients[]` with amounts normalized to the pinned serving count (so `base_servings` = that count), and an interleaved `steps[]` covering prep (including a preheat step at the right lead time) and cook (one logical action each), using `{ingredient_id}` interpolation and comprehensive `timer_seconds` on every waiting step.
- Offer the mode after emit: **tap through the card solo**, or a **hands-free voice walk** over the same steps with the card on screen as reference.
- **Guard the emit and degrade gracefully**: `recipe_display_v0` is a Claude.ai built-in, not an MCP tool, so when it is not in the exposed tool set the skill SHALL fall back to today's plain-text one-step-at-a-time walk. The text walk is retained as the fallback branch, not deleted.
- Voice mode defers timers to the user (the agent never starts a timer and does not ask the user to confirm a timer is set — it only speaks again when the timer should be going off, unless there is interleaved work to pace meanwhile). The companion voice-timer-control seam (#87) is a no-op for this change.
- Hand off to the `cooked` flow on completion — unchanged.
- Document the `recipe_display_v0` contract at the bottom of `docs/TOOLS.md`, flagged as a claude.ai built-in (not part of the grocery-mcp).

## Capabilities

### New Capabilities

- `guided-cook`: The hands-free guided cook walkthrough — pre-flight (equipment, gather, pin servings, sufficiency check with sub/scale/swap), the `recipe_display_v0` card that scaffolds prep + cook, the card-vs-voice mode offer, the harness-widget guard/degrade path, voice-mode timer behavior, and hand-off to the cooked flow. This flow lives in `AGENT_INSTRUCTIONS.md` today but has never had its own spec (the `meal-planning` spec explicitly deferred it); this change brings it under contract and adds the widget scaffolding.

### Modified Capabilities

<!-- None. The meal-planning spec's "Plan and cook modes" requirement deferred the guided walkthrough to "a later Guided cook mode change"; that deferral is fulfilled here by the new guided-cook capability, but the meal-planning requirement (which governs the minimal cook-capture / cooked flow) needs no requirement change. -->

## Impact

- **`AGENT_INSTRUCTIONS.md`** — the `cook` skill section is rewritten (pre-flight conversational, card-scaffolded prep+cook, mode offer, guard/degrade, voice timers). The `cooked` flow and its hand-off are untouched. The skill stays core-only (no new `needs:` tier) and references no new MCP tool.
- **`docs/TOOLS.md`** — new bottom section documenting the `recipe_display_v0` widget contract as a claude.ai built-in.
- **`plugin/`** — regenerated via `aubr build:plugin` (requires `$GROCERY_MCP_URL`); the `cook` skill body changes. Never hand-edited.
- **No Worker / MCP / D1 changes** — `recipe_display_v0` is harness-provided; no tool, schema, or migration is added.
- **Companion**: #87 (voice-mode timer control) remains a future seam; this change documents the user-owns-timers behavior rather than depending on it.
