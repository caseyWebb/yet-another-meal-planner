# plan-presents-as-card — design

## Context

Post route-show-me-asks, display/read routing is description-owned — but the plan flow's own choreography (which outranks descriptions on plugin hosts) drives the data tool, and the engine tool's description carries no widget redirect for skill-less hosts.

## Goals / Non-Goals

**Goals:** the card is the planning presentation surface on every widget-rendering host; zero contract change to `propose_meal_plan`. **Non-Goals:** widget UI changes; saved-plan card (still doesn't exist); worker behavior changes.

## Decisions

- **Choreography fix in the persona, redirect in the description** — the same two-layer split route-show-me-asks established: the skill owns when-to-render (card as the proposal, Commit supersedes chat-save), the description owns the skill-less guarantee. *Alternative rejected:* removing `propose_meal_plan` from the member surface — the flow still needs the data form on card-less hosts and for silent feasibility reasoning.
- **Card Commit supersedes the chat save** — already the widget's contract (D18); the flow just stops double-writing.

## Risks / Trade-offs

- [Members on card-less hosts] → step 3's explicit fallback keeps the propose-then-chat-save path.

## Migration Plan

Worker deploy ships the description; the deploy's plugin republish ships the choreography. Rollback = revert.

## Open Questions

None.
