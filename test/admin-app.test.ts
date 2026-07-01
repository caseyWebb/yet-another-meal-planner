import { describe, it, expect } from "vitest";
import app from "../src/admin/app.js";
import type { Env } from "../src/env.js";
import type { KvStore } from "../src/kroger-user.js";
import { redeemAuthNonce } from "../src/oauth.js";
import { fakeD1 } from "./fake-d1.js";
import { fakeR2 } from "./fake-r2.js";

/** In-memory KV (single-page list) — satisfies the bindings the member ops touch. */
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

/** A minimal Env for the Hono app. `ADMIN_DEV_BYPASS=1` admits on a loopback request host
 *  (a bare `app.request("/admin/...")` is `http://localhost`), exercising the panel offline. */
function makeEnv(over: Partial<Env> = {}, members: string[] = []): Env {
  const kvInit: Record<string, string> = {};
  for (const id of members) kvInit[`tenant:${id}`] = JSON.stringify({ id });
  return {
    ADMIN_DEV_BYPASS: "1",
    TENANT_KV: memKv(kvInit),
    KROGER_KV: memKv(),
    DB: fakeD1().env.DB,
    CORPUS: fakeR2().bucket,
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
    ...over,
  } as unknown as Env;
}

describe("admin Hono app", () => {
  it("404s when Access is unconfigured and the host is not loopback", async () => {
    const res = await app.request(
      "https://example.com/admin/members",
      {},
      makeEnv({ ADMIN_DEV_BYPASS: undefined }),
    );
    expect(res.status).toBe(404);
  });

  it("server-renders the members list (SSR via listTenants) under the loopback bypass", async () => {
    const res = await app.request("/admin/members", {}, makeEnv({}, ["casey", "alex"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("casey");
    expect(html).toContain("alex");
    // Links the served stylesheet and bootstraps the island.
    expect(html).toContain("/admin/styles.css");
    expect(html).toContain("/admin/islands/members.js");
  });

  it("lists tenants via the typed GET route, as structured roster rows", async () => {
    const res = await app.request("/admin/api/tenants", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenants: { id: string }[] };
    expect(body.tenants.map((t) => t.id)).toEqual(["casey"]);
    expect(body.tenants[0]).toMatchObject({ owner: false, status: "pending", kroger: "unlinked", cooked: 0, favorites: 0 });
  });

  it("onboards a member, returning the once-shown invite + connector url", async () => {
    const res = await app.request(
      "/admin/api/tenants",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "Casey" }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; invite_code: string; connector_url: string };
    expect(body.username).toBe("casey"); // canonicalized lowercase
    expect(body.invite_code).toMatch(/^[0-9a-f]{16}$/);
    expect(body.connector_url).toBe("http://localhost/mcp");
  });

  it("surfaces a structured validation error as 400 (data, not a 500)", async () => {
    const res = await app.request(
      "/admin/api/tenants",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "" }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "validation_failed" });
  });

  it("revokes a member via the typed DELETE route", async () => {
    const res = await app.request(
      "/admin/api/tenants/casey",
      { method: "DELETE" },
      makeEnv({}, ["casey"]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ username: "casey", revoked: true });
  });

  it("mints a redeemable Kroger consent link for an allowlisted member", async () => {
    const env = makeEnv({}, ["casey"]);
    const res = await app.request("/admin/api/tenants/casey/kroger-login", { method: "POST" }, env);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const nonce = new URL(url).searchParams.get("nonce")!;
    expect(await redeemAuthNonce(env.KROGER_KV as unknown as KvStore, nonce)).toBe("casey");
  });

  it("404s a Kroger consent link for a non-allowlisted member", async () => {
    const res = await app.request("/admin/api/tenants/ghost/kroger-login", { method: "POST" }, makeEnv());
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_found" });
  });
});

