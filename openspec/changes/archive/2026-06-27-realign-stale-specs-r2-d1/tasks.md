## 1. Write the spec deltas

- [x] 1.1 `specs/mcp-server/spec.md`: REMOVE "Authenticated GitHub data-access client" (cross-ref `r2-corpus-store`); MODIFY "MCP server over Streamable HTTP" (tenant R2/D1 context) and "Operator-controlled Worker deployment" (public repo, Kroger-only secrets, auto-deploy trigger)
- [x] 1.2 `specs/agent-bug-reporting/spec.md`: ADD "Worker records attributed bug reports in D1" + "Bug-report write failures surface structured"; MODIFY the two `report-grocery-agent-bug` skill requirements (issue→report, drop URL); REMOVE the two GitHub-issue requirements

## 2. Verify each delta against the code (no edits — confirmation only)

- [x] 2.1 Corpus is R2 with no GitHub App — `src/corpus-store.ts`; `errors.ts`/`tools.ts` note "no GitHub App" — confirms the mcp-server REMOVE
- [x] 2.2 `report_bug` → D1 `bug_reports` (`reporter`/`title`/`body`/`created_at`/`status='open'`), returns `{ filed: true }`, server-stamped attribution — `src/bug-reports.ts`, `src/tools.ts` (`report_bug`)
- [x] 2.3 Operator review path is `GET /admin/api/bug-reports` (Access-gated) — `src/admin.ts`
- [x] 2.4 Auto-deploy: `ci.yml` `trigger-deploy` dispatches the data repo deploy via `DATA_REPO_ACTIONS_TOKEN`, gated on green CI; the code repo runs no `wrangler deploy` — `.github/workflows/ci.yml`

## 3. Fix the Purpose prose (direct living-spec edit at apply — not a delta op)

- [x] 3.1 `openspec/specs/mcp-server/spec.md` Purpose: dropped "the authenticated GitHub data-access client"
- [x] 3.2 `openspec/specs/agent-bug-reporting/spec.md` Purpose: replaced the `TBD` with a real one (D1 `bug_reports` + `/admin` review)

## 4. Validate & archive

- [x] 4.1 `openspec validate "realign-stale-specs-r2-d1" --strict` passes
- [x] 4.2 `openspec archive realign-stale-specs-r2-d1` (applies the deltas into the living specs); `openspec validate --all` stays green
- [x] 4.3 Confirm no `src/`, workflow, or non-openspec doc changed (spec-only)
