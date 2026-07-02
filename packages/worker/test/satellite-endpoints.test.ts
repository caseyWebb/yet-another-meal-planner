import { describe, it, expect } from "vitest";
import { handleSatelliteClaim, handleSatelliteResults } from "../src/satellite.js";
import { mintIngestKey, revokeIngestKey } from "../src/ingest-db.js";
import { enqueueTask, getTask, claimTasks } from "../src/satellite-tasks-db.js";
import type { ClaimResponse, ResultResponse, TaskEnvelope } from "@grocery-agent/contract";
import { sqliteEnv } from "./sqlite-d1.js";
import type { Env } from "../src/env.js";

// The pull-channel ENDPOINTS (satellite-pull-channel) end-to-end over the real-SQLite env: the
// shared ingest-key auth + rate limit, the atomic claim (scope/capability), and the idempotent,
// dedup-backed results intake. `/satellite/*` is outside `/admin*`, so no Access assertion is
// ever consulted — a valid key alone is served.

const NOW = 1_800_000_000_000;

const claimReq = (secret: string | null, body: unknown): Request => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new Request("https://host/satellite/tasks/claim", { method: "POST", headers, body: JSON.stringify(body) });
};
const resultsReq = (secret: string | null, body: unknown): Request => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  return new Request("https://host/satellite/results", { method: "POST", headers, body: JSON.stringify(body) });
};

const recipeObs = (n: number) => ({
  kind: "recipe" as const,
  title: `Recipe ${n}`,
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear.", "Braise 3h."],
  source: `https://cooking.example.com/r${n}`,
});

async function claim(env: Env, secret: string, capabilities: string[], now = NOW): Promise<TaskEnvelope[]> {
  const res = await handleSatelliteClaim(claimReq(secret, { capabilities }), env, now);
  expect(res.status).toBe(200);
  return ((await res.json()) as ClaimResponse).tasks;
}

describe("/satellite/* auth", () => {
  it("rejects a missing / unknown / revoked key with 401 and claims nothing", async () => {
    const { env } = sqliteEnv();
    const { id, secret } = await mintIngestKey(env, "home-nas", NOW);
    const task = await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "d", payload: {} }, NOW);

    expect((await handleSatelliteClaim(claimReq(null, { capabilities: ["scan"] }), env, NOW)).status).toBe(401);
    expect((await handleSatelliteClaim(claimReq("ing_live_deadbeef", { capabilities: ["scan"] }), env, NOW)).status).toBe(401);

    await revokeIngestKey(env, id);
    const revoked = await handleSatelliteClaim(claimReq(secret, { capabilities: ["scan"] }), env, NOW);
    expect(revoked.status).toBe(401);
    // Nothing was claimed on any rejection — the task is still pending.
    expect(await getTask(env, task.id).then((r) => r?.status)).toBe("pending");
  });

  it("serves a valid key with NO Cloudflare Access assertion (the gate never applies off /admin*)", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "d", payload: { ok: 1 } }, NOW);
    // The request carries only the ingest key — no Cf-Access-Jwt-Assertion header — and is served.
    const tasks = await claim(env, secret, ["scan"]);
    expect(tasks).toHaveLength(1);
  });

  it("is rate-limited like the ingest route (429 once the per-key window is saturated)", async () => {
    const { env } = sqliteEnv();
    const { id, secret } = await mintIngestKey(env, "home-nas", NOW);
    // Saturate the shared per-key fixed-window bucket (same limiter as /admin/api/ingest).
    const bucket = Math.floor(NOW / 1000 / 60);
    await env.KROGER_KV.put(`ingest:rl:${id}:${bucket}`, "120");
    const res = await handleSatelliteClaim(claimReq(secret, { capabilities: ["scan"] }), env, NOW);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("rejects a malformed claim body with 400 bad_payload", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const res = await handleSatelliteClaim(claimReq(secret, { capabilities: "scan" }), env, NOW);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("bad_payload");
  });
});

