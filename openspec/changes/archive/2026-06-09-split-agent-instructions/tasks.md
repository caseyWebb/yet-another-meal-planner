## 1. Relocate agent prose

- [x] 1.1 Create `AGENT_INSTRUCTIONS.md` at the repo root with the current `CLAUDE.md` content verbatim (adjust only the H1 title, e.g. `# AGENT_INSTRUCTIONS.md — Grocery Agent`)
- [x] 1.2 Confirm the move is byte-identical apart from the title (diff old CLAUDE.md body vs new AGENT_INSTRUCTIONS.md body)

## 2. Repurpose CLAUDE.md as repo-dev guide

- [x] 2.1 Replace `CLAUDE.md` with Claude Code development guidance: Worker build/test (`cd worker && npm test`), CD-on-push deploy flow, MCP Inspector for local checks
- [x] 2.2 Document the OpenSpec workflow (propose → apply → archive; where `openspec/changes` and `openspec/specs` live) and validation/indexes (`scripts/build-indexes.mjs`, build-indexes Action, structural pre-commit validation)
- [x] 2.3 Add repo-layout orientation + the three-store data-model pointer (`pantry`/`stockup`/`grocery_list`)
- [x] 2.4 Add an explicit pointer: the grocery-agent persona and conversational flows live in `AGENT_INSTRUCTIONS.md` (pasted into the Claude.ai project), not in CLAUDE.md

## 3. Fix references

- [x] 3.1 `docs/PROJECT.md`: update the architecture diagram and the "project instructions (canonical)" / "Project instructions ← CLAUDE.md in repo" lines to reference `AGENT_INSTRUCTIONS.md` (also retargeted the "harness portability" section and build-phase/risks/summary mentions for accuracy)
- [x] 3.2 `docs/TOOLS.md:378`: change "the discipline of when to call them lives in CLAUDE.md" → `AGENT_INSTRUCTIONS.md`
- [x] 3.3 `worker/src/write-tools.ts:250`: update the comment referencing CLAUDE.md → `AGENT_INSTRUCTIONS.md`
- [x] 3.4 `ROADMAP.md`: retarget "update CLAUDE.md" to `AGENT_INSTRUCTIONS.md` in future Changes 09–13 where it means the agent prose; leave archived/historical mentions (Changes 01–08, the doc-commit lines) as written
- [x] 3.5 `README.md`: repository-layout table + "where to start" links — `AGENT_INSTRUCTIONS.md` = agent instructions, `CLAUDE.md` = dev guide (discovered during the 4.2 sweep; not in the original list)

## 4. Spec + consistency

- [x] 4.1 Verify the `repo-structure` delta matches the final file layout (AGENT_INSTRUCTIONS.md = agent source; CLAUDE.md = dev guide pointing to it)
- [x] 4.2 Re-grep the repo (excl. `openspec/changes/archive` and `node_modules`) for stray `CLAUDE.md`-as-agent-instructions references and confirm none remain (surfaced README.md + the `data-write-tools` live spec — both fixed; the live `repo-structure` spec is updated by this change's delta on archive; `docs/notes/2026-06-09-*` left as a dated historical note)
- [x] 4.3 Confirm `worker/` still builds/tests green (the comment change is inert) and indexes/validation are unaffected — `npm test` 141 passed / 4 skipped
- [x] 4.4 Add a MODIFIED delta for `data-write-tools` (the curated-writers requirement's "documented in CLAUDE.md" pointer → `AGENT_INSTRUCTIONS.md`); discovered during 4.2
