import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import type { JobRun } from "../src/health.js";
import {
  backlogSeries,
  deriveAuditObservability,
  deriveRecipeBackfill,
  readAuditObservability,
  readEdgeDecisionLog,
  readMergeRejections,
  readAuditSurface,
  CORESOLVE_BACKOFF_DAYS,
} from "../src/audit-admin.js";
import { NORMALIZE_CORESOLVE_REJECT_BACKOFF_MS } from "../src/ingredient-normalize.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;

function run(id: string, ranAt: number, summary: Record<string, unknown>, ok = true): JobRun {
  return { id, ok, ran_at: ranAt, duration_ms: 500, summary };
}

// === Pure derivations =======================================================================

describe("backlogSeries", () => {
  it("back-sums the remaining backlog from newest-first runs, landing on the live count", () => {
    const runs = [
      run("r3", NOW - 1 * MIN, { audited: 5 }), // newest
      run("r2", NOW - 6 * MIN, { audited: 10 }),
      run("r1", NOW - 11 * MIN, { audited: 20 }), // oldest
    ];
    // after r1: 7 + 5 + 10 = 22 · after r2: 7 + 5 = 12 · after r3: 7 (live)
    expect(backlogSeries(7, runs)).toEqual([22, 12, 7]);
  });

  it("is empty with no run history and exact-at-zero when converged", () => {
    expect(backlogSeries(3, [])).toEqual([]);
    expect(backlogSeries(0, [run("r1", NOW, { audited: 4 }), run("r0", NOW - 5 * MIN, { audited: 0 })])).toEqual([4, 0]);
  });
});

describe("deriveAuditObservability", () => {
  it("reads converging while un-audited rows remain, with per-pass ticks and summaries", () => {
    const obs = deriveAuditObservability({
      aliasRuns: [
        run("a2", NOW - 1 * MIN, { audited: 20, self_stamped: 10, kept: 4, repointed: 3, minted: 2, merged: 1, skipped: 0 }),
        run("a1", NOW - 6 * MIN, { audited: 30, self_stamped: 20, kept: 6, repointed: 2, minted: 1, merged: 1, skipped: 0 }),
      ],
      edgeRuns: [run("e1", NOW - 2 * MIN, { audited: 8, self_loops: 1, cycles: 1, dropped: 2, kept: 6, skipped: 0, structural: 3, structural_restored: 1, self_loops_swept: 0, replayed: 2, restored: 1 })],
      skuRuns: [run("s1", NOW - 3 * MIN, { rekeyed: 4, merged: 1, alias_retargeted: 2, truncated: false })],
      aliasBacklog: 50,
      edgeBacklog: 10,
    });

    expect(obs.state).toBe("converging");
    expect(obs.backlog).toMatchObject({ alias: 50, edge: 10, total: 60, converged: false });
    expect(obs.backlog.aliasSeries).toEqual([70, 50]); // 50 + a2's 20, then live
    expect(obs.backlog.edgeSeries).toEqual([10]);
    expect(obs.lastSweep).toBe(NOW - 1 * MIN); // newest across the passes

    const [alias, edge, sku] = obs.passes;
    expect(alias).toMatchObject({ id: "alias", worked: 20, changed: 6, settled: false }); // repointed+minted+merged
    expect(alias.ticks).toEqual([
      { worked: 30, changed: 4 },
      { worked: 20, changed: 6 },
    ]);
    expect(alias.summary).toEqual([
      ["audited", 20],
      ["self_stamped", 10],
      ["kept", 4],
      ["repointed", 3],
      ["minted", 2],
      ["merged", 1],
      ["skipped", 0],
    ]);
    expect(edge).toMatchObject({ id: "edge", worked: 8, changed: 2, settled: false });
    expect(sku).toMatchObject({ id: "sku", worked: 7, changed: 7, settled: false }); // rekeyed+merged+alias_retargeted
    expect(sku.summary).toEqual([
      ["rekeyed", 4],
      ["merged", 1],
      ["alias_retargeted", 2],
    ]);
  });

  it("counts an alias-retarget-only sku tick as work, never a settled no-op", () => {
    const obs = deriveAuditObservability({
      aliasRuns: [],
      edgeRuns: [],
      skuRuns: [run("s", NOW, { rekeyed: 0, merged: 0, alias_retargeted: 3, truncated: false })],
      aliasBacklog: 0,
      edgeBacklog: 0,
    });
    expect(obs.passes[2]).toMatchObject({ id: "sku", worked: 3, changed: 3, settled: false });
  });

  it("is converged only when BOTH backlogs are zero, and passes settle on healthy no-ops", () => {
    const noop = { audited: 0, self_stamped: 0, kept: 0, repointed: 0, minted: 0, merged: 0, skipped: 0 };
    const obs = deriveAuditObservability({
      aliasRuns: [run("a", NOW, noop)],
      edgeRuns: [run("e", NOW, { audited: 0, dropped: 0 })],
      skuRuns: [run("s", NOW, { rekeyed: 0, merged: 0, truncated: false })],
      aliasBacklog: 0,
      edgeBacklog: 0,
    });
    expect(obs.state).toBe("converged");
    expect(obs.backlog.converged).toBe(true);
    expect(obs.passes.every((p) => p.settled)).toBe(true);
  });

  it("never settles a pass on a FAILED no-op run or a truncated sku tick", () => {
    const obs = deriveAuditObservability({
      aliasRuns: [run("a", NOW, { error: "boom" }, false)],
      edgeRuns: [],
      skuRuns: [run("s", NOW, { rekeyed: 0, merged: 0, truncated: true })],
      aliasBacklog: 0,
      edgeBacklog: 0,
    });
    expect(obs.passes[0].settled).toBe(false); // failed run carries {error} → 0/0 but not settled
    expect(obs.passes[2].settled).toBe(false); // capped mid-backlog
  });

  it("is neverRun only with no history AND nothing to drain", () => {
    const obs = deriveAuditObservability({ aliasRuns: [], edgeRuns: [], skuRuns: [], aliasBacklog: 0, edgeBacklog: 0 });
    expect(obs.state).toBe("neverRun");
    expect(obs.lastSweep).toBeNull();
    expect(obs.backlog.aliasSeries).toEqual([]);
  });

  it("reads a fresh deploy with rows already waiting as converging, not idle", () => {
    const obs = deriveAuditObservability({ aliasRuns: [], edgeRuns: [], skuRuns: [], aliasBacklog: 7, edgeBacklog: 0 });
    expect(obs.state).toBe("converging");
    expect(obs.backlog.converged).toBe(false);
  });
});

