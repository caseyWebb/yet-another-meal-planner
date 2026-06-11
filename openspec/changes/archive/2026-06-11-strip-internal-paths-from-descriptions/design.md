## Context

Three surfaces ship to the Claude.ai agent: MCP tool `description` strings (defined in `src/*-tools.ts` + `src/tools.ts`), `AGENT_INSTRUCTIONS.md`, and the plugin skills under `plugin/grocery-agent/skills/` — which are **generated** from `AGENT_INSTRUCTIONS.md` by `scripts/build-plugin.mjs` and never hand-edited. A scan found ~20 distinct repo-internal filenames referenced ~80 times across these surfaces (heaviest in tool descriptions). The consumer that reads them has no filesystem — only tools and conversation — so every path is a non-actionable instruction. This is a copy/authoring change: tool contracts (params, returns, error `code`s) are untouched; only human-readable prose changes.

## Goals / Non-Goals

**Goals:**
- Remove every repo-internal path/extension from consumer-facing text, replacing it per the concept / behavior / drop disposition.
- Keep the intent-model nouns intact (strip decoration only).
- Keep `docs/TOOLS.md` (the contract) in sync in the same pass.
- Zero behavior change; CI (`typecheck` + both test suites) and the plugin rebuild stay green.

**Non-Goals:**
- No change to tool names, parameters, return shapes, or error `code`s.
- No change to developer/operator surfaces (`CLAUDE.md`, `README.md`, `ROADMAP.md`, `docs/SCHEMAS.md`/`PROJECT.md`/`SELF_HOSTING.md`, `scripts/`).
- No new lint/CI enforcement of the rule (a guard could be a follow-up; this change is the manual cleanup + the spec that documents the standard).
- No data-format or worker-logic change.

## Decisions

**Edit at the source of truth, regenerate the rest.** Tool descriptions are edited in `src/*-tools.ts`/`src/tools.ts`; instruction prose in `AGENT_INSTRUCTIONS.md`; then `npm run build:plugin` regenerates `plugin/grocery-agent/skills/*`. The generated bundle is never hand-edited — editing it directly would be silently overwritten on the next build. *Alternative considered:* editing the generated skills directly — rejected; it violates the repo's stated build invariant.

**One disposition table drives every rewrite** (from the proposal): Class A tool-backed → concept/tool noun; Class B operator-config-no-verb → behavior, drop filename; Class C side-effect path → drop. This keeps the cleanup mechanical and reviewable rather than ad-hoc per string. The intent-model nouns are the named exception (keep noun, strip extension).

**Skills may read as tool-call scripts.** Per the user's call, flow bodies naming tools explicitly is acceptable — the invariant is "no internal *file* paths," not "no proper nouns." This means Class A references inside flow bodies can resolve to the tool name (`read_pantry`) rather than a softer concept phrase, which is often clearer in a procedure.

**`docs/TOOLS.md` synced as documentation, not as a behavior delta.** The contract doc mirrors the description language; it is developer-facing, so it is updated for consistency but does not itself gate the consumer. No spec for an existing capability changes — hence a single new `consumer-facing-descriptions` capability rather than delta-editing `mcp-server`/`data-read-tools`/`data-write-tools`/`recipe-discovery`.

**Verification is grep-based.** After the rewrite, a path/extension grep over the three consumer surfaces should return only intentional survivors (none expected); this is the acceptance check, alongside `typecheck` + tests + a clean plugin rebuild (byte-identical-from-source property of `build-plugin.mjs`).

## Risks / Trade-offs

- **Over-stripping a load-bearing noun** → Mitigation: the intent-model nouns are an explicit, enumerated exception; reviewer checks that `pantry`/`stockup`/`grocery list`/`meal plan`/`cooking log` survive as nouns.
- **Reworded error `message` breaks a test that asserts on message text** → Mitigation: tests assert on error `code`s by convention (`src/errors.ts`); run both suites and fix any message-text assertions found, but do not change any `code`.
- **Description rewrite subtly changes agent behavior** (descriptions are part of the prompt the model sees) → Mitigation: rewrites preserve the actionable content (what the tool does, when to use it); only the file-path framing is removed. Net effect should be clearer, not different.
- **Drift returns later** (no automated guard) → Accepted for this change; the spec documents the standard and a CI grep-guard is noted as a possible follow-up.
