## Context

Two living specs predate the R2 corpus migration, the D1 bug-reports change, the operator-admin panel, the public-data-repo marketplace, and auto-deploy. The code shipped all of those; the specs were never updated. This change corrects the specs to match shipped behavior — it is **spec-only**, verified against `src/` and `.github/workflows/`. No runtime code changes.

## Goals / Non-Goals

**Goals:**
- The living contract for `mcp-server` and `agent-bug-reporting` matches what the Worker actually does.
- Remove the standing contradictions (GitHub App corpus client, GitHub-Issues bug reports, private repo, no-auto-deploy).

**Non-Goals:**
- No code changes — the behavior already exists.
- Not re-litigating the R2/D1/admin/auto-deploy designs (they shipped in their own changes); this only realigns the prose.
- Not editing `r2-corpus-store` / `operator-admin` / `operator-provisioning` — they already own the new behavior; this change points at them rather than duplicating.

## Decisions

- **REMOVE, don't rewrite, "Authenticated GitHub data-access client."** Corpus data-access is owned by the `r2-corpus-store` capability. Rewriting an R2 data-access requirement *here* would re-introduce cross-spec drift; the spec instead drops it and cross-references `r2-corpus-store`. The remaining `mcp-server` requirements (structured errors, workerd-safe parsing, the per-tenant gate, write tools) still apply to the R2/D1 path.
- **REMOVE + ADD for the bug-report requirements** (not MODIFY). The headers change materially ("…as GitHub issues" → "…in D1"; "…without Issues permission" → "…write failures surface structured"), and OpenSpec MODIFIED matches by header — so REMOVE the obsolete ones (with Reason/Migration) and ADD the accurate ones. The two *skill* requirements keep their headers, so they're MODIFIED in place (reword issue→report, drop the URL).
- **Purpose lines are fixed by direct living-spec edit at apply**, not via a delta — `## Purpose` is prose, not a requirement, and OpenSpec deltas only carry `ADDED/MODIFIED/REMOVED Requirements`. `mcp-server`'s Purpose drops "the authenticated GitHub data-access client"; `agent-bug-reporting`'s `TBD` Purpose gets a real one.

## Risks / Trade-offs

- **A delta could misstate current behavior** → each delta was written against the code: `src/corpus-store.ts` (R2, no App), `src/bug-reports.ts` + `src/tools.ts` `report_bug` (D1 `bug_reports`, returns `{ filed: true }`), `src/admin.ts` (`GET /admin/api/bug-reports`), `ci.yml` `trigger-deploy` (auto-dispatch via `DATA_REPO_ACTIONS_TOKEN`). The tasks re-verify each.
- **Editing a living-spec Purpose outside the delta** → standard for prose that the delta ops don't cover; done at apply, before archive, so the archived living spec is internally consistent.
- **No test covers spec prose** → `openspec validate --strict` is the gate (structure + scenarios); accuracy is the manual verification above.
