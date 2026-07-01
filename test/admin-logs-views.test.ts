import { describe, it, expect } from "vitest";
import { AllJobsLog, LogsPage, PAGE_SIZE } from "../src/admin/pages/logs.js";
import { outcomeClassWord, isRetryable, hasDetail, entryTitle } from "../src/admin/logs-shared.js";
import type { DiscoveryLogRow } from "../src/discovery-db.js";
import type { JobRunWithJob } from "../src/health.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

function row(over: Partial<DiscoveryLogRow> = {}): DiscoveryLogRow {
  return {
    id: "1",
    url: "http://x",
    title: "T",
    source: "feed",
    outcome: "imported",
    slug: "t",
    detail: null,
    created_at: "2026-06-29",
    attempts: 0,
    next_retry_at: null,
    ...over,
  };
}

describe("Logs helpers", () => {
  it("maps outcomes to [class, word], passing unknown through", () => {
    expect(outcomeClassWord("imported")).toEqual(["ok", "imported"]);
    expect(outcomeClassWord("error")).toEqual(["fail", "error"]);
    expect(outcomeClassWord("no_match")).toEqual(["muted", "no match"]);
    expect(outcomeClassWord("weird")).toEqual(["muted", "weird"]);
  });

  it("flags only error/failed as retryable", () => {
    expect(isRetryable("error")).toBe(true);
    expect(isRetryable("failed")).toBe(true);
    expect(isRetryable("imported")).toBe(false);
  });

  it("computes hasDetail (slug present OR non-empty detail)", () => {
    expect(hasDetail(row({ slug: "t", detail: null }))).toBe(true);
    expect(hasDetail(row({ slug: null, detail: { reason: "x" } }))).toBe(true);
    expect(hasDetail(row({ slug: null, detail: null }))).toBe(false);
    expect(hasDetail(row({ slug: null, detail: {} }))).toBe(false);
  });

  it("titles an entry by title → url → untitled", () => {
    expect(entryTitle(row({ title: "T" }))).toBe("T");
    expect(entryTitle(row({ title: null, url: "http://x" }))).toBe("http://x");
    expect(entryTitle(row({ title: null, url: null }))).toBe("(untitled)");
  });
});

function run(over: Partial<JobRunWithJob> = {}): JobRunWithJob {
  return { id: "flyer-warm-1", job: "flyer-warm", ok: true, ran_at: 900_000, duration_ms: 100, summary: {}, ...over };
}

describe("AllJobsLog SSR (all-jobs run log)", () => {
  const NOW = 1_000_000;

  it("lists runs across every job, newest-first, with a hint line split ok vs failed", () => {
    const runs = [
      run({ id: "a", job: "flyer-warm", ran_at: 3000, ok: true }),
      run({ id: "b", job: "email", ran_at: 2000, ok: false }),
      run({ id: "c", job: "flyer-warm", ran_at: 1000, ok: true }),
    ];
    const html = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW }));
    const ia = html.indexOf('data-run-id="a"');
    const ib = html.indexOf('data-run-id="b"');
    const ic = html.indexOf('data-run-id="c"');
    expect(ia).toBeGreaterThan(-1);
    expect(ia).toBeLessThan(ib);
    expect(ib).toBeLessThan(ic);
    expect(html).toContain("3 runs · 2 ok · 1 failed");
  });

  it("renders a pill for every registered job, including one with zero runs", () => {
    const html = render(AllJobsLog({ runs: [], job: "All", page: 0, now: NOW }));
    expect(html).toContain("All jobs");
    expect(html).toContain(">flyer-warm<");
    expect(html).toContain(">discovery-sweep<");
    expect(html).toContain("No runs recorded yet.");
  });

  it("filtering by job narrows the list and the hint counts", () => {
    const runs = [
      run({ id: "a", job: "flyer-warm", ran_at: 3000, ok: true }),
      run({ id: "b", job: "email", ran_at: 2000, ok: true }),
    ];
    const html = render(AllJobsLog({ runs, job: "email", page: 0, now: NOW }));
    expect(html).toContain('data-run-id="b"');
    expect(html).not.toContain('data-run-id="a"');
    expect(html).toContain("1 runs · 1 ok · 0 failed");
    expect(html).toMatch(/pill active"[^>]*>email/);
  });

  it("expanding an entry shows its summary via PrettyKV, and the error when failed", () => {
    const runs = [run({ id: "a", ok: false, summary: { error: "boom", processed: 4 } })];
    const html = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW }));
    expect(html).toContain("processed");
    expect(html).toContain("boom");
  });

  it("a discovery-sweep run links out to the top-level Discovery area, not the legacy Logs route", () => {
    const runs = [run({ id: "a", job: "discovery-sweep" })];
    const html = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW }));
    expect(html).toContain('href="/admin/discovery"');
    expect(html).not.toContain('href="/admin/logs/discovery"');
    expect(html).toContain("View discovery candidates");
  });

  it("a non-discovery-sweep run does not link to the discovery log", () => {
    const runs = [run({ id: "a", job: "flyer-warm" })];
    const html = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW }));
    expect(html).not.toContain("View discovery candidates");
  });

  it("paginates the filtered list, resetting implicitly when the filter narrows below a page", () => {
    // Caller-sorted newest-first (as readAllJobRuns returns) — r0 is the newest, the last id the
    // highest ran_at.
    const runs = Array.from({ length: PAGE_SIZE + 3 }, (_, i) =>
      run({ id: `r${i}`, ran_at: PAGE_SIZE + 3 - i, ok: true }),
    );
    const page0 = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW }));
    expect(page0).toContain(`Page 1 of 2 · ${PAGE_SIZE + 3} runs`);
    expect(page0).toContain('data-run-id="r0"'); // newest-first: top of page 0
    expect(page0).not.toContain(`data-run-id="r${PAGE_SIZE + 2}"`); // last (oldest) is on page 1

    const page1 = render(AllJobsLog({ runs, job: "All", page: 1, now: NOW }));
    expect(page1).toContain(`data-run-id="r${PAGE_SIZE + 2}"`);
  });

  it("does not paginate when the filtered count fits on one page", () => {
    const runs = [run({ id: "a" })];
    const html = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW }));
    expect(html).not.toContain("pager-info");
  });

  it("highlights and pre-expands the entry matching highlightId", () => {
    const runs = [run({ id: "a" }), run({ id: "b" })];
    const html = render(AllJobsLog({ runs, job: "All", page: 0, now: NOW, highlightId: "a" }));
    expect(html).toMatch(/<details class="log-entry hl" data-run-id="a" open[^>]*>/);
    expect(html).not.toMatch(/<details class="log-entry hl" data-run-id="b"/);
  });
});

describe("LogsPage SSR shell", () => {
  it("renders the all-jobs submenu item active by default", () => {
    const html = render(LogsPage({ runs: [], job: "All", page: 0, now: 1000 }));
    expect(html).toContain("Logs");
    expect(html).toMatch(/log-source active"[^>]*><a class="log-source-link" href="\/admin\/logs">/);
  });
});
