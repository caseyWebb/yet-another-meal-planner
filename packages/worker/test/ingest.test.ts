import { describe, it, expect } from "vitest";
import { handleIngest } from "../src/ingest.js";
import { mintIngestKey, readSatelliteLiveness, revokeIngestKey, FRESH_WINDOW_MS } from "../src/ingest-db.js";
import { CONTRACT_VERSION, MAX_BATCH_ITEMS, type BatchResponse } from "@grocery-agent/contract";
import { fakeD1 } from "./fake-d1.js";

// POST /admin/api/ingest (recipe-ingestion). Exercised end-to-end over the in-memory D1
// fake (the KROGER_KV rate-limiter fail-opens when the binding is absent, so no KV stub is
// needed). Corpus/rejections/settled-log reads resolve empty from the unseeded fake tables.
// Both the v2 capability-tagged batch and the legacy v1 recipe batch are accepted.

const NOW = 1_800_000_000_000;

function freshEnv() {
  return fakeD1({ tables: { ingest_keys: [], ingest_candidates: [], ingest_pushes: [] } });
}

/** A v2 recipe observation. */
const obs = (n: number) => ({
  kind: "recipe" as const,
  title: `Recipe ${n}`,
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear.", "Braise 3h."],
  source: `https://cooking.example.com/r${n}`,
});

/** The v1 recipe shape (no kind tag) — the compat path normalizes it. */
const v1Item = (n: number) => ({
  title: `Recipe ${n}`,
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear.", "Braise 3h."],
  source: `https://cooking.example.com/r${n}`,
});

function req(secret: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new Request("https://host/admin/api/ingest", { method: "POST", headers, body: JSON.stringify(body) });
}

/** A v2 batch envelope. */
const batch = (observations: unknown[], over: Record<string, unknown> = {}) => ({
  capability: "recipe-scrape",
  source: "NYT Cooking",
  satellite_version: "1.0.0",
  contract_version: CONTRACT_VERSION,
  observations,
  ...over,
});

/** A legacy v1 batch envelope. */
const v1Batch = (recipes: unknown[], over: Record<string, unknown> = {}) => ({
  source: "NYT Cooking",
  scraper_version: "0.9.0",
  contract_version: "v1",
  recipes,
  ...over,
});

