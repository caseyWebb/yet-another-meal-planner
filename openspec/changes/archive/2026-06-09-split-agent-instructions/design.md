## Context

`CLAUDE.md` at the repo root is consumed by two systems at once: Claude Code auto-loads it as project context when developing here, and its content is the canonical text pasted into the Claude.ai "Grocery Agent" project instructions (Change 07). The `repo-structure` spec explicitly pins this dual role (`repo-structure/spec.md:57`: "CLAUDE.md SHALL reside at the repository root so Claude Code and Claude.ai project instructions consume it natively").

The agent is now live and used via Claude.ai, not Claude Code. The two audiences have diverged enough that one file serving both is friction. This change separates them; it deliberately lands **before** Change 09 so the agent-prose edits 09 makes (and 10–13 after it) go to the right file from the start, avoiding a double-edit.

## Goals / Non-Goals

**Goals:**
- The grocery-agent operational prose lives in its own file (`AGENT_INSTRUCTIONS.md`), decoupled from the file coding agents auto-load.
- `CLAUDE.md` becomes genuinely useful to a Claude Code session working in this repo.
- All references resolve to the correct file; no dangling "CLAUDE.md = agent instructions" pointers remain (outside the archive).
- Zero agent-behavior change — the move is verbatim.

**Non-Goals:**
- Editing the agent prose itself (that is Change 09's job; here it moves unchanged).
- Re-pasting Claude.ai project instructions (not required while content is identical).
- Touching archived changes (Change 07/08 archives reference CLAUDE.md historically — left as-is).
- Any Worker tool / data behavior change.

## Decisions

### D1: Verbatim move, not a rewrite

The grocery-agent prose moves to `AGENT_INSTRUCTIONS.md` byte-for-byte (only the H1 title adjusts, e.g. `# AGENT_INSTRUCTIONS.md — Grocery Agent`). Keeping it verbatim means the currently-pasted Claude.ai instructions stay valid with no re-paste, and it isolates this change to "relocation" so Change 09's diff is purely the menu-generation content. Rewriting and moving in one step would entangle two concerns.

### D2: `AGENT_INSTRUCTIONS.md`, not `AGENTS.md`

The new filename is `AGENT_INSTRUCTIONS.md`. The `AGENTS.md` (and `CLAUDE.md`) conventions are **auto-loaded** by coding agents into context — which is exactly what we want to *avoid* for the Claude.ai paste source: it is the wrong audience for a Claude Code session and would re-bloat the context we are trying to slim. A non-magic filename keeps it inert to Claude Code while remaining the obvious human-named source for the Claude.ai paste.

### D3: Keep a root `CLAUDE.md`, repurposed for repo development

Rather than delete `CLAUDE.md`, repurpose it as a Claude Code dev guide for this repo. Contents:
- How to build/test the Worker (`cd worker && npm test`, the CD-on-push flow, MCP Inspector for local checks).
- The OpenSpec change workflow (propose → apply → archive; where changes/specs live).
- Validation & indexes (`scripts/build-indexes.mjs`, the build-indexes Action, structural pre-commit validation).
- Repo layout orientation and the three-store data model pointer (`pantry`/`stockup`/`grocery_list`).
- An explicit pointer: "the grocery-agent persona and conversational flows live in `AGENT_INSTRUCTIONS.md` (pasted into the Claude.ai project) — not here."

Rationale: future Claude Code sessions in this repo lose nothing and gain targeted guidance; the global `~/.claude/CLAUDE.md` stays about the user, this one about the repo.

### D4: Update the `repo-structure` spec to match

The pinned requirement is rewritten so the **canonical Claude.ai instruction source is `AGENT_INSTRUCTIONS.md`**, while `CLAUDE.md` remains a root file consumed by Claude Code as repo-development context. Scenarios updated accordingly. This is the one spec-level change; everything else is docs/code reference fixes.

## Risks / Trade-offs

- **Stale references left behind** → mitigated by enumerating every live reference up front (`docs/PROJECT.md`, `docs/TOOLS.md:378`, `worker/src/write-tools.ts:250`, ROADMAP 10–13) as explicit tasks; archive references are intentionally excluded.
- **Claude.ai project drifts from the file** → accepted and documented: the file is the source of truth, re-paste is a manual step that only matters when content changes (Change 09). This change keeps content identical so there is nothing to re-paste yet.
- **ROADMAP forward-refs vs. history** → only Changes 10–13 (future) are retargeted; archived/historical mentions stay as written so the record is accurate.

## Migration Plan

1. Create `AGENT_INSTRUCTIONS.md` = current `CLAUDE.md` content (verbatim, title adjusted).
2. Replace `CLAUDE.md` with the repo-dev guide (D3).
3. Fix references: `docs/PROJECT.md`, `docs/TOOLS.md:378`, `worker/src/write-tools.ts:250`, ROADMAP 10–13.
4. Update the `repo-structure` spec requirement + scenarios.
5. Rollback: trivial — restore the single-file `CLAUDE.md` from git; no code or data depends on the split at runtime.

## Open Questions

- Should the global ROADMAP intro workflow blurb (steps 1–5) also mention `AGENT_INSTRUCTIONS.md`? Minor; fold into the reference-fix task if it reads cleanly, otherwise leave.
