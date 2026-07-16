## Why

The persona grew with the author — an LLM power user — as its audience: 639 lines, 17 skills, four persona tiers, tool-choreography prose, deprecation lore, and a 10-step onboarding interrogation. The audience is now non-LLM household members. They don't know what to ask for, they should never hear machinery words ("vibe", "corpus", "slug"), and they won't perform profile maintenance through chat ceremonies. Meanwhile the tool surface underneath the persona has been rebuilt: `narrow-mcp-surface` shrinks ~84 advertised tools to ~28 (fused ops, widgets-as-canonical, profile-gated registration, a server-computed `attention` block) and `remove-ready-to-eat` rips the ready-to-eat infrastructure. Every skill references tools by name, so the persona must be rewritten against the final surface — and a rewrite is the right moment to change its posture, not just its tool names.

Three posture changes, all user-ratified:

1. **Terse voice, zero jargon.** Short plain responses, no flourish, no tool-call narration; machinery nouns never surface in chat.
2. **Silent learning** (inverts the current "suggest, never write" rule). Observed patterns — taste leans, rhythms worth keeping, substitution stances, equipment — are captured as they happen, without announcement or confirmation. The member web app profile page is the transparency surface, not chat ceremonies. One hard boundary: dietary restrictions and allergies write only from explicit user statements, never inferred, never silently relaxed.
3. **Proactive hand-holding.** One light nudge per session at a natural moment (driven by `read_user_profile`'s `attention` block), and the agent offers the next step in the plan → shop → cook loop, because members don't know what to ask for.

## What Changes

- **New `packages/plugin` workspace package owns the persona source and its generator.** `AGENT_INSTRUCTIONS.md` living in `packages/worker/` is a pre-monorepo artifact: the persona is the source of the *distributed plugin*, not a Worker asset. This change relocates `packages/worker/AGENT_INSTRUCTIONS.md` → `packages/plugin/AGENT_INSTRUCTIONS.md`, `packages/worker/scripts/build-plugin.mjs` → `packages/plugin/scripts/build-plugin.mjs`, and `packages/worker/tests/build-plugin.test.mjs` → `packages/plugin/tests/build-plugin.test.mjs`, with the root `build:plugin` script, CI's plugin-build check and deploy-relevance path filter, and the data-deploy build step re-pointed. The rewritten persona is authored at the new location.
- **`AGENT_INSTRUCTIONS.md` rewritten from scratch** (at `packages/plugin/`) — target well under half the current 639 lines. Single `core` persona tier (the `cart`/`corpus`/`discovery` depth tiers dissolve); the build's tier/skill marker grammar is unchanged, so `build-plugin.mjs` needs no logic change (relocation only).
- **BREAKING — Skills 17 → 6**: `plan`, `shop`, `cook`, `pantry`, `setup`, `report-bug`. Eleven skills disappear as installable entries:
  - `meal-plan` + `recipe-sides` + `grocery-sale-check` → **`plan`** (sides ladder and sale-steering absorbed).
  - `shop-groceries` → **`shop`** (all six flush branches + the sale check).
  - `cook` + `cooked` + `cooking-retrospective`'s cook-capture seams → **`cook`** (the walkthrough ends by logging; a reported completed meal is the same skill).
  - `update-pantry` → **`pantry`** (keeps its own skill; gains the kitchen-equipment ops folded into `update_pantry`).
  - `configure-yamp-profile` → **`setup`** (slims to store/ZIP, hard diet gates, rough cooking rhythm; everything else learns ambiently).
  - `report-yamp-bug` → **`report-bug`** (unchanged in substance).
  - `import-recipe`, `add-recipe-feedback`, `add-recipe-note`, `cooking-retrospective` (the summary ask), and vibe/palette capture become **core-persona behaviors** (a few lines each), not skills.
  - `save-technique`, `save-buying-guide`, `merge-duplicate-recipes`, `add-ready-to-eat-feedback` are **removed** (member guidance writes and merge review left the member surface in `narrow-mcp-surface`; ready-to-eat is ripped in `remove-ready-to-eat`).
- **BREAKING — Silent-learning posture** replaces "suggest, never write" for profile-learning writes (`update_taste` append, `add_meal_vibe`, substitution stances, equipment observations). Action confirmation is **unchanged** for consequential actions: orders, substitutions on an order, plan agreement, agent-proposed corpus imports.
- **Framing rewrite**: store-agnostic shopping (the list is store-agnostic; the flush picks the mode — never "fill my Kroger cart"), subscription cookbook ("your cookbook grows from sources you trust" — "cookbook" is the member-facing term for the shared collection), widgets as how members see things (`display_*` canonical for any "show me"), graceful degradation by tool **presence** (a non-Kroger household simply has no Kroger tools). Deprecation-shim lore and the agent-side import-classification rubric do not carry over.
- **Onboarding slims** to minimum viable: store/ZIP, hard diet gates, rough rhythm — then start planning. The thorough first-run inventory, bulk-buy watchlist, and discovery-source seeding areas dissolve (web app / admin / ambient learning own them).
- **Plugin regenerated and published** (`aubr build:plugin`); the real-doc contract test in `packages/worker/tests/build-plugin.test.mjs` updates to the new 6-flow census. The operator deploy (in the data repo) publishes the bundle Worker-first as usual.

## Capabilities

### New Capabilities

- `ambient-preference-learning` — the durable behavioral contract for silent learning: what is captured silently, the explicit-statement-only hard gate for dietary restrictions/allergies, the no-machinery-jargon rule for member-facing chat, the one-nudge-per-session `attention` behavior, and the member-web-app-profile-page-as-transparency-surface principle.

### Modified Capabilities

- `agent-plugin-distribution` — the canonical source and generator move to `packages/plugin/`; single `core` persona tier (depth tiers become optional, none shipped); six workflow skills.
- `repo-structure` — the workspace census gains the `packages/plugin` package; the persona source's defined location becomes `packages/plugin/AGENT_INSTRUCTIONS.md` (the spec's stated repo-root location is already stale).
- `guided-onboarding` — `configure-yamp-profile` becomes the slimmed `setup` skill; inventory, bulk-buy watchlist, and discovery-source seeding requirements removed; the browse surface is the member web app.
- `guided-cook` — the `cooked` flow dissolves into `cook`; completion logs in-flow instead of handing off; pre-flight equipment saves route through `update_pantry`'s kitchen ops.
- `recipe-sides` — the standalone flow and the import-recipe handoff are removed; the side-resolution ladder and its propose-then-confirm gate re-home into the `plan` skill; plating-edge (`pairs_with`) authorship pauses with `update_recipe`'s removal.
- `agent-bug-reporting` — the skill renames `report-yamp-bug` → `report-bug`; behavior unchanged. (The cooking-techniques / purchasing-guidance capture-flow requirement removals ride `narrow-mcp-surface`'s deltas — this change only removes the corresponding skills from the persona source.)

## Impact

- **Depends on `narrow-mcp-surface` and `remove-ready-to-eat` landing first.** The new persona is written against the post-cull tool surface (fused `import_recipe`, `update_pantry` kitchen ops, `set_recipe_disposition`, `flyer`, the `attention` block, `update_taste` append semantics, no RTE tools) — skills reference tools by name, so implementation cannot start until changes 1+2 are merged. Spec deltas here are authored against the intended post-1+2 state; a reconcile pass against the archived specs of changes 1+2 is a task before apply.
- Files: new `packages/plugin/` package (`package.json` + the three relocated files; `AGENT_INSTRUCTIONS.md` fully rewritten, `build-plugin.test.mjs` real-doc census updated, `build-plugin.mjs` moved without logic changes); root `package.json` scripts (`build:plugin`, `test:tooling` coverage of the moved tests); `.github/workflows/ci.yml` (plugin-build job's `working-directory`, deploy-relevance path filter naming the old paths); `.github/workflows/data-deploy.yml` (the `_code/packages/worker/scripts/build-plugin.mjs` invocation); `.github/pull_request_template.md` (generated-plugin checkbox wording, if path-specific); `packages/worker/scripts/build-vault.mjs` (header-comment reference) and `packages/worker/src/write-tools.ts:589` (comment reference); docs lockstep wherever the old path or skill census appears (`AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/SELF_HOSTING.md`).
- **No Worker runtime, web-app, or MCP-Apps changes.** All tool behavior ships in changes 1+2; the Worker package only loses its plugin-build tooling (the vault builder stays in `packages/worker`).
- **Plugin distribution**: installed members receive the new skills via the marketplace auto-update on the next data-repo publish; the deploy's Worker-first ordering already guarantees no published skill references an undeployed tool. Uninstalled/stale bundles hard-error on removed tools — that breakage window is accepted and owned by `narrow-mcp-surface`'s posture; this change only shortens it by publishing promptly.
- Specs whose text incidentally names old flow labels (e.g. "the meal-plan flow") in scenarios of unmodified requirements keep their contracts; only requirements whose behavior changes carry deltas here.
