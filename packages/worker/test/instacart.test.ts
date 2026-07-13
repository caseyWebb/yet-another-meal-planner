import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env.js";
import type { ToBuyView } from "../src/order-shapes.js";
import {
  INSTACART_ORIGINS, buildInstacartPayload, createInstacartClient, createInstacartHandoff,
  getInstacartConfig, hashInstacartPayload, type InstacartClient,
} from "../src/instacart.js";
import { sqliteEnv } from "./sqlite-d1.js";

const NOW = new Date("2026-07-12T12:00:00.000Z");
function view(lines: Array<{ key: string; name: string; quantity?: number }> = [{ key: "milk", name: "Milk", quantity: 2 }], underived: string[] = []): ToBuyView {
  return {
    to_buy: lines.map((line) => ({ ...line, quantity: line.quantity ?? 1, assumed_quantity: false, for_recipes: [], origin: "list", kind: "grocery", domain: "grocery", checked_at: null, row_version: 1, updated_at: NOW.toISOString() })),
    checked: [], pantry_covered: [], in_cart: [], underived,
  };
}
function configured(env: Env): Env {
  env.INSTACART_API_KEY = "top-secret"; env.INSTACART_API_ENV = "development"; return env;
}
function deps(v: ToBuyView, client?: InstacartClient) {
  return { readToBuy: vi.fn(async () => v), client, now: () => NOW };
}

