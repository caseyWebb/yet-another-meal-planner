## Why

The root `CLAUDE.md` currently does double duty: it is both the grocery-agent's operational prose (pasted into the Claude.ai project as instructions) **and** the file Claude Code reads when developing in this repo. Those are two different audiences with opposite needs — the agent persona/flows belong in Claude.ai, while a Claude Code session in this repo wants build/test/workflow guidance. Now that the agent is fully working in Claude.ai (Change 07) and the repo is primarily a development surface, conflating them is friction: the dev assistant gets a wall of grocery-persona prose, and the agent instructions are coupled to a filename coding agents auto-load.

This change separates the two **before** Change 09 edits the agent prose, so 09 (and 10–13) target the right file from the start.

## What Changes

- **New `AGENT_INSTRUCTIONS.md` at the repo root** holds the grocery-agent operational prose — moved **verbatim** from the current `CLAUDE.md` (no behavior change; pure relocation). This becomes the canonical source pasted into the Claude.ai project.
- **`CLAUDE.md` is repurposed** into a Claude Code repo-development guide: Worker build/test commands, the OpenSpec change workflow, validation/indexes, repo layout, and a pointer to `AGENT_INSTRUCTIONS.md` for the agent persona.
- **Doc/code references updated** to point at the right file: `docs/PROJECT.md` (architecture diagram + "project instructions (canonical)"), `docs/TOOLS.md:378` (curated-config discipline), `worker/src/write-tools.ts:250` (comment), and ROADMAP.md forward-references in Changes 10–13 ("update CLAUDE.md" → "update AGENT_INSTRUCTIONS.md" where they mean the agent prose).
- **`repo-structure` spec updated**: the canonical Claude.ai instruction source is `AGENT_INSTRUCTIONS.md`; `CLAUDE.md` at root is now Claude Code dev guidance.
- **No agent behavior changes.** The pasted Claude.ai instructions are byte-identical after the move, so no re-paste is required by this change alone (re-paste happens when content changes, i.e. Change 09).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `repo-structure`: the root-doc requirement changes — `AGENT_INSTRUCTIONS.md` becomes the canonical agent/Claude.ai instruction file; `CLAUDE.md` remains at root but as Claude Code development guidance.
- `data-write-tools`: the curated-writers requirement's pointer to where the "when to call" discipline is documented moves from `CLAUDE.md` to `AGENT_INSTRUCTIONS.md` (text reference only; no tool-behavior change).

## Impact

- **Docs/root files:** `CLAUDE.md` (repurposed), `AGENT_INSTRUCTIONS.md` (new), `README.md`, `docs/PROJECT.md`, `docs/TOOLS.md`, `ROADMAP.md`.
- **Code:** `worker/src/write-tools.ts` (one comment).
- **Specs:** `repo-structure`, `data-write-tools` (text-reference fix).
- **Downstream:** Change 09 (and 10–13) retarget their "update CLAUDE.md" work to `AGENT_INSTRUCTIONS.md`. 09 depends on this change landing first.
- **Manual follow-up (not blocking):** the Claude.ai project instructions are sourced from `AGENT_INSTRUCTIONS.md` going forward; re-paste is only needed once content actually changes.
