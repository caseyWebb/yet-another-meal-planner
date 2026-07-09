import { describe, it, expect } from "vitest";
import { draftProposals, runReconcileSignalsJob } from "../src/reconcile-signals.js";
import type { NightVibe } from "../src/night-vibe-db.js";
import { proposalId, enqueueProposal, readProposals, setProposalStatus, supersedeProposals, getProposal } from "../src/reconcile-db.js";
import { resolveProposal } from "../src/reconcile-tools.js";
import { ToolError } from "../src/errors.js";
import { fakeD1 } from "./fake-d1.js";

const NOW = new Date("2026-07-01T00:00:00Z");

function vibe(over: Partial<NightVibe> & { id: string; vibe: string }): NightVibe {
  return { ...over };
}

describe("draftProposals", () => {
  it("proposes PRUNE for a cadence vibe added long ago and never satisfied", () => {
    const palette = [vibe({ id: "salad", vibe: "a light salad", cadence_days: 7, created_at: "2026-04-01T00:00:00Z" })];
    const drafts = draftProposals(palette, new Map(), NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: "prune_vibe", target: "salad", payload: { id: "salad" } });
  });

  it("does NOT propose pruning a freshly-added, never-satisfied vibe", () => {
    const palette = [vibe({ id: "new", vibe: "a new idea", cadence_days: 7, created_at: "2026-06-28T00:00:00Z" })];
    expect(draftProposals(palette, new Map(), NOW)).toHaveLength(0);
  });

  it("proposes ADJUST when the real interval runs well past the cadence", () => {
    const palette = [vibe({ id: "pasta", vibe: "weeknight pasta", cadence_days: 7, created_at: "2026-01-01T00:00:00Z" })];
    // last cooked 2026-06-01 → ~30 days ago vs a 7-day cadence (> 3×).
    const drafts = draftProposals(palette, new Map([["pasta", ["2026-06-01"]]]), NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("adjust_cadence");
    expect((drafts[0].payload as { cadence_days: number }).cadence_days).toBeGreaterThan(7);
  });

  it("proposes nothing for a recently-satisfied or cadence-less vibe", () => {
    const palette = [
      vibe({ id: "pasta", vibe: "weeknight pasta", cadence_days: 7, created_at: "2026-01-01T00:00:00Z" }),
      vibe({ id: "wild", vibe: "a wildcard", created_at: "2026-01-01T00:00:00Z" }), // no cadence
    ];
    const drafts = draftProposals(palette, new Map([["pasta", ["2026-06-28"]]]), NOW); // 3 days ago
    expect(drafts).toHaveLength(0);
  });

  it("gives a stable id per (kind, target), bucketing adjust_cadence by suggested value", () => {
    expect(proposalId("prune_vibe", "salad")).toBe(proposalId("prune_vibe", "salad"));
    expect(proposalId("prune_vibe", "salad")).not.toBe(proposalId("prune_vibe", "soup"));
    // adjust_cadence folds a coarse ~weekly bucket in, so a materially different suggestion is new
    expect(proposalId("adjust_cadence", "pasta", { cadence_days: 7 })).not.toBe(
      proposalId("adjust_cadence", "pasta", { cadence_days: 60 }),
    );
    expect(proposalId("adjust_cadence", "pasta", { cadence_days: 7 })).toBe(
      proposalId("adjust_cadence", "pasta", { cadence_days: 8 }), // same ~weekly bucket
    );
  });
});

