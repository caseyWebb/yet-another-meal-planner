import { describe, it, expect } from "vitest";
import { EntriesList } from "../src/admin/pages/logs.js";
import { outcomeClassWord, isRetryable, hasDetail, entryTitle } from "../src/admin/logs-shared.js";
import type { DiscoveryLogRow } from "../src/discovery-db.js";

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

describe("Logs SSR entries", () => {
  it("renders entries with outcome badges", () => {
    const html = render(
      EntriesList({ entries: [row({ outcome: "error", title: "Boom" }), row({ id: "2", outcome: "imported", title: "OK" })] }),
    );
    expect(html).toContain("Boom");
    expect(html).toContain("entry-outcome fail");
    expect(html).toContain("OK");
  });

  it("renders the empty state", () => {
    expect(render(EntriesList({ entries: [] }))).toContain("No discovery activity");
  });
});
