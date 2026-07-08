## ADDED Requirements

### Requirement: Member log corrections

The system SHALL provide a bounded, most-recent-first read of the caller's `cooking_log`
(ordered by `date` then insertion id, recipe entries enriched with the recipe's title and
facets from the shared index) and a tenant-scoped delete of a single log entry by its row id,
serving the member web surface's cooking-log page. The delete SHALL remove only a row owned by
the calling tenant; everything derived from the log (`last_cooked`, the retrospective, vibe
cadence recency) SHALL reflect the deletion organically on the next read, since none of it is
materialized. These are operations behind the member `/api` surface; no new MCP tool is added —
the agent-side contract (`log_cooked` append + `retrospective`) is unchanged.

#### Scenario: The log page lists the caller's history

- **WHEN** the member log read is called
- **THEN** it returns the caller's entries most-recent-first, bounded, with recipe entries
  carrying the recipe's title and facets, and each row carrying its id

#### Scenario: Deleting a mis-log heals derived reads

- **WHEN** a member deletes a mistakenly logged cook by id
- **THEN** only that tenant-owned row is removed, and a subsequent `last_cooked` or
  retrospective read no longer reflects it

#### Scenario: A member cannot delete another tenant's entry

- **WHEN** a delete is attempted with an id belonging to a different tenant
- **THEN** nothing is deleted and the result reports the entry as not found
