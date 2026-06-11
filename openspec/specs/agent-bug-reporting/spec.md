# agent-bug-reporting Specification

## Purpose
TBD - created by archiving change agent-self-reports-bugs. Update Purpose after archive.
## Requirements
### Requirement: Worker files attributed bug reports as GitHub issues

The system SHALL provide a `report_bug(title, body)` MCP tool that opens a GitHub issue on the operator's configured **private data repo** (`DATA_OWNER`/`DATA_REPO`) using the existing GitHub App installation token. The Worker SHALL append attribution it controls — the caller's resolved `username` and a timestamp — to the issue body, and SHALL apply an `agent-reported` label, so attribution cannot be omitted or spoofed by the agent. The tool SHALL operate only in the resolved tenant's context (behind the per-tenant gate) and SHALL file to the repo-level issues endpoint, not under any tenant subtree. On success it SHALL return the issue URL and number.

#### Scenario: A bug report becomes an attributed issue

- **WHEN** the `report_bug` tool is called with a title and body for an allowlisted tenant
- **THEN** a GitHub issue is created on the private data repo carrying the agent's title/body plus a server-added trailer with the caller's `username` and a timestamp and the `agent-reported` label, and the tool returns the issue URL

#### Scenario: Reports never go to a public repo

- **WHEN** a bug report is filed
- **THEN** it is created only on the operator's private data repo, never on a public repository

### Requirement: Graceful degradation without Issues permission

The system SHALL return a structured `insufficient_permission` error (not a raw throw) when the GitHub App lacks `Issues: write` on the data repo, and SHALL surface other GitHub failures as `upstream_unavailable`. The agent SHALL relay such a failure to the user rather than implying the report was filed.

#### Scenario: Missing Issues permission is reported, not crashed

- **WHEN** `report_bug` is called but the App installation cannot create issues
- **THEN** the tool returns `{ error: "insufficient_permission", message }` and the Worker stays responsive

### Requirement: Agent reports friction on errors or repeated correction

The system SHALL provide a `report-grocery-agent-bug` skill that the agent uses when the grocery-mcp server returns an unworkable error, when the user has repeatedly corrected or redirected the agent on the same point, or when the user explicitly asks to report a problem. The skill SHALL compose a specific, reproducible report (what was attempted, the failure or correction pattern, the tools/inputs involved), call `report_bug`, and then **inform the user** that it filed the report (including the URL when returned). The shared `grocery-core` SHALL reference this skill so the trigger is available in every flow.

#### Scenario: An unworkable tool error is auto-reported

- **WHEN** a grocery-mcp tool returns an error the agent cannot work around during a flow
- **THEN** the agent uses the `report-grocery-agent-bug` skill to file an attributed issue and tells the user it flagged the problem for the maintainer

#### Scenario: Repeated correction triggers a report

- **WHEN** the user has to correct or redirect the agent repeatedly on the same point in a session
- **THEN** the agent files one report capturing the pattern and informs the user

### Requirement: At most one report per distinct problem per session

The `report-grocery-agent-bug` skill SHALL file at most one issue per distinct problem within a conversation — if it has already reported a given problem, it SHALL NOT refile it. File-and-inform is the behavior; the skill SHALL NOT block on asking the user's permission before filing.

#### Scenario: The same problem is not filed twice

- **WHEN** the same underlying problem recurs after the agent has already filed a report for it this session
- **THEN** no duplicate issue is filed