describe("pending_proposals store", () => {
  it("enqueues idempotently, reads pending, and resolves on confirm", async () => {
    const d1 = fakeD1({ tables: { pending_proposals: [] } });
    const draft = { kind: "prune_vibe" as const, target: "salad", payload: { id: "salad" }, rationale: "drop it?", evidence: {} };

    const first = await enqueueProposal(d1.env, "everett", draft, "signal-cron", NOW.toISOString());
    expect(first.inserted).toBe(true);
    const again = await enqueueProposal(d1.env, "everett", draft, "signal-cron", NOW.toISOString());
    expect(again.inserted).toBe(false); // stable id → no duplicate

    const pending = await readProposals(d1.env, "everett", "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "prune_vibe", target: "salad", status: "pending" });

    const ok = await setProposalStatus(d1.env, first.id, "everett", "rejected", NOW.toISOString());
    expect(ok).toBe(true);
    expect(await readProposals(d1.env, "everett", "pending")).toHaveLength(0);
    expect((await getProposal(d1.env, first.id, "everett"))?.status).toBe("rejected");
  });

  it("keeps two tenants' same-(kind,target) proposals distinct (PK is (tenant, id))", async () => {
    const d1 = fakeD1({ tables: { pending_proposals: [] } });
    const draft = { kind: "prune_vibe" as const, target: "salad", payload: { id: "salad" }, rationale: "drop it?", evidence: {} };
    const a = await enqueueProposal(d1.env, "alice", draft, "signal-cron", NOW.toISOString());
    const b = await enqueueProposal(d1.env, "bob", draft, "signal-cron", NOW.toISOString());
    expect(a.id).toBe(b.id); // same hash (tenant excluded)
    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(true); // but the (tenant, id) PK keeps both — no cross-tenant clobber
    expect(await readProposals(d1.env, "alice", "pending")).toHaveLength(1);
    expect(await readProposals(d1.env, "bob", "pending")).toHaveLength(1);
  });

  it("supersedeProposals flips only pending rows, never a member-resolved one, and stamps resolved_at", async () => {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [
          { tenant: "everett", id: "p1", kind: "add_vibe", status: "pending", created_at: "2026-07-01T00:00:00Z" },
          { tenant: "everett", id: "p2", kind: "add_vibe", status: "pending", created_at: "2026-07-02T00:00:00Z" },
          { tenant: "everett", id: "r1", kind: "add_vibe", status: "rejected", created_at: "2026-07-03T00:00:00Z", resolved_at: "2026-07-03T12:00:00Z" },
          { tenant: "other", id: "p1", kind: "add_vibe", status: "pending", created_at: "2026-07-01T00:00:00Z" },
        ],
      },
    });
    const changed = await supersedeProposals(d1.env, "everett", ["p1", "r1"], NOW.toISOString());
    expect(changed).toBe(1); // only the pending p1 flips; the rejected r1 is untouched by the guard
    const p1 = await getProposal(d1.env, "p1", "everett");
    expect(p1?.status).toBe("superseded");
    expect(d1.tables.pending_proposals.find((r) => r.tenant === "everett" && r.id === "p1")?.resolved_at).toBe(NOW.toISOString());
    // The member dismissal keeps its status AND its original resolved_at — never rewritten.
    const r1 = d1.tables.pending_proposals.find((r) => r.id === "r1");
    expect(r1?.status).toBe("rejected");
    expect(r1?.resolved_at).toBe("2026-07-03T12:00:00Z");
    // Cross-tenant isolation: the other tenant's same-id pending row is not touched.
    expect((await getProposal(d1.env, "p1", "other"))?.status).toBe("pending");
  });

  it("readProposals(pending) excludes superseded rows; superseded answers a structured conflict on confirm", async () => {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [],
        night_vibes: [],
      },
    });
    const draft = { kind: "add_vibe" as const, target: "cozy", payload: { id: "cozy", vibe: "a cozy braise" }, rationale: "add it?", evidence: {} };
    const { id } = await enqueueProposal(d1.env, "everett", draft, "edge", NOW.toISOString());
    await supersedeProposals(d1.env, "everett", [id], NOW.toISOString());
    expect(await readProposals(d1.env, "everett", "pending")).toHaveLength(0);
    const err = await resolveProposal(d1.env, "everett", id, true).catch((e) => e as ToolError);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("conflict");
    expect((err as ToolError).context).toMatchObject({ id, status: "superseded" });
  });
});

