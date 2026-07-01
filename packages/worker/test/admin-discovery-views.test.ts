// SSR tests for the Discovery area's candidate-pipeline view (admin-ui-redesign-discovery):
// stat tiles, filter pills + counts, the StageTrack progression track (done/halt/todo), the
// retry-clock / terminal readout, and the expand-to-detail raw-row rendering.

import { describe, it, expect } from "vitest";
import { DiscoveryView, STAGES } from "../src/admin/pages/discovery.js";
import { StageTrack } from "../src/admin/ui/kit.js";
import { deriveHalt, matchScoresFromDetail, type DiscoveryCandidate, type DiscoveryLogRow } from "../src/discovery-db.js";

const render = (node: unknown): string => (node as { toString(): string }).toString();

const NOW = new Date("2026-06-30T12:00:00.000Z").getTime();

function logRow(over: Partial<DiscoveryLogRow> & Pick<DiscoveryLogRow, "id" | "outcome">): DiscoveryLogRow {
  return {
    url: "https://example.com/r",
    title: "A Recipe",
    source: "Some Feed",
    slug: null,
    detail: null,
    created_at: "2026-06-30T10:00:00.000Z",
    attempts: 0,
    next_retry_at: null,
    pushed: false,
    origin: null,
    ...over,
  };
}

function candidate(over: Partial<DiscoveryLogRow> & Pick<DiscoveryLogRow, "id" | "outcome">): DiscoveryCandidate {
  const row = logRow(over);
  return { ...row, ...deriveHalt(row), matchScores: matchScoresFromDetail(row.detail) };
}

describe("StageTrack primitive", () => {
  it("marks stages before the halt index done, the halt index by kind, and the rest todo", () => {
    const html = render(
      StageTrack({
        stages: STAGES.map((s) => ({ key: s.key, label: s.label })),
        haltIndex: 2,
        kind: "park",
        imported: false,
      }),
    );
    expect(html).toContain('class="pl-stage done"');
    expect(html).toContain('class="pl-stage park halt"');
    expect(html).toContain('class="pl-stage todo"');
  });

  it("renders every stage done, none halted, when imported", () => {
    const html = render(
      StageTrack({ stages: STAGES.map((s) => ({ key: s.key, label: s.label })), haltIndex: 6, kind: "accepted", imported: true }),
    );
    expect(html).not.toContain("halt");
    // All 7 stages render as done.
    expect((html.match(/pl-stage done/g) ?? []).length).toBe(7);
  });
});