describe("admin Hono app — Data area routing (narrowed to Recipes/Stores/Guidance)", () => {
  it("/admin/data defaults to the Recipes explorer", async () => {
    const res = await app.request("/admin/data", {}, makeEnv());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Recipes");
    expect(html).toContain("pill active");
  });

  it("serves the Recipes, Stores, and Guidance routes", async () => {
    for (const path of ["/admin/data/recipes", "/admin/data/stores", "/admin/data/guidance"]) {
      const res = await app.request(path, {}, makeEnv());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    }
  });

  it("the sub-nav offers exactly Recipes, Stores, Guidance — no Members/Corpus/Discovery/System", async () => {
    const res = await app.request("/admin/data", {}, makeEnv());
    const html = await res.text();
    const subNav = /<div class="data-nav">.*?<\/div>/s.exec(html)?.[0] ?? "";
    expect(subNav).toContain(">Recipes<");
    expect(subNav).toContain(">Stores<");
    expect(subNav).toContain(">Guidance<");
    expect(subNav).not.toContain(">Members<");
    expect(subNav).not.toContain(">Corpus<");
    expect(subNav).not.toContain(">Discovery<");
    expect(subNav).not.toContain(">System<");
  });

  it("the dropped /admin/data/{members,corpus,discovery,system} routes are gone, not 500ing", async () => {
    for (const path of ["/admin/data/members", "/admin/data/members/casey", "/admin/data/corpus", "/admin/data/discovery", "/admin/data/system"]) {
      const res = await app.request(path, {}, makeEnv({}, ["casey"]));
      expect(res.status).toBe(404);
    }
  });

  // Pins the "Stores explorer shows as empty" diagnosis (admin-ui-fidelity-pass group 6): a
  // store seeded into `stores` (+ a `store_notes` row + a `sku_cache` row scoped to its
  // location_id) renders through the real route — `storeList`/`storeDetail` (src/admin-data.ts)
  // and the SSR page. This exercises the exact reader/render path an operator's browser would
  // hit, not just the unit-level `admin-data.test.ts` reads. It passes, confirming there is no
  // reader/render bug: a genuinely-empty `stores` table (nothing added via `add_store` yet) is
  // the correct explanation for an operator seeing an empty Stores explorer, not a code bug.
  it("a seeded store (+ note + cached SKU) renders in both the Stores list and its detail page", async () => {
    const env = makeEnv({
      DB: fakeD1({
        tables: {
          stores: [
            {
              slug: "kroger-hp",
              name: "Kroger Highland Park",
              domain: "grocery",
              extra: JSON.stringify({ chain: "kroger", label: "the big one", address: "123 Main St", location_id: "01400943" }),
            },
          ],
          store_notes: [
            { id: "n1", store: "kroger-hp", author: "casey", body: "produce is in the back left", tags: JSON.stringify(["layout"]), private: 0, created_at: "2026-06-01" },
          ],
          sku_cache: [
            { ingredient: "salmon", location_id: "01400943", sku: "0001111041195", brand: "Kroger", size: "1 lb", last_used: "2026-06-25" },
          ],
        },
      }).env.DB,
    });

    const listRes = await app.request("/admin/data/stores", {}, env);
    expect(listRes.status).toBe(200);
    const listHtml = await listRes.text();
    expect(listHtml).toContain("Kroger Highland Park");
    expect(listHtml).toContain("/admin/data/stores/kroger-hp");
    expect(listHtml).toContain("1 notes");
    expect(listHtml).toContain("1 SKUs");
    expect(listHtml).not.toContain("No stores in the shared registry");

    const detailRes = await app.request("/admin/data/stores/kroger-hp", {}, env);
    expect(detailRes.status).toBe(200);
    const detailHtml = await detailRes.text();
    expect(detailHtml).toContain("Kroger Highland Park");
    expect(detailHtml).toContain("123 Main St");
    expect(detailHtml).toContain("01400943");
    expect(detailHtml).toContain("produce is in the back left");
    expect(detailHtml).toContain("0001111041195");
  });

  it("an empty stores registry genuinely renders the empty state (not a bug — no store added yet)", async () => {
    const res = await app.request("/admin/data/stores", {}, makeEnv());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No stores in the shared registry");
  });
});

describe("admin Hono app — health-dock injection middleware", () => {
  it("injects the health dock into an admin HTML page, before </body>", async () => {
    const res = await app.request("/admin/members", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="health-dock"');
    expect(html).toContain('id="health-props"');
    const bodyIdx = html.indexOf("</body>");
    const dockIdx = html.indexOf('id="health-dock"');
    expect(dockIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(-1);
    expect(dockIdx).toBeLessThan(bodyIdx);
  });

  it("leaves a JSON response from /admin/api/* completely untouched", async () => {
    const res = await app.request("/admin/api/tenants", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const text = await res.text();
    expect(text).not.toContain("health-dock");
    expect(text).not.toContain("health-props");
    // Still valid, parseable JSON — untouched by the splice.
    expect(() => JSON.parse(text)).not.toThrow();
    const body = JSON.parse(text) as { tenants: { id: string }[] };
    expect(body.tenants.map((t) => t.id)).toEqual(["casey"]);
  });

  it("after injection, content-length is absent or matches the new (spliced) body length", async () => {
    const res = await app.request("/admin/members", {}, makeEnv({}, ["casey"]));
    expect(res.status).toBe(200);
    const html = await res.text();
    const contentLength = res.headers.get("content-length");
    if (contentLength !== null) {
      expect(Number(contentLength)).toBe(new TextEncoder().encode(html).length);
    }
  });

  it("passes a text/html response with no </body> through unchanged (the real middleware, via a probe app)", async () => {
    // No real admin page lacks a </body> (every page renders through `Layout`), so the
    // passthrough branch can't be reached via `/admin/*`. Mount the SAME exported middleware
    // (`injectHealthDock` — not a re-implementation) onto a throwaway Hono app to reach it.
    const { Hono } = await import("hono");
    const { injectHealthDock } = await import("../src/admin/app.js");
    const probe = new Hono<{ Bindings: Env }>();
    probe.use("*", injectHealthDock);
    const fragment = "<!doctype html><html><body><p>no closing tag in this fixture</p>";
    probe.get("/", (c) => c.html(fragment));
    const res = await probe.request("/", {}, makeEnv({}, ["casey"]));
    const html = await res.text();
    expect(html).toBe(fragment);
    expect(html).not.toContain("health-dock");
  });
});
