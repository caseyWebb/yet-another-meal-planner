# route-show-me-asks — design

## Context

Post narrow-mcp-surface, the member surface has three display/read pairs. The show-me routing rule shipped in the persona's core tier — correct for plugin users mid-flow, invisible to a bare ask (no workflow skill triggers, so core never loads) and to plugin-less hosts. claude.ai injects MCP server `instructions` into context (verified against live connectors); ChatGPT reliably reads only tool descriptions.

## Goals / Non-Goals

**Goals:** the routing rule reaches every host on every turn; no behavior change for plugin users beyond correct routing; spec stays honest about what `instructions` may carry.

**Non-Goals:** no new skill (a read-ask must not load a flush workflow); no persona change; no widening of `instructions` beyond routing.

## Decisions

- **Descriptions first.** Tool descriptions are the only universally honored surface and are in context whenever the tools are. By `consumer-facing-descriptions`' litmus test the routing rule is a description-owned guarantee ("prefer this tool for a show-me ask" is contract a skill-less agent needs), not choreography. *Alternative rejected:* broadening the `shop` skill's triggers to catch list questions — wrong tier (a read-ask loading a flush workflow) and still absent on plugin-less hosts.
- **A minimal `instructions` preamble, scoped.** ~5 lines served in the initialize result: show-me → display tool; reads are internal; plain member-facing language. *Alternative rejected:* carrying the persona there — already deliberately forbidden (token cost on every session, duplicate-source drift); the existing clause is amended to name the preamble exception rather than silently violated.
- **The core skill keeps its copy of the rule.** Description = contract, skill = choreography (when in a flow to render vs. reason) — complementary halves per the capability, not a duplicate to strip.

## Risks / Trade-offs

- [Preamble ignored by some host] → descriptions alone already carry the fix; the preamble is redundancy, not the mechanism.
- [Instructions drift from persona] → the preamble states routing only (no voice, no learning posture); the spec amendment pins its ceiling.

## Migration Plan

Ships with the Worker deploy; no plugin republish needed. Rollback = revert.

## Open Questions

None.
