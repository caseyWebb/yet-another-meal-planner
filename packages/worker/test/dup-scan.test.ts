// The corpus dup-scan (recipe-dedup): the two-arm detection rule, the watermarked
// bounded plan, scanned-vs-all pair detection, the merge_recipes draft, and — through a
// REAL migrated SQLite (sqlite-d1.ts) — the wiring's enqueue idempotence (the real
// proposalId path), dismissal permanence, the no-operator recorded no-op, orphan-stamp
// pruning, and the job's health summary.
import { describe, it, expect } from "vitest";
import {
  DUP_SCAN_JOB,
  DUP_COSINE_HIGH,
  DUP_COSINE_CORROBORATED,
  DUP_SCAN_MAX_PER_TICK,
  scanStampHash,
  isDuplicatePair,
  planDupScan,
  detectPairs,
  draftMergeProposal,
  scanForDuplicates,
  buildDupScanDeps,
  runDupScanJob,
  type DupScanRow,
  type DupScanDeps,
  type DupCandidatePair,
} from "../src/dup-scan.js";
import { readProposals, setProposalStatus } from "../src/reconcile-db.js";
import { readJobHealth } from "../src/health.js";
import type { Env } from "../src/env.js";
import { sqliteEnv } from "./sqlite-d1.js";

const NOW = new Date("2026-07-08T00:00:00Z");

/** A unit vector at `cosine` from [1, 0] — cosineSimilarity([1,0], vec(c)) === c. */
const vec = (cosine: number): number[] => [cosine, Math.sqrt(1 - cosine * cosine)];

function row(over: Partial<DupScanRow> & { slug: string }): DupScanRow {
  return {
    title: over.slug,
    embedding: [1, 0],
    descriptionHash: `dh-${over.slug}`,
    ingredientsKey: [],
    stamp: null,
    ...over,
  };
}

/** The row's CURRENT stamp hash (what a fresh scan would store). */
const fresh = (r: DupScanRow): string => scanStampHash(r.descriptionHash, JSON.stringify(r.ingredientsKey));

describe("isDuplicatePair — the two-arm rule", () => {
  it("passes the fixture-shaped corroborated pair (0.767 / 2 shared / 0.67 Jaccard)", () => {
    expect(isDuplicatePair(0.767, 2, 0.67)).toBe(true);
  });

  it("rejects a moderate-cosine pair with weak overlap (0.85 but Jaccard < 0.5 or < 2 shared)", () => {
    expect(isDuplicatePair(0.85, 1, 0.4)).toBe(false);
    expect(isDuplicatePair(0.85, 2, 0.4)).toBe(false); // Jaccard below the floor
    expect(isDuplicatePair(0.85, 1, 0.5)).toBe(false); // fewer than 2 shared never corroborates
  });

  it("passes a high-cosine pair with NO ingredient overlap (the paraphrase-twin arm)", () => {
    expect(isDuplicatePair(0.91, 0, 0)).toBe(true);
    expect(isDuplicatePair(DUP_COSINE_HIGH, 0, 0)).toBe(true); // boundary inclusive
  });

  it("rejects strong overlap below the corroborated cosine floor", () => {
    expect(isDuplicatePair(0.71, 5, 0.9)).toBe(false);
    expect(isDuplicatePair(DUP_COSINE_CORROBORATED, 2, 0.5)).toBe(true); // boundary inclusive
  });
});