describe("/satellite/tasks/claim scope (end-to-end)", () => {
  it("operator-global key claims only operator-scope; tenant-bound key adds its own tenant", async () => {
    const { env } = sqliteEnv(["casey", "sam"]);
    const { secret: globalSecret } = await mintIngestKey(env, "op-box", NOW, null);
    const { secret: caseySecret } = await mintIngestKey(env, "casey-box", NOW, "casey");
    const w = (t: TaskEnvelope) => (t.payload as { who: string }).who;

    await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "op", payload: { who: "op" } }, NOW);
    await enqueueTask(env, { kind: "scan", scope: "tenant", tenant: "casey", dedupKey: "c", payload: { who: "casey" } }, NOW);
    await enqueueTask(env, { kind: "scan", scope: "tenant", tenant: "sam", dedupKey: "s", payload: { who: "sam" } }, NOW);

    // Operator-global sees only the operator task.
    expect((await claim(env, globalSecret, ["scan"])).map(w)).toEqual(["op"]);
    // The tasks it claimed are now leased; a fresh env isolates the tenant-bound assertion.
    const b = sqliteEnv(["casey", "sam"]);
    const { secret: caseySecret2 } = await mintIngestKey(b.env, "casey-box", NOW, "casey");
    await enqueueTask(b.env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "op", payload: { who: "op" } }, NOW);
    await enqueueTask(b.env, { kind: "scan", scope: "tenant", tenant: "casey", dedupKey: "c", payload: { who: "casey" } }, NOW);
    await enqueueTask(b.env, { kind: "scan", scope: "tenant", tenant: "sam", dedupKey: "s", payload: { who: "sam" } }, NOW);
    expect((await claim(b.env, caseySecret2, ["scan"])).map(w).sort()).toEqual(["casey", "op"]);
    void caseySecret;
  });
});

describe("/satellite/results", () => {
  it("lands observations through the shared intake and transitions the task to done", async () => {
    const { env, rows } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const { id } = await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "d", payload: {} }, NOW);
    await claimTasks(env, { keyId: "ik_x", tenant: null, capabilities: ["scan"], now: NOW });

    const res = await handleSatelliteResults(resultsReq(secret, { task_id: id, status: "done", observations: [recipeObs(1)] }), env, NOW + 1);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ResultResponse;
    expect(body.task).toEqual({ id, status: "done" });
    expect(body.results?.[0].disposition).toBe("accepted");
    expect(rows("ingest_candidates")).toHaveLength(1); // the recipe entered the raw-observation inbox
    expect(await getTask(env, id).then((r) => r?.status)).toBe("done");
  });

  it("is idempotent: a double / late report dedups on arrival and the transition is a safe no-op", async () => {
    const { env, rows } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const { id } = await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "d", payload: {} }, NOW);

    const first = await handleSatelliteResults(resultsReq(secret, { task_id: id, status: "done", observations: [recipeObs(1)] }), env, NOW + 1);
    expect(first.status).toBe(200);
    // A repeat report (e.g. the original claimer's late report after a re-claim): still 200, the
    // observation dedups on arrival (no duplicate row), and the terminal transition is a no-op.
    const second = await handleSatelliteResults(resultsReq(secret, { task_id: id, status: "done", observations: [recipeObs(1)] }), env, NOW + 2);
    expect(second.status).toBe(200);
    const body = (await second.json()) as ResultResponse;
    expect(body.task.status).toBe("done");
    expect(body.results?.[0].disposition).toBe("deduped");
    expect(rows("ingest_candidates")).toHaveLength(1); // still exactly one landed row
  });

  it("an unknown task_id is a structured not_found (404) with nothing persisted", async () => {
    const { env, rows } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const res = await handleSatelliteResults(resultsReq(secret, { task_id: "st_nope", status: "done", observations: [recipeObs(1)] }), env, NOW);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
    expect(rows("ingest_candidates")).toHaveLength(0);
  });

  it("masks another tenant's task as not_found (tenant isolation)", async () => {
    const { env } = sqliteEnv(["casey"]);
    const { secret: globalSecret } = await mintIngestKey(env, "op-box", NOW, null);
    const { id } = await enqueueTask(env, { kind: "fill", scope: "tenant", tenant: "casey", dedupKey: "c", payload: {} }, NOW);
    // An operator-global key (no tenant) reports on casey's tenant-scope task → not_found (existence hidden).
    const res = await handleSatelliteResults(resultsReq(globalSecret, { task_id: id, status: "done" }), env, NOW);
    expect(res.status).toBe(404);
    expect(await getTask(env, id).then((r) => r?.status)).toBe("pending"); // untouched
  });

  it("a failure report counts the attempt and parks at the cap", async () => {
    const { env } = sqliteEnv();
    const { secret } = await mintIngestKey(env, "home-nas", NOW);
    const { id } = await enqueueTask(env, { kind: "scan", scope: "operator", tenant: null, dedupKey: "d", payload: {}, maxAttempts: 1 }, NOW);
    // Claim (attempts→1) then report failed: at the cap → parked terminal failed.
    await claimTasks(env, { keyId: "ik_x", tenant: null, capabilities: ["scan"], now: NOW });
    const res = await handleSatelliteResults(resultsReq(secret, { task_id: id, status: "failed", reason: "unreachable" }), env, NOW + 1);
    expect(res.status).toBe(200);
    expect(((await res.json()) as ResultResponse).task.status).toBe("failed");
    expect(await getTask(env, id).then((r) => r?.last_error)).toBe("unreachable");
  });
});
