import { describe, it, expect } from "vitest";
import {
  enqueueTask,
  claimTasks,
  completeTask,
  failTask,
  getTask,
  LEASE_DURATION_MS,
  type NewTask,
} from "../src/satellite-tasks-db.js";
import { sqliteEnv } from "./sqlite-d1.js";

// The pull-channel queue (satellite-pull-channel) against a REAL SQLite (node:sqlite) with the
// actual migration DDL — so the atomic claim, lease expiry, scope/capability filtering, the
// attempt-cap park, and the partial-unique idempotent enqueue are exercised for real (the SQL
// the fake-d1 simulator cannot execute). There is no concrete task `kind` in the product; the
// tests use synthetic kinds ("scan"/"fill"), exactly as the channel is meant to be extended.

const NOW = 1_800_000_000_000;

/** A synthetic operator-scope task (payload marks who it belongs to, for assertions). */
function opTask(who: string, kind = "scan", dedup = who): NewTask {
  return { kind, scope: "operator", tenant: null, dedupKey: dedup, payload: { who } };
}
/** A synthetic tenant-scope task. */
function tenantTask(tenant: string, kind = "scan", dedup = `${tenant}:${kind}`): NewTask {
  return { kind, scope: "tenant", tenant, dedupKey: dedup, payload: { who: tenant } };
}

const who = (t: { payload: unknown }) => (t.payload as { who: string }).who;

describe("satellite-tasks-db: lifecycle", () => {
  it("advances a task pending → claimed → done and does not hand it out again", async () => {
    const { env } = sqliteEnv();
    const { id, enqueued } = await enqueueTask(env, opTask("a"), NOW);
    expect(enqueued).toBe(true);

    const claimed = await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], now: NOW });
    expect(claimed.map((t) => t.id)).toEqual([id]);
    expect(await getTask(env, id).then((r) => r?.status)).toBe("claimed");

    expect(await completeTask(env, id, NOW + 1)).toBe("done");
    expect(await getTask(env, id).then((r) => r?.status)).toBe("done");

    // A done task is never re-claimed, even long after any lease would have expired.
    const again = await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], now: NOW + LEASE_DURATION_MS * 10 });
    expect(again).toEqual([]);
  });

  it("parks a repeatedly-failing task terminal after the attempt cap, never looping", async () => {
    const { env } = sqliteEnv();
    const { id } = await enqueueTask(env, { ...opTask("poison"), maxAttempts: 2 }, NOW);

    // 1st claim (attempts→1) then fail: below cap → back to pending (re-claimable).
    await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], now: NOW });
    expect(await failTask(env, id, "session expired", NOW + 1)).toBe("pending");

    // 2nd claim (attempts→2) then fail: at cap → terminal failed (parked).
    await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], now: NOW + 2 });
    expect(await failTask(env, id, "still broken", NOW + 3)).toBe("failed");

    const row = await getTask(env, id);
    expect(row?.status).toBe("failed");
    expect(row?.last_error).toBe("still broken");
    // Parked terminal: no further claim ever re-leases it.
    const after = await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], now: NOW + LEASE_DURATION_MS * 5 });
    expect(after).toEqual([]);
  });

  it("parks a SILENTLY DROPPED task terminal at the attempt cap — re-claimed, never reported, still parked", async () => {
    const { env } = sqliteEnv();
    const { id } = await enqueueTask(env, { ...opTask("ghost"), maxAttempts: 2 }, NOW);

    // The satellite claims, then dies mid-work and NEVER reports (no failTask ever). The only driver
    // is the next claim after each lease expiry — lazy reclaim, no sweeper. Each claim re-leases and
    // bumps attempts until the cap; then the next claim parks it terminal instead of re-leasing.
    let t = NOW;
    for (let i = 0; i < 5; i++) {
      await claimTasks(env, { keyId: "ik_dropper", tenant: null, capabilities: ["scan"], now: t });
      t += LEASE_DURATION_MS + 1; // let the lease expire before the next claim
    }

    const row = await getTask(env, id);
    // Terminal failed (surfaced to the operator) — NOT re-claimed indefinitely — despite no explicit
    // failure report. `attempts` never runs past the cap; the park stamps a default reason.
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(2);
    expect(row?.last_error).toBe("lease expired at attempt cap");
    // No further claim ever re-leases the parked row.
    expect(await claimTasks(env, { keyId: "ik_dropper", tenant: null, capabilities: ["scan"], now: t + LEASE_DURATION_MS * 10 })).toEqual([]);
  });

  it("idempotent enqueue: no second in-flight row per dedup_key; a terminal key is re-enqueuable", async () => {
    const { env, rows } = sqliteEnv();
    const first = await enqueueTask(env, opTask("x", "scan", "unit-42"), NOW);
    expect(first.enqueued).toBe(true);

    // Re-running producer, same logical key, task still in flight → no second row.
    const dup = await enqueueTask(env, opTask("x", "scan", "unit-42"), NOW + 1);
    expect(dup.enqueued).toBe(false);
    expect(rows("satellite_tasks").filter((r) => (r as { dedup_key: string }).dedup_key === "unit-42")).toHaveLength(1);

    // Once the prior task is terminal, the same key may be enqueued afresh (next cycle's work).
    expect(await completeTask(env, first.id, NOW + 2)).toBe("done");
    const reenq = await enqueueTask(env, opTask("x", "scan", "unit-42"), NOW + 3);
    expect(reenq.enqueued).toBe(true);
    expect(rows("satellite_tasks").filter((r) => (r as { dedup_key: string }).dedup_key === "unit-42")).toHaveLength(2);
  });
});