describe("planDupScan — the watermark", () => {
  it("queues unstamped and stale rows only, respecting the cap", () => {
    const a = row({ slug: "a" }); // never scanned
    const b = row({ slug: "b" });
    b.stamp = fresh(b); // fresh — skipped
    const c = row({ slug: "c", stamp: "stale" });
    expect(planDupScan([a, b, c], 25)).toEqual(["a", "c"]);
    expect(planDupScan([a, b, c], 1)).toEqual(["a"]);
    expect(DUP_SCAN_MAX_PER_TICK).toBe(25);
  });

  it("a changed description_hash re-queues a stamped recipe", () => {
    const a = row({ slug: "a" });
    a.stamp = fresh(a);
    expect(planDupScan([a], 25)).toEqual([]);
    a.descriptionHash = "dh-regenerated";
    expect(planDupScan([a], 25)).toEqual(["a"]);
  });

  it("a changed ingredients_key re-queues a stamped recipe (facet-only re-derivation)", () => {
    const a = row({ slug: "a", ingredientsKey: ["flour", "eggs"] });
    a.stamp = fresh(a);
    expect(planDupScan([a], 25)).toEqual([]);
    a.ingredientsKey = ["flour", "eggs", "olive oil"];
    expect(planDupScan([a], 25)).toEqual(["a"]);
  });
});

describe("detectPairs — scanned-vs-all", () => {
  const pasta = row({
    slug: "fresh-pasta",
    title: "Fresh Pasta",
    embedding: [1, 0],
    ingredientsKey: ["flour", "eggs"],
  });
  const dough = row({
    slug: "homemade-pasta-dough",
    title: "Homemade Pasta Dough",
    embedding: vec(0.767),
    ingredientsKey: ["Flour", "Eggs", "olive oil"], // case-insensitive overlap
  });

  it("detects the fixture pair via the corroborated arm, members sorted", () => {
    const pairs = detectPairs(["homemade-pasta-dough"], [pasta, dough]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      a: "fresh-pasta",
      b: "homemade-pasta-dough",
      titles: ["Fresh Pasta", "Homemade Pasta Dough"],
      shared: ["eggs", "flour"],
      detector: "corroborated",
    });
    expect(pairs[0].cosine).toBeCloseTo(0.767, 3);
    expect(pairs[0].jaccard).toBeCloseTo(2 / 3, 3);
  });

  it("a NEW (unstamped) recipe finds an old stamped duplicate — pair completeness", () => {
    const old = { ...pasta, stamp: fresh(pasta) };
    const pairs = detectPairs(planDupScan([old, dough], 25), [old, dough]);
    expect(planDupScan([old, dough], 25)).toEqual(["homemade-pasta-dough"]);
    expect(pairs).toHaveLength(1);
  });

  it("does not pair a moderate-cosine low-overlap neighbor; does pair a 0.91-cosine stranger", () => {
    const neighbor = row({ slug: "minestrone", embedding: vec(0.85), ingredientsKey: ["beans", "kale"] });
    expect(detectPairs(["minestrone"], [pasta, neighbor])).toHaveLength(0);
    const twin = row({ slug: "zz-twin", embedding: vec(0.91), ingredientsKey: ["something-else"] });
    const pairs = detectPairs(["zz-twin"], [pasta, twin]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: "fresh-pasta", b: "zz-twin", detector: "cosine" });
  });

  it("dedups a pair when BOTH members are scanned the same tick", () => {
    const pairs = detectPairs(["fresh-pasta", "homemade-pasta-dough"], [pasta, dough]);
    expect(pairs).toHaveLength(1);
  });
});

describe("draftMergeProposal", () => {
  const pair: DupCandidatePair = {
    a: "fresh-pasta",
    b: "homemade-pasta-dough",
    titles: ["Fresh Pasta", "Homemade Pasta Dough"],
    cosine: 0.767,
    shared: ["eggs", "flour"],
    jaccard: 2 / 3,
    detector: "corroborated",
  };

  it("targets the sorted pair key and carries the evidence + thresholds in force", () => {
    const d = draftMergeProposal(pair);
    expect(d.kind).toBe("merge_recipes");
    expect(d.target).toBe("fresh-pasta+homemade-pasta-dough");
    expect(d.payload).toMatchObject({
      slugs: ["fresh-pasta", "homemade-pasta-dough"],
      titles: ["Fresh Pasta", "Homemade Pasta Dough"],
      shared_ingredients: ["eggs", "flour"],
      detector: "corroborated",
    });
    expect(d.rationale).toContain("Fresh Pasta");
    expect(d.rationale).toContain("Homemade Pasta Dough");
    expect(d.rationale).toContain("0.77");
    expect(d.evidence).toMatchObject({ thresholds: { cosine_high: 0.9, cosine_corroborated: 0.72, jaccard: 0.5, shared_min: 2 } });
  });
});

