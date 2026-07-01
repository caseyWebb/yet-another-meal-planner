import { describe, it, expect } from "vitest";
import { handleIngest } from "../src/ingest.js";
import { mintIngestKey } from "../src/ingest-db.js";
import { CONTRACT_VERSION, type BatchResponse } from "@grocery-agent/contract";
import { fakeD1 } from "./fake-d1.js";

// POST /admin/api/ingest (recipe-ingestion). Exercised end-to-end over the in-memory D1
// fake (the KROGER_KV rate-limiter fail-opens when the binding is absent, so no KV stub is
// needed). Corpus/rejections/settled-log reads resolve empty from the unseeded fake tables.

const NOW = 1_800_000_000_000;

function freshEnv() {
  return fakeD1({ tables: { ingest_keys: [], ingest_candidates: [] } });
}

const validItem = (n: number) => ({
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

const batch = (recipes: unknown[], over: Record<string, unknown> = {}) => ({
  source: "NYT Cooking",
  scraper_version: "1.0.0",
  contract_version: CONTRACT_VERSION,
  recipes,
  ...over,
});

describe("handleIngest", () => {
  it("accepts a valid batch, persists candidates, and stamps key liveness", async () => {
    const f = freshEnv();
    const { id, secret } = await mintIngestKey(f.env, "home-nas", NOW);

    const res = await handleIngest(req(secret, batch([validItem(1), validItem(2)])), f.env, NOW + 1000);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 2, accepted: 2, deduped: 0, rejected: 0 });
    expect(f.tables.ingest_candidates).toHaveLength(2);

    const key = f.tables.ingest_keys.find((k) => k.id === id)!;
    expect(key.last_used_at).toBe(NOW + 1000);
    expect(key.last_scraper_version).toBe("1.0.0");
    expect(key.last_contract_version).toBe(CONTRACT_VERSION);
  });

  it("rejects a missing or unknown key with 401 bad_key and persists nothing", async () => {
    const f = freshEnv();
    await mintIngestKey(f.env, "home-nas", NOW);

    const noKey = await handleIngest(req(null, batch([validItem(1)])), f.env, NOW);
    expect(noKey.status).toBe(401);
    expect(((await noKey.json()) as { error: string }).error).toBe("bad_key");

    const badKey = await handleIngest(req("ing_live_deadbeef", batch([validItem(1)])), f.env, NOW);
    expect(badKey.status).toBe(401);
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects a blank source (bad_payload) with nothing persisted", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const res = await handleIngest(req(secret, batch([validItem(1)], { source: "  " })), f.env, NOW);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_payload");
    expect(f.tables.ingest_candidates).toHaveLength(0);
  });

  it("rejects a malformed item without failing the valid ones in the batch", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const bad = { title: "No source", ingredients: ["x"], instructions: ["y"] }; // missing source
    const res = await handleIngest(req(secret, batch([validItem(1), bad])), f.env, NOW);
    const body = (await res.json()) as BatchResponse;
    expect(body.accepted).toBe(1);
    expect(body.rejected).toBe(1);
    expect(f.tables.ingest_candidates).toHaveLength(1);
    const rej = body.results.find((r) => r.disposition === "rejected");
    expect(rej?.reason).toContain("source");
  });

  it("dedups a re-push of an already-inboxed url", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    await handleIngest(req(secret, batch([validItem(1)])), f.env, NOW);
    const res = await handleIngest(req(secret, batch([validItem(1)])), f.env, NOW + 5000);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ accepted: 0, deduped: 1 });
    expect(f.tables.ingest_candidates).toHaveLength(1); // no duplicate row
  });

  it("dedups duplicate urls WITHIN a single batch", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    const res = await handleIngest(req(secret, batch([validItem(1), validItem(1)])), f.env, NOW);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 2, accepted: 1, deduped: 1 });
    expect(f.tables.ingest_candidates).toHaveLength(1);
  });
});
