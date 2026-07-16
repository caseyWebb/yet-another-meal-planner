import { describe, it, expect } from "vitest";
import { intakeObservations } from "../src/ingest.js";
import { readSatelliteLiveness } from "../src/ingest-db.js";
import { readRejections, readSourceStats, setQuarantine, clearQuarantine, appendRejection, bumpAcceptTally, getQuarantine } from "../src/satellite-audit-db.js";
import { sqliteEnv } from "./sqlite-d1.js";

// The intake wiring (satellite-source-audit) against a REAL SQLite (node:sqlite) with the actual
// migration DDL: every Worker-side reject across the three arms appends ONE ledger row; an accept
// bumps the accept-tally (never the ledger); a quarantined source is rejected at intake and lands
// nothing downstream; and read_satellite_rejections surfaces the ledger + quarantine set.

const NOW = 1_800_000_000_000;
const KEY = "ik_test";

/** A valid v2 recipe observation. */
const recipe = (n: number) => ({
  kind: "recipe" as const,
  title: `Recipe ${n}`,
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear.", "Braise 3h."],
  source: `https://cooking.example.com/r${n}`,
});

/** A valid raw `sale` observation for a claimed sale-scan task's store. */
const sale = (store: string) => ({
  kind: "sale" as const,
  store,
  locationId: "T-1",
  brand: "Good & Gather",
  categories: ["Grocery"],
  productId: "T-milk",
  description: "Organic 2% Milk",
  regular: 5.99,
  promo: 4.49,
  size: "1 gal",
});

describe("intake wiring: the ledger append per Worker-side reject", () => {
  it("a recipe parse-fail appends ONE ledger row (origin worker, kind recipe, source = batch source)", async () => {
    const { env } = sqliteEnv();
    const bad = { kind: "recipe", title: "No source", ingredients: ["x"], instructions: ["y"] }; // missing source
    const res = await intakeObservations(env, [bad], "NYT Cooking", KEY, NOW, { keyTenant: null });
    expect(res).toMatchObject({ received: 1, accepted: 0, rejected: 1 });

    const rows = await readRejections(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "worker", kind: "recipe", source: "NYT Cooking", key_id: KEY, tenant: null, count: 1 });
  });

  it("a sale store-mismatch reject appends ONE ledger row keyed to the TASK's store", async () => {
    const { env } = sqliteEnv();
    const res = await intakeObservations(env, [sale("wrongstore")], "satellite-pull:sale-scan", KEY, NOW, {
      saleTask: { store: "target", locationId: "T-1" },
      keyTenant: null,
    });
    expect(res).toMatchObject({ accepted: 0, rejected: 1 });
    const rows = await readRejections(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "worker", kind: "sale", source: "target" });
    expect(rows[0].reason).toContain("does not match the claimed sale-scan task");
  });

  it("an order item_id outside the issued set appends ONE ledger row keyed to the order-list's store", async () => {
    const { env } = sqliteEnv();
    const item = { kind: "order", item_id: "saffron", disposition: "unavailable" };
    const res = await intakeObservations(env, [item], "satellite-order:ol_1", KEY, NOW, {
      orderList: { id: "ol_1", tenant: "casey", store: "shop", locationId: null, itemIds: ["olive oil"] },
      keyTenant: "casey",
    });
    expect(res).toMatchObject({ accepted: 0, rejected: 1 });
    const rows = await readRejections(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "worker", kind: "order", source: "shop", tenant: "casey" });
    expect(rows[0].reason).toBe("item_id is not in the issued order-list");
  });
});