describe("handleIngest", () => {
  it("accepts a valid v2 batch, persists candidates, and stamps key liveness", async () => {
    const f = freshEnv();
    const { id, secret } = await mintIngestKey(f.env, "home-nas", NOW);

    const res = await handleIngest(req(secret, batch([obs(1), obs(2)])), f.env, NOW + 1000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 2, accepted: 2, deduped: 0, rejected: 0 });
    expect(f.tables.ingest_candidates).toHaveLength(2);

    const key = f.tables.ingest_keys.find((k) => k.id === id)!;
    expect(key.last_used_at).toBe(NOW + 1000);
    expect(key.last_scraper_version).toBe("1.0.0"); // satellite_version → retained column
    expect(key.last_contract_version).toBe(CONTRACT_VERSION);
  });

  it("accepts a legacy v1 batch, normalizing it to the recipe-scrape capability", async () => {
    const f = freshEnv();
    const { id, secret } = await mintIngestKey(f.env, "old-synology", NOW);

    const res = await handleIngest(req(secret, v1Batch([v1Item(1), v1Item(2)])), f.env, NOW + 1000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 2, accepted: 2, deduped: 0, rejected: 0 });
    expect(f.tables.ingest_candidates).toHaveLength(2);

    // The v1 `scraper_version` + `contract_version` are recorded (so skew still works).
    const key = f.tables.ingest_keys.find((k) => k.id === id)!;
    expect(key.last_scraper_version).toBe("0.9.0");
    expect(key.last_contract_version).toBe("v1");
  });

  it("rejects a batch declaring an unimplemented capability as bad_payload", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    // `order-fill` is the still-unimplemented capability (recipe-scrape + sale-scan are defined).
    const res = await handleIngest(req(secret, batch([obs(1)], { capability: "order-fill" })), f.env, NOW);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_payload");
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects a missing or unknown key with 401 bad_key and persists nothing", async () => {
    const f = freshEnv();
    await mintIngestKey(f.env, "home-nas", NOW);

    const noKey = await handleIngest(req(null, batch([obs(1)])), f.env, NOW);
    expect(noKey.status).toBe(401);
    expect(((await noKey.json()) as { error: string }).error).toBe("bad_key");

    const badKey = await handleIngest(req("ing_live_deadbeef", batch([obs(1)])), f.env, NOW);
    expect(badKey.status).toBe(401);
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects a REVOKED key with 401 bad_key and persists nothing", async () => {
    const f = freshEnv();
    const { id, secret } = await mintIngestKey(f.env, "home-nas", NOW);
    await revokeIngestKey(f.env, id);

    const res = await handleIngest(req(secret, batch([obs(1)])), f.env, NOW + 1000);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("bad_key");
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects an over-cap batch (> MAX_BATCH_ITEMS) with 400 bad_payload before any write", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const tooMany = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => obs(i));

    const res = await handleIngest(req(secret, batch(tooMany)), f.env, NOW);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_payload");
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects a blank source (bad_payload) with nothing persisted", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const res = await handleIngest(req(secret, batch([obs(1)], { source: "  " })), f.env, NOW);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_payload");
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects a malformed item (incl. unknown kind) without failing the valid ones in the batch", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const noSource = { kind: "recipe", title: "No source", ingredients: ["x"], instructions: ["y"] }; // missing source
    const unknownKind = { kind: "sale", regular: 4.99, promo: 3.49 }; // future kind not implemented
    const res = await handleIngest(req(secret, batch([obs(1), noSource, unknownKind])), f.env, NOW);
    const body = (await res.json()) as BatchResponse;
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(2);
    expect(f.tables.ingest_candidates).toHaveLength(1);
    const rej = body.results.find((r) => r.disposition === "rejected");
    expect(rej).toBeDefined();
  });

  it("rejects a `sale` pushed to /admin/api/ingest and writes NO rollup (sale-scan is pull-channel-only)", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    // A tiny KV so we can prove the first-party Kroger flyer is never touched by the push path.
    const kvStore = new Map<string, string>();
    const env = {
      ...(f.env as object),
      KROGER_KV: {
        async get(k: string) {
          return kvStore.has(k) ? kvStore.get(k)! : null;
        },
        async put(k: string, v: string) {
          kvStore.set(k, v);
        },
        async delete(k: string) {
          kvStore.delete(k);
        },
      },
    } as unknown as typeof f.env;

    // The blocker attack: a plain push declaring `sale-scan` with a `sale` item targeting the victim
    // Kroger flyer location. No claimed task → the sale arm rejects it per-item and writes nothing.
    const saleObs = { kind: "sale", store: "kroger", locationId: "03500493", productId: "p1", description: "Milk", regular: 100, promo: 10 };
    const res = await handleIngest(req(secret, batch([saleObs], { capability: "sale-scan" })), env, NOW);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 1, accepted: 0, rejected: 1 });
    expect(body.results[0].disposition).toBe("rejected");
    expect(body.results[0].reason).toContain("pull channel only");
    // No flyer rollup written (the rate limiter may write its own `ingest:rl:*` bucket key).
    expect([...kvStore.keys()].some((k) => k.startsWith("flyer:"))).toBe(false);
  });

  it("dedups a re-push of an already-inboxed url", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    await handleIngest(req(secret, batch([obs(1)])), f.env, NOW);
    const res = await handleIngest(req(secret, batch([obs(1)])), f.env, NOW + 5000);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ accepted: 0, deduped: 1 });
    expect(f.tables.ingest_candidates).toHaveLength(1); // no duplicate row
  });

  it("dedups a v1 re-push of a url already ingested via v2", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    await handleIngest(req(secret, batch([obs(1)])), f.env, NOW);
    // Same canonical url arriving via the legacy v1 shape → deduped, not a duplicate row.
    const res = await handleIngest(req(secret, v1Batch([v1Item(1)])), f.env, NOW + 5000);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ accepted: 0, deduped: 1 });
    expect(f.tables.ingest_candidates).toHaveLength(1);
  });

  it("dedups duplicate urls WITHIN a single batch", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const res = await handleIngest(req(secret, batch([obs(1), obs(1)])), f.env, NOW);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 2, accepted: 1, deduped: 1 });
    expect(f.tables.ingest_candidates).toHaveLength(1);
  });

  it("records the push for the liveness/recent-pushes view", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    await handleIngest(req(secret, batch([obs(1)])), f.env, NOW);
    expect(f.tables.ingest_pushes).toHaveLength(1);
    expect(f.tables.ingest_pushes[0]).toMatchObject({ source: "NYT Cooking", accepted: 1, result: "accepted" });
  });
});