describe("deriveRecipeBackfill", () => {
  it("reads the unresolved series straight off the run summaries", () => {
    const bf = deriveRecipeBackfill([
      run("r3", NOW - 1 * MIN, { projected: 2, skipped: 0, unresolved: 112, degraded: true }),
      run("r2", NOW - 6 * MIN, { projected: 5, skipped: 0, unresolved: 141, degraded: false }),
      run("r1", NOW - 11 * MIN, { projected: 9, skipped: 1, unresolved: 259, degraded: false }),
    ]);
    expect(bf).not.toBeNull();
    expect(bf!).toMatchObject({ unresolved: 112, start: 259, degraded: true, degradedAt: NOW - 1 * MIN });
    expect(bf!.series).toEqual([259, 141, 112]);
  });

  it("is null when no run carries an unresolved count (nothing to gauge)", () => {
    expect(deriveRecipeBackfill([])).toBeNull();
    expect(deriveRecipeBackfill([run("r", NOW, { projected: 3, skipped: 0 })])).toBeNull();
  });
});

// === Readers over the fake D1 ===============================================================

function seeded() {
  return fakeD1({
    tables: {
      ingredient_alias: [
        { variant: "scallions", id: "green onion", source: "auto", audited_at: null },
        { variant: "evoo", id: "olive oil", source: "auto", audited_at: NOW - 60 * MIN },
        { variant: "butter", id: "butter", source: "human", audited_at: null }, // human — not backlog
      ],
      ingredient_edge: [
        { from_id: "a", to_id: "b", kind: "general", source: "auto", audited_at: null },
        { from_id: "c", to_id: "d", kind: "general", source: "auto", audited_at: NOW - 60 * MIN },
      ],
      job_runs: [
        { id: "al-1", job: "ingredient-alias-audit", ok: 1, ran_at: NOW - 2 * MIN, duration_ms: 400, summary: JSON.stringify({ audited: 12, self_stamped: 6, kept: 3, repointed: 2, minted: 1, merged: 0, skipped: 0 }) },
        { id: "ed-1", job: "ingredient-edge-audit", ok: 1, ran_at: NOW - 1 * MIN, duration_ms: 400, summary: JSON.stringify({ audited: 4, self_loops: 1, cycles: 0, dropped: 1, kept: 3, skipped: 0, structural: 1, structural_restored: 0, self_loops_swept: 0, replayed: 1, restored: 1 }) },
        { id: "sk-1", job: "sku-cache-rekey", ok: 1, ran_at: NOW - 3 * MIN, duration_ms: 400, summary: JSON.stringify({ rekeyed: 2, merged: 1, truncated: false }) },
      ],
      ingredient_normalization_log: [
        // Structured post-calibration keep.
        { id: 10, term: "ground beef::fat-80-20 -[general]-> ground beef", outcome: "edge_keep", resolved_id: null, candidates: null, model: "m", detail: JSON.stringify({ audit: "edge", from: "ground beef::fat-80-20", to: "ground beef", kind: "general", direction: "forward", reason: "spec satisfies base" }), created_at: NOW - 50 * MIN },
        // Deterministic self-loop drop (born-marked replayed_at).
        { id: 11, term: "green onion -[general]-> green onion", outcome: "edge_drop", resolved_id: null, candidates: null, model: null, detail: JSON.stringify({ audit: "edge", from: "green onion", to: "green onion", kind: "general", note: "self_loop", replayed_at: NOW - 40 * MIN }), created_at: NOW - 40 * MIN },
        // LEGACY drop — no structured fields; the edge must parse from the term string.
        { id: 12, term: "chives -[general]-> green onion", outcome: "edge_drop", resolved_id: null, candidates: null, model: "m", detail: JSON.stringify({ direction: "neither", reason: "distinct alliums" }), created_at: NOW - 30 * MIN },
        // The replay revisits drop 12 and restores it.
        { id: 13, term: "chives -[general]-> green onion", outcome: "edge_restore", resolved_id: null, candidates: null, model: "m", detail: JSON.stringify({ audit: "edge", replay_of: 12, direction: "forward", reason: "satisfies after re-check", from: "chives", to: "green onion", kind: "general" }), created_at: NOW - 20 * MIN },
        // A structural-guarantee restore (no replay_of).
        { id: 14, term: "kosher salt::coarse -[general]-> kosher salt", outcome: "edge_restore", resolved_id: null, candidates: null, model: null, detail: JSON.stringify({ audit: "edge", note: "structural_guarantee", from: "kosher salt::coarse", to: "kosher salt", kind: "general" }), created_at: NOW - 10 * MIN },
        // Malformed legacy noise — neither structured fields nor a parseable term. Dropped.
        { id: 15, term: "not an edge", outcome: "edge_drop", resolved_id: null, candidates: null, model: null, detail: null, created_at: NOW - 5 * MIN },
        // A term decision — must never enter the edge stream.
        { id: 16, term: "scallions", outcome: "same", resolved_id: "green onion", candidates: null, model: "m", detail: null, created_at: NOW - 1 * MIN },
      ],
      ingredient_coresolution_rejection: [
        { a: "chives", b: "green onion", decided_at: NOW - 3 * 86_400_000 },
        { a: "baking powder", b: "baking soda", decided_at: NOW - 11 * 86_400_000 },
      ],
    },
  });
}

