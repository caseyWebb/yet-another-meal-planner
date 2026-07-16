// The curated tier + import-path attribution (deployment-profiles-and-visibility-lens):
// curated candidates ride the sweep pipeline with NO taste matching and NO
// discovery_matches (grants land on the reserved tenant); the sweep's match+grant
// single write path (recordDiscoveryMatches) mints attribution and visibility together.
// The shared create path's dedup-to-grant attribution mechanics (formerly exercised
// here via create_recipe) are covered by test/import-recipe.test.ts now.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { registerWriteTools, applyPreferencesPatch } from "../src/write-tools.js";
import { readPreferences } from "../src/profile-db.js";
import { recordDiscoveryMatches } from "../src/discovery-db.js";
import { CURATED_TENANT, memberViewer, visibleSlugs } from "../src/visibility.js";
import {
  runDiscoverySweep,
  type DiscoveryDeps,
  type SweepCandidate,
  type SweepMember,
  DEFAULT_CONFIG,
} from "../src/discovery-sweep.js";

// --- sweep-level: curated candidates skip matching and land the reserved grant --------

const VEC_A = [1, 0, 0];
const VEC_B = [0, 1, 0]; // orthogonal to every member's taste

function member(tenant: string): SweepMember {
  return { tenant, tasteVector: VEC_A, favoriteVectors: [], rejectVectors: [], dietary: [] };
}

function fakeSweepDeps(opts: { candidates: SweepCandidate[]; members: SweepMember[]; corpus?: { slug: string; vector: number[] }[] }) {
  const calls = {
    imported: [] as string[],
    curatedGrants: [] as string[],
    matches: [] as Array<{ slug: string; via: string; tenants: string[] }>,
    logs: [] as Array<{ outcome: string; slug?: string }>,
  };
  const deps: DiscoveryDeps = {
    loadCandidates: async () => opts.candidates,
    loadRetries: async () => [],
    loadMembers: async () => opts.members,
    loadCorpusVectors: async () => opts.corpus ?? [],
    embed: async () => VEC_B, // every candidate's description vector: far from all tastes
    embedMany: async (texts) => texts.map(() => VEC_B),
    acquireContent: async (c) => ({ ok: true, content: { title: c.title, ingredients: ["x"], instructions: ["y"] } }),
    classify: async (content) => ({ title: content.title, dietary: [] }),
    describe: async (fm) => `DESC:${fm.title}`,
    confirmMatches: async (_t, _d, members) => members.map((m) => m.tenant),
    importRecipe: async (fm) => String(fm.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    recordMatches: async (slug, attributions, via) => {
      calls.matches.push({ slug, via, tenants: attributions.map((a) => a.tenant) });
    },
    grantCurated: async (slug) => {
      calls.curatedGrants.push(slug);
    },
    recordLog: async (entry) => {
      calls.logs.push({ outcome: entry.outcome, slug: entry.slug });
    },
    resolveRow: async () => {},
    bumpRetry: async () => {},
  };
  return { deps, calls };
}

describe("curated candidates in the sweep pipeline", () => {
  it("imports WITHOUT taste matching: no member match needed, grantCurated minted, recordMatches never called", async () => {
    const { deps, calls } = fakeSweepDeps({
      // The description vector (VEC_B) is orthogonal to every taste — a member-feed
      // candidate with this profile would be no_match; the curated one still lands.
      candidates: [{ url: "https://cur.example.com/soup", title: "Starter Soup", summary: null, source: "curated", via: "curated", curated: true }],
      members: [member("casey")],
    });
    const res = await runDiscoverySweep(deps, DEFAULT_CONFIG);
    expect(res.imported).toBe(1);
    expect(calls.curatedGrants).toEqual(["starter-soup"]);
    expect(calls.matches).toEqual([]); // curated landings write NO discovery_matches
    expect(calls.logs.at(-1)).toMatchObject({ outcome: "imported", slug: "starter-soup" });
  });

  it("a curated semantic duplicate is DEDUP-TO-GRANT: the existing slug gains the curated grant", async () => {
    const { deps, calls } = fakeSweepDeps({
      candidates: [{ url: "https://cur.example.com/dup", title: "Dup Dish", summary: null, source: "curated", via: "curated", curated: true }],
      members: [member("casey")],
      corpus: [{ slug: "existing-dish", vector: VEC_B }], // cosine 1.0 ≥ δ → duplicate
    });
    const res = await runDiscoverySweep(deps, DEFAULT_CONFIG);
    expect(res.duplicate).toBe(1);
    expect(calls.curatedGrants).toEqual(["existing-dish"]);
    expect(calls.logs.at(-1)).toMatchObject({ outcome: "duplicate" });
  });

  it("a member-feed candidate threads its via to the match+grant write path", async () => {
    const { deps, calls } = fakeSweepDeps({
      candidates: [{ url: "https://blog.example.com/r", title: "Ragu", summary: null, source: "Blog", via: "feed:https://blog.example.com/rss" }],
      members: [{ ...member("casey"), tasteVector: VEC_B }], // taste == description vector → match
    });
    const res = await runDiscoverySweep(deps, DEFAULT_CONFIG);
    expect(res.imported).toBe(1);
    expect(calls.curatedGrants).toEqual([]);
    expect(calls.matches).toEqual([{ slug: "ragu", via: "feed:https://blog.example.com/rss", tenants: ["casey"] }]);
  });
});

// --- the match+grant single write path over real SQLite -------------------------------

describe("recordDiscoveryMatches (attribution and visibility minted together)", () => {
  it("N confirmed households mean N match rows AND N grants, in one batch, via stamped", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    await recordDiscoveryMatches(
      h.env,
      "ragu",
      [
        { tenant: "casey", member: "casey", score: 0.8 },
        { tenant: "pat", member: "pat", score: 0.7 },
      ],
      "2026-07-01",
      "feed:https://blog.example.com/rss",
    );
    expect(h.rows("discovery_matches")).toHaveLength(2);
    expect(h.rows("recipe_imports")).toEqual([
      { recipe: "ragu", tenant: "casey", member: "casey", via: "feed:https://blog.example.com/rss", imported_at: "2026-07-01" },
      { recipe: "ragu", tenant: "pat", member: "pat", via: "feed:https://blog.example.com/rss", imported_at: "2026-07-01" },
    ]);
  });

  it("re-recording updates the match row but never the grant (first provenance wins)", async () => {
    const h = sqliteEnv(["casey"]);
    await recordDiscoveryMatches(h.env, "ragu", [{ tenant: "casey", member: "casey", score: 0.8 }], "2026-07-01", "satellite");
    await recordDiscoveryMatches(h.env, "ragu", [{ tenant: "casey", member: "casey", score: 0.9 }], "2026-07-08", "satellite");
    expect(h.rows<{ score: number }>("discovery_matches")[0].score).toBe(0.9);
    expect(h.rows<{ imported_at: string }>("recipe_imports")[0].imported_at).toBe("2026-07-01");
  });
});