describe("satellite-tasks-db: claim atomicity + graceful degradation", () => {
  it("two claims do not double-acquire: the second sees a fresh lease and skips", async () => {
    const { env } = sqliteEnv();
    await enqueueTask(env, opTask("only"), NOW);

    const first = await claimTasks(env, { keyId: "ik_A", tenant: null, capabilities: ["scan"], now: NOW });
    expect(first).toHaveLength(1);
    // A second claim an instant later — the row is claimed with a live lease → nothing to hand back.
    const second = await claimTasks(env, { keyId: "ik_B", tenant: null, capabilities: ["scan"], now: NOW + 1 });
    expect(second).toEqual([]);
  });

  it("an expired lease is re-claimable; a dropped satellite leaves work pending with no Worker recovery", async () => {
    const { env } = sqliteEnv();
    const { id } = await enqueueTask(env, opTask("dropme"), NOW);

    // Satellite A claims, then drops (never reports). The Worker initiates nothing toward it —
    // there is no sweeper; reclaim is lazy, driven only by the next claim after the lease expires.
    const a = await claimTasks(env, { keyId: "ik_A", tenant: null, capabilities: ["scan"], now: NOW });
    expect(a.map((t) => t.id)).toEqual([id]);
    // Before expiry: still leased to A, not handed out.
    expect(await claimTasks(env, { keyId: "ik_B", tenant: null, capabilities: ["scan"], now: NOW + LEASE_DURATION_MS - 1 })).toEqual([]);
    // After expiry: B re-claims the same task.
    const b = await claimTasks(env, { keyId: "ik_B", tenant: null, capabilities: ["scan"], now: NOW + LEASE_DURATION_MS + 1 });
    expect(b.map((t) => t.id)).toEqual([id]);
    // The attempt counter reflects both claims (a double-run is possible — made safe by result dedup).
    expect(await getTask(env, id).then((r) => r?.attempts)).toBe(2);
  });
});