describe("resolveProposal (shared confirm op — tool + member API)", () => {
  const draft = { kind: "prune_vibe" as const, target: "salad", payload: { id: "salad" }, rationale: "drop it?", evidence: {} };

  it("accepts a pending proposal: applies the diff and records accepted", async () => {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [],
        night_vibes: [{ tenant: "everett", id: "salad", vibe: "a light salad" }],
      },
    });
    const { id } = await enqueueProposal(d1.env, "everett", draft, "edge", NOW.toISOString());
    const out = await resolveProposal(d1.env, "everett", id, true);
    expect(out).toMatchObject({ id, status: "accepted", applied: expect.stringContaining("salad") });
    expect(d1.tables.night_vibes).toHaveLength(0); // the prune applied
    expect((await getProposal(d1.env, id, "everett"))?.status).toBe("accepted");
  });

  it("rejects a pending proposal without applying anything", async () => {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [],
        night_vibes: [{ tenant: "everett", id: "salad", vibe: "a light salad" }],
      },
    });
    const { id } = await enqueueProposal(d1.env, "everett", draft, "edge", NOW.toISOString());
    const out = await resolveProposal(d1.env, "everett", id, false);
    expect(out).toEqual({ id, status: "rejected" });
    expect(d1.tables.night_vibes).toHaveLength(1); // untouched
  });

  it("answers a double-confirm with structured conflict, changing nothing (D8)", async () => {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [],
        night_vibes: [{ tenant: "everett", id: "salad", vibe: "a light salad" }],
      },
    });
    const { id } = await enqueueProposal(d1.env, "everett", draft, "edge", NOW.toISOString());
    await resolveProposal(d1.env, "everett", id, false);
    const err = await resolveProposal(d1.env, "everett", id, true).catch((e) => e as ToolError);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("conflict");
    expect((err as ToolError).context).toMatchObject({ id, status: "rejected" });
    // The earlier resolution stands; the vibe was never pruned.
    expect((await getProposal(d1.env, id, "everett"))?.status).toBe("rejected");
    expect(d1.tables.night_vibes).toHaveLength(1);
  });

  it("accepting a merge_recipes proposal records the decision and writes NOTHING (recipe-dedup)", async () => {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [],
        night_vibes: [{ tenant: "casey", id: "salad", vibe: "a light salad" }],
      },
    });
    const merge = {
      kind: "merge_recipes" as const,
      target: "fresh-pasta+homemade-pasta-dough",
      payload: { slugs: ["fresh-pasta", "homemade-pasta-dough"], titles: ["Fresh Pasta", "Homemade Pasta Dough"] },
      rationale: "same dish?",
      evidence: {},
    };
    const { id } = await enqueueProposal(d1.env, "casey", merge, "dup-scan", NOW.toISOString());
    const out = await resolveProposal(d1.env, "casey", id, true);
    expect(out).toMatchObject({ id, status: "accepted", applied: expect.stringContaining("agent-guided") });
    expect((await getProposal(d1.env, id, "casey"))?.status).toBe("accepted");
    // The apply path touched no palette row (and there is no corpus write surface here at all).
    expect(d1.tables.night_vibes).toHaveLength(1);
  });

  it("answers an unknown id (or another tenant's proposal) with not_found", async () => {
    const d1 = fakeD1({ tables: { pending_proposals: [] } });
    const { id } = await enqueueProposal(d1.env, "alice", draft, "edge", NOW.toISOString());
    const err = await resolveProposal(d1.env, "bob", id, true).catch((e) => e as ToolError);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("not_found");
  });
});

// --- the cadence-TIGHTEN rule (member-app-propose D6) ----------------------------------------

describe("draftProposals — tighten", () => {
  // A vibe satisfied 3, 10, and 16 days ago on a 14-day cadence: recent intervals 7 and 6
  // (both ≤ 14 × 0.5), currently on-track (3 < 14).
  const tightVibe = vibe({ id: "noodles", vibe: "fast noodles", cadence_days: 14, created_at: "2026-01-01T00:00:00Z" });
  const tightDates = new Map([["noodles", ["2026-06-28", "2026-06-21", "2026-06-15"]]]);

  it("fires on repeated tight intervals while on-track, suggesting the observed interval", () => {
    const drafts = draftProposals([tightVibe], tightDates, NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: "adjust_cadence",
      target: "noodles",
      payload: { id: "noodles", cadence_days: 7 }, // round(mean(7, 6))
      evidence: { intervals_days: [7, 6], cadence_days: 14, last_satisfied: "2026-06-28" },
    });
    expect(drafts[0].rationale).toMatch(/tighten/i);
  });

  it("the on-track guard blocks a vibe that later went overdue, tight history or not", () => {
    // Same tight historical intervals, but the LAST satisfaction is 20 days back (≥ 14).
    const overdue = new Map([["noodles", ["2026-06-11", "2026-06-04", "2026-05-29"]]]);
    expect(draftProposals([tightVibe], overdue, NOW)).toHaveLength(0); // 20 < 3×14 → no stretch either
  });

  it("fewer than 3 satisfactions never tighten", () => {
    const two = new Map([["noodles", ["2026-06-28", "2026-06-21"]]]);
    expect(draftProposals([tightVibe], two, NOW)).toHaveLength(0);
  });

  it("a loose recent interval blocks (EVERY recent interval must be tight)", () => {
    // 7-day then 12-day intervals on a 14-day cadence: 12 > 7 (14 × 0.5) → no draft.
    const mixed = new Map([["noodles", ["2026-06-28", "2026-06-21", "2026-06-09"]]]);
    expect(draftProposals([tightVibe], mixed, NOW)).toHaveLength(0);
  });

  it("a suggestion not strictly below the current cadence is dropped (the floor can collide)", () => {
    // cadence 3, satisfied daily: intervals 1,1 ≤ 1.5, but max(3, 1) == 3 is NOT < 3.
    const daily = vibe({ id: "daily", vibe: "every night", cadence_days: 3, created_at: "2026-01-01T00:00:00Z" });
    const dates = new Map([["daily", ["2026-06-30", "2026-06-29", "2026-06-28"]]]);
    expect(draftProposals([daily], dates, NOW)).toHaveLength(0);
  });

  it("floors the suggestion at 3 days", () => {
    // cadence 14, satisfied every single day → mean interval 1 → suggested 3.
    const dates = new Map([["noodles", ["2026-06-30", "2026-06-29", "2026-06-28"]]]);
    const drafts = draftProposals([tightVibe], dates, NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].payload).toMatchObject({ cadence_days: 3 });
  });

  it("stretch and tighten are disjoint on one palette pass — never both for one vibe", () => {
    const palette = [
      tightVibe,
      vibe({ id: "project", vibe: "a project cook", cadence_days: 7, created_at: "2026-01-01T00:00:00Z" }),
    ];
    const dates = new Map([
      ["noodles", ["2026-06-28", "2026-06-21", "2026-06-15"]], // tighten
      ["project", ["2026-06-01", "2026-05-28", "2026-05-25"]], // 30 days since, ≥ 3×7 → stretch
    ]);
    const drafts = draftProposals(palette, dates, NOW);
    expect(drafts).toHaveLength(2);
    const byTarget = new Map(drafts.map((d) => [d.target, d]));
    expect(byTarget.get("noodles")!.rationale).toMatch(/tighten/i);
    expect(byTarget.get("project")!.rationale).toMatch(/stretch/i);
    expect(drafts.filter((d) => d.target === "noodles")).toHaveLength(1);
  });

  it("a rejected tighten at ~the same value is not re-surfaced; a materially different one is new", async () => {
    const d1 = fakeD1({ tables: { pending_proposals: [] } });
    const [draft] = draftProposals([tightVibe], tightDates, NOW);
    const first = await enqueueProposal(d1.env, "everett", draft, "signal-cron", NOW.toISOString());
    await setProposalStatus(d1.env, first.id, "everett", "rejected", NOW.toISOString());

    // The same behavior window re-drafts the same bucketed id → INSERT OR IGNORE no-op.
    const redraft = await enqueueProposal(d1.env, "everett", draft, "signal-cron", NOW.toISOString());
    expect(redraft.id).toBe(first.id);
    expect(redraft.inserted).toBe(false);
    expect(await readProposals(d1.env, "everett", "pending")).toHaveLength(0);

    // A materially different later suggestion (a different ~weekly bucket) is a NEW proposal.
    const different = { ...draft, payload: { ...draft.payload, cadence_days: 21 } };
    const later = await enqueueProposal(d1.env, "everett", different, "signal-cron", NOW.toISOString());
    expect(later.id).not.toBe(first.id);
    expect(later.inserted).toBe(true);
  });
});

