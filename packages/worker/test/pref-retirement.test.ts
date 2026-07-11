// runPrefRetirementSeedJob (profile-reconciliation) over REAL SQLite — the F5
// acceptance fixture's local shape: the production pre-state (casey lunch_strategy
// 'mixed' + ready_to_eat_default_action 'auto-add', everett/caitie NULL, austin/jack
// no row) seeds exactly two `pref-retire:*` add_vibe proposals for casey and NULLs
// both retired columns; the second tick is a NO-OP (columns-NULL is the convergence
// predicate); a member's dismissal never resurrects; the `custom` bag is byte-
// identical; the enqueue idempotency covers the enqueue→NULL crash window.

import { describe, it, expect } from "vitest";
import { sqliteEnv } from "./sqlite-d1.js";
import { runPrefRetirementSeedJob, draftRetirementSeeds } from "../src/pref-retirement.js";

const CASEY_CUSTOM =
  '{"defaults":{"default_cooking_nights":3,"lunch_strategy":"leftovers when available; instant ramen and buldak as fallback","no_cook_days":["Sunday"]}}';

function seedF5(h: ReturnType<typeof sqliteEnv>): void {
  const prof = h.raw.prepare(
    "INSERT INTO profile (tenant, default_cooking_nights, lunch_strategy, ready_to_eat_default_action, custom) VALUES (?, ?, ?, ?, ?)",
  );
  prof.run("caitie", 4, null, null, null);
  prof.run("casey", 5, "mixed", "auto-add", CASEY_CUSTOM);
  prof.run("everett", null, null, null, null);
  // austin / jack: no profile row — skipped structurally by the WHERE clause.
}

function proposals(h: ReturnType<typeof sqliteEnv>) {
  return h.raw
    .prepare("SELECT tenant, kind, target, payload, status, producer FROM pending_proposals ORDER BY tenant, target")
    .all() as { tenant: string; kind: string; target: string; payload: string; status: string; producer: string }[];
}

describe("runPrefRetirementSeedJob (F5)", () => {
  it("first tick: exactly two pref-retire proposals for casey, both retired columns NULL, other tenants untouched, custom byte-identical", async () => {
    const h = sqliteEnv();
    seedF5(h);
    await runPrefRetirementSeedJob(h.env);

    const rows = proposals(h);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tenant === "casey" && r.kind === "add_vibe" && r.status === "pending" && r.producer === "pref-retirement")).toBe(true);
    expect(rows.map((r) => r.target)).toEqual(["pref-retire:lunch_strategy", "pref-retire:rte"]);
    const lunch = JSON.parse(rows[0].payload) as Record<string, unknown>;
    expect(lunch).toMatchObject({ vibe: "leftovers or something quick and easy", meal: "lunch" });
    const rte = JSON.parse(rows[1].payload) as Record<string, unknown>;
    expect(rte).toMatchObject({ vibe: "a zero-effort heat-and-eat night", meal: "dinner" });

    const profs = h.raw
      .prepare("SELECT tenant, lunch_strategy, ready_to_eat_default_action, default_cooking_nights, custom FROM profile ORDER BY tenant")
      .all() as Record<string, unknown>[];
    for (const p of profs) {
      expect(p.lunch_strategy).toBeNull();
      expect(p.ready_to_eat_default_action).toBeNull();
    }
    const casey = profs.find((p) => p.tenant === "casey")!;
    expect(casey.custom).toBe(CASEY_CUSTOM); // never read or written
    expect(casey.default_cooking_nights).toBe(5); // frozen, NOT NULLed (the cadence fallback reads it)
    expect(profs).toHaveLength(3); // no row minted for austin/jack
  });

  it("second tick is a no-op — columns-NULL is the convergence predicate, and a dismissal never resurrects", async () => {
    const h = sqliteEnv();
    seedF5(h);
    await runPrefRetirementSeedJob(h.env);
    // The member dismisses one seed (rejected is a member verb — final).
    h.raw.prepare("UPDATE pending_proposals SET status = 'rejected' WHERE target = 'pref-retire:rte'").run();

    await runPrefRetirementSeedJob(h.env);
    const rows = proposals(h);
    expect(rows).toHaveLength(2); // nothing new
    expect(rows.find((r) => r.target === "pref-retire:rte")!.status).toBe("rejected"); // untouched
  });

  it("opt-in seeds nothing but still converges; a lone auto-add seeds the dinner vibe only", async () => {
    const h = sqliteEnv();
    h.raw
      .prepare("INSERT INTO profile (tenant, lunch_strategy, ready_to_eat_default_action) VALUES ('everett', NULL, 'opt-in')")
      .run();
    await runPrefRetirementSeedJob(h.env);
    expect(proposals(h)).toHaveLength(0);
    const p = h.raw.prepare("SELECT ready_to_eat_default_action FROM profile WHERE tenant = 'everett'").get() as Record<string, unknown>;
    expect(p.ready_to_eat_default_action).toBeNull();
  });

  it("the enqueue→NULL crash window is covered by the (tenant, kind, target) enqueue idempotency", async () => {
    const h = sqliteEnv();
    seedF5(h);
    // Simulate a crash AFTER the enqueue but BEFORE the NULL: run once, then restore the
    // columns as if the batch had split (a worst-case re-process).
    await runPrefRetirementSeedJob(h.env);
    h.raw.prepare("UPDATE profile SET lunch_strategy = 'mixed', ready_to_eat_default_action = 'auto-add' WHERE tenant = 'casey'").run();
    await runPrefRetirementSeedJob(h.env);
    expect(proposals(h)).toHaveLength(2); // no duplicate seeds
    const casey = h.raw.prepare("SELECT lunch_strategy, ready_to_eat_default_action FROM profile WHERE tenant = 'casey'").get() as Record<string, unknown>;
    expect(casey.lunch_strategy).toBeNull();
    expect(casey.ready_to_eat_default_action).toBeNull();
  });

  it("records job health under pref-retirement", async () => {
    const h = sqliteEnv();
    seedF5(h);
    await runPrefRetirementSeedJob(h.env);
    const health = h.raw.prepare("SELECT name, ok FROM job_health WHERE name = 'pref-retirement'").get() as Record<string, unknown>;
    expect(health.ok).toBe(1);
  });
});

describe("draftRetirementSeeds (the total, decisive mapping)", () => {
  it("maps every lunch_strategy value; unknown values seed nothing (still converge)", () => {
    expect(draftRetirementSeeds({ tenant: "t", lunch_strategy: "leftovers", ready_to_eat_default_action: null })[0].payload.vibe).toBe(
      "leftovers remixed into lunch",
    );
    expect(draftRetirementSeeds({ tenant: "t", lunch_strategy: "buy", ready_to_eat_default_action: null })[0].payload.vibe).toBe(
      "grab-and-go bought lunch",
    );
    expect(draftRetirementSeeds({ tenant: "t", lunch_strategy: "surprise-me", ready_to_eat_default_action: null })).toHaveLength(0);
  });
});
