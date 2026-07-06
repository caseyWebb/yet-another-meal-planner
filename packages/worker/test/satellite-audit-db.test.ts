import { describe, it, expect } from "vitest";
import {
  appendRejection,
  readRejections,
  pruneSatelliteRejections,
  bumpAcceptTally,
  readSourceStats,
  setQuarantine,
  clearQuarantine,
  getQuarantine,
  isQuarantined,
  readSourceQuality,
  pruneSourceStats,
  QUARANTINE_FAIL_RATE_THRESHOLD,
  QUARANTINE_MIN_SAMPLE,
  DEFAULT_SOURCE_QUALITY_WINDOW_MS,
} from "../src/satellite-audit-db.js";
import { sqliteEnv } from "./sqlite-d1.js";

// The source-audit D1 layer (satellite-source-audit) against a REAL SQLite (node:sqlite) with the
// actual 0039 migration DDL — so the append-with-prune ledger, the NULL-tenant accept-tally upsert
// (the COALESCE unique index), the quarantine flag CRUD, and the compute-on-read reliability rollup
// exercise the real semantics the fake-d1 simulator cannot.

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("satellite-audit-db: the rejection ledger", () => {
  it("appends worker rejects and reads them most-recent-first, bounded", async () => {
    const { env } = sqliteEnv();
    await appendRejection(env, { tenant: null, keyId: "ik_1", kind: "recipe", source: "NYT", origin: "worker", reason: "unresolvable source url", provenance: "https://x" }, NOW);
    await appendRejection(env, { tenant: null, keyId: "ik_1", kind: "recipe", source: "NYT", origin: "worker", reason: "bad shape", provenance: null }, NOW + 1000);
    await appendRejection(env, { tenant: "casey", keyId: "ik_2", kind: "order", source: "target", origin: "worker", reason: "item_id is not in the issued order-list", provenance: "olive oil" }, NOW + 2000);

    const all = await readRejections(env);
    expect(all.map((r) => r.reason)).toEqual([
      "item_id is not in the issued order-list",
      "bad shape",
      "unresolvable source url",
    ]);
    expect(all[0]).toMatchObject({ tenant: "casey", key_id: "ik_2", kind: "order", source: "target", origin: "worker", count: 1 });

    const bounded = await readRejections(env, { limit: 1 });
    expect(bounded).toHaveLength(1);
    expect(bounded[0].reason).toBe("item_id is not in the issued order-list");
  });

  it("filters by source and floors at sinceMs", async () => {
    const { env } = sqliteEnv();
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "NYT", origin: "worker", reason: "a", provenance: null }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "SeriousEats", origin: "worker", reason: "b", provenance: null }, NOW + 5000);

    const onlyNyt = await readRejections(env, { source: "NYT" });
    expect(onlyNyt.map((r) => r.source)).toEqual(["NYT"]);

    const recent = await readRejections(env, { sinceMs: NOW + 1 });
    expect(recent.map((r) => r.source)).toEqual(["SeriousEats"]);
  });

  it("records a pre-aggregated local-reject entry as ONE row carrying its count + sample", async () => {
    const { env } = sqliteEnv();
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "local", reason: "contract_invalid", provenance: "missing price field", count: 40 }, NOW);
    const rows = await readRejections(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: "local", reason: "contract_invalid", count: 40, provenance: "missing price field" });
  });

  it("prunes rows older than the retention floor, sparing fresh ones", async () => {
    const { env } = sqliteEnv();
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "NYT", origin: "worker", reason: "old", provenance: null }, NOW - 10 * DAY);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "NYT", origin: "worker", reason: "fresh", provenance: null }, NOW - 1000);

    const removed = await pruneSatelliteRejections(env, NOW - 5 * DAY);
    expect(removed).toBe(1);
    const left = await readRejections(env);
    expect(left.map((r) => r.reason)).toEqual(["fresh"]);
  });
});

describe("satellite-audit-db: the accept-tally", () => {
  it("upserts an operator-global (NULL tenant) source into a SINGLE row, advancing last_accepted_at on accept", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "sale", source: "target", accepted: 3, deduped: 1 }, NOW);
    await bumpAcceptTally(env, { tenant: null, kind: "sale", source: "target", accepted: 2, deduped: 0 }, NOW + 5000);

    const stats = await readSourceStats(env);
    expect(stats).toHaveLength(1); // NULL-tenant rows collapse to one via COALESCE unique index
    expect(stats[0]).toMatchObject({ tenant: null, kind: "sale", source: "target", accepted: 5, deduped: 1, last_accepted_at: NOW + 5000 });
  });

  it("a dedup-only bump does NOT advance last_accepted_at (a dedup is not a fresh accept)", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "NYT", accepted: 1, deduped: 0 }, NOW);
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "NYT", accepted: 0, deduped: 4 }, NOW + 9000);
    const stats = await readSourceStats(env);
    expect(stats[0]).toMatchObject({ accepted: 1, deduped: 4, last_accepted_at: NOW });
  });

  it("keeps a tenant-bound source distinct from an operator-global one of the same kind/source", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "NYT", accepted: 1, deduped: 0 }, NOW);
    await bumpAcceptTally(env, { tenant: "casey", kind: "recipe", source: "NYT", accepted: 2, deduped: 0 }, NOW);
    const stats = await readSourceStats(env);
    expect(stats).toHaveLength(2);
  });
});