describe("runReconcileSignalsJob — the tighten path through the cron wrapper", () => {
  function jobEnv() {
    const d1 = fakeD1({
      tables: {
        pending_proposals: [],
        night_vibes: [
          {
            tenant: "casey",
            id: "noodles",
            vibe: "fast noodles",
            facets: null,
            cadence_days: 14,
            pinned: 0,
            base_weight: null,
            weather_affinity: null,
            weather_antipathy: null,
            season: null,
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        cooking_log: [
          { tenant: "casey", date: "2026-06-28", type: "recipe", recipe: "r1", satisfied_vibe: "noodles" },
          { tenant: "casey", date: "2026-06-21", type: "recipe", recipe: "r2", satisfied_vibe: "noodles" },
          { tenant: "casey", date: "2026-06-15", type: "recipe", recipe: "r3", satisfied_vibe: "noodles" },
        ],
        job_health: [],
        job_runs: [],
      },
    });
    const tenantKv = {
      async get(key: string) {
        return key === "tenant:casey" ? JSON.stringify({ id: "casey" }) : null;
      },
      async put() {},
      async list({ prefix = "" }: { prefix?: string } = {}) {
        return { keys: prefix === "tenant:" ? [{ name: "tenant:casey" }] : [], list_complete: true, cacheStatus: null };
      },
    };
    const env = { ...(d1.env as object), TENANT_KV: tenantKv, TOOL_AE: { writeDataPoint: () => {} } } as unknown as typeof d1.env;
    return { env, d1 };
  }

  it("drafts + enqueues the tighten once; a second tick is a no-op (stable id)", async () => {
    const { env, d1 } = jobEnv();
    await runReconcileSignalsJob(env, () => NOW.getTime());
    expect(d1.tables.pending_proposals).toHaveLength(1);
    expect(d1.tables.pending_proposals[0]).toMatchObject({ kind: "adjust_cadence", target: "noodles", producer: "signal-cron", status: "pending" });
    expect(JSON.parse(String(d1.tables.pending_proposals[0].payload))).toEqual({ id: "noodles", cadence_days: 7 });

    await runReconcileSignalsJob(env, () => NOW.getTime()); // second tick — idempotent
    expect(d1.tables.pending_proposals).toHaveLength(1);
  });
});