describe("readSatelliteLiveness", () => {
  function envWith(tables: Record<string, Record<string, unknown>[]>) {
    return fakeD1({ tables: { ingest_keys: [], ingest_candidates: [], ingest_pushes: [], ...tables } }).env;
  }

  it("rolls up a fresh satellite with a per-source breakdown and no skew", async () => {
    const env = envWith({});
    const { id } = await mintIngestKey(env, "home-nas", NOW);
    const { touchIngestKey, recordIngestPush } = await import("../src/ingest-db.js");
    await touchIngestKey(env, id, "1.4.2", CONTRACT_VERSION, NOW - 1000);
    await recordIngestPush(env, { keyId: id, source: "NYT Cooking", received: 5, accepted: 5, deduped: 0, rejected: 0, result: "accepted" }, NOW - 1000);
    await recordIngestPush(env, { keyId: id, source: "Serious Eats", received: 3, accepted: 3, deduped: 0, rejected: 0, result: "accepted" }, NOW - 2000);
    const r = await readSatelliteLiveness(env, NOW);
    const s = r.satellites.find((x) => x.id === id)!;
    expect(s.health).toBe("fresh");
    expect(s.skew).toBe(false);
    expect(s.satelliteVersion).toBe("1.4.2");
    expect(s.sourceCount).toBe(2);
    expect(s.sources.map((x) => x.name).sort()).toEqual(["NYT Cooking", "Serious Eats"]);
    expect(s.pushes24h).toBe(2);
    expect(r.stats.fresh).toBe(1);
    expect(r.funnel.arrival.received).toBe(8);
  });

  it("flags contract skew and marks a silent satellite stale", async () => {
    const env = envWith({});
    const { id } = await mintIngestKey(env, "old-synology", NOW);
    const { touchIngestKey, recordIngestPush } = await import("../src/ingest-db.js");
    // Reported an OLD contract version (v1 against the Worker's v2), and last pushed > the fresh window ago.
    const longAgo = NOW - FRESH_WINDOW_MS - 60_000;
    await touchIngestKey(env, id, "0.9.0", "v1", longAgo);
    await recordIngestPush(env, { keyId: id, source: "ATK", received: 1, accepted: 1, deduped: 0, rejected: 0, result: "accepted" }, longAgo);
    const r = await readSatelliteLiveness(env, NOW);
    const s = r.satellites.find((x) => x.id === id)!;
    expect(s.skew).toBe(true);
    expect(s.health).toBe("stale");
  });

  it("reports a minted-but-never-used key as never", async () => {
    const env = envWith({});
    const { id } = await mintIngestKey(env, "kitchen-backup", NOW);
    const r = await readSatelliteLiveness(env, NOW);
    const s = r.satellites.find((x) => x.id === id)!;
    expect(s.health).toBe("never");
    expect(s.sourceCount).toBe(0);
  });

  it("excludes a revoked key from the active set", async () => {
    const env = envWith({});
    const { id } = await mintIngestKey(env, "old-laptop", NOW);
    await revokeIngestKey(env, id);
    const r = await readSatelliteLiveness(env, NOW);
    expect(r.activeSatellites.find((x) => x.id === id)).toBeUndefined();
    expect(r.satellites.find((x) => x.id === id)?.status).toBe("revoked");
  });
});
