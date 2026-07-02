import { describe, it, expect } from "vitest";
import { runSaleScanPlan, runSaleScanPlanJob, type SaleScanPlanDeps } from "../src/sale-scan-plan.js";
import { readJobHealth } from "../src/health.js";
import { SALE_SCAN_KIND } from "@grocery-agent/contract";
import { sqliteEnv } from "./sqlite-d1.js";
import type { KvStore } from "../src/kroger-user.js";
import type { NewTask } from "../src/satellite-tasks-db.js";

// The sale-scan-plan producer (satellite-sale-scan): the enqueue-only `scheduled()` sibling. It
// builds the plan (distinct NON-KROGER (store, locationId) from tenants' preferred stores), enqueues
// one idempotent operator-scope task per pair, is refresh-gated by a KV cursor, prunes terminal
// rows, and no-ops on an empty plan. Core logic runs over fake deps; the health wrapper over sqlite.

const NOW = 1_800_000_000_000;

function fakeKv(): KvStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = "" } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

interface Harness {
  deps: SaleScanPlanDeps;
  enqueued: NewTask[];
  pruneCalls: number[];
  setNow: (n: number) => void;
}

function harness(over: Partial<SaleScanPlanDeps> = {}): Harness {
  const kv = fakeKv();
  const enqueuedKeys = new Set<string>();
  const enqueued: NewTask[] = [];
  const pruneCalls: number[] = [];
  let now = NOW;
  const deps: SaleScanPlanDeps = {
    kv,
    listTenantIds: async () => ["alice", "bob"],
    // alice + bob both fulfill from the same non-Kroger store/location by default.
    readTenantStore: async (id) => ({ alice: { store: "target", locationId: "T-1" }, bob: { store: "target", locationId: "T-1" } })[id] ?? null,
    readBroadTerms: async () => ["milk", "eggs"],
    enqueue: async (task) => {
      enqueued.push(task);
      if (enqueuedKeys.has(task.dedupKey)) return { enqueued: false, id: "dup" };
      enqueuedKeys.add(task.dedupKey);
      return { enqueued: true, id: `st_${task.dedupKey}` };
    },
    pruneTerminal: async (olderThan) => {
      pruneCalls.push(olderThan);
      return 0;
    },
    now: () => now,
    ...over,
  };
  return { deps, enqueued, pruneCalls, setNow: (n) => (now = n) };
}

describe("runSaleScanPlan", () => {
  it("enqueues one operator-scope task per distinct non-Kroger pair, carrying all terms", async () => {
    const h = harness();
    const r = await runSaleScanPlan(h.deps);
    expect(r.action).toBe("planned");
    expect(r.pairs).toBe(1); // alice + bob share target/T-1
    expect(r.enqueued).toBe(1);
    expect(h.enqueued).toHaveLength(1);
    const t = h.enqueued[0];
    expect(t.kind).toBe(SALE_SCAN_KIND);
    expect(t.scope).toBe("operator");
    expect(t.tenant).toBeNull();
    expect(t.dedupKey).toBe("sale-scan:target:T-1");
    expect(t.payload).toEqual({ store: "target", locationId: "T-1", terms: ["milk", "eggs"] });
  });

  it("excludes Kroger stores (the Worker scans those itself)", async () => {
    const h = harness({
      readTenantStore: async (id) =>
        ({ alice: { store: "kroger", locationId: "01400943" }, bob: { store: "target", locationId: "T-2" } })[id] ?? null,
    });
    const r = await runSaleScanPlan(h.deps);
    expect(r.pairs).toBe(1);
    expect(h.enqueued.map((t) => t.dedupKey)).toEqual(["sale-scan:target:T-2"]);
  });

  it("is a clean no-op on an empty plan (no non-Kroger store), still advancing the cursor", async () => {
    const h = harness({ readTenantStore: async () => ({ store: "kroger", locationId: "01400943" }) });
    const r = await runSaleScanPlan(h.deps);
    expect(r).toMatchObject({ action: "planned", pairs: 0, enqueued: 0 });
    expect(h.enqueued).toHaveLength(0);
    // A second immediate run idles against the advanced cursor.
    expect((await runSaleScanPlan(h.deps)).action).toBe("idle");
  });

  it("refresh-gates: within the window it idles; after it, it re-plans (idempotent enqueue)", async () => {
    const h = harness();
    h.setNow(NOW);
    expect((await runSaleScanPlan(h.deps, { refreshMs: 1000 })).action).toBe("planned");
    h.setNow(NOW + 500); // within window
    expect((await runSaleScanPlan(h.deps, { refreshMs: 1000 })).action).toBe("idle");
    h.setNow(NOW + 1000); // window elapsed
    const again = await runSaleScanPlan(h.deps, { refreshMs: 1000 });
    expect(again.action).toBe("planned");
    expect(again.enqueued).toBe(0); // dedup_key already in-flight → no second row
  });

  it("prunes terminal sale-scan rows with the configured age cutoff", async () => {
    const h = harness();
    await runSaleScanPlan(h.deps, { pruneAgeMs: 5000 });
    expect(h.pruneCalls).toEqual([NOW - 5000]);
  });

  it("does not collide two distinct (store, locationId) pairs that share a bare-space join", async () => {
    // A `locationId` that is a raw `preferred_location` label can contain spaces, so a bare-space
    // join ("market" + " " + "5 a" === "market 5" + " " + "a") would collapse these two DISTINCT
    // pairs into one plan entry. The NUL-delimited key keeps them separate → two tasks enqueued.
    const h = harness({
      listTenantIds: async () => ["alice", "bob"],
      readTenantStore: async (id) =>
        ({ alice: { store: "market", locationId: "5 a" }, bob: { store: "market 5", locationId: "a" } })[id] ?? null,
    });
    const r = await runSaleScanPlan(h.deps);
    expect(r.pairs).toBe(2); // NOT collapsed to 1 by a colliding bare-space key
    expect(h.enqueued.map((t) => t.dedupKey).sort()).toEqual(["sale-scan:market 5:a", "sale-scan:market:5 a"]);
  });

  it("skips tenants with no store set", async () => {
    const h = harness({
      readTenantStore: async (id) => (id === "alice" ? { store: "target", locationId: "T-9" } : null),
    });
    const r = await runSaleScanPlan(h.deps);
    expect(r.pairs).toBe(1);
    expect(h.enqueued.map((t) => t.dedupKey)).toEqual(["sale-scan:target:T-9"]);
  });
});

describe("runSaleScanPlanJob (health wrapper)", () => {
  it("writes a sale-scan-plan job_health record on a clean cycle", async () => {
    const { env } = sqliteEnv();
    const h = harness();
    await runSaleScanPlanJob(env, h.deps);
    const health = await readJobHealth(env, "sale-scan-plan");
    expect(health?.ok).toBe(true);
    expect(health?.summary).toMatchObject({ action: "planned", pairs: 1, enqueued: 1 });
  });

  it("records a failing health record and rethrows when a cycle throws", async () => {
    const { env } = sqliteEnv();
    const h = harness({
      listTenantIds: async () => {
        throw new Error("directory down");
      },
    });
    await expect(runSaleScanPlanJob(env, h.deps)).rejects.toThrow("directory down");
    const health = await readJobHealth(env, "sale-scan-plan");
    expect(health?.ok).toBe(false);
    expect(health?.summary).toMatchObject({ error: "directory down" });
  });
});
