// Agent-filed bug reports (agent-bug-reporting capability), backed by the D1
// `bug_reports` table. `report_bug` records a report here instead of opening a GitHub
// issue (the GitHub App is gone for data); the operator reviews them via the admin
// panel (`GET /admin/api/bug-reports`). Attribution (reporter + timestamp) is stamped
// server-side, never trusted from the agent. Goes through `src/db.ts`, so a D1 failure
// surfaces as a structured `storage_error` (no raw throw at the tool boundary).

import type { Db } from "./db.js";

/** One bug report row, as surfaced to the operator. */
export interface BugReport {
  id: number;
  reporter: string;
  title: string;
  body: string;
  created_at: string;
  status: string;
}

/**
 * Record an agent-filed bug report attributed to `reporter` (the tenant id) and stamped
 * with `createdAt` server-side. Lands `open` for the operator's review queue.
 */
export async function recordBugReport(
  d: Db,
  reporter: string,
  title: string,
  body: string,
  createdAt: string,
): Promise<void> {
  await d.run(
    "INSERT INTO bug_reports (reporter, title, body, created_at, status) VALUES (?1, ?2, ?3, ?4, ?5)",
    reporter,
    title,
    body,
    createdAt,
    "open",
  );
}

/** Every bug report, newest first — the operator read path (cross-tenant, admin-gated). */
export async function listBugReports(d: Db): Promise<BugReport[]> {
  return d.all<BugReport>(
    "SELECT id, reporter, title, body, created_at, status FROM bug_reports ORDER BY created_at DESC, id DESC",
  );
}
