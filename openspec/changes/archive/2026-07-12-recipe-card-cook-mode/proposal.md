## Why

The recipe-card widget is read-only, and the conversation has two competing cooking cards: the
built-in `recipe_display_v0` (guided cook's dependency) and the bespoke `display_recipe` card. D4
requires cook-mode completion, log-cooked, and favorite to reach the agent through the MCP Apps
bridge — a channel `recipe_display_v0` does not have. D32 (ratified) resolves this: the dual-use
Recipe Card, with cook mode included, becomes the ONE conversation cooking card once body
annotations land, and its read-only justification (no structured step data) is obsoleted by the
annotation contract.

This change converts the Recipe Card from read-only to a WRITING widget (the second dual-use
writing widget after plan-your-week) and folds guided cook onto it.

## What Changes

- **`CookModeData` on the contract (D32/Q1)**: `RecipeCardData` gains an ADDITIVE optional `cook`
  block — `{ base_servings?, ingredients[{id,text,group?}], steps[{title?,content,timer_seconds?}] }`.
  `KNOWN_RECIPE_CONTRACT_VERSION` bumps 1 → 2 (additive within the major). `ProposeCardData` stays at
  1 (versioned independently). The satellite version gate bumps `0.1.16` → `0.1.17`.
- **One shared cook-mode surface (D20)**: a shared `<CookMode>` step machine (browse → mise → step →
  done, check-offs + per-step timers, all client-local ephemeral state) and a shared `useCookController`
  driving the favorite/log writes, consumed identically by the member recipe page and the in-chat
  widget. A pure `parseCookBody` derives `CookModeData` from `body` client-side; the component PREFERS
  a skill-supplied `cook` block, so every card is cook-capable with no interim dual-card state (Q2).
- **The widget performs its writes (D18)**: favorite tap → `toggle_favorite` + `ui/update-model-context`
  (full-state snapshot, no message); log cooked → `log_cooked` + `ui/update-model-context` + `ui/message`;
  cook completion → `ui/message` only. The worker tools are throw-free, so a resolved `isError` is a
  failure (no false context/message); the writes are idempotent/additive, so no server-side version
  guard is needed — but boot re-hydrate IS (D19).
- **Boot re-hydrate + contract-version gate (D19)**: the widget re-reads `favorite` via `read_recipe`
  before enabling writes; a bridge-unavailable / failed re-hydrate renders read-only. An unknown-newer
  `contract_version` degrades to the plain card with no cook entry.
- **Serving-scale deferred (Q4)** and **voice = painted-door (D5/Q3)**: no serving-scale UI even when
  `base_servings` is present; the "Hands-Free Voice Mode" entry is a `ui/message` handoff (widget) /
  `/cook` deep link (member), with no native voice engine.
- **Guided cook folds onto `display_recipe` (D32)**: the `cook` skill emits `display_recipe`'s widget
  on an MCP-Apps host (dropping the `recipe_display_v0` dependency) and reconciles the two structured
  step paths onto `CookModeData`, keeping the conversational pre-flight, the plain-text fallback,
  user-owned timers, and the cooked-flow handoff.

## Capabilities

### Modified Capabilities

- `recipe-card-widget`: the read-only rendering requirement is replaced by guided cook mode, the D18
  favorite/log writes, and the D19 re-hydrate + contract-version gate; serving-scale is explicitly
  deferred.
- `guided-cook`: the emit target moves from `recipe_display_v0` to `display_recipe`'s cook-mode card
  (keyed on the host rendering MCP Apps), reconciling the structured-step paths onto `CookModeData`;
  the pre-flight, text-walk fallback, user-owned timers, and cooked handoff are unchanged.
- `member-app-core`: the recipe-detail requirement gains an in-app Start Cooking entry that mounts the
  same shared cook-mode component, alongside the existing Cook-with-Claude deep link.