// create_recipe left the MCP surface (recipe-discovery, recipe-import): the shared
// create path's dedup-to-grant / slug_exists / attribution mechanics it exercised are
// now behind import_recipe — see test/import-recipe.test.ts for that coverage
// (fresh import, dedup-to-grant with a fresh vs. idempotent grant, slug_exists).

// --- curated_hide: the household preferences write path (D13-amendment) ------------------

describe("curated_hide rides the preferences merge-patch path", () => {
  function setSaas(h: SqliteEnv): void {
    h.raw.exec("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')");
  }

  function seedCurated(h: SqliteEnv): void {
    h.raw.exec("INSERT INTO recipes (slug, title) VALUES ('starter', 'Starter')");
    h.raw.exec(
      `INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('starter', '${CURATED_TENANT}', '${CURATED_TENANT}', 'curated', '2026-01-01')`,
    );
  }

  it("persists 1, suppresses the curated tier for THAT household only, and reads back as a boolean", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    setSaas(h);
    seedCurated(h);
    await applyPreferencesPatch(h.env, "casey", { curated_hide: true });
    expect(h.rows<{ tenant: string; curated_hide: number | null }>("profile").find((r) => r.tenant === "casey")?.curated_hide).toBe(1);
    expect((await readPreferences(h.env, "casey"))?.curated_hide).toBe(true);
    expect(await visibleSlugs(h.env, memberViewer("casey"))).toEqual(new Set());
    // Household-scoped: the other household's lens keeps the tier.
    expect(await visibleSlugs(h.env, memberViewer("pat"))).toEqual(new Set(["starter"]));
  });

  it("a null patch clears the key back to shown; the setting deleted nothing", async () => {
    const h = sqliteEnv(["casey"]);
    setSaas(h);
    seedCurated(h);
    await applyPreferencesPatch(h.env, "casey", { curated_hide: true });
    await applyPreferencesPatch(h.env, "casey", { curated_hide: null });
    const prefs = await readPreferences(h.env, "casey");
    // assemblePreferences surfaces the key ONLY when stored 1 — cleared reads as absent.
    expect(prefs?.curated_hide).toBeUndefined();
    expect(await visibleSlugs(h.env, memberViewer("casey"))).toEqual(new Set(["starter"]));
  });

  it("a non-boolean value is malformed_data and nothing is stored", async () => {
    const h = sqliteEnv(["casey"]);
    await expect(applyPreferencesPatch(h.env, "casey", { curated_hide: "yes" })).rejects.toMatchObject({
      code: "malformed_data",
    });
    expect(h.rows("profile")).toEqual([]);
  });

  it("toggle_reject still works on a curated-granted row (the per-member overlay brake)", async () => {
    const h = sqliteEnv(["casey"]);
    setSaas(h);
    seedCurated(h); // the recipes projection row exists — the disposition gate passes
    const server = new McpServer({ name: "write-test", version: "0.0.0" });
    registerWriteTools(server, h.env, "casey");
    const out = await withServer(server, (c) => invokeTool(c, "toggle_reject", { slug: "starter", reject: true }));
    expect(out.isError).toBe(false);
    expect(out.result).toMatchObject({ slug: "starter", overlay: { reject: true } });
    expect(h.rows<{ tenant: string; recipe: string; reject: number | null }>("overlay")).toEqual([
      expect.objectContaining({ tenant: "casey", recipe: "starter", reject: 1 }),
    ]);
  });
});