describe("Instacart configuration and request client", () => {
  it("fails closed unless key and a fixed environment are both valid", () => {
    expect(getInstacartConfig({})).toBeNull();
    expect(getInstacartConfig({ INSTACART_API_KEY: "x", INSTACART_API_ENV: "staging" })).toBeNull();
    expect(getInstacartConfig({ INSTACART_API_KEY: "x", INSTACART_API_ENV: "development" })).toEqual({ apiKey: "x", environment: "development", origin: INSTACART_ORIGINS.development });
    expect(getInstacartConfig({ INSTACART_API_KEY: "x", INSTACART_API_ENV: "production" })?.origin).toBe(INSTACART_ORIGINS.production);
  });

  it("sends the exact current payload and only bearer auth", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ products_link_url: "https://www.instacart.com/store/recipes/abc" }), { status: 200 }));
    const client = createInstacartClient(getInstacartConfig({ INSTACART_API_KEY: "secret", INSTACART_API_ENV: "development" })!, fetcher as typeof fetch);
    expect(await client.create(buildInstacartPayload(view([{ key: "eggs", name: "Eggs", quantity: 3 }])))).toEqual({ ok: true, url: "https://www.instacart.com/store/recipes/abc" });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit]; const [url, init] = call;
    expect(url).toBe(`${INSTACART_ORIGINS.development}/idp/v1/products/products_link`);
    expect(init.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer secret" });
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Yamp grocery list", link_type: "shopping_list", expires_in: 30, line_items: [{ name: "Eggs", display_text: "Eggs", line_item_measurements: [{ quantity: 3, unit: "package" }] }] });
    expect(init.body).not.toMatch(/retailer|sku|product|upc|price|aisle|brand|filter|"unit"\s*:\s*"(?!package)|"quantity"\s*:\s*3\s*,\s*"name"/i);
  });

  it("refuses redirects instead of forwarding the Bearer POST", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      throw new TypeError("redirect mode is error");
    });
    const client = createInstacartClient({ apiKey: "key", environment: "development", origin: INSTACART_ORIGINS.development }, fetcher as typeof fetch);
    await expect(client.create(buildInstacartPayload(view()))).resolves.toEqual({ ok: false, code: "upstream_unavailable", retryable: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("canonicalizes non-ASCII keys by deterministic code units", () => {
    const payload = buildInstacartPayload(view([
      { key: "éclair", name: "e acute" }, { key: "zebra", name: "z" },
      { key: "äpfel", name: "a umlaut" }, { key: "apple", name: "a" },
    ]));
    expect(payload.line_items.map((line) => line.name)).toEqual(["a", "z", "a umlaut", "e acute"]);
  });

  it.each([[400, "invalid_request", false], [401, "unauthorized", false], [403, "forbidden", false], [429, "rate_limited", true], [503, "upstream_unavailable", true]] as const)("maps %s without exposing raw bodies", async (status, code, retryable) => {
    const fetcher = vi.fn(async () => new Response("raw secret diagnostic", { status }));
    const out = await createInstacartClient({ apiKey: "key", environment: "production", origin: INSTACART_ORIGINS.production }, fetcher as typeof fetch).create(buildInstacartPayload(view()));
    expect(out).toEqual({ ok: false, code, retryable });
    expect(JSON.stringify(out)).not.toContain("raw secret diagnostic"); expect(JSON.stringify(out)).not.toContain("key");
  });

  it("rejects non-Instacart and insecure URLs", async () => {
    for (const url of ["http://instacart.com/x", "https://instacart.com.evil.test/x", "https://example.test/x"]) {
      const fetcher = vi.fn(async () => Response.json({ products_link_url: url }));
      await expect(createInstacartClient({ apiKey: "k", environment: "development", origin: INSTACART_ORIGINS.development }, fetcher as typeof fetch).create(buildInstacartPayload(view()))).resolves.toEqual({ ok: false, code: "invalid_response", retryable: false });
    }
  });

  it("maps network failures without retrying creation", async () => {
    const fetcher = vi.fn(async () => { throw new Error("network body with secret"); });
    const out = await createInstacartClient({ apiKey: "key", environment: "development", origin: INSTACART_ORIGINS.development }, fetcher as typeof fetch).create(buildInstacartPayload(view()));
    expect(out).toEqual({ ok: false, code: "upstream_unavailable", retryable: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.stringify(out)).not.toMatch(/secret|key/);
  });
});

describe("createInstacartHandoff", () => {
  it("does zero reads, writes, or egress while unconfigured", async () => {
    const h = sqliteEnv(); const d = deps(view());
    expect(await createInstacartHandoff(h.env, "alice", d)).toEqual({ status: "unavailable", code: "not_configured" });
    expect(d.readToBuy).not.toHaveBeenCalled(); expect(h.rows("instacart_links")).toEqual([]);
  });

  it("returns empty before hashing/cache/client I/O and preserves underived", async () => {
    const h = sqliteEnv(); configured(h.env); const client = { create: vi.fn() } as unknown as InstacartClient;
    expect(await createInstacartHandoff(h.env, "alice", deps(view([], ["missing-recipe"]), client))).toEqual({ status: "empty", item_count: 0, underived: ["missing-recipe"] });
    expect(client.create).not.toHaveBeenCalled(); expect(h.rows("instacart_links")).toEqual([]);
  });

  it("creates once, reuses exact content, and refreshes changed content", async () => {
    const h = sqliteEnv(); configured(h.env);
    const client = { create: vi.fn().mockResolvedValueOnce({ ok: true, url: "https://www.instacart.com/store/a" }).mockResolvedValueOnce({ ok: true, url: "https://www.instacart.com/store/b" }) } as InstacartClient;
    const first = await createInstacartHandoff(h.env, "alice", deps(view(), client));
    const reused = await createInstacartHandoff(h.env, "alice", deps(view(), client));
    const changed = await createInstacartHandoff(h.env, "alice", deps(view([{ key: "milk", name: "Milk", quantity: 3 }]), client));
    expect(first).toMatchObject({ status: "ready", reused: false, url: "https://www.instacart.com/store/a" });
    expect(reused).toMatchObject({ status: "ready", reused: true, url: "https://www.instacart.com/store/a" });
    expect(changed).toMatchObject({ status: "ready", reused: false, url: "https://www.instacart.com/store/b" });
    expect(client.create).toHaveBeenCalledTimes(2); expect(h.rows("instacart_links")).toHaveLength(2);
  });

  it("isolates identical hashes by tenant and converges concurrent upserts", async () => {
    const h = sqliteEnv(); configured(h.env);
    const clientA = { create: vi.fn(async () => ({ ok: true as const, url: "https://www.instacart.com/store/a" })) };
    const clientB = { create: vi.fn(async () => ({ ok: true as const, url: "https://www.instacart.com/store/b" })) };
    await createInstacartHandoff(h.env, "alice", deps(view(), clientA));
    const bob = await createInstacartHandoff(h.env, "bob", deps(view(), clientB));
    expect(bob).toMatchObject({ status: "ready", url: "https://www.instacart.com/store/b", reused: false });
    expect(h.rows<{ tenant: string }>("instacart_links").map((r) => r.tenant).sort()).toEqual(["alice", "bob"]);
    const hash = await hashInstacartPayload(buildInstacartPayload(view()));
    await Promise.all([h.env.DB.prepare("INSERT INTO instacart_links VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(tenant, content_hash) DO UPDATE SET url=excluded.url").bind("carol", hash, "https://www.instacart.com/store/1", "2026-08-01", NOW.toISOString()).run(), h.env.DB.prepare("INSERT INTO instacart_links VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(tenant, content_hash) DO UPDATE SET url=excluded.url").bind("carol", hash, "https://www.instacart.com/store/2", "2026-08-01", NOW.toISOString()).run()]);
    expect(h.rows<{ tenant: string }>("instacart_links").filter((r) => r.tenant === "carol")).toHaveLength(1);
  });

  it("refreshes a cached URL inside the expiry safety window", async () => {
    const h = sqliteEnv(); configured(h.env);
    const payload = buildInstacartPayload(view()); const hash = await hashInstacartPayload(payload);
    h.raw.prepare("INSERT INTO instacart_links VALUES (?, ?, ?, ?, ?)").run("alice", hash, "https://www.instacart.com/store/stale", "2026-07-12T12:04:00.000Z", "2026-07-01T00:00:00.000Z");
    const client = { create: vi.fn(async () => ({ ok: true as const, url: "https://www.instacart.com/store/fresh" })) };
    const out = await createInstacartHandoff(h.env, "alice", deps(view(), client));
    expect(out).toMatchObject({ status: "ready", url: "https://www.instacart.com/store/fresh", reused: false });
    expect(client.create).toHaveBeenCalledOnce();
  });

  it("does not mutate grocery/send/spend state on success, reuse, or failure", async () => {
    const h = sqliteEnv(); configured(h.env);
    h.raw.prepare("INSERT INTO grocery_list (tenant, name, normalized_name, status, kind, domain, source, added_at) VALUES ('alice','Milk','milk','active','grocery','grocery','ad_hoc','2026-07-12')").run();
    const before = JSON.stringify({ grocery: h.rows("grocery_list"), sends: h.rows("order_sends"), lines: h.rows("order_send_lines"), spend: h.rows("spend_events"), pantry: h.rows("pantry") });
    await createInstacartHandoff(h.env, "alice", deps(view(), { create: async () => ({ ok: true, url: "https://www.instacart.com/store/a" }) }));
    await createInstacartHandoff(h.env, "alice", deps(view(), { create: async () => ({ ok: false, code: "upstream_unavailable", retryable: true }) }));
    const after = JSON.stringify({ grocery: h.rows("grocery_list"), sends: h.rows("order_sends"), lines: h.rows("order_send_lines"), spend: h.rows("spend_events"), pantry: h.rows("pantry") });
    expect(after).toBe(before);
  });

  it("rejects an invalid URL from an injected client before cache or return", async () => {
    const h = sqliteEnv(); configured(h.env);
    const result = await createInstacartHandoff(h.env, "alice", deps(view(), { create: async () => ({ ok: true, url: "https://instacart.com.evil.test/steal" }) }));
    expect(result).toEqual({ status: "error", code: "invalid_response", retryable: false });
    expect(h.rows("instacart_links")).toEqual([]);
  });
});
