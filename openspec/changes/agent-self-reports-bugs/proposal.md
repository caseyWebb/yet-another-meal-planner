## Why

The agent serves a friend group where members have **no GitHub accounts** and won't file issues — and, in practice, only occasionally tell the operator when something breaks. Real bugs (a grocery-mcp tool erroring, the agent repeatedly misunderstanding and needing correction) go unreported, so the operator is flying blind on quality. The Worker already authenticates to GitHub via a GitHub App installation token and knows the caller's tenant, so it can file an attributed issue on the operator's behalf — turning silent friction into actionable bug reports.

## What Changes

- **New Worker tool `report_bug(title, body)`** — opens a GitHub issue on the operator's **private data repo** (`DATA_OWNER/DATA_REPO`, where the App is already installed) via the existing installation-token client. The Worker appends the caller's `username` + a timestamp and labels the issue `agent-reported`, so the operator sees who and when without the agent having to ask. Returns the issue URL, or a structured error.
- **New error code `insufficient_permission`** — returned when the App lacks `Issues: write` (so the agent degrades gracefully instead of throwing).
- **New skill `report-grocery-agent-bug`** (core-only) — composes a concise report (what the agent was doing, what failed / the correction pattern, tools involved), files it via `report_bug`, then **informs** the user ("flagged this for the maintainer"). Dedupes within a session — one issue per distinct problem, never spam. File-and-inform, not ask-first (silent friends won't opt in).
- **`grocery-core` references it conditionally** — one line: if the grocery-mcp server errors, or the user repeatedly corrects/redirects on the same thing, use the `report-grocery-agent-bug` skill.
- **Reports land in the private data repo, not the public code repo** — bug bodies carry conversation context + the member's name; the public repo would leak that, and the App isn't installed there. The operator triages and copies sanitized issues upstream as needed.

## Capabilities

### New Capabilities
- `agent-bug-reporting`: the Worker tool that files attributed GitHub issues to the operator's private data repo, and the agent skill + core trigger that drive it on errors or repeated correction.

### Modified Capabilities
- None at the spec level — `report_bug` is a new tool under the existing `mcp-server` write-behind-the-gate posture; no existing requirement changes.

## Impact

- **New**: a `createIssue` method on the GitHub client (`src/github.ts`); the `report_bug` tool registration (`src/tools.ts` or a small new module); the `report-grocery-agent-bug` skill (`AGENT_INSTRUCTIONS.md`) + the `grocery-core` trigger line; `docs/TOOLS.md` entry.
- **Operator one-time setup**: grant the GitHub App **`Issues: write`** on the data repo (a GitHub permission approval); documented in `docs/SELF_HOSTING.md`. Until granted, `report_bug` returns `insufficient_permission` and the agent tells the user it couldn't file.
- **Deploy**: this is a Worker change — after merge, the operator runs the data-repo deploy.
- **Unchanged**: data model, OAuth flow, the plugin packaging. Privacy posture preserved (reports stay in the private control plane).