describe("readAuditObservability", () => {
  it("counts only auto un-audited rows and derives the model from the run windows", async () => {
    const obs = await readAuditObservability(seeded().env);
    expect(obs.state).toBe("converging");
    // scallions (auto, null) counts; evoo is stamped; butter is human.
    expect(obs.backlog).toMatchObject({ alias: 1, edge: 1, total: 2, converged: false });
    expect(obs.backlog.aliasSeries).toEqual([1]); // one retained run → one point, the live count
    expect(obs.passes.map((p) => p.id)).toEqual(["alias", "edge", "sku"]);
    expect(obs.lastSweep).toBe(NOW - 1 * MIN);
  });
});

describe("readEdgeDecisionLog", () => {
  it("parses structured + legacy rows, flags, and restore back-links; drops malformed noise", async () => {
    const log = await readEdgeDecisionLog(seeded().env);

    // Newest-first; the term decision (16) and the malformed row (15) never enter.
    expect(log.decisions.map((d) => d.id)).toEqual([12, 11, 10]);

    const byId = Object.fromEntries(log.decisions.map((d) => [d.id, d]));
    expect(byId[10]).toMatchObject({ outcome: "keep", from: "ground beef::fat-80-20", to: "ground beef", kind: "general", direction: "forward", flag: null, revisitedBy: null });
    expect(byId[11]).toMatchObject({ outcome: "drop", flag: "self-loop", note: "self_loop" });
    // Legacy row: edge parsed from the term via the strict shared regex; revisited by 13.
    expect(byId[12]).toMatchObject({ outcome: "drop", from: "chives", to: "green onion", kind: "general", reason: "distinct alliums", revisitedBy: 13 });

    expect(log.restorations.map((r) => r.id)).toEqual([14, 13]);
    expect(log.restorations[0]).toMatchObject({ via: "structural", origin: null, from: "kosher salt::coarse" });
    expect(log.restorations[1]).toMatchObject({ via: "replay", origin: 12, reason: "satisfies after re-check" });
  });
});

describe("readMergeRejections", () => {
  it("orders newest-first, stamps the backoff expiry, and drops lapsed rows", async () => {
    const d = seeded();
    // A pair whose backoff lapsed (older than the 30-day window) — re-eligible, so not "held".
    d.tables.ingredient_coresolution_rejection.push({ a: "table salt", b: "kosher salt", decided_at: NOW - 45 * 86_400_000 });
    const rejections = await readMergeRejections(d.env, NOW);
    expect(rejections.map((r) => r.a)).toEqual(["chives", "baking powder"]);
    expect(rejections[0].expiresAt).toBe(rejections[0].rejectedAt + NORMALIZE_CORESOLVE_REJECT_BACKOFF_MS);
    expect(CORESOLVE_BACKOFF_DAYS).toBe(30);
  });
});

describe("readAuditSurface", () => {
  it("assembles the one-shot Normalize payload", async () => {
    const s = await readAuditSurface(seeded().env, NOW);
    expect(s.obs.state).toBe("converging");
    expect(s.edges).toHaveLength(3);
    expect(s.restorations).toHaveLength(2);
    expect(s.rejections).toHaveLength(2);
    expect(s.backoffDays).toBe(30);
  });
});