describe("intake wiring: the accept-tally bump", () => {
  it("an accepted recipe bumps satellite_source_stats and writes NO ledger row", async () => {
    const { env } = sqliteEnv();
    const res = await intakeObservations(env, [recipe(1)], "NYT Cooking", KEY, NOW, { keyTenant: null });
    expect(res).toMatchObject({ accepted: 1, rejected: 0 });

    const stats = await readSourceStats(env);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ tenant: null, kind: "recipe", source: "NYT Cooking", accepted: 1, deduped: 0, last_accepted_at: NOW });
    expect(await readRejections(env)).toHaveLength(0);
  });

  it("an accepted sale bumps the tally for the task's store and writes NO ledger row", async () => {
    const { env } = sqliteEnv();
    const res = await intakeObservations(env, [sale("target")], "satellite-pull:sale-scan", KEY, NOW, {
      saleTask: { store: "target", locationId: "T-1" },
      keyTenant: null,
    });
    expect(res).toMatchObject({ accepted: 1, rejected: 0 });
    const stats = await readSourceStats(env);
    expect(stats[0]).toMatchObject({ kind: "sale", source: "target", accepted: 1 });
    expect(await readRejections(env)).toHaveLength(0);
  });

  it("a recipe dedup bumps deduped (not accepted) and writes NO ledger row", async () => {
    const { env } = sqliteEnv();
    await intakeObservations(env, [recipe(1)], "NYT Cooking", KEY, NOW, { keyTenant: null });
    const res = await intakeObservations(env, [recipe(1)], "NYT Cooking", KEY, NOW + 1000, { keyTenant: null });
    expect(res).toMatchObject({ accepted: 0, deduped: 1 });
    const stats = await readSourceStats(env);
    expect(stats[0]).toMatchObject({ accepted: 1, deduped: 1, last_accepted_at: NOW }); // recency unchanged by the dedup
    expect(await readRejections(env)).toHaveLength(0);
  });
});

describe("intake wiring: the quarantine gate", () => {
  it("a quarantined recipe source is rejected at intake, ledgered, and lands NOTHING; a sibling source flows", async () => {
    const { env, rows } = sqliteEnv();
    await setQuarantine(env, { tenant: null, kind: "recipe", source: "NYT Cooking" }, "adapter broke", NOW);

    // Quarantined source: rejected, ledgered `quarantined`, no candidate inboxed, no accept tally.
    const blocked = await intakeObservations(env, [recipe(1)], "NYT Cooking", KEY, NOW, { keyTenant: null });
    expect(blocked).toMatchObject({ accepted: 0, rejected: 1 });
    expect(rows("ingest_candidates")).toHaveLength(0);
    const led = await readRejections(env);
    expect(led).toHaveLength(1);
    expect(led[0]).toMatchObject({ kind: "recipe", source: "NYT Cooking", origin: "worker", reason: "quarantined" });
    expect(await readSourceStats(env)).toHaveLength(0); // nothing accepted → no tally

    // A sibling source of the SAME key is unaffected.
    const flows = await intakeObservations(env, [recipe(2)], "SeriousEats", KEY, NOW + 10, { keyTenant: null });
    expect(flows).toMatchObject({ accepted: 1 });
    expect(rows("ingest_candidates")).toHaveLength(1);

    // Clearing the flag lets the next observation through.
    await clearQuarantine(env, { tenant: null, kind: "recipe", source: "NYT Cooking" });
    const after = await intakeObservations(env, [recipe(1)], "NYT Cooking", KEY, NOW + 20, { keyTenant: null });
    expect(after).toMatchObject({ accepted: 1 });
    expect(rows("ingest_candidates")).toHaveLength(2);
  });

  it("a quarantined sale source does NOT REPLACE the store rollup to empty (nothing lands)", async () => {
    const { env } = sqliteEnv();
    await setQuarantine(env, { tenant: null, kind: "sale", source: "target" }, null, NOW);
    const res = await intakeObservations(env, [sale("target")], "satellite-pull:sale-scan", KEY, NOW, {
      saleTask: { store: "target", locationId: "T-1" },
      keyTenant: null,
    });
    expect(res).toMatchObject({ accepted: 0, rejected: 1 });
    // The flyer rollup KV was never written (the bucket was never seeded).
    const kvKeys = (await (env.KROGER_KV as unknown as { list: (o?: unknown) => Promise<{ keys: { name: string }[] }> }).list({ prefix: "flyer:" })).keys;
    expect(kvKeys).toHaveLength(0);
    expect((await readRejections(env))[0]).toMatchObject({ reason: "quarantined", kind: "sale", source: "target" });
  });
});

describe("readSatelliteLiveness: the folded-in quality dimension", () => {
  it("carries the per-{kind, source} quality rollup beside the recency view", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "sale", source: "target", accepted: 13, deduped: 0 }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "worker", reason: "bad", provenance: null, count: 7 }, NOW);
    await setQuarantine(env, { tenant: null, kind: "sale", source: "target" }, null, NOW);

    const rollup = await readSatelliteLiveness(env, NOW);
    expect(rollup.quality).toHaveLength(1);
    expect(rollup.quality[0]).toMatchObject({ kind: "sale", source: "target", sample: 20, quarantined: true, recommendQuarantine: true });
    expect(rollup.quality[0].failRate).toBeCloseTo(0.35, 6);
  });

  it("is an empty quality list on a clean instance (no audit rows)", async () => {
    const { env } = sqliteEnv();
    const rollup = await readSatelliteLiveness(env, NOW);
    expect(rollup.quality).toEqual([]);
  });
});

