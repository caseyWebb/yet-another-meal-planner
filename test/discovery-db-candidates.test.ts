// Unit tests for the candidate-pipeline enrichment (admin-ui-redesign-discovery):
// deriveHalt (pure, exhaustive over the real Outcome union) and readDiscoveryCandidates (the
// SSR reader for /admin/discovery, wrapping readDiscoveryLog).

import { describe, it, expect } from "vitest";
import { deriveHalt, readDiscoveryCandidates, type DiscoveryLogRow } from "../src/discovery-db.js";
import type { Env } from "../src/env.js";

function row(over: Partial<DiscoveryLogRow> & Pick<DiscoveryLogRow, "id" | "outcome">): DiscoveryLogRow {
  return {
    url: "https://example.com/r",
    title: "T",
    source: "feed",
    slug: null,
    detail: null,
    created_at: "2026-06-27T10:00:00.000Z",
    attempts: 0,
    next_retry_at: null,
    ...over,
  };
}

describe("deriveHalt — exhaustive over the real Outcome union", () => {
  it("imported halts at import, fully passed (kind accepted)", () => {
    expect(deriveHalt(row({ id: "1", outcome: "imported" }))).toEqual({
      haltStage: "import",
      kind: "accepted",
      retryable: false,
    });
  });

  it("duplicate halts at dedup (kind dup)", () => {
    expect(deriveHalt(row({ id: "2", outcome: "duplicate", detail: { duplicate_of: "x" } }))).toEqual({
      haltStage: "dedup",
      kind: "dup",
      retryable: false,
    });
  });

  it("no_match with detail.stage triage halts at triage", () => {
    expect(deriveHalt(row({ id: "3", outcome: "no_match", detail: { stage: "triage" } }))).toEqual({
      haltStage: "triage",
      kind: "reject",
      retryable: false,
    });
  });

  it("no_match with detail.stage confirm halts at match", () => {
    expect(deriveHalt(row({ id: "4", outcome: "no_match", detail: { stage: "confirm" } }))).toEqual({
      haltStage: "match",
      kind: "reject",
      retryable: false,
    });
  });

  it("no_match with detail.stage match halts at match", () => {
    expect(deriveHalt(row({ id: "4b", outcome: "no_match", detail: { stage: "match" } }))).toMatchObject({
      haltStage: "match",
    });
  });

  it("no_match with no detail (legacy row) halts at match, not triage", () => {
    expect(deriveHalt(row({ id: "4c", outcome: "no_match", detail: null }))).toMatchObject({
      haltStage: "match",
    });
  });

  it("dietary_gated always halts at match (kind reject)", () => {
    expect(deriveHalt(row({ id: "5", outcome: "dietary_gated", detail: { stage: "match", restriction: "pork-free" } }))).toEqual({
      haltStage: "match",
      kind: "reject",
      retryable: false,
    });
  });

  it("rejected_source halts at triage (kind reject)", () => {
    expect(deriveHalt(row({ id: "6", outcome: "rejected_source" }))).toEqual({
      haltStage: "triage",
      kind: "reject",
      retryable: false,
    });
  });

  it("deferred halts at import, held not failed (kind defer)", () => {
    expect(deriveHalt(row({ id: "7", outcome: "deferred", detail: { note: "rate cap" } }))).toEqual({
      haltStage: "import",
      kind: "defer",
      retryable: false,
    });
  });

  it("error with an acquisition-park reason halts at acquire (kind park)", () => {
    for (const reason of ["unreachable", "no_jsonld", "not_a_recipe", "incomplete"]) {
      expect(deriveHalt(row({ id: `e-${reason}`, outcome: "error", detail: { reason } }))).toEqual({
        haltStage: "acquire",
        kind: "park",
        retryable: false,
      });
    }
  });

  it("error with an import:-prefixed reason halts at import (kind park)", () => {
    expect(
      deriveHalt(row({ id: "e-import", outcome: "error", detail: { reason: "import: storage_error writing corpus object" } })),
    ).toEqual({ haltStage: "import", kind: "park", retryable: false });
  });

  it("error with a classify-shaped reason (validation failure) halts at classify (kind park)", () => {
    expect(
      deriveHalt(
        row({
          id: "e-classify",
          outcome: "error",
          detail: { reason: "Classification did not pass the recipe contract after 3 attempts: missing cuisine" },
        }),
      ),
    ).toEqual({ haltStage: "classify", kind: "park", retryable: false });
  });

  it("error with no detail (unshaped/legacy) falls back to classify (kind park)", () => {
    expect(deriveHalt(row({ id: "e-legacy", outcome: "error", detail: null }))).toMatchObject({ haltStage: "classify" });
  });

  it("failed renders at acquire as a documented approximation (kind fail)", () => {
    expect(deriveHalt(row({ id: "8", outcome: "failed", detail: { reason: "unexpected: AiError" } }))).toEqual({
      haltStage: "acquire",
      kind: "fail",
      retryable: false,
    });
  });

  it("retryable mirrors next_retry_at !== null regardless of outcome", () => {
    expect(deriveHalt(row({ id: "9", outcome: "error", detail: { reason: "unreachable" }, next_retry_at: "2099-01-01T00:00:00.000Z" })).retryable).toBe(
      true,
    );
    expect(deriveHalt(row({ id: "10", outcome: "failed", next_retry_at: "2099-01-01T00:00:00.000Z" })).retryable).toBe(true);
    expect(deriveHalt(row({ id: "11", outcome: "imported", next_retry_at: null })).retryable).toBe(false);
  });
});

