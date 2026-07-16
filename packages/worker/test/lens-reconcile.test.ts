// The legacy-attachment LENS RECONCILE (deployment-profiles-and-visibility-lens,
// shared-corpus): attribution-derived vs operator-fallback attachment, the
// unset-operator recorded skip + later convergence, converged-corpus zero-work,
// re-run idempotence, bounded batch draining, and the match-row drift heal — over the
// REAL-SQLite env, with the job wrapper's health/run records asserted once.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { reconcileLensAttachment, runLensReconcileJob, LENS_RECONCILE_JOB } from "../src/lens-reconcile.js";
import { visibleSlugs, memberViewer } from "../src/visibility.js";
import type { Env } from "../src/env.js";

function seedRecipe(h: SqliteEnv, slug: string, discoveredAt: string | null = null): void {
  h.raw.prepare("INSERT INTO recipes (slug, title, discovered_at) VALUES (?, ?, ?)").run(slug, slug, discoveredAt);
}

function seedMatch(h: SqliteEnv, recipe: string, tenant: string, matchedAt = "2026-06-01"): void {
  h.raw
    .prepare("INSERT INTO discovery_matches (recipe, tenant, member, score, matched_at) VALUES (?, ?, ?, 0.7, ?)")
    .run(recipe, tenant, tenant, matchedAt);
}

function seedImportedLog(h: SqliteEnv, slug: string, source: string | null, pushed = false): void {
  h.raw
    .prepare("INSERT INTO discovery_log (id, url, title, source, outcome, slug, created_at, attempts, pushed) VALUES (?, ?, ?, ?, 'imported', ?, '2026-06-01T00:00:00Z', 0, ?)")
    .run(`log-${slug}`, `https://ex.test/${slug}`, slug, source, slug, pushed ? 1 : 0);
}

function grants(h: SqliteEnv): Array<Record<string, unknown>> {
  return h.rows("recipe_imports");
}

function withOperator(h: SqliteEnv, id: string | undefined): Env {
  (h.env as unknown as { OWNER_TENANT_ID?: string }).OWNER_TENANT_ID = id;
  return h.env;
}

