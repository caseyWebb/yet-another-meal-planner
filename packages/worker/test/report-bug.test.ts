// Tests for report_bug's D1 write path (the GitHub-issues path is retired): the
// bug-reports recorder/lister and the admin read endpoint.
import { describe, it, expect } from "vitest";
import { recordBugReport, listBugReports } from "../src/bug-reports.js";
import { db } from "../src/db.js";
import { fakeD1 } from "./fake-d1.js";

describe("recordBugReport / listBugReports", () => {
  it("records an attributed report and lists it back", async () => {
    const d1 = fakeD1({ tables: { bug_reports: [] } });
    await recordBugReport(db(d1.env), "casey", "Match broke", "match_ingredient threw", "2026-06-27T10:00:00.000Z");

    expect(d1.tables.bug_reports).toHaveLength(1);
    expect(d1.tables.bug_reports[0]).toMatchObject({
      reporter: "casey",
      title: "Match broke",
      body: "match_ingredient threw",
      created_at: "2026-06-27T10:00:00.000Z",
      status: "open",
    });

    const reports = await listBugReports(db(d1.env));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ reporter: "casey", title: "Match broke", status: "open" });
  });

  it("keeps multiple reports distinct (autoincrement id, no GitHub)", async () => {
    const d1 = fakeD1({ tables: { bug_reports: [] } });
    await recordBugReport(db(d1.env), "casey", "A", "a", "2026-06-27T10:00:00.000Z");
    await recordBugReport(db(d1.env), "everett", "B", "b", "2026-06-27T11:00:00.000Z");
    expect(d1.tables.bug_reports).toHaveLength(2);
    const reports = await listBugReports(db(d1.env));
    // newest first (created_at DESC)
    expect(reports.map((r) => r.title)).toEqual(["B", "A"]);
    expect(reports.map((r) => r.reporter)).toEqual(["everett", "casey"]);
  });
});
