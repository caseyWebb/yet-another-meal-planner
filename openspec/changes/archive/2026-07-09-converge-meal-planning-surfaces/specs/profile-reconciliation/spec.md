## ADDED Requirements

### Requirement: Off-plan cadence is attributed at cook time, reconcile is the backstop

The off-plan cadence blind spot — a vibe cooked off-plan not resetting its clock — SHALL be handled primarily at **cook time** by the cosine attribution in `log_cooked` (the `cooking-history` and `night-vibe-palette` capabilities), not by the reconcile pass. The reconcile SHALL therefore no longer treat "cooked it off-plan, cadence never reset" as a primary cause of drift, because such cooks now advance `last_satisfied` immediately. The reconcile SHALL remain a **backstop** for systematic drift the cook-time signal cannot resolve — a vibe whose stated cadence persistently mismatches revealed frequency across many cooks (a stretch/tighten proposal), or a threshold-calibration gap — reading the whole cooking log as before. This narrows the reconcile's mandate; it does not remove the retrospective's stated-vs-revealed reconciliation.

#### Scenario: An off-plan cook no longer needs the reconcile to reset cadence

- **WHEN** a member cooks a vibe's dish off-plan
- **THEN** cook-time cosine attribution advances that vibe's `last_satisfied` immediately, and the reconcile does not need to catch the miss

#### Scenario: The reconcile still catches persistent cadence mismatch

- **WHEN** a vibe's stated `cadence_days` persistently mismatches how often it is actually satisfied across many cooks
- **THEN** the reconcile proposes a cadence stretch/tighten as before, reading the whole cooking log
