import { describe, it, expect } from "vitest";
import { deriveReconcile } from "../src/reconcile-admin.js";
import type { JobRun } from "../src/health.js";

// The reconcile observability derivation: `deriveReconcile` turns the `grocery-reconcile` per-run
// history (newest-first, as `readJobRuns` returns) into the convergence card's model. Pure — no D1
// — so the converged-vs-converging + no-runs cases are pinned directly here.

/** A `grocery-reconcile` run with a `{grocery_rekeyed, pantry_rekeyed, truncated}` summary. */
function run(ranAt: number, g: number, p: number, truncated = false, ok = true): JobRun {
  return {
    id: `grocery-reconcile-${ranAt}`,
    ok,
    ran_at: ranAt,
    duration_ms: 5,
    summary: { grocery_rekeyed: g, pantry_rekeyed: p, truncated },
  };
}

describe("deriveReconcile", () => {
  it("no runs yet → a calm neverRun model the card can render", () => {
    const m = deriveReconcile([], 5);
    expect(m.state).toBe("neverRun");
    expect(m.ticks).toEqual([]);
    expect(m.lifetimeMerged).toBe(0);
    expect(m.grocery_rekeyed).toBe(0);
    expect(m.pantry_rekeyed).toBe(0);
    expect(m.lastTick).toBeNull();
    expect(m.convergedAt).toBeNull();
    expect(m.lastMerge).toBeNull();
    expect(m.cadenceMin).toBe(5);
    expect(m.cap).toBe(500);
  });

  it("latest tick re-keyed rows → converging, with live counts + oldest→newest ticks", () => {
    // newest-first input: newest did 40/25
    const runs = [run(300, 40, 25), run(200, 10, 4), run(100, 96, 61)];
    const m = deriveReconcile(runs, 5);
    expect(m.state).toBe("converging");
    expect(m.grocery_rekeyed).toBe(40);
    expect(m.pantry_rekeyed).toBe(25);
    // ticks are oldest→newest
    expect(m.ticks).toEqual([
      { g: 96, p: 61 },
      { g: 10, p: 4 },
      { g: 40, p: 25 },
    ]);
    expect(m.lastTick).toBe(300);
    expect(m.startedAt).toBe(100);
    // lifetime sums grocery+pantry over the window
    expect(m.lifetimeMerged).toBe(96 + 61 + 10 + 4 + 40 + 25);
    // most recent run with any re-keys
    expect(m.lastMerge).toBe(300);
    expect(m.convergedAt).toBeNull();
  });

  it("latest tick did 0 and wasn't truncated → converged (positive terminal state)", () => {
    // Work tailed off; the last three ticks are silent no-ops.
    const runs = [run(500, 0, 0), run(400, 0, 0), run(300, 0, 0), run(200, 3, 1), run(100, 8, 4)];
    const m = deriveReconcile(runs, 5);
    expect(m.state).toBe("converged");
    expect(m.grocery_rekeyed).toBe(0);
    expect(m.pantry_rekeyed).toBe(0);
    // convergedAt = the FIRST of the trailing run of zero no-op ticks (ran_at 300 here)
    expect(m.convergedAt).toBe(300);
    // lastMerge = the most recent run that actually re-keyed (ran_at 200)
    expect(m.lastMerge).toBe(200);
    expect(m.lifetimeMerged).toBe(3 + 1 + 8 + 4);
  });

  it("latest tick did 0 but hit the cap → still converging (a backlog remains)", () => {
    const runs = [run(200, 0, 0, /* truncated */ true), run(100, 300, 200, true)];
    const m = deriveReconcile(runs, 5);
    expect(m.state).toBe("converging");
    expect(m.truncated).toBe(true);
    expect(m.convergedAt).toBeNull();
  });

  it("a failed run contributes a zero tick and does not count as a merge", () => {
    const runs = [run(300, 0, 0), { ...run(200, 0, 0, false, false), summary: { error: "boom" } }, run(100, 5, 2)];
    const m = deriveReconcile(runs, 5);
    // latest is a real, HEALTHY 0/0 no-op → converged
    expect(m.state).toBe("converged");
    // the middle (failed) run's summary has no counts → tick 0/0, not a merge
    expect(m.ticks).toEqual([
      { g: 5, p: 2 },
      { g: 0, p: 0 },
      { g: 0, p: 0 },
    ]);
    expect(m.lastMerge).toBe(100);
    // convergedAt STOPS at the failed run — "converged since T" must not span an error, so it's the
    // latest healthy no-op (300), not the failed run's 200.
    expect(m.convergedAt).toBe(300);
  });

  it("a FAILED latest run is converging, never the healthy 'converged' terminal state", () => {
    // The most recent run errored (an `{error}` summary → 0/0 counts). Without the ok check it would
    // masquerade as converged on the one surface that flags this job (it's not in HEALTH_JOBS).
    const runs = [{ ...run(300, 0, 0, false, false), summary: { error: "d1 down" } }, run(200, 0, 0), run(100, 4, 1)];
    const m = deriveReconcile(runs, 5);
    expect(m.state).toBe("converging");
    expect(m.convergedAt).toBeNull();
  });

  it("a single converged tick → convergedAt is that tick, lastMerge null", () => {
    const m = deriveReconcile([run(100, 0, 0)], 5);
    expect(m.state).toBe("converged");
    expect(m.convergedAt).toBe(100);
    expect(m.lastMerge).toBeNull();
    expect(m.lifetimeMerged).toBe(0);
  });
});
