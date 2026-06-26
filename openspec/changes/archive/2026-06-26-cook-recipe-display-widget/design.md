## Context

The guided `cook` flow (`AGENT_INSTRUCTIONS.md`, `### Guided cook`) is a text-only mise-en-place: equipment → gather + sufficiency → prep → cook, paced one logical step at a time, then hand off to `cooked`. It is core-only (no `needs:` tier) and references no MCP tool — it is pure persona prose. The `meal-planning` spec's "Plan and cook modes" requirement originally **deferred** the full hands-free walkthrough to "a later Guided cook mode change"; the flow landed in the instructions without ever getting its own spec, so this change is also the moment it gets one.

Claude.ai now exposes `recipe_display_v0`, a built-in widget that renders a scalable ingredient list and a tappable, timer-bearing step list. It is **harness-provided, not part of grocery-mcp** — it appears in the agent's tool set only where the harness exposes it, and is invisible to the Worker. The whole change is therefore confined to persona prose plus one doc note plus a plugin rebuild; there is no Worker, MCP, D1, or migration work.

The widget's contract (provided by the maintainer, recorded verbatim in `docs/TOOLS.md`):
- `ingredients[]`: `{ id (4-char zero-padded string), amount (number at base servings), name, unit? (g|kg|ml|l|tsp|tbsp|cup|fl_oz|oz|lb|pinch) }`. Countable items omit `unit` and fold the counting noun into `name` ("garlic cloves"); seasonings use a concrete `tsp` amount.
- `steps[]`: `{ id, title (step header + timer label), content (refs ingredients as `{ingredient_id}`), timer_seconds? }`. A timer is included on any waiting step, omitted only on active hands-on steps.
- `title` (required); `base_servings` (int, default 4), `description?`, `notes?` (optional).
- Behavioral contract: the widget rescales all amounts proportionally with servings, which only works if `amount` is the quantity at `base_servings` and step text uses `{ingredient_id}` refs rather than hardcoded numbers.

## Goals / Non-Goals

**Goals:**
- Scaffold the prep + cook half of the walkthrough with `recipe_display_v0` while keeping pre-flight conversational.
- Offer card-tap-solo or a voice walk over the same steps.
- Degrade cleanly to the existing text walk wherever the widget is absent.
- Bring the guided-cook flow under an OpenSpec capability for the first time.

**Non-Goals:**
- Any Worker/MCP/D1 change, or exposing `recipe_display_v0` through the MCP — it stays a harness built-in.
- Agent-driven timers (#87). The agent never starts a timer in either mode.
- Changing the `cooked` flow, the hand-off, or `last_cooked` semantics.
- Moving pre-flight (equipment/gather/sufficiency) into the card.

## Decisions

**1. Pre-flight stays conversational; the card covers prep + cook only.** Pre-flight is the catch-a-shortfall-before-the-pan-is-hot phase — it reads the kitchen, offers subs/scale-down/swap, and restarts on a swap. A static card can do none of that. So the boundary is firm: equipment, gather, pin-servings, and sufficiency happen in conversation; the card begins at prep. *Alternative considered:* put ingredients into the card and check sufficiency there. Rejected — the card can't branch or restart, and a shortfall surfaced inside a card the user is already tapping through is exactly the mid-cook surprise the flow exists to prevent.

**2. Pin the serving count in pre-flight; the card's scaler is measure-convenience, not a re-plan.** The sufficiency check is meaningless without a count, so the flow pins one conversationally and checks against it, then builds the card with `base_servings` = that count and amounts normalized to it. The widget's scaler still works (the user can scale for display/measure), but scaling *up* past the checked count is the user's call — the sufficiency verdict is explicitly tied to the pinned number. *Alternative:* re-run sufficiency on every scaler change. Rejected — the scaler lives in the card with no path back into the conversational sub/swap logic; coupling them would mean the card driving a conversational restart, which it can't.

**3. The single card scaler scales the whole interleaved meal together.** A main + sides fold into one card with one `base_servings` and one scaler. Scaling to N scales main and sides together — which is the desired "cooking for N tonight" behavior. Shared ingredients are kept as **separate disambiguated lines** ("onion, for the stew" / "onion, for the slaw") rather than merged, because separate lines read better for mise and avoid implying a single combined prep. *Alternative:* merge shared ingredients into one summed line. Rejected — loses the per-dish mise clarity for marginal compactness.

**4. Guard on tool presence; the text walk is the fallback branch.** The skill checks whether `recipe_display_v0` is in the exposed tool set. Present → emit the card. Absent → today's plain-text one-step-at-a-time walk, no card, no error. This is the one genuinely new mechanic, and it means the existing text walk is **retained, not deleted** — it becomes the `else` branch. *Alternative:* assume the widget is always present. Rejected — the issue is explicit that the skill must not break wherever the widget is absent.

**5. Timers are comprehensive and always user-initiated.** Per the widget contract, `timer_seconds` goes on every waiting step (cook/bake/rest/marinate/chill/simmer/preheat), omitted only on active hands-on steps — broader than "stovetop cook times." The agent never *starts* a timer: in card-tap mode the user taps the step's native timer; in voice mode the user sets their own. Voice nuance: state the duration, **don't** ask the user to confirm it's set, and speak again only when it should be going off — unless there's interleaved work to pace meanwhile. #87 (voice-mode timer control) is a no-op here.

**6. New `guided-cook` capability rather than a `meal-planning` delta.** The living flow has no spec; `meal-planning` only mentions it to defer it. A new capability cleanly captures the whole guided walkthrough. The `meal-planning` "Plan and cook modes" requirement governs the minimal cook-capture (the `cooked` flow) and needs no edit — its deferral clause is historical scoping for an archived change, fulfilled (not contradicted) by this one.

## Risks / Trade-offs

- **The widget contract lives outside this repo.** → Recorded verbatim in `docs/TOOLS.md` and flagged as a claude.ai built-in, so a future schema drift has a single documented anchor to reconcile against rather than being buried only in the skill prose.
- **Scale-after-check staleness.** A user who scales the card *up* past the pinned, sufficiency-checked count could exceed what's on hand with no re-warning. → Mitigated by pinning the count in pre-flight (the default card view is the checked one) and by framing the scaler as measure-convenience; accepted as a small, user-initiated risk rather than coupling the card back into conversational re-planning.
- **Preheat lead time is soft in a tap-through card.** The preheat step sits at the right position, but a user tapping fast/slow controls real pacing. → Inherent to user-paced tap-through; the lead-time placement is best-effort and the same preheat guidance carries in the voice walk where the agent paces.
- **Plugin build gate.** `aubr build:plugin` refuses the placeholder connector URL, so the regen needs `$GROCERY_MCP_URL` set. → Standard for any instructions change; called out in tasks.

## Migration Plan

No runtime migration. Edit `AGENT_INSTRUCTIONS.md`, add the `docs/TOOLS.md` note, run `aubr build:plugin` to regenerate `plugin/`, and let the normal `main` merge publish the plugin. Rollback is a revert of the prose + regenerated bundle; nothing stateful changes.

## Open Questions

None outstanding — the widget schema, the conversational/card boundary, the scaler semantics, the timer behavior, and the #87 no-op were all settled during exploration.
