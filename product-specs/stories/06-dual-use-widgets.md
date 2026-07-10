# Story 06 — Dual-use widgets (member app + MCP Apps)

**Decision (operator steer, 2026-07-10):** the standalone widgets in the design bundle —
Meal Planning, Grocery List, Order Review, Recipe Card, RecipeRow — are dual-use. Each
renders (a) as a component inside the member SPA and (b) as an **MCP App**: an
interactive UI resource surfaced inside a Claude conversation by a yamp tool (the
existing `meal-plan-widget` and `recipe-card-widget` specs are the precedent). One
component, two hosts.

## 1. The hosting model

- **The baseline**: view primitives are already shared (the @yamp/ui propose
  primitives); stateful orchestration is hand-duplicated
  (packages/app/src/lib/propose.ts vs packages/widgets/src/ProposeCard.tsx's
  self-declared faithful copies). "One implementation per widget" means lifting
  orchestration into the shared package and rebuilding BOTH shipped surfaces over it —
  a refactor with a regression surface, not a wrapper.
- **Target architecture**: the shared component owns state machine + view,
  plumbing-agnostic — data via props, mutations via an injected host-adapter interface:
  - *Member app host*: adapter binds TanStack Query + the normal registered class (b)
    mutations (offline-queue rules apply).
  - *MCP App host*: initial data arrives from the tool result that spawned the widget;
    the adapter binds the ext-apps bridge (tool calls / messages), online-only.
- Per D32, the Recipe Card gains cook mode once body annotations land, and becomes the
  ONE conversation cooking card (see pages/02 §3).
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

Design rule for proposals (D18 — three fixed protocol channels): every mutating
interaction in the MCP host does exactly (0) nothing secret — a widget's tool-result
payload contains data only, never a token, session id, or signed URL; MCP-host mutations
are exclusively bridge tool calls under the grant's (tenant, member); member-app-host
mutations are the normal /api mutations; (1) a deterministic backend write via
`App.callServerTool` to an app-callable Worker tool — the D1 write is always the source
of truth; (2) an immediate `ui/update-model-context` carrying a FULL current-state
snapshot mirroring D1 — never an event delta (updates overwrite each other; hosts may
defer delivery), never client-side debouncing; a `callServerTool` write without a
context update is invisible to the agent and is the D4 bug by definition; (3)
`ui/message` only at commit/send/close boundaries where a model turn is wanted; (4) a
server-side lost-update guard — shared-state payloads carry a version/updated_at,
mutating calls echo it, and the Worker rejects-or-merges stale writes. The context
update is a derived mirror of the D1 write — there is no per-interaction conflict
question. Interactions with no agent-visible effect must be explicitly justified (pure
view state like collapsing a section).

Grounding (D18): MCP Apps spec 2026-01-26, ext-apps SDK ^1.7.4 (already pinned), Claude
web+desktop support. Capability probing via getHostCapabilities; the residual probe is
host `updateModelContext` support + boot-time tools/call, folded into one
host-capability check. Degradation ladder: serverTools → write (+outcome message);
sendMessage-only → today's delegation message as explicit fallback; neither → control
disabled, text fallback. Macro boundaries write AND announce: plan commit = the
slug-keyed idempotent plan-ops upsert; order send = `place_order` (the only Kroger cart
writer).

**Widget freshness (D19)** — a peer rule: hosts cache widget HTML and re-render
re-opened conversations from the ORIGINAL structuredContent, so the spawning tool result
is a render-only snapshot — sufficient for first paint and the text fallback, never
trusted as current state for writes. Every widget mutating persistent state (Grocery
List, Order Review, Recipe Card's log-cooked/favorite) re-hydrates on boot via a bridge
read tool and gates mutations on a successful re-hydrate; bridge unavailable →
read-only render (the existing degrade path). The propose widget is exempt by
construction (stateless replay; commit packs against current plan state server-side);
its localStorage session-persistence line is member-app-host-only.

## 3. Consequences

- The Worker's MCP layer needs the widgets served as MCP App resources with their tool
  wiring. NEW surface: a grocery display tool + `ui://grocery/list`, an order-review
  display tool + `ui://order/review` fed from the `place_order` preview. EXISTING:
  `display_recipe`/`ui://recipe/card`, `display_meal_plan`/`ui://plan/propose`.
- Widget bundles must be self-contained per MCP Apps constraints (CSP, no external
  fetches beyond the sanctioned bridge) — same constraint family the member PWA already
  respects.
- Versioning (D19): every widget payload gains a `contract_version` (in @yamp/contract;
  floor/ceiling check); widgets degrade to read-only on unknown-newer payloads;
  additive-only evolution within a major — applied retroactively to
  ProposeCardData/RecipeCardData in the first dual-use change.
- First-writing-widget obligations (D18): the landing change deltas meal-plan-widget's
  "NO writes" stance, switches `ProposeCard.commit()` off sendMessage-delegation, and
  mints the app-callable write ops.
- Testing: widget behavior gets covered once at the component level plus a thin
  host-adapter test per host (`app-ui-testing` gates the member host; the MCP host needs
  an equivalent harness — likely fixture-driven).

## 4. Open questions

1. ~~Which MCP Apps protocol surface do we target, and what does Claude.ai support
   today?~~ — decided (D18): the three-channel template in §2; the residual probe is
   host updateModelContext support + boot-time tools/call, folded into one
   host-capability check — no spike.
2. ~~Granularity of context updates.~~ — decided (D18): full-state snapshot per mutating
   interaction, never debounced; `ui/message` only at commit/send/close boundaries.
3. Decided: MCP-host writes ride the member's MCP OAuth grant via the host bridge — the
   widget never sees a cookie or hits /api; write attribution comes from the grant's
   (tenant, member) (D10).
4. Decided: the shared component is plumbing-agnostic; the member host owns class (b)
   queueing; the MCP host is online-only; order-send is inexpressible as queued work in
   both hosts.
