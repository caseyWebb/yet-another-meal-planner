import { describe, it, expect } from "vitest";
import { runPullTick, type PullDeps } from "../src/pull.js";
import { validateSaleEmit, runScanAdapter, type ScanSdk, type SaleScanAdapter } from "../src/sale-adapter.js";
import { SALE_SCAN_KIND, type SaleObservation, type TaskEnvelope } from "@grocery-agent/contract";
import type { SatelliteConfig } from "../src/config.js";
import type { FetchTier } from "../src/fetch.js";

// The pull-channel client (satellite-sale-scan): claim → run adapter → validate → report, strictly
// outbound-only. Fixture-based — no live source, no browser, no network. Also locks the local
// contract validation (a non-contract shape / a smuggled derived field is rejected, never reported).

const silentLog = { info() {}, warn() {}, error() {} };

const CONFIG: SatelliteConfig = {
  connector_url: "https://mcp.example.workers.dev",
  sources: [],
  scan_stores: [{ store: "target", adapter: "target-sales" }],
};

/** A canned transport: records every request, returns a claim batch then 200 for reports. */
function fakeTransport(tasks: TaskEnvelope[]) {
  const claims: unknown[] = [];
  const reports: { task_id: string; status: string; observations?: SaleObservation[]; reason?: string }[] = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body);
    if (url.endsWith("/satellite/tasks/claim")) {
      claims.push(body);
      return { status: 200, json: async () => ({ tasks }) };
    }
    if (url.endsWith("/satellite/results")) {
      reports.push(body);
      return { status: 200, json: async () => ({ task: { id: body.task_id, status: body.status } }) };
    }
    return { status: 404, json: async () => ({}) };
  };
  return { fetchImpl, claims, reports };
}

const noTier: FetchTier = { async fetch() { return { html: "", finalUrl: "", status: 200 }; }, async close() {} };

/** Deps wired to a fake adapter + transport. */
function deps(over: Partial<PullDeps> & { transport: ReturnType<typeof fakeTransport>; adapter: SaleScanAdapter }): PullDeps {
  return {
    loadSession: () => null,
    tierFor: () => noTier,
    saleAdapters: { "target-sales": () => over.adapter },
    fetchImpl: over.transport.fetchImpl,
    connectorUrl: CONFIG.connector_url,
    ingestKey: "ing_live_x",
    log: silentLog,
    options: { maxAttempts: 1, baseDelayMs: 0, sleep: async () => {} },
    ...over,
  };
}

const saleTask = (over: Partial<TaskEnvelope> = {}): TaskEnvelope => ({
  id: "st_1",
  kind: SALE_SCAN_KIND,
  scope: "operator",
  payload: { store: "target", locationId: "T-1", terms: ["milk"] },
  ...over,
});

const rawSale = (over: Record<string, unknown> = {}) => ({
  kind: "sale",
  store: "target",
  locationId: "T-1",
  productId: "p1",
  description: "Milk",
  regular: 4,
  promo: 3,
  ...over,
});