// read_satellite_rejections left the MCP surface (satellite-source-audit): the ledger +
// quarantine reads are an operator admin surface now, over the SAME readRejections /
// getQuarantine operations — exercised directly below (the tool's own visibility-scoping
// and shaping logic is preserved here since the future admin route will need it too).
describe("readRejections / getQuarantine (operator admin surface, formerly read_satellite_rejections)", () => {
  const CALLER_TENANT = "casey";

  it("returns the recent rejections (most-recent-first) plus the quarantine set", async () => {
    const { env } = sqliteEnv();
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "NYT", origin: "worker", reason: "old", provenance: null }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "local", reason: "contract_invalid", provenance: "sample", count: 12 }, NOW + 1000);
    await setQuarantine(env, { tenant: null, kind: "sale", source: "target" }, "flooding", NOW);

    const rejections = await readRejections(env, { tenantScope: CALLER_TENANT });
    expect(rejections.map((r) => r.reason)).toEqual(["contract_invalid", "old"]);
    expect(rejections[0].count).toBe(12);
    // Trimmed to design F's {kind, source, quarantined_at} — the raw tenant/note are the caller's concern to drop.
    const quarantined = (await getQuarantine(env))
      .filter((q) => q.tenant == null || q.tenant === CALLER_TENANT)
      .map((q) => ({ kind: q.kind, source: q.source, quarantined_at: q.quarantined_at }));
    expect(quarantined).toEqual([{ kind: "sale", source: "target", quarantined_at: NOW }]);
  });

  it("scopes order-kind rejections to the CALLER's tenant while keeping recipe/sale household-wide", async () => {
    const { env } = sqliteEnv();
    // Operator-global recipe + sale rejections (tenant NULL — shared across the group).
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "NYT", origin: "worker", reason: "recipe-reject", provenance: null }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "worker", reason: "sale-reject", provenance: null }, NOW + 1);
    // Casey's OWN order reject + ANOTHER member's (sam) private order reject.
    await appendRejection(env, { tenant: "casey", keyId: "kc", kind: "order", source: "shop", origin: "worker", reason: "casey-order", provenance: "olive oil" }, NOW + 2);
    await appendRejection(env, { tenant: "sam", keyId: "ks", kind: "order", source: "shop", origin: "worker", reason: "sam-order", provenance: "saffron" }, NOW + 3);
    // Quarantines: an operator-global sale flag (shared) + another member's private order flag (hidden).
    await setQuarantine(env, { tenant: null, kind: "sale", source: "target" }, "flooding", NOW);
    await setQuarantine(env, { tenant: "sam", kind: "order", source: "shop" }, "sam-only", NOW);

    const rejections = await readRejections(env, { tenantScope: CALLER_TENANT });
    const reasons = rejections.map((r) => r.reason);
    // Casey sees the shared recipe/sale rejects + her OWN order reject, but NOT sam's private order reject.
    expect(reasons).toContain("recipe-reject");
    expect(reasons).toContain("sale-reject");
    expect(reasons).toContain("casey-order");
    expect(reasons).not.toContain("sam-order");
    // Quarantine set: the shared sale flag is visible; sam's private order flag is not.
    const quarantined = (await getQuarantine(env))
      .filter((q) => q.tenant == null || q.tenant === CALLER_TENANT)
      .map((q) => ({ kind: q.kind, source: q.source, quarantined_at: q.quarantined_at }));
    expect(quarantined).toEqual([{ kind: "sale", source: "target", quarantined_at: NOW }]);
  });

  it("filters to one source when given", async () => {
    const { env } = sqliteEnv();
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "NYT", origin: "worker", reason: "a", provenance: null }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "SeriousEats", origin: "worker", reason: "b", provenance: null }, NOW + 1);

    const rejections = await readRejections(env, { source: "SeriousEats", tenantScope: CALLER_TENANT });
    expect(rejections.map((r) => r.source)).toEqual(["SeriousEats"]);
  });
});