// --- retry stream: a parked curated row re-enters the pipeline AS curated -------------
// (D13: curated intake skips taste matching and lands the reserved tenant's grant; a
// retry that lost the flag would mint discovery_matches + household grants instead.)

describe("loadRetries curated provenance", () => {
  it("re-derives curated/via from the log row's source", async () => {
    const h = sqliteEnv(["casey"]);
    const env = h.env;
    const { recordDiscoveryLog } = await import("../src/discovery-db.js");
    const { buildDiscoveryDeps } = await import("../src/discovery-sweep.js");
    const past = "2026-01-01T00:00:00.000Z";
    await recordDiscoveryLog(env, {
      url: "https://curated.example/pie",
      title: "Pie",
      source: "curated",
      outcome: "error",
      createdAt: past,
      attempts: 1,
      nextRetryAt: past,
    });
    await recordDiscoveryLog(env, {
      url: "https://blog.example/stew",
      title: "Stew",
      source: "https://blog.example/feed.xml",
      outcome: "failed",
      createdAt: past,
      attempts: 2,
      nextRetryAt: past,
    });
    await recordDiscoveryLog(env, {
      url: "https://walled.example/cake",
      title: "Cake",
      source: "curated", // pushed wins: a satellite row is never curated intake
      outcome: "error",
      createdAt: past,
      attempts: 1,
      nextRetryAt: past,
      pushed: true,
    });

    const deps = buildDiscoveryDeps(env);
    const retries = await deps.loadRetries("2026-07-15T00:00:00.000Z", 10);
    const bySlugUrl = Object.fromEntries(retries.map((r) => [r.url, r]));

    expect(bySlugUrl["https://curated.example/pie"].curated).toBe(true);
    expect(bySlugUrl["https://curated.example/pie"].via).toBe("curated");
    expect(bySlugUrl["https://blog.example/stew"].curated).toBe(false);
    expect(bySlugUrl["https://blog.example/stew"].via).toBe("feed:https://blog.example/feed.xml");
    expect(bySlugUrl["https://walled.example/cake"].curated).toBe(false);
    expect(bySlugUrl["https://walled.example/cake"].via).toBe("satellite");
  });
});
