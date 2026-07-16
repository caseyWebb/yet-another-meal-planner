## MODIFIED Requirements

### Requirement: Agent reports friction on errors or repeated correction

The system SHALL provide a `report-bug` skill that the agent uses when the yamp server returns an unworkable error, when the user has repeatedly corrected or redirected the agent on the same point, or when the user explicitly asks to report a problem. The skill SHALL compose a specific, reproducible report (what was attempted, the failure or correction pattern, the tools/inputs involved), call `report_bug`, and then **inform the user** that it filed the report (the tool returns `{ filed: true }` — there is no URL to relay); the in-chat account of the failure SHALL stay in plain member language even though the filed report is technical. The shared `yamp-core` SHALL reference this skill so the trigger is available in every flow.

#### Scenario: An unworkable tool error is auto-reported

- **WHEN** a yamp tool returns an error the agent cannot work around during a flow
- **THEN** the agent uses the `report-bug` skill to file an attributed report and tells the user it flagged the problem for the maintainer

#### Scenario: Repeated correction triggers a report

- **WHEN** the user has to correct or redirect the agent repeatedly on the same point in a session
- **THEN** the agent files one report capturing the pattern and informs the user

### Requirement: At most one report per distinct problem per session

The `report-bug` skill SHALL file at most one report per distinct problem within a conversation — if it has already reported a given problem, it SHALL NOT refile it. File-and-inform is the behavior; the skill SHALL NOT block on asking the user's permission before filing.

#### Scenario: The same problem is not filed twice

- **WHEN** the same underlying problem recurs after the agent has already filed a report for it this session
- **THEN** no duplicate report is filed