describe("satellite-audit-db: the quarantine flag", () => {
  it("sets, checks (NULL + bound tenant), and clears a per-source flag", async () => {
    const { env } = sqliteEnv();
    await setQuarantine(env, { tenant: null, kind: "sale", source: "target" }, "adapter flooding garbage", NOW);
    expect(await isQuarantined(env, { tenant: null, kind: "sale", source: "target" })).toBe(true);
    // A different tenant / kind / source is NOT quarantined.
    expect(await isQuarantined(env, { tenant: "casey", kind: "sale", source: "target" })).toBe(false);
    expect(await isQuarantined(env, { tenant: null, kind: "recipe", source: "target" })).toBe(false);

    const rows = await getQuarantine(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenant: null, kind: "sale", source: "target", note: "adapter flooding garbage" });

    expect(await clearQuarantine(env, { tenant: null, kind: "sale", source: "target" })).toBe(true);
    expect(await isQuarantined(env, { tenant: null, kind: "sale", source: "target" })).toBe(false);
    expect(await getQuarantine(env)).toHaveLength(0);
  });

  it("re-toggling refreshes the timestamp/note without duplicating the row", async () => {
    const { env } = sqliteEnv();
    await setQuarantine(env, { tenant: "casey", kind: "order", source: "shop" }, "first", NOW);
    await setQuarantine(env, { tenant: "casey", kind: "order", source: "shop" }, "second", NOW + 1000);
    const rows = await getQuarantine(env);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quarantined_at: NOW + 1000, note: "second" });
  });
});

describe("satellite-audit-db: the reliability rollup (compute-on-read)", () => {
  it("computes per-source fail/acceptance rate + staleness, excluding dedups and quarantine rejects", async () => {
    const { env } = sqliteEnv();
    // A source with 13 accepts + a pre-aggregated 7-reject entry → sample 20, failRate 0.35.
    await bumpAcceptTally(env, { tenant: null, kind: "sale", source: "target", accepted: 13, deduped: 3 }, NOW - 2 * DAY);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "local", reason: "contract_invalid", provenance: "x", count: 7 }, NOW - DAY);

    const quality = await readSourceQuality(env, NOW);
    expect(quality).toHaveLength(1);
    const q = quality[0];
    expect(q).toMatchObject({ kind: "sale", source: "target", accepted: 13, rejected: 7, deduped: 3, sample: 20 });
    expect(q.failRate).toBeCloseTo(0.35, 6);
    expect(q.acceptanceRate).toBeCloseTo(0.65, 6);
    expect(q.staleMs).toBe(2 * DAY); // now − last_accepted_at
  });

  it("sets recommendQuarantine only over the fail-rate threshold WITH the minimum sample", async () => {
    const { env } = sqliteEnv();
    // OVER: 13 accepts + 7 rejects = sample 20 (== min), failRate 0.35 ≥ threshold → recommend.
    await bumpAcceptTally(env, { tenant: null, kind: "sale", source: "over", accepted: 13, deduped: 0 }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "over", origin: "worker", reason: "bad", provenance: null, count: 7 }, NOW);
    // HEALTHY: 19 accepts + 1 reject = sample 20, failRate 0.05 → no recommend.
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "healthy", accepted: 19, deduped: 0 }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "healthy", origin: "worker", reason: "bad", provenance: null, count: 1 }, NOW);
    // UNDER-SAMPLE: 6 accepts + 4 rejects = sample 10 (< min), failRate 0.4 → no recommend despite the rate.
    await bumpAcceptTally(env, { tenant: null, kind: "order", source: "under", accepted: 6, deduped: 0 }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "order", source: "under", origin: "worker", reason: "bad", provenance: null, count: 4 }, NOW);

    const byKey = new Map((await readSourceQuality(env, NOW)).map((q) => [`${q.kind}:${q.source}`, q]));
    expect(byKey.get("sale:over")!.recommendQuarantine).toBe(true);
    expect(byKey.get("recipe:healthy")!.recommendQuarantine).toBe(false);
    expect(byKey.get("order:under")!.recommendQuarantine).toBe(false);
    // The thresholds are the documented fixed rule, not a model.
    expect(QUARANTINE_FAIL_RATE_THRESHOLD).toBe(0.3);
    expect(QUARANTINE_MIN_SAMPLE).toBe(20);
  });

  it("flags a quarantined source and excludes its quarantine rejects from the fail numerator", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "sale", source: "target", accepted: 10, deduped: 0 }, NOW);
    // Two real validation fails + five quarantine blocks; only the validation fails count.
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "worker", reason: "contract_invalid", provenance: null, count: 2 }, NOW);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "sale", source: "target", origin: "worker", reason: "quarantined", provenance: null, count: 5 }, NOW);
    await setQuarantine(env, { tenant: null, kind: "sale", source: "target" }, null, NOW);

    const q = (await readSourceQuality(env, NOW))[0];
    expect(q.quarantined).toBe(true);
    expect(q.rejected).toBe(2); // the 5 quarantine blocks are excluded
    expect(q.sample).toBe(12);
  });
});