describe("validateSaleEmit (local contract gate)", () => {
  it("accepts a well-formed raw sale", () => {
    expect(validateSaleEmit(rawSale()).ok).toBe(true);
  });

  it("rejects a non-contract shape (missing a required raw fact)", () => {
    const { productId: _d, ...noProduct } = rawSale();
    const r = validateSaleEmit(noProduct);
    expect(r.ok).toBe(false);
  });

  it("rejects a sensor-not-judge violation (a smuggled derived field)", () => {
    for (const field of ["savings", "savings_pct", "on_sale"]) {
      const r = validateSaleEmit(rawSale({ [field]: 1 }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("sensor-not-judge");
    }
  });
});

describe("runPullTick", () => {
  it("claims, runs the adapter, and reports the validated sale observations", async () => {
    const transport = fakeTransport([saleTask()]);
    const adapter: SaleScanAdapter = {
      id: "target-sales",
      async scan() {
        return [rawSale({ productId: "a" }), rawSale({ productId: "b", regular: 6, promo: 5 })] as SaleObservation[];
      },
    };
    const r = await runPullTick(CONFIG, deps({ transport, adapter }));
    expect(r).toMatchObject({ claimed: 1, reported: 1, failed: 0, rejectedObservations: 0 });
    // The claim declared the sale-scan capability.
    expect(transport.claims[0]).toMatchObject({ capabilities: [SALE_SCAN_KIND] });
    // The report carried the observations under status done.
    expect(transport.reports).toHaveLength(1);
    expect(transport.reports[0].status).toBe("done");
    expect(transport.reports[0].observations?.map((o) => o.productId)).toEqual(["a", "b"]);
  });

  it("drops a non-contract / judgment-bearing observation locally and reports only the valid ones", async () => {
    const transport = fakeTransport([saleTask()]);
    const adapter: SaleScanAdapter = {
      id: "target-sales",
      async scan() {
        return [
          rawSale({ productId: "ok" }),
          rawSale({ productId: "smuggled", savings: 1.5 }), // sensor-not-judge violation → dropped
          { kind: "sale", store: "target" }, // non-contract shape → dropped
        ] as unknown as SaleObservation[];
      },
    };
    const r = await runPullTick(CONFIG, deps({ transport, adapter }));
    expect(r.rejectedObservations).toBe(2);
    expect(transport.reports[0].status).toBe("done");
    const reported = transport.reports[0].observations ?? [];
    expect(reported.map((o) => o.productId)).toEqual(["ok"]);
    // No derived saving ever reaches the wire.
    for (const o of reported) expect(o).not.toHaveProperty("savings");
  });

  it("reports failed when the adapter returns a structured error", async () => {
    const transport = fakeTransport([saleTask()]);
    const adapter: SaleScanAdapter = { id: "target-sales", async scan() { return { error: "session expired" }; } };
    const r = await runPullTick(CONFIG, deps({ transport, adapter }));
    expect(r).toMatchObject({ reported: 0, failed: 1 });
    expect(transport.reports[0]).toMatchObject({ status: "failed", reason: "session expired" });
  });

  it("reports failed for a task whose store has no configured adapter", async () => {
    const transport = fakeTransport([saleTask({ payload: { store: "kroger", locationId: "x", terms: [] } })]);
    const adapter: SaleScanAdapter = { id: "target-sales", async scan() { return []; } };
    const r = await runPullTick(CONFIG, deps({ transport, adapter }));
    expect(r.failed).toBe(1);
    expect(transport.reports[0].status).toBe("failed");
    expect(transport.reports[0].reason).toContain("no scan adapter");
  });

  it("does not claim when the machine declares no scan stores", async () => {
    const transport = fakeTransport([]);
    const adapter: SaleScanAdapter = { id: "x", async scan() { return []; } };
    const r = await runPullTick({ ...CONFIG, scan_stores: [] }, deps({ transport, adapter }));
    expect(r.claimed).toBe(0);
    expect(transport.claims).toHaveLength(0); // strictly outbound; nothing sent
  });
});

describe("runScanAdapter (the `test` dry-run path — validate, never report)", () => {
  it("returns validated observations + local rejects without any network call", async () => {
    const adapter: SaleScanAdapter = {
      id: "target-sales",
      async scan() {
        return [rawSale({ productId: "ok" }), rawSale({ productId: "bad", on_sale: true })] as unknown as SaleObservation[];
      },
    };
    const sdk = { store: CONFIG.scan_stores![0], config: CONFIG, session: null, fetch: async () => ({ html: "", finalUrl: "", status: 200 }), log: silentLog } as ScanSdk;
    const outcome = await runScanAdapter(sdk, adapter, { store: "target", locationId: "T-1", terms: ["milk"] });
    expect("error" in outcome).toBe(false);
    if ("error" in outcome) return;
    expect(outcome.observations.map((o) => o.productId)).toEqual(["ok"]);
    expect(outcome.rejected).toHaveLength(1);
  });

  it("surfaces an adapter throw as a structured error (never crashes the loop)", async () => {
    const adapter: SaleScanAdapter = { id: "x", async scan() { throw new Error("boom"); } };
    const sdk = { store: CONFIG.scan_stores![0], config: CONFIG, session: null, fetch: async () => ({ html: "", finalUrl: "", status: 200 }), log: silentLog } as ScanSdk;
    const outcome = await runScanAdapter(sdk, adapter, { store: "target", locationId: "T-1", terms: [] });
    expect("error" in outcome).toBe(true);
    if ("error" in outcome) expect(outcome.error).toContain("boom");
  });
});
