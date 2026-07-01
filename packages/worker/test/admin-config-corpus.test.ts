import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";

/** Minimal in-memory KV (just enough for the Access gate's loopback bypass). */
function memKv(): KVNamespace {
  const m = new Map<string, string>();
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

/** A dev-bypass (loopback) env over a fakeD1-seeded corpus. */
function devEnv(tables: Record<string, Record<string, unknown>[]>): { env: Env; tables: Record<string, Record<string, unknown>[]> } {
  const { env: dbEnv, tables: t } = fakeD1({ tables });
  return {
    env: {
      ADMIN_DEV_BYPASS: "1",
      TENANT_KV: memKv(),
      KROGER_KV: memKv(),
      DB: dbEnv.DB,
      ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    } as unknown as Env,
    tables: t,
  };
}

const post = (body: unknown) =>
  ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as RequestInit;

describe("Config › shared-corpus editors (SSR pages)", () => {
  it("404s an unknown Config group slug as a structured not_found, not a 500", async () => {
    const { env } = devEnv({ aliases: [] });
    const res = await app.request("/admin/config/nonsense", {}, env);
    // No SSR route matches /config/nonsense, so it falls through to ASSETS (404 here).
    expect(res.status).toBe(404);
  });
});

// --- Config › four-group sub-nav (admin-ui-redesign-config) ------------------

describe("Config › four consolidated groups", () => {
  it("the bare /admin/config route serves the Discovery group by default, with calibration + Feeds + Email Sources", async () => {
    const { env } = devEnv({
      feeds: [{ url: "https://a.example/feed", name: "A", weight: 1, tags: [] }],
      discovery_members: [{ address: "casey@dirtbag.social" }],
      discovery_senders: [{ address: "digest@nyt-forward.example" }],
    });
    const res = await app.request("/admin/config", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Calibration");
    expect(html).toContain("/admin/islands/calibration.js");
    expect(html).toContain("Discovery feeds");
    expect(html).toContain("https://a.example/feed");
    expect(html).toContain("Email Sources");
    expect(html).toContain("casey@dirtbag.social");
    expect(html).toContain("digest@nyt-forward.example");
    expect(html).toContain("/admin/islands/email-sources.js");
    // The Discovery pill is active on the default route.
    expect(html).toMatch(/class="pill active">\s*Discovery/);
  });

  it("/admin/config/flyer serves the Kroger Flyer group: flyer knobs + flyer-terms editor", async () => {
    const { env } = devEnv({ flyer_terms: [{ term: "olive oil" }] });
    const res = await app.request("/admin/config/flyer", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Flyer behaviour");
    expect(html).toContain("/admin/islands/opconfig.js");
    expect(html).toContain("Flyer terms");
    expect(html).toContain("olive oil");
    expect(html).toMatch(/class="pill active">\s*Kroger Flyer/);
  });

  it("/admin/config/ranking serves only the Ranking knob console (no corpus editor)", async () => {
    const { env } = devEnv({});
    const res = await app.request("/admin/config/ranking", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Ranking weights");
    expect(html).toContain("/admin/islands/opconfig.js");
    expect(html).toMatch(/class="pill active">\s*Ranking/);
  });

  it("/admin/config/aliases redirects to the Normalization Aliases tab (bookmark preserved)", async () => {
    const { env } = devEnv({});
    const res = await app.request("/admin/config/aliases", {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/normalize?tab=aliases");
  });

  it("the sub-nav lists exactly the three group labels, in order", async () => {
    const { env } = devEnv({});
    const res = await app.request("/admin/config", {}, env);
    const html = await res.text();
    const navMatch = html.match(/<div class="data-nav">.*?<\/div>/s);
    expect(navMatch).not.toBeNull();
    const subNav = navMatch![0];
    const labels = ["Discovery", "Kroger Flyer", "Ranking"];
    let lastIndex = -1;
    for (const label of labels) {
      const idx = subNav.indexOf(`>${label}</a>`);
      expect(idx).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
    // The old eight-slug flat destinations are gone as standalone sub-nav pills.
    expect(subNav).not.toContain(">Senders</a>");
    expect(subNav).not.toContain(">Members</a>");
    expect(subNav).not.toContain(">Flyer terms</a>");
    expect(subNav).not.toContain(">Feeds</a>");
  });
});

describe("Config › shared-corpus editors (typed API routes)", () => {
  it("lists a table via GET /admin/api/corpus/:table", async () => {
    const { env } = devEnv({ flyer_terms: [{ term: "cheese" }] });
    const res = await app.request("/admin/api/corpus/flyer-terms", {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      table: "flyer-terms",
      columns: ["term"],
      rows: [{ term: "cheese" }],
    });
  });

  it("404s a retired corpus table (aliases moved to Normalization)", async () => {
    const { env } = devEnv({});
    const res = await app.request("/admin/api/corpus/aliases", {}, env);
    expect(res.status).toBe(404);
  });

  it("adds a row via POST and removes it via DELETE", async () => {
    const { env, tables } = devEnv({ flyer_terms: [] });
    const add = await app.request(
      "/admin/api/corpus/flyer-terms",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term: "cheese" }) },
      env,
    );
    expect(add.status).toBe(200);
    expect(await add.json()).toEqual({ added: 1 });
    expect(tables.flyer_terms.map((r) => r.term)).toEqual(["cheese"]);

    const del = await app.request("/admin/api/corpus/flyer-terms/cheese", { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ removed: true });
    expect(tables.flyer_terms).toHaveLength(0);
  });

  it("surfaces an unknown table as a structured 404 (not a 500)", async () => {
    const { env } = devEnv({ aliases: [] });
    const res = await app.request("/admin/api/corpus/nonsense", {}, env);
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_found" });
  });

  it("rejects an invalid add (missing required field) with a structured 400, writing nothing", async () => {
    const { env, tables } = devEnv({ flyer_terms: [] });
    const res = await app.request(
      "/admin/api/corpus/flyer-terms",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notterm: "x" }) },
      env,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
    expect(tables.flyer_terms).toHaveLength(0);
  });

  it("rejects feed tags that are not a string array (400)", async () => {
    const { env } = devEnv({ feeds: [] });
    const res = await app.request("/admin/api/corpus/feeds", post({ url: "https://a.com", tags: "x" }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a negative feed weight (400)", async () => {
    const { env } = devEnv({ feeds: [] });
    const res = await app.request("/admin/api/corpus/feeds", post({ url: "https://a.com", weight: -1 }), env);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed member address (no @) with 400 instead of a silent no-op", async () => {
    const { env, tables } = devEnv({ discovery_members: [] });
    const res = await app.request("/admin/api/corpus/members", post({ address: "notanaddress" }), env);
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
    expect(tables.discovery_members).toHaveLength(0);
  });

  it("removes by primary key idempotently (removed: true, then false)", async () => {
    const { env, tables } = devEnv({ flyer_terms: [{ term: "fruit" }] });
    const hit = await app.request("/admin/api/corpus/flyer-terms/fruit", { method: "DELETE" }, env);
    expect(await hit.json()).toEqual({ removed: true });
    expect(tables.flyer_terms).toHaveLength(0);
    const miss = await app.request("/admin/api/corpus/flyer-terms/fruit", { method: "DELETE" }, env);
    expect(await miss.json()).toEqual({ removed: false });
  });

  it("normalizes an address key on delete", async () => {
    const { env } = devEnv({ discovery_members: [{ address: "me@x.com" }] });
    const res = await app.request("/admin/api/corpus/members/Me@X.com", { method: "DELETE" }, env);
    expect(await res.json()).toEqual({ removed: true });
  });
});

// --- Email Sources: the presentation-layer consolidation of members + senders ------------
// The Email Sources island (client/email-sources.tsx) is two listCorpus reads + two
// add/remove writes composed into one list — no new backend route, no schema change (design.md
// Decision 5). These tests exercise the underlying two-table routing contract it depends on:
// a "member" add lands only in `members`, an "automated forward" add lands only in `senders`,
// and removing a row from one table never touches the other (the mis-route safeguard).

describe("Email Sources › two-table routing (members vs senders)", () => {
  it("adding a 'member' address writes to discovery_members and leaves discovery_senders untouched", async () => {
    const { env, tables } = devEnv({ discovery_members: [], discovery_senders: [] });
    const res = await app.request("/admin/api/corpus/members", post({ address: "dani@dirtbag.social" }), env);
    expect(res.status).toBe(200);
    expect(tables.discovery_members.map((r) => r.address)).toEqual(["dani@dirtbag.social"]);
    expect(tables.discovery_senders).toHaveLength(0);
  });

  it("adding an 'automated forward' address writes to discovery_senders and leaves discovery_members untouched", async () => {
    const { env, tables } = devEnv({ discovery_members: [], discovery_senders: [] });
    const res = await app.request("/admin/api/corpus/senders", post({ address: "digest@nyt-forward.example" }), env);
    expect(res.status).toBe(200);
    expect(tables.discovery_senders.map((r) => r.address)).toEqual(["digest@nyt-forward.example"]);
    expect(tables.discovery_members).toHaveLength(0);
  });

  it("both kinds appear together when both tables are listed (the merged Email Sources view)", async () => {
    const { env } = devEnv({
      discovery_members: [{ address: "priya@dirtbag.social" }],
      discovery_senders: [{ address: "newsletter@seriouseats-forward.example" }],
    });
    const [members, senders] = await Promise.all([
      app.request("/admin/api/corpus/members", {}, env),
      app.request("/admin/api/corpus/senders", {}, env),
    ]);
    expect((await members.json()) as { rows: unknown[] }).toMatchObject({ rows: [{ address: "priya@dirtbag.social" }] });
    expect((await senders.json()) as { rows: unknown[] }).toMatchObject({ rows: [{ address: "newsletter@seriouseats-forward.example" }] });
  });

  it("removing an 'automated forward' targets only discovery_senders, leaving discovery_members unaffected (mis-route safeguard)", async () => {
    const { env, tables } = devEnv({
      discovery_members: [{ address: "sage@dirtbag.social" }],
      discovery_senders: [{ address: "digest@nyt-forward.example" }],
    });
    const res = await app.request("/admin/api/corpus/senders/digest@nyt-forward.example", { method: "DELETE" }, env);
    expect(await res.json()).toEqual({ removed: true });
    expect(tables.discovery_senders).toHaveLength(0);
    // The members table — same address shape, different table — is untouched.
    expect(tables.discovery_members.map((r) => r.address)).toEqual(["sage@dirtbag.social"]);
  });

  it("removing a 'member' targets only discovery_members, leaving discovery_senders unaffected (mis-route safeguard)", async () => {
    const { env, tables } = devEnv({
      discovery_members: [{ address: "sage@dirtbag.social" }],
      discovery_senders: [{ address: "digest@nyt-forward.example" }],
    });
    const res = await app.request("/admin/api/corpus/members/sage@dirtbag.social", { method: "DELETE" }, env);
    expect(await res.json()).toEqual({ removed: true });
    expect(tables.discovery_members).toHaveLength(0);
    expect(tables.discovery_senders.map((r) => r.address)).toEqual(["digest@nyt-forward.example"]);
  });
});
