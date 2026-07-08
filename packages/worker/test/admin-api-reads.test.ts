// The SPA's per-screen aggregate READ routes (admin-spa D4): each returns its SSR assembly's
// shape against seeded fixtures, through the real Hono dispatch (gate + onError included).
// Degraded health is DATA (200 + payload, D6); pending/unknown members take their guard paths;
// everything sits behind the Access gate (404 unconfigured — the existing posture, unchanged).
import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";
import { fakeR2 } from "./fake-r2.js";

/** In-memory KV (single-page list) — satisfies the bindings the reads touch. */
function memKv(initial: Record<string, string> = {}): KVNamespace {
  const m = new Map(Object.entries(initial));
  return {
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string; cursor?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

const NOW = Date.now();

/** A seeded Env: two members (casey active via an OAuth grant, pat pending), a recipe in both
 *  tiers (R2 source + D1 index row), one healthy + one failing job with run history, a
 *  discovery row, and a store — enough for every aggregate read to return populated shapes. */
function makeEnv(over: Partial<Env> = {}): Env {
  const r2 = fakeR2();
  void r2.bucket.put(
    "recipes/red-lentil-soup.md",
    ["---", "title: Red lentil soup", "protein: legume", "---", "", "# Red lentil soup", "", "Body text."].join("\n"),
  );
  void r2.bucket.put("guidance/cooking/salt.md", ["---", "topic: salt", "---", "", "Salt early."].join("\n"));
  const d1 = fakeD1({
    tables: {
      recipes: [
        {
          slug: "red-lentil-soup",
          title: "Red lentil soup",
          protein: "legume",
          cuisine: "indian",
          course: null,
          tags: null,
          ingredients_key: "red lentils",
          time_total: 40,
        },
      ],
      job_health: [
        { name: "flyer-warm", ok: 1, last_run_at: NOW - 60_000, summary: JSON.stringify({ warmed: 2 }) },
        { name: "recipe-embed", ok: 0, last_run_at: NOW - 120_000, summary: JSON.stringify({ error: "boom" }) },
      ],
      job_runs: [
        { id: "run-1", job: "flyer-warm", ok: 1, ran_at: NOW - 60_000, duration_ms: 40, summary: JSON.stringify({ warmed: 2 }), error: null },
        { id: "run-2", job: "recipe-embed", ok: 0, ran_at: NOW - 120_000, duration_ms: 12, summary: "{}", error: "boom" },
      ],
      discovery_log: [
        {
          id: "d-1",
          url: "https://example.com/soup",
          title: "A discovered soup",
          source: "feed:example",
          outcome: "error",
          slug: null,
          detail: JSON.stringify({ stage: "acquire" }),
          attempts: 1,
          next_retry_at: new Date(NOW + 3_600_000).toISOString(),
          created_at: new Date(NOW - 3_600_000).toISOString(),
        },
      ],
      stores: [{ slug: "kroger-main", name: "Kroger Main St", chain: "kroger", domain: null, address: null, location_id: "01400376" }],
      tenant_activity: [{ tenant: "casey", first_seen_at: new Date(NOW - 86_400_000).toISOString(), last_seen_at: new Date(NOW).toISOString() }],
      cooking_log: [
        {
          id: 1,
          tenant: "casey",
          type: "recipe",
          recipe: "red-lentil-soup",
          notes: null,
          cooked_at: new Date(NOW - 43_200_000).toISOString(),
          created_at: new Date(NOW - 43_200_000).toISOString(),
        },
      ],
    },
  });
  return {
    ADMIN_DEV_BYPASS: "1",
    TENANT_KV: memKv({ "tenant:casey": JSON.stringify({ id: "casey" }), "tenant:pat": JSON.stringify({ id: "pat" }) }),
    KROGER_KV: memKv(),
    OAUTH_KV: memKv({ "grant:casey:abc123": JSON.stringify({}) }),
    DB: d1.env.DB,
    CORPUS: r2.bucket,
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    ...over,
  } as unknown as Env;
}

async function readJson<T>(path: string, env: Env = makeEnv()): Promise<T> {
  const res = await app.request(path, {}, env);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  return (await res.json()) as T;
}

describe("GET /admin/api/status", () => {
  it("returns the StatusPage aggregate — payload, counts, per-job runs, reconcile, audit, satellites", async () => {
    const body = await readJson<{
      payload: { ok: boolean; jobs: { name: string }[]; d1: { ok: boolean }; admin: Record<string, boolean> };
      counts: { recipes: number; members: number; feeds: number; cached_skus: number };
      runsByJob: Record<string, unknown[]>;
      reconcile: { state: string };
      audit: unknown;
      satellites: unknown[];
    }>("/admin/api/status");
    expect(body.payload.jobs.length).toBeGreaterThan(0);
    expect(body.counts).toMatchObject({ recipes: 1, members: 2 });
    expect(Object.keys(body.runsByJob)).toContain("flyer-warm");
    expect(body.runsByJob["flyer-warm"]!.length).toBe(1);
    expect(body.reconcile.state).toBeDefined();
    expect(Array.isArray(body.satellites)).toBe(true);
  });

  it("returns a DEGRADED payload as 200-with-payload, not an error (D6)", async () => {
    const body = await readJson<{ payload: { ok: boolean; jobs: { name: string; ok: boolean | null }[] } }>(
      "/admin/api/status",
    );
    // The seeded recipe-embed job is failing — the payload is degraded yet served as data.
    expect(body.payload.ok).toBe(false);
    expect(body.payload.jobs.find((j) => j.name === "recipe-embed")?.ok).toBe(false);
  });
});

describe("GET /admin/api/members/:id", () => {
  it("assembles the roster row + member detail + recipe titles for a connected member", async () => {
    const body = await readJson<{
      row: { id: string; status: string };
      detail: { id: string; pantry: unknown[]; meal_plan: unknown[]; cooking_log: unknown[] } | null;
      titles: Record<string, string>;
    }>("/admin/api/members/casey");
    expect(body.row).toMatchObject({ id: "casey", status: "active" });
    expect(body.detail).not.toBeNull();
    expect(body.detail!.cooking_log.length).toBe(1);
    expect(body.titles["red-lentil-soup"]).toBe("Red lentil soup");
  });

  it("returns { row, detail: null } for a pending member — no detail read attempted", async () => {
    const body = await readJson<{ row: { id: string; status: string }; detail: unknown; titles: Record<string, string> }>(
      "/admin/api/members/pat",
    );
    expect(body.row).toMatchObject({ id: "pat", status: "pending" });
    expect(body.detail).toBeNull();
    expect(body.titles).toEqual({});
  });

  it("404s an unknown member with a structured not_found", async () => {
    const res = await app.request("/admin/api/members/nobody", {}, makeEnv());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});

describe("GET /admin/api/logs/runs", () => {
  it("returns the registered jobs and the merged bounded run list", async () => {
    const body = await readJson<{ jobs: string[]; runs: { id: string; job: string; ok: boolean }[] }>("/admin/api/logs/runs");
    expect(body.jobs).toContain("flyer-warm");
    expect(body.runs.map((r) => r.id)).toEqual(["run-1", "run-2"]);
  });
});

describe("GET /admin/api/data/recipes", () => {
  it("returns the joined, paginated list shape (facets + status, no score in keyword mode)", async () => {
    const body = await readJson<{
      query: string;
      mode: string;
      resolvedMode: string;
      size: number;
      page: number;
      pages: number;
      total: number;
      hits: { slug: string; title: string | null; status: string; protein: string | null; score: number | null; semantic: boolean }[];
    }>("/admin/api/data/recipes");
    expect(body).toMatchObject({ query: "", mode: "keyword", resolvedMode: "keyword", size: 50, page: 0, pages: 1, total: 1 });
    expect(body.hits[0]).toMatchObject({ slug: "red-lentil-soup", status: "indexed", protein: "legume", score: null, semantic: false });
  });

  it("keyword-matches all query tokens and clamps an out-of-range page", async () => {
    const body = await readJson<{ total: number; page: number; hits: { slug: string }[] }>(
      "/admin/api/data/recipes?q=lentil+soup&page=9",
    );
    expect(body.total).toBe(1);
    expect(body.page).toBe(0);
    expect(body.hits[0]!.slug).toBe("red-lentil-soup");
  });
});

describe("GET /admin/api/data/recipes/:slug", () => {
  it("returns the cross-tier detail with Worker-rendered html + parsed frontmatter (D8)", async () => {
    const body = await readJson<{
      slug: string;
      status: string;
      html: string | null;
      frontmatter: Record<string, unknown> | null;
      source: string | null;
    }>("/admin/api/data/recipes/red-lentil-soup");
    expect(body.slug).toBe("red-lentil-soup");
    expect(body.status).toBe("indexed");
    expect(body.html).toContain("<h1>Red lentil soup</h1>");
    expect(body.frontmatter).toMatchObject({ title: "Red lentil soup" });
    expect(body.source).toContain("# Red lentil soup");
  });
});

describe("GET /admin/api/data/stores", () => {
  it("lists the registry and serves a store's cross-tier detail", async () => {
    const list = await readJson<{ stores: { slug: string; name: string }[] }>("/admin/api/data/stores");
    expect(list.stores[0]).toMatchObject({ slug: "kroger-main", name: "Kroger Main St" });
    const detail = await readJson<{ slug: string; skus: unknown[]; notes: Record<string, unknown[]> }>(
      "/admin/api/data/stores/kroger-main",
    );
    expect(detail.slug).toBe("kroger-main");
    expect(detail.notes).toHaveProperty("general");
  });
});

describe("GET /admin/api/data/guidance", () => {
  it("lists a folder (kind: listing) and renders an object (kind: object, D8)", async () => {
    const listing = await readJson<{ kind: string; prefix: string; listing: { entries: { name: string; type: string }[] } }>(
      "/admin/api/data/guidance",
    );
    expect(listing.kind).toBe("listing");
    expect(listing.listing.entries.some((e) => e.type === "dir" && e.name === "cooking")).toBe(true);
    const object = await readJson<{ kind: string; path: string; frontmatter: Record<string, unknown> | null; html: string }>(
      "/admin/api/data/guidance?gpath=guidance/cooking/salt.md",
    );
    expect(object.kind).toBe("object");
    expect(object.frontmatter).toMatchObject({ topic: "salt" });
    expect(object.html).toContain("Salt early.");
  });
});

describe("GET /admin/api/insights", () => {
  it("returns the one all-windows insights payload", async () => {
    const body = await readJson<Record<string, unknown>>("/admin/api/insights");
    // Every window precomputed in one payload — the SPA's toggles are request-free.
    expect(body).toHaveProperty("windows");
  });
});

describe("GET /admin/api/usage", () => {
  it("passes not-configured states through structurally as data", async () => {
    const body = await readJson<{ usage: { configured: boolean }; trends: { configured: boolean }; tools: { configured: boolean } }>(
      "/admin/api/usage",
    );
    expect(body.usage.configured).toBe(false);
    expect(body.trends.configured).toBe(false);
    expect(body.tools.configured).toBe(false);
  });
});

describe("GET /admin/api/discovery/candidates", () => {
  it("returns the bounded candidate list + the liveness-derived ingest strip", async () => {
    const body = await readJson<{
      candidates: { id: string; outcome: string; attempts: number }[];
      ingest: { activeSatellites: number; fresh: number; stale: number; pushedToday: number; warn: boolean };
      now: number;
    }>("/admin/api/discovery/candidates");
    expect(body.candidates.map((c) => c.id)).toEqual(["d-1"]);
    expect(body.ingest).toMatchObject({ activeSatellites: 0, warn: false });
    expect(body.now).toBeGreaterThan(0);
  });
});

describe("GET /admin/api/satellites", () => {
  it("returns the SatellitesPage props — rollup, windowed rejections, quarantine flags", async () => {
    const body = await readJson<{
      rollup: { satellites: unknown[]; stats: Record<string, number>; funnel: Record<string, unknown> };
      rejections: unknown[];
      quarantine: unknown[];
      now: number;
    }>("/admin/api/satellites");
    expect(body.rollup).toHaveProperty("satellites");
    expect(body.rollup).toHaveProperty("funnel");
    expect(Array.isArray(body.rejections)).toBe(true);
    expect(Array.isArray(body.quarantine)).toBe(true);
  });
});

describe("the Normalize-area reads", () => {
  it("GET /admin/api/normalization/page returns the page model + now", async () => {
    const body = await readJson<{ data: Record<string, unknown>; now: number }>("/admin/api/normalization/page");
    expect(body.data).toHaveProperty("decisions");
    expect(body.now).toBeGreaterThan(0);
  });

  it("GET /admin/api/normalization/nodes returns the nodes browse model", async () => {
    const body = await readJson<Record<string, unknown>>("/admin/api/normalization/nodes");
    expect(body).toHaveProperty("nodes");
  });

  it("GET /admin/api/normalization/audit returns the audit surface", async () => {
    const body = await readJson<Record<string, unknown>>("/admin/api/normalization/audit");
    expect(body).toHaveProperty("obs");
    expect(body).toHaveProperty("gauges");
    expect(body).toHaveProperty("restorations");
    expect(body).toHaveProperty("rejections");
  });

  it("GET /admin/api/reconcile returns the reconcile observability model", async () => {
    const body = await readJson<{ state: string }>("/admin/api/reconcile");
    expect(body.state).toBeDefined();
  });
});

describe("gate posture (unchanged)", () => {
  it("404s every read when Access is unconfigured and the host is not loopback", async () => {
    const env = makeEnv({ ADMIN_DEV_BYPASS: undefined });
    for (const path of ["/admin/api/status", "/admin/api/members/casey", "/admin/api/logs/runs", "/admin/api/insights"]) {
      const res = await app.request(`https://example.com${path}`, {}, env);
      expect(res.status).toBe(404);
    }
  });
});