describe("reconcileLensAttachment", () => {
  it("attribution-derived attachment: one grant per attributed tenant, via from the log origin, dated from the match", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    seedRecipe(h, "ragu", "2026-05-30");
    seedMatch(h, "ragu", "casey");
    seedMatch(h, "ragu", "pat");
    seedImportedLog(h, "ragu", "Serious Eats");
    const s = await reconcileLensAttachment(withOperator(h, "casey"), { today: "2026-07-15" });
    expect(s).toMatchObject({ scanned: 1, attributed: 2, operator_fallback: 0, skipped_no_operator: 0 });
    expect(grants(h).sort((a, b) => String(a.tenant).localeCompare(String(b.tenant)))).toEqual([
      { recipe: "ragu", tenant: "casey", member: "casey", via: "feed:Serious Eats", imported_at: "2026-06-01" },
      { recipe: "ragu", tenant: "pat", member: "pat", via: "feed:Serious Eats", imported_at: "2026-06-01" },
    ]);
  });

  it("via resolves satellite for pushed origins and agent when no origin resolves", async () => {
    const h = sqliteEnv(["casey"]);
    seedRecipe(h, "pushed-dish");
    seedMatch(h, "pushed-dish", "casey");
    seedImportedLog(h, "pushed-dish", "my-satellite", true);
    seedRecipe(h, "orphan-match");
    seedMatch(h, "orphan-match", "casey"); // no discovery_log row at all
    await reconcileLensAttachment(withOperator(h, undefined));
    const byRecipe = new Map(grants(h).map((g) => [g.recipe, g]));
    expect(byRecipe.get("pushed-dish")).toMatchObject({ via: "satellite" });
    expect(byRecipe.get("orphan-match")).toMatchObject({ via: "agent" });
  });

  it("operator fallback: an unattributed recipe attaches to the operator household (founding member)", async () => {
    const h = sqliteEnv(["casey"]);
    seedRecipe(h, "hand-authored", "2026-04-01");
    const s = await reconcileLensAttachment(withOperator(h, "Casey")); // normalized to lowercase
    expect(s).toMatchObject({ scanned: 1, attributed: 0, operator_fallback: 1 });
    expect(grants(h)).toEqual([
      { recipe: "hand-authored", tenant: "casey", member: "casey", via: "agent", imported_at: "2026-04-01" },
    ]);
  });

  it("unset operator: attribution-derived grants still run; the remainder is a recorded skip that converges later", async () => {
    const h = sqliteEnv(["casey"]);
    seedRecipe(h, "matched");
    seedMatch(h, "matched", "casey");
    seedRecipe(h, "unmatched");
    const s1 = await reconcileLensAttachment(withOperator(h, undefined));
    expect(s1).toMatchObject({ attributed: 1, operator_fallback: 0, skipped_no_operator: 1 });
    expect(grants(h)).toHaveLength(1); // never a NULL-owner sentinel, never a placeholder row
    // Configuring the operator later converges the remainder without manual surgery.
    const s2 = await reconcileLensAttachment(withOperator(h, "casey"));
    expect(s2).toMatchObject({ scanned: 1, operator_fallback: 1, skipped_no_operator: 0 });
    expect(await visibleSlugs(h.env, memberViewer("casey"))).toEqual(new Set(["matched", "unmatched"]));
  });

  it("a converged corpus plans zero writes, and a re-run is idempotent", async () => {
    const h = sqliteEnv(["casey"]);
    seedRecipe(h, "ragu");
    seedMatch(h, "ragu", "casey");
    await reconcileLensAttachment(withOperator(h, "casey"));
    const before = grants(h);
    const s = await reconcileLensAttachment(h.env);
    expect(s).toEqual({ scanned: 0, attributed: 0, operator_fallback: 0, drift_healed: 0, skipped_no_operator: 0 });
    expect(grants(h)).toEqual(before);
  });

  it("bounded batches drain the backlog over ticks", async () => {
    const h = sqliteEnv(["casey"]);
    for (let i = 0; i < 5; i++) seedRecipe(h, `r-${i}`);
    const env = withOperator(h, "casey");
    expect((await reconcileLensAttachment(env, { cap: 2 })).operator_fallback).toBe(2);
    expect((await reconcileLensAttachment(env, { cap: 2 })).operator_fallback).toBe(2);
    expect((await reconcileLensAttachment(env, { cap: 2 })).operator_fallback).toBe(1);
    expect(grants(h)).toHaveLength(5);
  });

  it("heals a match row missing its grant on an ALREADY-attached recipe (the drift guard)", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    seedRecipe(h, "ragu");
    // casey already holds a grant; pat's match row somehow lost its grant (pre-0059 data).
    h.raw.exec(
      "INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('ragu', 'casey', 'casey', 'agent', '2026-01-01')",
    );
    seedMatch(h, "ragu", "casey");
    seedMatch(h, "ragu", "pat", "2026-06-02");
    const s = await reconcileLensAttachment(withOperator(h, undefined));
    expect(s).toMatchObject({ scanned: 0, drift_healed: 1 });
    expect(grants(h).find((g) => g.tenant === "pat")).toMatchObject({ via: "agent", imported_at: "2026-06-02" });
  });
});

describe("runLensReconcileJob (the scheduled wrapper)", () => {
  it("records job_health + job_runs under lens-reconcile with the tick summary", async () => {
    const h = sqliteEnv(["casey"]);
    seedRecipe(h, "hand-authored");
    await runLensReconcileJob(withOperator(h, "casey"), () => 1_700_000_000_000);
    const health = h.rows<{ name: string; ok: number; summary: string }>("job_health").find((r) => r.name === LENS_RECONCILE_JOB);
    expect(health?.ok).toBe(1);
    expect(JSON.parse(health!.summary)).toMatchObject({ scanned: 1, operator_fallback: 1 });
    expect(h.rows<{ job: string }>("job_runs").some((r) => r.job === LENS_RECONCILE_JOB)).toBe(true);
  });
});

// Regression: production D1 caps queries at 100 bound variables ("variable number must
// be between ?1 and ?100"), which the first shipped reconcile hit the moment a real
// corpus (>100 unattached slugs per tick) reached the origin/match IN-list queries —
// every tick failed and nothing ever attached. The sqlite harness now enforces D1's
// limit, so this test fails without the chunked queries.
describe("D1 bind-limit safety", () => {
  it("attaches a 150-slug tick without exceeding 100 binds per query", async () => {
    const h = sqliteEnv(["casey"]);
    for (let i = 0; i < 150; i += 1) seedRecipe(h, `bulk-${String(i).padStart(3, "0")}`);
    const env = withOperator(h, "casey");
    const summary = await reconcileLensAttachment(env, { cap: 200 });
    expect(summary.operator_fallback).toBe(150);
    expect(summary.skipped_no_operator).toBe(0);
    const rows = h.rows<{ recipe: string; tenant: string }>("recipe_imports");
    expect(rows).toHaveLength(150);
    expect(new Set(rows.map((r) => r.tenant))).toEqual(new Set(["casey"]));
    // Converged: a second tick plans zero writes.
    const again = await reconcileLensAttachment(env, { cap: 200 });
    expect(again.scanned).toBe(0);
  });
});