// ── readDiscoveryCandidates ──────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  url: string | null;
  title: string | null;
  source: string | null;
  outcome: string;
  slug: string | null;
  detail: string | null;
  created_at: string | null;
  attempts: number;
  next_retry_at: string | null;
}

function discoveryD1(rows: Row[]): Env["DB"] {
  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async all<T>() {
        if (/FROM discovery_log/i.test(sql)) {
          const limit = Number(binds[0]);
          const ordered = [...rows].sort((a, b) =>
            (a.created_at ?? "") < (b.created_at ?? "") ? 1 : (a.created_at ?? "") > (b.created_at ?? "") ? -1 : 0,
          );
          return { results: ordered.slice(0, limit) as unknown as T[], success: true as const, meta: { changes: 0 } };
        }
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { success: true as const, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  return {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as Env["DB"];
}

function d1Row(over: Partial<Row> & Pick<Row, "id" | "outcome" | "created_at">): Row {
  return {
    url: "https://example.com/r",
    title: "T",
    source: "feed",
    slug: null,
    detail: null,
    attempts: 0,
    next_retry_at: null,
    ...over,
  };
}

describe("readDiscoveryCandidates", () => {
  it("enriches each readDiscoveryLog row with haltStage/kind/retryable", async () => {
    const DB = discoveryD1([
      d1Row({ id: "a", outcome: "imported", created_at: "2026-06-27T10:00:00.000Z" }),
      d1Row({ id: "b", outcome: "duplicate", created_at: "2026-06-27T11:00:00.000Z", detail: JSON.stringify({ duplicate_of: "x" }) }),
    ]);
    const env = { DB } as unknown as Env;
    const candidates = await readDiscoveryCandidates(env, 200);
    // Most-recent-first (readDiscoveryLog's order), each row enriched.
    expect(candidates.map((c) => c.id)).toEqual(["b", "a"]);
    expect(candidates[0]).toMatchObject({ id: "b", haltStage: "dedup", kind: "dup", retryable: false });
    expect(candidates[1]).toMatchObject({ id: "a", haltStage: "import", kind: "accepted", retryable: false });
  });

  it("passes the limit through to readDiscoveryLog (bounded)", async () => {
    const many = Array.from({ length: 10 }, (_, i) => d1Row({ id: `r${i}`, outcome: "no_match", created_at: `2026-06-27T00:${String(i).padStart(2, "0")}:00.000Z` }));
    const env = { DB: discoveryD1(many) } as unknown as Env;
    const candidates = await readDiscoveryCandidates(env, 3);
    expect(candidates.length).toBe(3);
  });
});
