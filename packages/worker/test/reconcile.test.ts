import { describe, it, expect } from "vitest";
import { draftProposals } from "../src/reconcile-signals.js";
import type { NightVibe } from "../src/night-vibe-db.js";
import { proposalId, enqueueProposal, readProposals, setProposalStatus, getProposal } from "../src/reconcile-db.js";
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
    const drafts = draftProposals(palette, new Map([["pasta", "2026-06-01"]]), NOW);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("adjust_cadence");
    expect((drafts[0].payload as { cadence_days: number }).cadence_days).toBeGreaterThan(7);
  });

  it("proposes nothing for a recently-satisfied or cadence-less vibe", () => {
    const palette = [
      vibe({ id: "pasta", vibe: "weeknight pasta", cadence_days: 7, created_at: "2026-01-01T00:00:00Z" }),
      vibe({ id: "wild", vibe: "a wildcard", created_at: "2026-01-01T00:00:00Z" }), // no cadence
    ];
    const drafts = draftProposals(palette, new Map([["pasta", "2026-06-28"]]), NOW); // 3 days ago
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

  it("answers an unknown id (or another tenant's proposal) with not_found", async () => {
    const d1 = fakeD1({ tables: { pending_proposals: [] } });
    const { id } = await enqueueProposal(d1.env, "alice", draft, "edge", NOW.toISOString());
    const err = await resolveProposal(d1.env, "bob", id, true).catch((e) => e as ToolError);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("not_found");
  });
});