describe("DiscoveryView SSR — stat tiles", () => {
  it("summarizes the candidate pool: total, imported + rate, parked/failed, in-retry-queue", () => {
    const candidates = [
      candidate({ id: "1", outcome: "imported" }),
      candidate({ id: "2", outcome: "imported" }),
      candidate({ id: "3", outcome: "error", detail: { reason: "unreachable" }, next_retry_at: "2026-07-01T00:00:00.000Z" }),
      candidate({ id: "4", outcome: "failed", detail: { reason: "unexpected: boom" } }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain(">Candidates<");
    expect(html).toContain(">4<"); // total
    expect(html).toContain(">Imported<");
    expect(html).toContain(">2<"); // imported count
    expect(html).toContain("50% of intake"); // import rate
    expect(html).toContain("Parked / failed");
    expect(html).toContain("In retry queue");
  });
});

describe("DiscoveryView SSR — Refresh header", () => {
  it("shows a Refresh action with the freshest candidate's created_at as 'last sweep'", () => {
    const candidates = [
      candidate({ id: "1", outcome: "imported", created_at: "2026-06-30T10:00:00.000Z" }),
      candidate({ id: "2", outcome: "duplicate", detail: { duplicate_of: "x" }, created_at: "2026-06-30T09:00:00.000Z" }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toMatch(/Refresh · last sweep 2h ago/);
  });

  it("omits the 'last sweep' context (renders bare Refresh) when there are no candidates", () => {
    const html = render(DiscoveryView({ candidates: [], filter: "all", page: 0, now: NOW }));
    expect(html).toMatch(/>Refresh<\/a>/);
    expect(html).not.toContain("last sweep");
  });
});

describe("DiscoveryView SSR — filter pills", () => {
  it("narrows the candidate list and resets to the first page when a pill is selected", () => {
    const candidates = [
      candidate({ id: "1", outcome: "duplicate", detail: { duplicate_of: "x" } }),
      candidate({ id: "2", outcome: "imported" }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "duplicate", page: 0, now: NOW }));
    expect(html).toContain('data-candidate-id="1"');
    expect(html).not.toContain('data-candidate-id="2"');
    expect(html).toMatch(/pill active"[^>]*>\s*Duplicate/);
  });

  it("labels each pill with its current count", () => {
    const candidates = [candidate({ id: "1", outcome: "imported" }), candidate({ id: "2", outcome: "imported" })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toMatch(/Imported<span class="pill-count">2<\/span>/);
  });

  it("the Retrying pill matches both error- and failed-outcome retryable rows", () => {
    const candidates = [
      candidate({ id: "1", outcome: "error", detail: { reason: "unreachable" }, next_retry_at: "2026-07-01T00:00:00.000Z", attempts: 1 }),
      candidate({ id: "2", outcome: "failed", detail: { reason: "unexpected: x" }, next_retry_at: "2026-07-01T00:00:00.000Z", attempts: 1 }),
      candidate({ id: "3", outcome: "error", detail: { reason: "no_jsonld" } }), // terminal, not retryable
    ];
    const html = render(DiscoveryView({ candidates, filter: "retrying", page: 0, now: NOW }));
    expect(html).toContain('data-candidate-id="1"');
    expect(html).toContain('data-candidate-id="2"');
    expect(html).not.toContain('data-candidate-id="3"');
  });
});

describe("DiscoveryView SSR — candidate cards", () => {
  it("an imported candidate's progression track shows all 7 stages passed, no halt", () => {
    const candidates = [candidate({ id: "1", outcome: "imported", detail: { attribution: [{ tenant: "casey", score: 0.7 }] } })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).not.toContain("halt");
    expect(html).toContain("tagged for @casey");
  });

  it("a triage no_match shows zero stages passed and triage as the halt point", () => {
    const candidates = [candidate({ id: "1", outcome: "no_match", detail: { stage: "triage" } })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain('class="pl-stage reject halt"');
    expect(html).not.toContain("pl-stage done");
  });

  it("a retryable park shows its attempt count against the cap and a retry countdown", () => {
    const candidates = [
      candidate({
        id: "1",
        outcome: "error",
        detail: { reason: "unreachable", status: 503 },
        attempts: 2,
        next_retry_at: new Date(NOW + 42 * 60_000).toISOString(),
      }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain("attempt 2/5");
    expect(html).toContain("in 42m");
    expect(html).toContain('data-action="retry"');
  });

  it("a terminal parked candidate (cap exhausted) shows terminal, not a countdown", () => {
    const candidates = [
      candidate({ id: "1", outcome: "error", detail: { reason: "unreachable", status: 0 }, attempts: 5, next_retry_at: null }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain("terminal");
    expect(html).not.toContain('data-action="retry"');
    expect(html).toContain('data-action="delete"');
  });
});

describe("DiscoveryView SSR — match scores", () => {
  it("shows per-member match scores on a candidate halted at the match stage", () => {
    const candidates = [
      candidate({
        id: "1",
        outcome: "no_match",
        detail: { stage: "match", match_scores: [{ tenant: "casey", score: 0.52 }, { tenant: "sage", score: 0.61 }] },
      }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain("dc-match-scores");
    expect(html).toContain("@casey");
    expect(html).toContain("0.52");
    expect(html).toContain("@sage");
    expect(html).toContain("0.61");
  });

  it("shows per-member match scores on a dietary-gated candidate", () => {
    const candidates = [
      candidate({
        id: "1",
        outcome: "dietary_gated",
        detail: { stage: "match", restriction: "pork-free", tenant: "sage", match_scores: [{ tenant: "sage", score: 0.71 }] },
      }),
    ];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain("dc-match-scores");
    expect(html).toContain("@sage");
    expect(html).toContain("0.71");
  });

  it("renders no match-scores block when the row carries none (e.g. a triage-stage rejection)", () => {
    const candidates = [candidate({ id: "1", outcome: "no_match", detail: { stage: "triage" } })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).not.toContain("dc-match-scores");
  });

  it("renders no match-scores block for an imported candidate", () => {
    const candidates = [candidate({ id: "1", outcome: "imported", detail: { attribution: [{ tenant: "casey", score: 0.7 }] } })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).not.toContain("dc-match-scores");
  });
});

describe("DiscoveryView SSR — expand/collapse toggle (native <details>)", () => {
  it("wraps each card in a <details> whose <summary> carries a persistent, bidirectional Details/Hide affordance", () => {
    const candidates = [candidate({ id: "1", outcome: "no_match", detail: { stage: "triage" } })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    // The disclosure is a native <details class="dc-details">, not a click-driven div.
    expect(html).toMatch(/<details class="dc-details">/);
    // Both the closed-state and open-state labels are always present in markup (CSS flips which
    // is visible via `.dc-details[open]`), so the affordance is visible before AND after
    // expansion, and a second click on the same <summary> always collapses it back (native
    // <details> toggle semantics — no JS state to get out of sync).
    expect(html).toContain("dc-expand-closed");
    expect(html).toContain("dc-expand-open");
    expect(html).toContain("Details");
    expect(html).toContain("Hide");
    // The retry-clock/actions row (dc-foot) is inside <summary> — always visible on the
    // collapsed card, not gated behind expansion.
    expect(html).toMatch(/<summary class="dc-main">[\s\S]*dc-foot[\s\S]*<\/summary>/);
  });
});

describe("DiscoveryView SSR — expand-to-detail", () => {
  it("shows the 7-stage breakdown (passed/stopped here/not reached) and the raw log row via PrettyKV", () => {
    const candidates = [candidate({ id: "1", outcome: "dietary_gated", detail: { stage: "match", restriction: "pork-free", tenant: "sage" } })];
    const html = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(html).toContain("stopped here");
    expect(html).toContain("passed");
    expect(html).toContain("not reached");
    expect(html).toContain("discovery_log detail");
    expect(html).toContain("restriction");
    expect(html).toContain("pork-free");
  });
});

describe("DiscoveryView SSR — pagination", () => {
  it("paginates the filtered list with a fixed page size", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => candidate({ id: `${i}`, outcome: "imported" }));
    const page0 = render(DiscoveryView({ candidates, filter: "all", page: 0, now: NOW }));
    expect(page0).toContain('data-candidate-id="0"');
    expect(page0).not.toContain('data-candidate-id="6"');
    expect(page0).toContain("Page 1 of 2");

    const page1 = render(DiscoveryView({ candidates, filter: "all", page: 1, now: NOW }));
    expect(page1).toContain('data-candidate-id="6"');
  });
});