// --- the wiring, against a real migrated SQLite (dup_scan + pending_proposals DDL) ---------

function insert(envDb: Env, sql: string, ...binds: unknown[]): Promise<unknown> {
  return (envDb.DB.prepare(sql).bind(...binds) as unknown as { run(): Promise<unknown> }).run();
}

async function seedCorpus(env: Env): Promise<void> {
  // Distinct residual dimensions so only the pasta pair is close: cos(pasta, dough) =
  // 0.767 (corroborated arm), cos(pasta, minestrone) = 0.85 (no overlap — no pair),
  // cos(dough, minestrone) = 0.767 × 0.85 ≈ 0.65 (below every arm).
  const rows: Array<[string, string, number[], string[]]> = [
    ["fresh-pasta", "Fresh Pasta", [1, 0, 0], ["flour", "eggs"]],
    ["homemade-pasta-dough", "Homemade Pasta Dough", [0.767, Math.sqrt(1 - 0.767 ** 2), 0], ["flour", "eggs", "olive oil"]],
    ["minestrone", "Minestrone", [0.85, 0, Math.sqrt(1 - 0.85 ** 2)], ["beans", "kale"]],
  ];
  for (const [slug, title, embedding, keys] of rows) {
    await insert(env, "INSERT INTO recipes (slug, title, ingredients_key) VALUES (?1, ?2, ?3)", slug, title, JSON.stringify(keys));
    await insert(
      env,
      "INSERT INTO recipe_derived (slug, embedding, description_hash) VALUES (?1, ?2, ?3)",
      slug,
      JSON.stringify(embedding),
      `dh-${slug}`,
    );
  }
}

function operatorEnv(): { env: Env; rows: <T = Record<string, unknown>>(table: string) => T[] } {
  const s = sqliteEnv();
  (s.env as { OWNER_TENANT_ID?: string }).OWNER_TENANT_ID = "Casey"; // normalization → "casey"
  return { env: s.env, rows: s.rows };
}

