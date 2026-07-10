# Story 06 — Dual-use widgets (member app + MCP Apps)

**Decision (operator steer, 2026-07-10):** the standalone widgets in the design bundle —
Meal Planning, Grocery List, Order Review, Recipe Card, RecipeRow — are dual-use. Each
renders (a) as a component inside the member SPA and (b) as an **MCP App**: an
interactive UI resource surfaced inside a Claude conversation by a yamp tool (the
existing `meal-plan-widget` and `recipe-card-widget` specs are the precedent). One
component, two hosts.

## 1. The hosting model

- **One implementation** per widget (packages/ui or a widgets package), with the data
  plumbing abstracted per host:
  - *Member app host*: props fed from `/api` via TanStack Query; mutations are the
    normal registered mutations (offline-queue rules apply).
  - *MCP App host*: initial data arrives from the tool result that spawned the widget;
    mutations go through the MCP Apps host bridge (tool calls / messages), online-only.
- The mockup demonstrates the pattern: the propose page embeds the Meal Planning widget
  (`embedded`, `session-key`, `on-commit`, `on-open-recipe` props); the grocery page is
  the Grocery List widget plus a page header; the Order Review widget is the order modal.
- Widget→surface mapping: Meal Planning ↔ propose page / `propose_meal_plan`;
  Grocery List ↔ grocery page / grocery display tooling; Order Review ↔ order flow /
  `place_order` preview; Recipe Card ↔ `display_recipe` + guided cook (`guided-cook`
  spec); RecipeRow ↔ shared row primitive in lists.

## 2. Agent-context consistency (the critical requirement)

**In the MCP App host, every mutating interaction MUST send updated context back to the
agent via the correct MCP Apps protocol** — the agent's model of the plan/list/order has
to stay internally consistent with what the user did in the widget. A silent backend
write that the agent never sees is a state-divergence bug, not a feature.

Concretely, per widget:

- **Meal Planning**: swaps, facet pins, vibe overrides, sides edits, stepper changes, and
  above all **commit** must reach the agent as context ("user committed 3 dinners:
  X, Y, Z with these sides"), not just mutate D1. The conversation continues from the
  committed plan.
- **Grocery List**: check-offs, adds/removes, pantry-coverage decisions (Still good / Buy
  anyway), substitution swaps ("using linguine, spaghetti dropped") — the agent must be
  able to reference the current list state after the user touches the widget.
- **Order Review**: skips, qty changes, brand decisions, save-preferred-brand, unavailable
  resolutions, and the final send outcome (what was carted, what was left off).
- **Recipe Card**: log-cooked (with backdate), favorite toggles, cook-mode completion
  ("plated up") — these feed the cooking log and overlay the agent reasons over.

Design rule for proposals: for every widget interaction, specify (1) the backend write it
performs, (2) the context update the agent receives, and (3) which of the two is the
source of truth on conflict. Interactions with no agent-visible effect must be explicitly
justified (pure view state like collapsing a section).

## 3. Consequences

- The Worker's MCP layer needs the widgets served as MCP App resources with their tool
  wiring (which tools return which widget, with what initial payload).
- Widget bundles must be self-contained per MCP Apps constraints (CSP, no external
  fetches beyond the sanctioned bridge) — same constraint family the member PWA already
  respects.
- Versioning: a widget shipped into conversations must tolerate payloads from an older
  Worker (contract-versioned props, like the satellite contract).
- Testing: widget behavior gets covered once at the component level plus a thin
  host-adapter test per host (`app-ui-testing` gates the member host; the MCP host needs
  an equivalent harness — likely fixture-driven).

## 4. Open questions

1. Which MCP Apps protocol surface do we target (tool-call round trips from the iframe,
   host-mediated messages, resource re-fetch), and what does Claude.ai support today?
   Needs a spike against the current MCP Apps SDK before the first widget change.
2. Granularity of context updates: per-interaction (chatty) vs debounced summary on
   settle vs explicit "Done" handoff. Recommend: micro-writes silently, one consolidated
   context update at interaction boundaries (commit / send / close).
3. Do MCP App widgets share the member session (cookie) or ride the MCP OAuth grant for
   writes? (Grant is per-member already — likely the answer.)
4. Offline: member-app host queues class-b writes; MCP App host is online-only — confirm
   no widget depends on queued semantics.
