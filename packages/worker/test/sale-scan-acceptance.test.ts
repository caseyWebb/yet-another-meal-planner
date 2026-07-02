import { describe, it, expect } from "vitest";
import { runSaleScanPlan, type SaleScanPlanDeps } from "../src/sale-scan-plan.js";
import { enqueueTask, pruneTerminalTasks } from "../src/satellite-tasks-db.js";
import { handleSatelliteClaim, handleSatelliteResults } from "../src/satellite.js";
import { readStoreFlyer, writeStoreRollup, KROGER_STORE } from "../src/flyer-warm.js";
import { dedupeFlyerHits } from "../src/matching.js";
import { mintIngestKey } from "../src/ingest-db.js";
import {
  parseSaleObservation,
  parseSaleScanPayload,
  SALE_SCAN_KIND,
  type ClaimResponse,
  type SaleObservation,
} from "@grocery-agent/contract";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";
import type { KvStore } from "../src/kroger-user.js";
import type { KrogerCandidate } from "../src/kroger.js";

// The satellite-sale-scan CONVERGENCE CHECK (tasks §11.2): seed a non-Kroger `target` store + a
// tenant primary + an operator-authored fake sale adapter, then drive the WHOLE loop over the real
// queue + endpoints + intake + read — producer → claim → scan → `sale` results → store rollup — and
// assert satellite sales read IDENTICALLY to first-party Kroger sales (store-namespaced convergence).

const NOW = 1_800_000_000_000;
const kv = (env: Env) => env.KROGER_KV as unknown as KvStore;

const claimReq = (secret: string, body: unknown) =>
  new Request("https://host/satellite/tasks/claim", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
const resultsReq = (secret: string, body: unknown) =>
  new Request("https://host/satellite/results", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

/** A fake OPERATOR sale adapter for the `target` store: emits raw `sale` observations for the terms,
 *  each self-validated with `parseSaleObservation` exactly as the real satellite gates its emit. */
function fakeTargetAdapter(store: string, locationId: string, terms: string[]): SaleObservation[] {
  const shelf: Record<string, { productId: string; description: string; regular: number; promo: number; size: string }> = {
    milk: { productId: "T-milk", description: "Organic 2% Milk", regular: 5.99, promo: 4.49, size: "1 gal" },
    eggs: { productId: "T-eggs", description: "Cage-Free Large Eggs", regular: 4.29, promo: 3.29, size: "12 ct" },
  };
  const out: SaleObservation[] = [];
  for (const term of terms) {
    const row = shelf[term];
    if (!row) continue;
    const raw = { kind: "sale", store, locationId, brand: "Good & Gather", categories: ["Grocery"], ...row };
    const v = parseSaleObservation(raw); // the satellite would refuse to report an invalid emit
    if (v.ok) out.push(v.value);
  }
  return out;
}

/** Producer deps: a seeded `target`-primary tenant + real enqueue/prune against the live queue. */
function planDeps(env: Env): SaleScanPlanDeps {
  return {
    kv: kv(env),
    listTenantIds: async () => ["casey"],
    readTenantStore: async () => ({ store: "target", locationId: "T-1234" }),
    readBroadTerms: async () => ["milk", "eggs"],
    enqueue: (task) => enqueueTask(env, task, NOW),
    pruneTerminal: (olderThan) => pruneTerminalTasks(env, SALE_SCAN_KIND, olderThan),
    now: () => NOW,
  };
}

describe("satellite-sale-scan end-to-end convergence", () => {
  it("drives producer → claim → scan → results → store_flyer, reading identically to Kroger", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "target-satellite", NOW);

    // 1) PRODUCER — enqueue one operator-scope sale-scan task for the non-Kroger target store.
    const plan = await runSaleScanPlan(planDeps(env));
    expect(plan).toMatchObject({ action: "planned", pairs: 1, enqueued: 1 });

    // 2) CLAIM — the satellite claims sale-scan work with its ingest key.
    const claimRes = await handleSatelliteClaim(claimReq(secret, { capabilities: [SALE_SCAN_KIND] }), env, NOW + 1);
    expect(claimRes.status).toBe(200);
    const tasks = ((await claimRes.json()) as ClaimResponse).tasks;
    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.kind).toBe(SALE_SCAN_KIND);

    // 3) SCAN — the operator adapter observes the store for the task's terms.
    const payload = parseSaleScanPayload(task.payload);
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.value).toEqual({ store: "target", locationId: "T-1234", terms: ["milk", "eggs"] });
    const observations = fakeTargetAdapter(payload.value.store, payload.value.locationId, payload.value.terms);

    // 4) RESULTS — report the raw sale observations; the Worker re-derives + converges the rollup.
    const resultsRes = await handleSatelliteResults(resultsReq(secret, { task_id: task.id, status: "done", observations }), env, NOW + 2);
    expect(resultsRes.status).toBe(200);

    // 5) READ — the store-aware read serves the satellite-scanned sales.
    const targetRollup = await readStoreFlyer(kv(env), "target", "T-1234");
    expect(targetRollup).not.toBeNull();
    expect(targetRollup!.items.map((i) => i.sku).sort()).toEqual(["T-eggs", "T-milk"]);
    const milk = targetRollup!.items.find((i) => i.sku === "T-milk")!;
    expect(milk.savings).toBe(1.5); // Worker-re-derived (5.99 - 4.49), never trusted from the wire

    // 6) CONVERGENCE — a first-party Kroger scan of the SAME product produces an identical rollup
    // item at the kroger-namespaced key; both read uniformly, distinguishable only by provenance.
    const krogerCandidate: KrogerCandidate = {
      productId: "T-milk",
      brand: "Good & Gather",
      description: "Organic 2% Milk",
      categories: ["Grocery"],
      size: "1 gal",
      price: { regular: 5.99, promo: 4.49 },
      fulfillment: { curbside: true, delivery: false, inStore: true },
      aisleLocation: null,
    };
    await writeStoreRollup(kv(env), KROGER_STORE, "K-9", dedupeFlyerHits([{ term: "milk", candidates: [krogerCandidate] }]), NOW + 3);
    const krogerRollup = await readStoreFlyer(kv(env), KROGER_STORE, "K-9");
    const krogerMilk = krogerRollup!.items.find((i) => i.sku === "T-milk")!;

    // Identical FlyerItem except matched_terms (Kroger tracks the surfacing term; a satellite sale
    // carries []) — the whole sensor-not-judge point: downstream cannot tell them apart by shape.
    const { matched_terms: _s, ...satelliteFields } = milk;
    const { matched_terms: _k, ...krogerFields } = krogerMilk;
    expect(satelliteFields).toEqual(krogerFields);

    // Idempotency: a late/double report of the same scan replaces to the same rows.
    await handleSatelliteResults(resultsReq(secret, { task_id: task.id, status: "done", observations }), env, NOW + 4);
    const reread = await readStoreFlyer(kv(env), "target", "T-1234");
    expect(reread!.items.map((i) => i.sku).sort()).toEqual(["T-eggs", "T-milk"]);
  });
});