describe("runDupScanJob — real wiring", () => {
  it("scans, enqueues ONE operator proposal for the fixture pair, stamps, and quiesces", async () => {
    const { env, rows } = operatorEnv();
    await seedCorpus(env);
    const deps = buildDupScanDeps(env);
    await runDupScanJob(env, deps);

    const pending = await readProposals(env, "casey", "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "merge_recipes",
      target: "fresh-pasta+homemade-pasta-dough",
      producer: "dup-scan",
      status: "pending",
    });
    expect(pending[0].payload).toMatchObject({ slugs: ["fresh-pasta", "homemade-pasta-dough"] });
    expect(rows("dup_scan")).toHaveLength(3); // every embedded recipe stamped

    const health = await readJobHealth(env, DUP_SCAN_JOB);
    expect(health?.ok).toBe(true);
    expect(health?.summary).toMatchObject({ scanned: 3, pairs_found: 1, enqueued: 1, stamps_pruned: 0 });

    // Second tick: fully stamped — zero comparisons, nothing new.
    await runDupScanJob(env, deps);
    expect((await readJobHealth(env, DUP_SCAN_JOB))?.summary).toMatchObject({ scanned: 0, pairs_found: 0, enqueued: 0 });
    expect(await readProposals(env, "casey", "pending")).toHaveLength(1);
  });

  it("re-detection of a pending or DISMISSED pair inserts nothing (stable id, permanent suppression)", async () => {
    const { env, rows } = operatorEnv();
    await seedCorpus(env);
    const deps = buildDupScanDeps(env);
    await runDupScanJob(env, deps);
    const [p] = await readProposals(env, "casey", "pending");

    // Force a full re-scan (as if every stamp went stale) — the pending pair re-detects to a no-op.
    await insert(env, "DELETE FROM dup_scan");
    await runDupScanJob(env, deps);
    expect((await readJobHealth(env, DUP_SCAN_JOB))?.summary).toMatchObject({ pairs_found: 1, enqueued: 0 });

    // Dismiss, force another re-scan: the rejected row blocks re-insert forever.
    await setProposalStatus(env, p.id, "casey", "rejected", NOW.toISOString());
    await insert(env, "DELETE FROM dup_scan");
    await runDupScanJob(env, deps);
    expect(await readProposals(env, "casey", "pending")).toHaveLength(0);
    expect(rows("pending_proposals")).toHaveLength(1); // still just the rejected row
  });

  it("no operator configured → recorded no-op: no scan, no stamps, no proposals", async () => {
    const s = sqliteEnv(); // OWNER_TENANT_ID unset
    await seedCorpus(s.env);
    await runDupScanJob(s.env, buildDupScanDeps(s.env));
    expect(s.rows("dup_scan")).toHaveLength(0); // backlog preserved for a later operator
    expect(s.rows("pending_proposals")).toHaveLength(0);
    const health = await readJobHealth(s.env, DUP_SCAN_JOB);
    expect(health?.ok).toBe(true);
    expect(health?.summary).toEqual({ skipped: "no_operator" });
  });

  it("prunes orphan stamps (slug no longer in recipe_derived)", async () => {
    const { env, rows } = operatorEnv();
    await seedCorpus(env);
    await insert(env, "INSERT INTO dup_scan (slug, scanned_hash, scanned_at) VALUES ('gone', 'x', ?1)", NOW.toISOString());
    await runDupScanJob(env, buildDupScanDeps(env));
    expect(rows("dup_scan").map((r) => r.slug)).not.toContain("gone");
    expect((await readJobHealth(env, DUP_SCAN_JOB))?.summary).toMatchObject({ stamps_pruned: 1 });
  });

  it("records ok:false and rethrows a hard failure", async () => {
    const { env } = operatorEnv();
    const deps: DupScanDeps = {
      loadScanState: async () => {
        throw new Error("boom");
      },
      enqueuePair: async () => ({ inserted: false }),
      stamp: async () => {},
      pruneStamps: async () => 0,
      maxPerTick: 25,
      now: () => NOW.getTime(),
    };
    await expect(runDupScanJob(env, deps)).rejects.toThrow("boom");
    const health = await readJobHealth(env, DUP_SCAN_JOB);
    expect(health?.ok).toBe(false);
    expect(health?.summary).toMatchObject({ error: "boom" });
  });
});

describe("scanForDuplicates — in-memory deps", () => {
  it("stamps only the scanned batch (cap) and counts the summary honestly", async () => {
    const a = row({ slug: "a", embedding: [1, 0, 0] });
    const b = row({ slug: "b", embedding: [0, 1, 0] });
    const c = row({ slug: "c", embedding: [0, 0, 1] });
    const stamped: string[] = [];
    const deps: DupScanDeps = {
      loadScanState: async () => [a, b, c],
      enqueuePair: async () => ({ inserted: true }),
      stamp: async (stamps) => {
        stamped.push(...stamps.map((s) => s.slug));
      },
      pruneStamps: async () => 0,
      maxPerTick: 2,
      now: () => NOW.getTime(),
    };
    const s = await scanForDuplicates(deps);
    expect(s).toEqual({ scanned: 2, pairs_found: 0, enqueued: 0, stamps_pruned: 0 });
    expect(stamped).toEqual(["a", "b"]); // c waits for the next tick
  });
});
