import { describe, it, expect } from "vitest";
import { handleIngest } from "../src/ingest.js";
import { handleSatelliteResults, handleOrderReceipt } from "../src/satellite.js";
import { mintIngestKey } from "../src/ingest-db.js";
import { enqueueTask, claimTasks } from "../src/satellite-tasks-db.js";
import { insertOrderList } from "../src/order-lists-db.js";
import { readRejections, readSourceStats, readSourceQuality } from "../src/satellite-audit-db.js";
import { CONTRACT_VERSION, SALE_SCAN_KIND, type LocalReject } from "@grocery-agent/contract";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";

// The local-reject reporting path (satellite-source-audit, Decision D §5.3): each delivery envelope
// (push batch / pull-results / order-receipt) MAY carry an additive `local_rejects` summary the
// satellite assembled from its own dropped items; the Worker records ONE `origin: local` ledger row
// per entry (right kind/source/count), does NOT bump the accept-tally (they were never accepted), and
// so raises the source's fail-rate exactly as a Worker-side reject does. Real SQLite (node:sqlite).

const NOW = 1_800_000_000_000;

const recipe = (n: number) => ({
  kind: "recipe" as const,
  title: `Recipe ${n}`,
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear.", "Braise 3h."],
  source: `https://cooking.example.com/r${n}`,
});

const ingestReq = (secret: string, body: unknown): Request =>
  new Request("https://host/admin/api/ingest", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const resultsReq = (secret: string, body: unknown): Request =>
  new Request("https://host/satellite/results", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const receiptReq = (secret: string, body: unknown): Request =>
  new Request("https://host/satellite/order/receipt", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("push handler: local_rejects on the recipe push batch", () => {
  it("records one origin:local ledger row per entry (kind recipe, source = batch source), no accept-tally bump, raised fail-rate", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const local: LocalReject[] = [{ category: "contract_invalid", count: 10, sample: "adapter emitted an invalid item: source Required" }];

    const res = await handleIngest(ingestReq(secret, {
      capability: "recipe-scrape",
      source: "NYT Cooking",
      satellite_version: "1.0.0",
      contract_version: CONTRACT_VERSION,
      observations: [recipe(1)],
      local_rejects: local,
    }), env, NOW);
    expect(res.status).toBe(200);

    // ONE local ledger row, carrying the reported count + the sample as provenance.
    const rows = await readRejections(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "local", kind: "recipe", source: "NYT Cooking", reason: "contract_invalid", count: 10 });
    expect(rows[0].provenance).toBe("adapter emitted an invalid item: source Required");

    // The accept-tally reflects ONLY the one accepted recipe — a local reject never bumps it.
    const stats = await readSourceStats(env);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ kind: "recipe", source: "NYT Cooking", accepted: 1 });

    // The fail-rate is raised: 10 rejected over (1 accepted + 10 rejected).
    const quality = await readSourceQuality(env, NOW);
    const q = quality.find((x) => x.kind === "recipe" && x.source === "NYT Cooking")!;
    expect(q.rejected).toBe(10);
    expect(q.failRate).toBeCloseTo(10 / 11, 6);
  });

  it("a push WITHOUT local_rejects writes no local ledger row (additive)", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    await handleIngest(ingestReq(secret, {
      capability: "recipe-scrape",
      source: "NYT Cooking",
      satellite_version: "1.0.0",
      contract_version: CONTRACT_VERSION,
      observations: [recipe(1)],
    }), env, NOW);
    expect(await readRejections(env)).toHaveLength(0);
  });
});

describe("pull-results handler: local_rejects on a sale-scan done report", () => {
  it("records origin:local rows keyed to the claimed task's store (kind sale)", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const { id } = await enqueueTask(
      env,
      { kind: SALE_SCAN_KIND, scope: "operator", tenant: null, dedupKey: "sale-scan:target:T-1", payload: { store: "target", locationId: "T-1", terms: ["milk"] } },
      NOW,
    );
    await claimTasks(env, { keyId: "ik_x", tenant: null, capabilities: [SALE_SCAN_KIND], now: NOW });

    const saleObs = { kind: "sale", store: "target", locationId: "T-1", productId: "p1", description: "Milk", regular: 4, promo: 3 };
    const res = await handleSatelliteResults(
      resultsReq(secret, { task_id: id, status: "done", observations: [saleObs], local_rejects: [{ category: "judgment_smuggled", count: 3, sample: "sensor-not-judge violation" }] }),
      env,
      NOW + 1,
    );
    expect(res.status).toBe(200);

    const local = (await readRejections(env)).filter((r) => r.origin === "local");
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ origin: "local", kind: "sale", source: "target", reason: "judgment_smuggled", count: 3 });
    // The valid sale bumped the tally; the local reject did not.
    const stats = await readSourceStats(env);
    expect(stats.find((s) => s.kind === "sale" && s.source === "target")).toMatchObject({ accepted: 1 });
  });

  it("does not record local_rejects on a `failed` report (a whole-task failure is not a per-item reject)", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const { id } = await enqueueTask(
      env,
      { kind: SALE_SCAN_KIND, scope: "operator", tenant: null, dedupKey: "sale-scan:target:T-1", payload: { store: "target", locationId: "T-1", terms: ["milk"] } },
      NOW,
    );
    await claimTasks(env, { keyId: "ik_x", tenant: null, capabilities: [SALE_SCAN_KIND], now: NOW });
    // A satellite would not send local_rejects on a failure, but even if it did the failed path returns
    // before the done-branch recording — so nothing lands.
    await handleSatelliteResults(resultsReq(secret, { task_id: id, status: "failed", reason: "session expired", local_rejects: [{ category: "contract_invalid", count: 9 }] }), env, NOW + 1);
    expect((await readRejections(env)).filter((r) => r.origin === "local")).toHaveLength(0);
  });
});

describe("order-receipt handler: local_rejects on the receipt", () => {
  it("records origin:local rows keyed to the issued order-list's store (kind order), tenant-bound", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    const olId = await insertOrderList(env, { tenant: "casey", store: "shop", locationId: null, itemIds: ["olive oil"] }, NOW);

    const res = await handleOrderReceipt(
      receiptReq(secret, { order_list_id: olId, observations: [], local_rejects: [{ category: "contract_invalid", count: 5, sample: "adapter emitted an invalid order observation" }] }),
      env as Env,
      NOW + 1,
    );
    expect(res.status).toBe(200);

    const local = (await readRejections(env)).filter((r) => r.origin === "local");
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({ origin: "local", kind: "order", source: "shop", tenant: "casey", reason: "contract_invalid", count: 5 });
  });
});