describe("satellite-audit-db: per-tenant rollup keying (no cross-tenant merge)", () => {
  it("keeps two tenants sharing {order, target} as SEPARATE quality rows, each correctly attributed", async () => {
    const { env } = sqliteEnv();
    // Order-store slugs are shared across a friend group: alice's `target` is healthy, bob's is broken.
    // Pre-fix, these collapsed into ONE {order, target} aggregate (tenant = whoever sorted first),
    // blaming alice for bob's breakage AND letting a quarantine of one miss the other.
    await bumpAcceptTally(env, { tenant: "alice", kind: "order", source: "target", accepted: 25, deduped: 0 }, NOW);
    await appendRejection(env, { tenant: "bob", keyId: "kb", kind: "order", source: "target", origin: "worker", reason: "bad", provenance: null, count: 25 }, NOW);

    const quality = await readSourceQuality(env, NOW);
    expect(quality).toHaveLength(2); // two rows, not one merged aggregate
    const byTenant = new Map(quality.map((q) => [q.tenant, q]));
    expect(byTenant.get("alice")).toMatchObject({ kind: "order", source: "target", accepted: 25, rejected: 0, failRate: 0, recommendQuarantine: false });
    expect(byTenant.get("bob")).toMatchObject({ kind: "order", source: "target", accepted: 0, rejected: 25, recommendQuarantine: true });
    expect(byTenant.get("bob")!.failRate).toBeCloseTo(1, 6);

    // Quarantining alice's source must NOT flag bob's (the failing) source — the flag is per-tenant.
    await setQuarantine(env, { tenant: "alice", kind: "order", source: "target" }, null, NOW);
    const after = new Map((await readSourceQuality(env, NOW)).map((q) => [q.tenant, q]));
    expect(after.get("alice")!.quarantined).toBe(true);
    expect(after.get("bob")!.quarantined).toBe(false);
  });
});

describe("satellite-audit-db: windowed accept-tally (recent rate, not lifetime)", () => {
  const OUT_OF_WINDOW = DEFAULT_SOURCE_QUALITY_WINDOW_MS + 30 * DAY; // comfortably older than W

  it("a large STALE accept history no longer dilutes the fail-rate — a broken source now trips recommendQuarantine", async () => {
    const { env } = sqliteEnv();
    // 500 accepts months ago (OUT of the window) + a small recent accept + a recent reject flood.
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "seriouseats", accepted: 500, deduped: 0 }, NOW - OUT_OF_WINDOW);
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "seriouseats", accepted: 5, deduped: 0 }, NOW - 2 * DAY);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "seriouseats", origin: "worker", reason: "adapter rotted", provenance: null, count: 25 }, NOW - DAY);

    const q = (await readSourceQuality(env, NOW))[0];
    // Only the in-window accept (5) counts — the 500 stale accepts are dropped by the window.
    expect(q.accepted).toBe(5);
    expect(q.rejected).toBe(25);
    expect(q.sample).toBe(30);
    expect(q.failRate).toBeCloseTo(25 / 30, 6); // ≈0.83, well over threshold
    expect(q.recommendQuarantine).toBe(true);
    // Sanity: with the stale accepts included (the pre-fix behavior) the rate would be 25/525 ≈ 0.048 < 0.3.
  });

  it("a source healthy WITHIN the window does not trip the recommendation", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "nyt", accepted: 30, deduped: 0 }, NOW - 3 * DAY);
    await appendRejection(env, { tenant: null, keyId: "k", kind: "recipe", source: "nyt", origin: "worker", reason: "bad", provenance: null, count: 2 }, NOW - DAY);

    const q = (await readSourceQuality(env, NOW))[0];
    expect(q.sample).toBe(32);
    expect(q.failRate).toBeCloseTo(2 / 32, 6);
    expect(q.recommendQuarantine).toBe(false);
  });

  it("pruneSourceStats reaps buckets older than the retention window, sparing fresh ones", async () => {
    const { env } = sqliteEnv();
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "nyt", accepted: 3, deduped: 0 }, NOW - OUT_OF_WINDOW);
    await bumpAcceptTally(env, { tenant: null, kind: "recipe", source: "nyt", accepted: 4, deduped: 0 }, NOW - DAY);
    expect(await readSourceStats(env)).toHaveLength(2); // two distinct day buckets

    const removed = await pruneSourceStats(env, NOW - DEFAULT_SOURCE_QUALITY_WINDOW_MS);
    expect(removed).toBe(1);
    const left = await readSourceStats(env);
    expect(left).toHaveLength(1);
    expect(left[0].accepted).toBe(4); // the fresh bucket survives
  });
});
