## ADDED Requirements

### Requirement: Worker records attributed bug reports in D1

The system SHALL provide a `report_bug(title, body)` MCP tool that records an attributed report into the D1 **`bug_reports`** table (columns `reporter`, `title`, `body`, `created_at`, `status`). The Worker SHALL set `reporter` to the **resolved tenant id** and stamp `created_at` **server-side** — so attribution cannot be omitted or spoofed by the agent — and SHALL land the row with `status` `open` for the operator's review queue. The tool SHALL operate only in the resolved tenant's context (behind the per-tenant gate), SHALL go through `src/db.ts`, and SHALL return `{ filed: true }` (no issue URL or number). The operator SHALL review reports in the Cloudflare Access-gated `/admin` panel (`GET /admin/api/bug-reports`, a cross-tenant admin-gated read). No GitHub issue, label, or GitHub App is involved.

#### Scenario: A bug report becomes an attributed D1 row

- **WHEN** the `report_bug` tool is called with a title and body for an allowlisted tenant
- **THEN** a row is inserted into the D1 `bug_reports` table carrying the agent's title/body plus the server-set `reporter` (the caller's tenant) and `created_at`, with `status='open'`, and the tool returns `{ filed: true }`

#### Scenario: Attribution is server-stamped, not agent-supplied

- **WHEN** the agent includes its own claimed identity or timestamp in the body
- **THEN** the persisted `reporter` and `created_at` are the server-resolved tenant and server clock, not any value the agent supplied

#### Scenario: Reports stay in the operator's private review queue

- **WHEN** a bug report is filed
- **THEN** it lands only in the operator's D1 `bug_reports` table, read through the Access-gated `/admin` panel — never on a public surface

### Requirement: Bug-report write failures surface structured

A D1 write failure from `report_bug` SHALL surface as a structured **`storage_error`** (via `src/db.ts`), not a raw throw, and the agent SHALL relay the failure to the user rather than implying the report was filed.

#### Scenario: A storage failure is reported, not crashed

- **WHEN** `report_bug` is called but the D1 write fails
- **THEN** the tool returns a structured `storage_error` and the Worker stays responsive, and the agent tells the user the report did not file

## MODIFIED Requirements

### Requirement: Agent reports friction on errors or repeated correction

The system SHALL provide a `report-grocery-agent-bug` skill that the agent uses when the grocery-mcp server returns an unworkable error, when the user has repeatedly corrected or redirected the agent on the same point, or when the user explicitly asks to report a problem. The skill SHALL compose a specific, reproducible report (what was attempted, the failure or correction pattern, the tools/inputs involved), call `report_bug`, and then **inform the user** that it filed the report (the tool returns `{ filed: true }` — there is no URL to relay). The shared `grocery-core` SHALL reference this skill so the trigger is available in every flow.

#### Scenario: An unworkable tool error is auto-reported

- **WHEN** a grocery-mcp tool returns an error the agent cannot work around during a flow
- **THEN** the agent uses the `report-grocery-agent-bug` skill to file an attributed report and tells the user it flagged the problem for the maintainer

#### Scenario: Repeated correction triggers a report

- **WHEN** the user has to correct or redirect the agent repeatedly on the same point in a session
- **THEN** the agent files one report capturing the pattern and informs the user

### Requirement: At most one report per distinct problem per session

The `report-grocery-agent-bug` skill SHALL file at most one report per distinct problem within a conversation — if it has already reported a given problem, it SHALL NOT refile it. File-and-inform is the behavior; the skill SHALL NOT block on asking the user's permission before filing.

#### Scenario: The same problem is not filed twice

- **WHEN** the same underlying problem recurs after the agent has already filed a report for it this session
- **THEN** no duplicate report is filed

## REMOVED Requirements

### Requirement: Worker files attributed bug reports as GitHub issues

**Reason**: `report_bug` no longer opens a GitHub issue — it records to the D1 `bug_reports` table (there is no GitHub App or Issues path on the data plane). Replaced by "Worker records attributed bug reports in D1."

**Migration**: Operators review agent-filed reports in the Access-gated `/admin` panel (`GET /admin/api/bug-reports`) instead of on a GitHub repo's issues.

### Requirement: Graceful degradation without Issues permission

**Reason**: There is no GitHub Issues permission to lack — `report_bug` writes D1. Replaced by "Bug-report write failures surface structured" (a D1 `storage_error` via `src/db.ts`).

**Migration**: A failed report now surfaces as `storage_error`; the agent relays it to the user, same as before.