describe("satellite-tasks-db: scope + capability filtering", () => {
  it("an operator-global key claims only operator-scope work, never any tenant's", async () => {
    const { env } = sqliteEnv();
    await enqueueTask(env, opTask("op"), NOW);
    await enqueueTask(env, tenantTask("casey"), NOW);
    await enqueueTask(env, tenantTask("sam"), NOW);

    const claimed = await claimTasks(env, { keyId: "ik_global", tenant: null, capabilities: ["scan"], now: NOW });
    expect(claimed.map(who)).toEqual(["op"]);
    expect(claimed.every((t) => t.scope === "operator")).toBe(true);
  });

  it("a tenant-bound key claims its own tenant + operator-scope, never another tenant's", async () => {
    const { env } = sqliteEnv();
    await enqueueTask(env, opTask("op"), NOW);
    await enqueueTask(env, tenantTask("casey"), NOW);
    await enqueueTask(env, tenantTask("sam"), NOW);

    const claimed = await claimTasks(env, { keyId: "ik_casey", tenant: "casey", capabilities: ["scan"], now: NOW });
    expect(claimed.map(who).sort()).toEqual(["casey", "op"]);
    expect(claimed.map(who)).not.toContain("sam");
  });

  it("the claim is filtered by declared capabilities (an unrun kind is not handed back)", async () => {
    const { env } = sqliteEnv();
    await enqueueTask(env, opTask("scanjob", "scan"), NOW);
    await enqueueTask(env, opTask("filljob", "fill"), NOW);

    const claimed = await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], now: NOW });
    expect(claimed.map(who)).toEqual(["scanjob"]);

    // An empty capability list matches no kind → no work, without a query.
    expect(await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: [], now: NOW })).toEqual([]);
  });

  it("respects the max bound (leases at most `max` rows in one claim)", async () => {
    const { env } = sqliteEnv();
    for (let i = 0; i < 5; i++) await enqueueTask(env, opTask(`t${i}`, "scan", `t${i}`), NOW + i);
    const claimed = await claimTasks(env, { keyId: "ik_1", tenant: null, capabilities: ["scan"], max: 2, now: NOW + 10 });
    expect(claimed).toHaveLength(2);
    // Oldest-first (created_at order).
    expect(claimed.map(who)).toEqual(["t0", "t1"]);
  });
});

describe("satellite-tasks-db: scope/tenant consistency CHECK", () => {
  it("the CHECK keeps the two consistent combos writable and both impossible ones unwritable", async () => {
    const { raw } = sqliteEnv();
    const ins = (scope: string, tenant: string | null) =>
      raw
        .prepare(
          "INSERT INTO satellite_tasks (id, kind, scope, tenant, dedup_key, payload, status, attempts, max_attempts, created_at, updated_at) " +
            "VALUES (?, 'scan', ?, ?, ?, '{}', 'pending', 0, 3, 1, 1)",
        )
        .run(`st_${scope}_${tenant}`, scope, tenant, `${scope}:${tenant}`);

    // Consistent: operator-scope carries no tenant; tenant-scope names its owner.
    expect(() => ins("operator", null)).not.toThrow();
    expect(() => ins("tenant", "casey")).not.toThrow();
    // Impossible: operator-scope with a tenant, tenant-scope with no owner — rejected by the CHECK.
    expect(() => ins("operator", "casey")).toThrow();
    expect(() => ins("tenant", null)).toThrow();
  });

  it("a producer's inconsistent enqueue writes no row (the real INSERT-OR-IGNORE path)", async () => {
    const { env, rows } = sqliteEnv();
    // Fresh dedup keys, so a false `enqueued` can only be the CHECK skipping the row (not a dedup hit).
    const a = await enqueueTask(env, { kind: "scan", scope: "tenant", tenant: null, dedupKey: "bad-a", payload: {} }, NOW);
    const b = await enqueueTask(env, { kind: "scan", scope: "operator", tenant: "casey", dedupKey: "bad-b", payload: {} }, NOW);
    expect(a.enqueued).toBe(false);
    expect(b.enqueued).toBe(false);
    expect(rows("satellite_tasks")).toHaveLength(0);
  });
});
