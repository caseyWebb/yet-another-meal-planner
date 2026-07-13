// Route-level tests for the member core's /api areas (member-app-core): every
// endpoint is a thin adapter over the shared ops, session-gated PER ROUTE (there is
// no global default-deny — the sweep below proves no route was left open), errors
// cross the boundary as structured bodies with the D8-mapped statuses (409 conflict,
// 412 failed If-Match, 400 boundary rejections), and the D7 suggest gate throttles
// without touching derivation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { ToolError } from "../src/errors.js";
import { fakeD1, type FakeD1 } from "./fake-d1.js";
import type { Env } from "../src/env.js";

// Stub the derivation core so the suggest gate's "no env.AI touch" is assertable;
// everything else (DERIVE_INTERVAL_MS, DEFAULT_MAX_SUGGESTIONS, the tool registrar)
// stays real.
vi.mock("../src/night-vibe-suggest.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/night-vibe-suggest.js")>();
  return {
    ...mod,
    runDerivation: vi.fn(async () => ({ candidates: [{ id: "cozy", vibe: "cozy braise" }], enqueued: 1, superseded: 0, source: "clusters" })),
  };
});
import { runDerivation } from "../src/night-vibe-suggest.js";

// Fake ORDER WIRING (member-app-grocery D9): the order route builds its matcher/location
// deps via tools.js `buildOrderWiring`; stub JUST that factory so preview/commit/partial
// paths cross the HTTP boundary with zero Kroger — everything else in tools.js stays real.
vi.mock("../src/tools.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/tools.js")>();
  return {
    ...mod,
    buildOrderWiring: vi.fn(() => ({
      resolve: async (name: string) => ({
        resolved: true as const,
        sku: `SKU-${name.toLowerCase().replace(/\s+/g, "-")}`,
        brand: "Store Brand",
        size: null,
        price: { regular: 2.5, promo: 0 },
        on_sale: false,
        reason: "test",
      }),
      revalidateSku: async () => null,
      getLocationId: async () => "loc-1",
      // The substitution read's raw closures (member-app-differentiators D1): one
      // fulfillable comparable alternative per search; a fulfillable current pick per sku.
      search: async () => [
        {
          productId: "ALT-1",
          brand: "Store Brand",
          description: "alternative",
          categories: [],
          size: "32 oz",
          price: { regular: 9.92, promo: 0 },
          fulfillment: { curbside: true, delivery: true, inStore: true },
          aisleLocation: null,
        },
      ],
      productById: async (sku: string) => ({
        productId: sku,
        brand: "Store Brand",
        description: "current pick",
        categories: [],
        size: "16 oz",
        price: { regular: 6.72, promo: 0 },
        fulfillment: { curbside: true, delivery: true, inStore: true },
        aisleLocation: { number: "4", description: "Dairy" },
      }),
    })),
  };
});
import app from "../src/api/app.js";

/** In-memory KV (get/put/delete/list). */
function memKv(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    store: m,
    async get(key: string) {
      return m.get(key) ?? null;
    },
    async put(key: string, value: string) {
      m.set(key, value);
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

const RECIPE_ROW = {
  slug: "tacos",
  title: "Tacos",
  protein: "beef",
  cuisine: "mexican",
  time_total: 30,
  ingredients_key: '["beef","tortillas"]',
  source_url: null,
  tags: '["weeknight"]',
  course: null,
  season: null,
  dietary: '[]',
  pairs_with: null,
  perishable_ingredients: null,
  requires_equipment: null,
  extra: null,
  discovered_at: null,
};

/** A full member env: fakeD1 domain tables + the session/allowlist KV + AE stub. */
function memberEnv(tables: Record<string, Record<string, unknown>[]> = {}) {
  const d1: FakeD1 = fakeD1({
    tables: {
      recipes: [RECIPE_ROW],
      recipe_derived: [],
      profile: [],
      brand_prefs: [],
      overlay: [],
      cooking_log: [],
      night_vibes: [],
      pending_proposals: [],
      ingredient_identity: [],
      ingredient_alias: [],
      novel_ingredient_terms: [],
      stores: [],
      ...tables,
    },
  });
  const tenantKv = memKv({ "tenant:casey": JSON.stringify({ id: "casey" }), "invite:GOODCODE": "casey" });
  const env = {
    ...(d1.env as object),
    TENANT_KV: tenantKv,
    KROGER_KV: memKv(),
    KROGER_CLIENT_ID: "client-id",
    KROGER_CLIENT_SECRET: "client-secret",
    TOOL_AE: { writeDataPoint: () => {} },
  } as unknown as Env;
  return { env, d1, tenantKv };
}

const CSRF = { "X-App-Csrf": "1" };

async function loggedIn(env: Env): Promise<string> {
  const res = await app.request(
    "http://127.0.0.1/api/session",
    { method: "POST", headers: { "content-type": "application/json", ...CSRF }, body: JSON.stringify({ invite_code: "GOODCODE" }) },
    env,
  );
  const m = /__Host-session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!m) throw new Error("login failed");
  return `__Host-session=${m[1]}`;
}

function get(env: Env, path: string, cookie: string, headers: Record<string, string> = {}) {
  return app.request(`http://127.0.0.1${path}`, { headers: { cookie, ...headers } }, env);
}

function send(env: Env, method: string, path: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(
    `http://127.0.0.1${path}`,
    {
      method,
      headers: { "content-type": "application/json", ...CSRF, cookie, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

// Every member endpoint this change adds (method + a representative concrete path).
const MEMBER_ENDPOINTS: [string, string][] = [
  ["GET", "/api/cookbook/recipes"],
  ["GET", "/api/cookbook/new-for-me"],
  ["GET", "/api/cookbook/trending"],
  ["GET", "/api/cookbook/picked-for-you"],
  ["GET", "/api/cookbook/search?q=tacos"],
  ["GET", "/api/cookbook/recipes/tacos"],
  ["GET", "/api/cookbook/recipes/tacos/similar"],
  ["GET", "/api/cookbook/recipes/tacos/notes"],
  ["POST", "/api/cookbook/recipes/tacos/notes"],
  ["PATCH", "/api/cookbook/recipes/tacos/notes/2026-01-01T00:00:00Z"],
  ["DELETE", "/api/cookbook/recipes/tacos/notes/2026-01-01T00:00:00Z"],
  ["GET", "/api/overlay"],
  ["PUT", "/api/overlay/favorite"],
  ["GET", "/api/plan"],
  ["POST", "/api/plan/ops"],
  ["GET", "/api/grocery"],
  ["GET", "/api/grocery/view"],
  ["GET", "/api/grocery/to-buy"],
  ["GET", "/api/grocery/to-buy?enrich=1"],
  ["POST", "/api/grocery/order"],
  ["POST", "/api/grocery/instacart"],
  ["POST", "/api/grocery/substitutions"],
  ["POST", "/api/grocery/items"],
  ["POST", "/api/grocery/checked"],
  ["POST", "/api/grocery/substitution"],
  ["POST", "/api/grocery/coverage"],
  ["POST", "/api/grocery/pantry-verify"],
  ["POST", "/api/grocery/relist"],
  ["POST", "/api/grocery/mark-placed"],
  ["PATCH", "/api/grocery/items/milk"],
  ["DELETE", "/api/grocery/items/milk"],
  ["GET", "/api/pantry"],
  ["POST", "/api/pantry/ops"],
  ["POST", "/api/pantry/verify"],
  ["GET", "/api/log"],
  ["POST", "/api/log"],
  ["DELETE", "/api/log/1"],
  ["GET", "/api/profile"],
  ["GET", "/api/profile/preferences"],
  ["PATCH", "/api/profile/preferences"],
  ["GET", "/api/profile/taste"],
  ["PUT", "/api/profile/taste"],
  ["GET", "/api/profile/diet-principles"],
  ["PUT", "/api/profile/diet-principles"],
  ["GET", "/api/profile/retrospective"],
  ["GET", "/api/profile/kroger-login-url"],
  ["GET", "/api/profile/store-adapters"],
  ["GET", "/api/profile/kroger-locations?zip=76104"],
  ["DELETE", "/api/profile/kroger-connection"],
  ["GET", "/api/vibes"],
  ["GET", "/api/vibes/weeknight"],
  ["POST", "/api/vibes"],
  ["PATCH", "/api/vibes/weeknight"],
  ["DELETE", "/api/vibes/weeknight"],
  ["GET", "/api/vibes/proposals"],
  ["POST", "/api/vibes/proposals/p1/confirm"],
  ["POST", "/api/vibes/suggest"],
  ["POST", "/api/propose"],
];

describe("session gating (requireSession is PER-ROUTE — none may be forgotten)", () => {
  it("every member endpoint answers 401 unauthorized without a session cookie", async () => {
    const { env } = memberEnv();
    for (const [method, path] of MEMBER_ENDPOINTS) {
      const res = await app.request(
        `http://127.0.0.1${path}`,
        { method, headers: { "content-type": "application/json", ...CSRF } },
        env,
      );
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(((await res.json()) as { error: string }).error, `${method} ${path}`).toBe("unauthorized");
    }
  });
});

describe("cookbook area", () => {
  it("serves the title-sorted index, keyword search parity, and the recipe detail", async () => {
    const { env } = memberEnv();
    const cookie = await loggedIn(env);

    const index = await get(env, "/api/cookbook/recipes", cookie);
    expect(index.status).toBe(200);
    expect(index.headers.get("etag")).toMatch(/^W\//);
    const { recipes } = (await index.json()) as { recipes: { slug: string; title: string }[] };
    expect(recipes.map((r) => r.slug)).toEqual(["tacos"]);

    const search = await get(env, "/api/cookbook/search?q=tacos", cookie);
    const found = (await search.json()) as { q: string; results: { slug: string }[] };
    expect(found.results.map((r) => r.slug)).toEqual(["tacos"]);

    const miss = await get(env, "/api/cookbook/search?q=zebra", cookie);
    expect(((await miss.json()) as { results: unknown[] }).results).toEqual([]);
  });

  it("notes: client-minted created_at is the idempotency key (replay converges)", async () => {
    const { env, d1 } = memberEnv({ recipe_notes: [] });
    const cookie = await loggedIn(env);
    const createdAt = "2026-07-01T12:00:00.000Z";
    const body = { body: "sear hotter next time", tags: ["tweak"], created_at: createdAt };

    const first = await send(env, "POST", "/api/cookbook/recipes/tacos/notes", cookie, body);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ slug: "tacos", author: "casey", created_at: createdAt });
    expect(d1.tables.recipe_notes).toHaveLength(1);

    const replay = await send(env, "POST", "/api/cookbook/recipes/tacos/notes", cookie, body);
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { deduped?: boolean }).deduped).toBe(true);
    expect(d1.tables.recipe_notes).toHaveLength(1); // no duplicate row

    const del = await send(env, "DELETE", `/api/cookbook/recipes/tacos/notes/${encodeURIComponent(createdAt)}`, cookie);
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
    const again = await send(env, "DELETE", `/api/cookbook/recipes/tacos/notes/${encodeURIComponent(createdAt)}`, cookie);
    expect(((await again.json()) as { removed: boolean }).removed).toBe(false); // converged, not an error
  });
});

describe("overlay area", () => {
  it("favorite is an explicit set keyed by slug — replaying converges", async () => {
    const { env, d1 } = memberEnv();
    const cookie = await loggedIn(env);
    for (let i = 0; i < 2; i++) {
      const res = await send(env, "PUT", "/api/overlay/favorite", cookie, { slug: "tacos", favorite: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ slug: "tacos", overlay: { favorite: true } });
    }
    expect(d1.tables.overlay).toHaveLength(1);
    const off = await send(env, "PUT", "/api/overlay/favorite", cookie, { slug: "tacos", favorite: false });
    expect(await off.json()).toEqual({ slug: "tacos", overlay: {} });

    const unknown = await send(env, "PUT", "/api/overlay/favorite", cookie, { slug: "ghost", favorite: true });
    expect(unknown.status).toBe(404);
  });
});

describe("plan area", () => {
  it("ops flow through the watermark composition; set persists a side removal + date clear", async () => {
    const { env, d1 } = memberEnv({
      meal_plan: [
        { tenant: "casey", id: "mp-tacos-0001", recipe: "tacos", meal: "dinner", planned_for: "2026-07-10", sides: '["rice","beans"]', from_vibe: "weeknight" },
      ],
    });
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/plan/ops", cookie, {
      ops: [{ op: "set", recipe: "tacos", sides: ["rice"], planned_for: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: unknown[] }).applied).toEqual([{ op: "set", id: "mp-tacos-0001", recipe: "tacos", meal: "dinner" }]);
    const row = d1.tables.meal_plan[0];
    expect(row.planned_for).toBeNull();
    expect(JSON.parse(row.sides as string)).toEqual(["rice"]);
    expect(row.from_vibe).toBe("weeknight");
    // set/remove never stamp the watermark; an add does.
    expect(d1.tables.profile).toHaveLength(0);
    await send(env, "POST", "/api/plan/ops", cookie, { ops: [{ op: "add", recipe: "tacos" }] });
    expect(d1.tables.profile[0].last_planned_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("grocery area", () => {
  const groceryRow = (status: string) => ({
    tenant: "casey", name: "Milk", normalized_name: "milk", quantity: "1", kind: "grocery",
    domain: "grocery", status, source: "ad_hoc", for_recipes: "[]", note: null,
    added_at: "2026-07-01", ordered_at: null,
  });

  it("in-cart is an explicit set; ordered is accepted ONLY as the in_cart advance (W3)", async () => {
    const { env, d1 } = memberEnv({ grocery_list: [groceryRow("active")] });
    const cookie = await loggedIn(env);

    const inCart = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "in_cart" });
    expect(inCart.status).toBe(200);
    expect(d1.tables.grocery_list[0].status).toBe("in_cart");
    const back = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "active" });
    expect(back.status).toBe(200);

    // From active, "ordered" is refused by the shared W3 transition guard (the route
    // boundary now allows the VALUE — P3's mark-order-placed — but never the transition).
    const illegal = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "ordered" });
    expect(illegal.status).toBe(400);
    const shape = (await illegal.json()) as { error: string; context?: { from?: string; to?: string } };
    expect(shape.error).toBe("validation_failed");
    expect(d1.tables.grocery_list[0].status).toBe("active"); // unchanged

    // The legal user-asserted advance: in_cart → ordered, ordered_at stamped.
    await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "in_cart" });
    const ordered = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "ordered" });
    expect(ordered.status).toBe(200);
    expect(d1.tables.grocery_list[0].status).toBe("ordered");
    expect(d1.tables.grocery_list[0].ordered_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("add merges on re-delivery; remove reports converged on the second delivery", async () => {
    const { env, d1 } = memberEnv();
    const cookie = await loggedIn(env);
    const add = { name: "Olive Oil", quantity: "1", for_recipes: ["tacos"] };
    await send(env, "POST", "/api/grocery/items", cookie, add);
    const replay = await send(env, "POST", "/api/grocery/items", cookie, add);
    expect(((await replay.json()) as { merged: boolean }).merged).toBe(true);
    expect(d1.tables.grocery_list).toHaveLength(1);

    const del = await send(env, "DELETE", "/api/grocery/items/olive%20oil", cookie);
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
    const again = await send(env, "DELETE", "/api/grocery/items/olive%20oil", cookie);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { removed: boolean }).removed).toBe(false);
  });
});

describe("grocery power (member-app-grocery)", () => {
  const STEW_ROW = {
    ...RECIPE_ROW,
    slug: "stew",
    title: "Stew",
    ingredients_full: '["chicken","black beans","cilantro"]',
  };
  function groceryTables(extra: Record<string, Record<string, unknown>[]> = {}) {
    return {
      recipes: [RECIPE_ROW, STEW_ROW], // RECIPE_ROW ("tacos") has NO ingredients_full → underived
      meal_plan: [
        { tenant: "casey", recipe: "stew", planned_for: null, sides: "[]", from_vibe: null },
        { tenant: "casey", recipe: "tacos", planned_for: null, sides: "[]", from_vibe: null },
      ],
      pantry: [
        { tenant: "casey", name: "Cilantro", normalized_name: "cilantro", quantity: "1 bunch", category: "produce", prepared_from: null, added_at: "2026-06-01", last_verified_at: "2026-06-20", notes: null },
      ],
      grocery_list: [
        { tenant: "casey", name: "chicken", normalized_name: "chicken", quantity: "2 lb", kind: "grocery", domain: "grocery", status: "active", source: "menu", for_recipes: "[]", note: null, added_at: "2026-07-01", ordered_at: null },
        { tenant: "casey", name: "olive oil", normalized_name: "olive oil", quantity: "1", kind: "grocery", domain: "grocery", status: "in_cart", source: "stockup", for_recipes: "[]", note: null, added_at: "2026-07-01", ordered_at: null },
      ],
      profile: [{ tenant: "casey", stores: JSON.stringify({ primary: "kroger", preferred_location: "Kroger — Hyde Park" }) }],
      ...extra,
    };
  }

  it("GET /grocery/to-buy returns the partitioned view (origin, coverage, in_cart, underived), ETagged with 304", async () => {
    const { env } = memberEnv(groceryTables());
    const cookie = await loggedIn(env);
    const res = await get(env, "/api/grocery/to-buy", cookie);
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag")!;
    expect(etag).toMatch(/^W\//);
    const view = (await res.json()) as {
      to_buy: { name: string; origin: string; for_recipes: string[]; assumed_quantity: boolean }[];
      pantry_covered: { name: string; on_hand: { last_verified_at?: string } }[];
      in_cart: { name: string }[];
      underived: string[];
    };
    const byName = new Map(view.to_buy.map((l) => [l.name, l]));
    expect(byName.get("chicken")!.origin).toBe("both"); // stored row the plan also needs
    expect(byName.get("black beans")!.origin).toBe("plan"); // virtual — no row written
    expect(byName.get("black beans")!.for_recipes).toEqual(["stew"]);
    expect(view.pantry_covered.map((p) => p.name)).toEqual(["cilantro"]);
    expect(view.pantry_covered[0].on_hand.last_verified_at).toBe("2026-06-20");
    expect(view.in_cart.map((i) => i.name)).toEqual(["olive oil"]);
    expect(view.underived).toEqual(["tacos"]);

    const cached = await get(env, "/api/grocery/to-buy", cookie, { "If-None-Match": etag });
    expect(cached.status).toBe(304);
  });

  it("the view derives without writing: grocery_list is unchanged after the read", async () => {
    const { env, d1 } = memberEnv(groceryTables());
    const cookie = await loggedIn(env);
    const before = JSON.stringify(d1.tables.grocery_list);
    await get(env, "/api/grocery/to-buy", cookie);
    expect(JSON.stringify(d1.tables.grocery_list)).toBe(before);
  });

  it("POST /grocery/order with preview: true resolves the derived set and writes nothing", async () => {
    const { env, d1 } = memberEnv(groceryTables({ sku_cache: [] }));
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/grocery/order", cookie, { preview: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      preview: boolean;
      resolved: { name: string; sku: string }[];
      underived: string[];
      cart: { written: boolean };
      sku_cache: { committed: boolean };
    };
    expect(body.preview).toBe(true);
    // The plan's derived needs rode in without the caller enumerating them.
    expect(body.resolved.map((l) => l.name).sort()).toEqual(["black beans", "chicken"]);
    expect(body.underived).toEqual(["tacos"]);
    expect(body.cart.written).toBe(false);
    expect(body.sku_cache.committed).toBe(false);
    expect(d1.tables.sku_cache).toHaveLength(0);
    expect(d1.tables.grocery_list).toHaveLength(2); // nothing materialized/advanced
  });

  it("commit reports the failed cart honestly (reauth_required rides the result; list not advanced)", async () => {
    const { env, d1 } = memberEnv(groceryTables({ sku_cache: [] }));
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/grocery/order", cookie, { exclude: ["black beans"] });
    expect(res.status).toBe(200); // an honest partial result, not a thrown error
    const body = (await res.json()) as {
      resolved: { name: string }[];
      cart: { written: boolean; code?: string };
      list: { advanced: boolean };
      sku_cache: { committed: boolean };
    };
    expect(body.resolved.map((l) => l.name)).toEqual(["chicken"]); // exclude dropped the derived line
    // No Kroger link in KV → the cart write fails structurally, never silently succeeds.
    expect(body.cart.written).toBe(false);
    expect(body.cart.code).toBe("reauth_required");
    expect(body.list.advanced).toBe(false);
    expect(d1.tables.grocery_list.find((r) => r.name === "chicken")!.status).toBe("active");
    // A failed cart never teaches.
    expect(body.sku_cache.committed).toBe(false);
  });

  it("refuses a non-Kroger primary with a structured unsupported naming the right flow (nothing resolved)", async () => {
    const { env } = memberEnv(
      groceryTables({
        profile: [{ tenant: "casey", stores: JSON.stringify({ primary: "target", fulfillment: "satellite" }) }],
      }),
    );
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/grocery/order", cookie, { preview: true });
    expect(res.status).toBe(405);
    const body = (await res.json()) as { error: string; flow?: string };
    expect(body.error).toBe("unsupported");
    expect(body.flow).toBe("satellite-cart-fill"); // ToolError context spreads onto the body
  });

  it("boundary-rejects a malformed order body as a structured 400", async () => {
    const { env } = memberEnv(groceryTables());
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/grocery/order", cookie, { exclude: "salmon" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_failed");
  });
});

describe("pantry area", () => {
  it("reads, applies row ops, and verify stamps today", async () => {
    const { env, d1 } = memberEnv({
      pantry: [{ tenant: "casey", name: "Jasmine rice", normalized_name: "jasmine rice", quantity: "2 lb", category: "grains", prepared_from: null, added_at: "2026-06-01", last_verified_at: "2026-06-01", notes: null }],
    });
    const cookie = await loggedIn(env);
    const read = await get(env, "/api/pantry", cookie);
    expect(((await read.json()) as { items: unknown[] }).items).toHaveLength(1);

    const ops = await send(env, "POST", "/api/pantry/ops", cookie, {
      operations: [{ op: "add", item: { name: "Eggs", category: "dairy", quantity: "12" } }],
    });
    expect(ops.status).toBe(200);
    expect(d1.tables.pantry).toHaveLength(2);

    const verify = await send(env, "POST", "/api/pantry/verify", cookie, { items: ["jasmine rice", "ghost"] });
    const out = (await verify.json()) as { verified: string[]; missing: string[] };
    expect(out.verified).toEqual(["jasmine rice"]);
    expect(out.missing).toEqual(["ghost"]);
    const row = d1.tables.pantry.find((r) => r.normalized_name === "jasmine rice")!;
    expect(row.last_verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.last_verified_at).not.toBe("2026-06-01");
  });

  it("GET /api/pantry filters by location; items carry both orthogonal fields", async () => {
    const { env } = memberEnv({
      pantry: [
        { tenant: "casey", name: "Peas", normalized_name: "peas", quantity: "1 bag", category: "frozen", location: "freezer", prepared_from: null, added_at: "2026-06-01", last_verified_at: "2026-06-01", notes: null },
        { tenant: "casey", name: "Milk", normalized_name: "milk", quantity: "full", category: "dairy", location: "fridge", prepared_from: null, added_at: "2026-06-01", last_verified_at: "2026-06-01", notes: null },
      ],
    });
    const cookie = await loggedIn(env);
    const res = await get(env, "/api/pantry?location=freezer", cookie);
    const { items } = (await res.json()) as { items: { name: string; category?: string; location?: string }[] };
    expect(items.map((i) => i.name)).toEqual(["Peas"]);
    expect(items[0]).toMatchObject({ category: "frozen", location: "freezer" });
  });

  it("POST /api/pantry/ops dispose has parity with the tool (waste event, warnings, validation_failed)", async () => {
    const { env, d1 } = memberEnv({
      pantry: [
        { tenant: "casey", name: "Cilantro", normalized_name: "cilantro", quantity: "1 bunch", category: "produce", location: "fridge", prepared_from: null, added_at: "2026-06-01", last_verified_at: "2026-06-01", notes: null },
      ],
      waste_events: [],
    });
    const cookie = await loggedIn(env);

    // Shape violation → 400 validation_failed, nothing written (the shared apply path).
    const bad = await send(env, "POST", "/api/pantry/ops", cookie, {
      operations: [{ op: "dispose", name: "cilantro", disposition: "waste" }],
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("validation_failed");
    expect(d1.tables.pantry).toHaveLength(1);

    // A client-minted event_id dispose applies once and converges on replay.
    const op = { op: "dispose", name: "cilantro", disposition: "waste", reason: "spoiled", event_id: "01JAPPKEY", occurred_at: "2026-07-01" };
    const first = await send(env, "POST", "/api/pantry/ops", cookie, { operations: [op] });
    expect(first.status).toBe(200);
    const firstOut = (await first.json()) as { applied: unknown[] };
    expect(firstOut.applied).toContainEqual({ op: "dispose", name: "cilantro", disposition: "waste" });
    expect(d1.tables.pantry).toHaveLength(0);
    expect(d1.tables.waste_events).toHaveLength(1);
    expect(d1.tables.waste_events[0]).toMatchObject({ tenant: "casey", id: "01JAPPKEY", department: "produce", occurred_at: "2026-07-01" });

    const replay = await send(env, "POST", "/api/pantry/ops", cookie, { operations: [op] });
    const replayOut = (await replay.json()) as { applied: unknown[]; conflicts: unknown[] };
    expect(replayOut.applied).toContainEqual({ op: "dispose", name: "cilantro", disposition: "waste" });
    expect(replayOut.conflicts).toHaveLength(0);
    expect(d1.tables.waste_events).toHaveLength(1); // exactly one event under the minted id

    // An off-vocab category add rides through with a warnings entry (accepted-and-dropped).
    const warned = await send(env, "POST", "/api/pantry/ops", cookie, {
      operations: [{ op: "add", item: { name: "Mystery", category: "other" } }],
    });
    const warnedOut = (await warned.json()) as { warnings?: { field: string }[] };
    expect(warnedOut.warnings).toContainEqual(expect.objectContaining({ field: "category" }));
  });
});

describe("log area", () => {
  it("logs through the shared op with dedupe ON (a replay cannot double-log) and deletes by id", async () => {
    const { env, d1 } = memberEnv();
    const cookie = await loggedIn(env);
    const entry = { type: "recipe", recipe: "tacos", date: "2026-07-01" };
    const first = await send(env, "POST", "/api/log", cookie, entry);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { deduped?: boolean }).deduped).toBeUndefined();
    const replay = await send(env, "POST", "/api/log", cookie, entry);
    expect(((await replay.json()) as { deduped?: boolean }).deduped).toBe(true);
    expect(d1.tables.cooking_log).toHaveLength(1);

    const id = d1.tables.cooking_log[0].id as number;
    const del = await send(env, "DELETE", `/api/log/${id}`, cookie);
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
    expect(d1.tables.cooking_log).toHaveLength(0);
  });
});

describe("Instacart member transport", () => {
  it("is session-gated and degrades before storage or egress when unconfigured", async () => {
    const { env } = memberEnv();
    const cookie = await loggedIn(env);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await send(env, "POST", "/api/grocery/instacart", cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable", code: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("profile area", () => {
  it("serves projection parity and disconnects idempotently without clearing the preferred location", async () => {
    const { env } = memberEnv({
      profile: [{
        tenant: "casey",
        stores: JSON.stringify({
          primary: "kroger",
          preferred_location: "01400943",
          preferred_location_name: "Kroger Marketplace",
          preferred_location_address: "123 Main St, Fort Worth, TX 76104",
          location_zip: "76104",
        }),
      }],
      stores: [{ slug: "aldi", name: "Aldi", domain: "grocery", extra: JSON.stringify({ address: "1 Oak St" }) }],
    });
    (env.KROGER_KV as unknown as { store: Map<string, string> }).store.set("kroger:refresh:casey", "secret");
    const cookie = await loggedIn(env);
    const projected = await get(env, "/api/profile/store-adapters", cookie);
    expect(projected.status).toBe(200);
    const body = (await projected.json()) as { adapters: { kroger: { linked: boolean; preferred: { location_id: string } } }; launcher: { id: string }[] };
    expect(body.adapters.kroger).toMatchObject({ linked: true, preferred: { location_id: "01400943" } });
    expect(body.launcher[0].id).toBe("kroger");
    expect(JSON.stringify(body)).not.toContain("secret");

    for (let i = 0; i < 2; i++) {
      const disconnected = await send(env, "DELETE", "/api/profile/kroger-connection", cookie);
      expect(disconnected.status).toBe(200);
      expect(await disconnected.json()).toEqual({ linked: false });
    }
    const after = (await (await get(env, "/api/profile/store-adapters", cookie)).json()) as { adapters: { kroger: { linked: boolean; preferred: { location_id: string } } } };
    expect(after.adapters.kroger).toMatchObject({ linked: false, preferred: { location_id: "01400943" } });
  });

  it("searches several/zero Kroger locations and distinguishes validation/upstream errors", async () => {
    const { env } = memberEnv();
    const cookie = await loggedIn(env);
    let mode: "many" | "empty" | "error" = "many";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "public-token", expires_in: 1800 }), { status: 200, headers: { "content-type": "application/json" } });
      if (mode === "error") return new Response("nope", { status: 503 });
      return new Response(JSON.stringify({ data: mode === "empty" ? [] : [
        { locationId: "2", name: "Near", address: { addressLine1: "2 Main", city: "Fort Worth", state: "TX", zipCode: "76104" } },
        { locationId: "3", name: "Next", address: { addressLine1: "3 Main", city: "Fort Worth", state: "TX", zipCode: "76104" } },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const many = await get(env, "/api/profile/kroger-locations?zip=76104", cookie);
    expect((await many.json()) as unknown).toMatchObject({ locations: [{ location_id: "2" }, { location_id: "3" }] });
    mode = "empty";
    expect(await (await get(env, "/api/profile/kroger-locations?zip=76104", cookie)).json()).toEqual({ locations: [] });
    const invalid = await get(env, "/api/profile/kroger-locations?zip=7610x", cookie);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()) as unknown).toMatchObject({ error: "validation_failed" });
    mode = "error";
    const upstream = await get(env, "/api/profile/kroger-locations?zip=76104", cookie);
    expect(upstream.status).toBe(503);
    expect((await upstream.json()) as unknown).toMatchObject({ error: "upstream_unavailable" });
  });

  it("assembles the profile with the Kroger link state from KV", async () => {
    const { env } = memberEnv();
    (env.KROGER_KV as unknown as { store: Map<string, string> }).store.set("kroger:refresh:casey", "tok");
    const cookie = await loggedIn(env);
    const res = await get(env, "/api/profile", cookie);
    const profile = (await res.json()) as { initialized: boolean; kroger: { linked: boolean } };
    expect(profile.initialized).toBe(false);
    expect(profile.kroger).toEqual({ linked: true });
  });

  it("preferences PATCH is class (a): no If-Match → 412; stale → 412 + nothing stored; fresh → applied", async () => {
    const { env, d1 } = memberEnv();
    const cookie = await loggedIn(env);

    const bare = await send(env, "PATCH", "/api/profile/preferences", cookie, { patch: { cadence: { dinner: 4 } } });
    expect(bare.status).toBe(412);
    expect(((await bare.json()) as { error: string }).error).toBe("conflict");
    expect(d1.tables.profile).toHaveLength(0); // nothing stored

    const read = await get(env, "/api/profile/preferences", cookie);
    const etag = read.headers.get("etag")!;
    const ok = await send(env, "PATCH", "/api/profile/preferences", cookie, { patch: { cadence: { dinner: 4 } } }, { "If-Match": etag });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { preferences: { cadence: { dinner: number } } }).preferences.cadence.dinner).toBe(4);
    expect(ok.headers.get("etag")).toMatch(/^W\//); // the fresh representation rides back

    // The old ETag is now stale — a raced second writer is refused, not clobbered.
    const stale = await send(env, "PATCH", "/api/profile/preferences", cookie, { patch: { cadence: { dinner: 2 } } }, { "If-Match": etag });
    expect(stale.status).toBe(412);
    expect(JSON.parse(d1.tables.profile[0].cadence as string)).toEqual({ dinner: 4 });
  });

  it("taste PUT replaces the whole markdown field under If-Match", async () => {
    const { env, d1 } = memberEnv();
    const cookie = await loggedIn(env);
    const read = await get(env, "/api/profile/taste", cookie);
    const etag = read.headers.get("etag")!;
    const put = await send(env, "PUT", "/api/profile/taste", cookie, { content: "Loves heat." }, { "If-Match": etag });
    expect(put.status).toBe(200);
    expect(d1.tables.profile[0].taste).toBe("Loves heat.");
  });

  it("mints the Kroger consent link bound to the session tenant", async () => {
    const { env } = memberEnv();
    const cookie = await loggedIn(env);
    const res = await get(env, "/api/profile/kroger-login-url", cookie);
    const { url } = (await res.json()) as { url: string };
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1\/oauth\/init\?nonce=/);
  });
});

describe("vibes area", () => {
  it("palette read merges the derived last_satisfied; create conflicts on duplicate (409)", async () => {
    const { env } = memberEnv({
      night_vibes: [{ tenant: "casey", id: "weeknight", vibe: "fast weeknight pasta", facets: null, cadence_days: 7, pinned: 0, base_weight: null, weather_affinity: null, weather_antipathy: null, season: null, created_at: "2026-06-01T00:00:00Z" }],
      cooking_log: [{ tenant: "casey", id: 1, date: "2026-06-20", type: "recipe", recipe: "tacos", name: null, satisfied_vibe: "weeknight" }],
      // last_satisfied derives over vibe_satisfaction (migration 0047): the cook-time satisfaction record.
      vibe_satisfaction: [{ tenant: "casey", cooking_log_id: 1, vibe_id: "weeknight", date: "2026-06-20", score: null }],
    });
    const cookie = await loggedIn(env);
    const res = await get(env, "/api/vibes", cookie);
    const { vibes } = (await res.json()) as { vibes: { id: string; last_satisfied: string | null }[] };
    expect(vibes).toHaveLength(1);
    expect(vibes[0].last_satisfied).toBe("2026-06-20");

    const dup = await send(env, "POST", "/api/vibes", cookie, { vibe: "fast weeknight pasta", id: "weeknight" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("conflict");
  });

  it("vibe edit is class (a): stale If-Match → 412; fresh → applied; delete converges", async () => {
    const { env, d1 } = memberEnv({
      night_vibes: [{ tenant: "casey", id: "weeknight", vibe: "fast weeknight pasta", facets: null, cadence_days: 7, pinned: 0, base_weight: null, weather_affinity: null, weather_antipathy: null, season: null, created_at: "2026-06-01T00:00:00Z" }],
    });
    const cookie = await loggedIn(env);
    const read = await get(env, "/api/vibes/weeknight", cookie);
    const etag = read.headers.get("etag")!;

    const stale = await send(env, "PATCH", "/api/vibes/weeknight", cookie, { cadence_days: 10 }, { "If-Match": 'W/"deadbeef"' });
    expect(stale.status).toBe(412);
    expect(d1.tables.night_vibes[0].cadence_days).toBe(7);

    const ok = await send(env, "PATCH", "/api/vibes/weeknight", cookie, { cadence_days: 10 }, { "If-Match": etag });
    expect(ok.status).toBe(200);
    expect(d1.tables.night_vibes[0].cadence_days).toBe(10);

    const del = await send(env, "DELETE", "/api/vibes/weeknight", cookie);
    expect(((await del.json()) as { removed: boolean }).removed).toBe(true);
    const again = await send(env, "DELETE", "/api/vibes/weeknight", cookie);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { removed: boolean }).removed).toBe(false);
  });

  it("queue: pending proposals list; confirm applies; double-confirm answers 409", async () => {
    const { env, d1 } = memberEnv({
      pending_proposals: [{ id: "p1", tenant: "casey", kind: "add_vibe", target: "cozy", payload: JSON.stringify({ id: "cozy", vibe: "a cozy braise" }), rationale: "you keep cooking these", evidence: "{}", status: "pending", producer: "edge", created_at: "2026-07-01T00:00:00Z" }],
    });
    const cookie = await loggedIn(env);
    const list = await get(env, "/api/vibes/proposals", cookie);
    expect(((await list.json()) as { proposals: unknown[] }).proposals).toHaveLength(1);

    const confirm = await send(env, "POST", "/api/vibes/proposals/p1/confirm", cookie, { accept: true });
    expect(confirm.status).toBe(200);
    expect(((await confirm.json()) as { status: string }).status).toBe("accepted");
    expect(d1.tables.night_vibes.map((v) => v.id)).toEqual(["cozy"]);

    const replay = await send(env, "POST", "/api/vibes/proposals/p1/confirm", cookie, { accept: true });
    expect(replay.status).toBe(409);
    expect(((await replay.json()) as { error: string }).error).toBe("conflict");
    expect(d1.tables.night_vibes).toHaveLength(1);
  });

  it("the retired suggest trigger answers the pinned 410 stub — no derivation, no model (D8/D20)", async () => {
    const { env } = memberEnv({
      // Even a stale job-health record changes nothing: the trigger is retired outright.
      job_health: [{ name: "archetype-derive", ok: 1, last_run_at: Date.now() - 30 * 60 * 60 * 1000, summary: "{}" }],
    });
    const cookie = await loggedIn(env);
    vi.mocked(runDerivation).mockClear();
    const res = await send(env, "POST", "/api/vibes/suggest", cookie, {});
    expect(res.status).toBe(410);
    // Pinned to the member-API route-level error convention ({ error: <literal>, message }),
    // NOT a src/errors.ts ToolError code.
    expect(await res.json()).toEqual({
      error: "gone",
      message: "Vibe suggestions now arrive automatically; this trigger was retired.",
    });
    expect(runDerivation).not.toHaveBeenCalled();
  });

  it("the 410 stub still requires a session (the gate outranks the stub)", async () => {
    const { env } = memberEnv();
    const res = await send(env, "POST", "/api/vibes/suggest", "", {});
    expect(res.status).toBe(401);
  });
});

// Test-only routes through the REAL mount's error boundary (api.test.ts's /boom idiom)
// pin the P1-added mappings that no member route surfaces organically in this file.
app.get("/gate", () => {
  throw new ToolError("insufficient_permission", "operator-only");
});
app.get("/kroger-expired", () => {
  throw new ToolError("reauth_required", "the Kroger refresh token was rejected");
});

describe("shared error table — P1 additions (5.2)", () => {
  it("maps insufficient_permission → 403 with the structured body", async () => {
    const { env } = memberEnv();
    const res = await app.request("http://127.0.0.1/api/gate", {}, env);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "insufficient_permission", message: "operator-only" });
  });

  it("maps reauth_required → 401 with the structured body", async () => {
    const { env } = memberEnv();
    const res = await app.request("http://127.0.0.1/api/kroger-expired", {}, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "reauth_required", message: "the Kroger refresh token was rejected" });
  });

  it("keeps a plain conflict at 409 while a precondition-marked conflict is 412", async () => {
    const { env } = memberEnv({
      night_vibes: [{ tenant: "casey", id: "weeknight", vibe: "fast weeknight pasta", facets: null, cadence_days: 7, pinned: 0, base_weight: null, weather_affinity: null, weather_antipathy: null, season: null, created_at: "2026-06-01T00:00:00Z" }],
    });
    const cookie = await loggedIn(env);
    const dup = await send(env, "POST", "/api/vibes", cookie, { vibe: "x", id: "weeknight" });
    expect(dup.status).toBe(409);
    const noMatch = await send(env, "PATCH", "/api/vibes/weeknight", cookie, { cadence_days: 10 });
    expect(noMatch.status).toBe(412); // missing If-Match is a precondition conflict
  });
});

describe("propose area (member-app-propose)", () => {
  // A tiny embedded corpus + palette: two recipes on distinct axes, one embedded vibe.
  const FISH_ROW = { ...RECIPE_ROW, slug: "salmon-rice", title: "Salmon Rice", protein: "fish", cuisine: "japanese" };
  function proposeTables() {
    return {
      recipes: [RECIPE_ROW, FISH_ROW],
      recipe_derived: [
        { slug: "tacos", embedding: JSON.stringify([1, 0, 0]), description: null },
        { slug: "salmon-rice", embedding: JSON.stringify([0, 1, 0]), description: null },
      ],
      night_vibes: [
        { tenant: "casey", id: "dinner", vibe: "a good dinner", facets: null, cadence_days: null, pinned: 0, base_weight: null, weather_affinity: null, weather_antipathy: null, season: null, created_at: null },
      ],
      night_vibe_derived: [{ tenant: "casey", id: "dinner", embedding: JSON.stringify([1, 0.5, 0]) }],
    };
  }
  // The op fetches the weather forecast unconditionally (resolveZip "" without a profile);
  // pin the upstream DOWN so route results are deterministic and offline.
  function stubWeatherDown() {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
  }
  afterEach(() => vi.unstubAllGlobals());

  it("POST /api/propose returns the shared op's result shape (the tool's contract)", async () => {
    stubWeatherDown();
    const { env } = memberEnv(proposeTables());
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/propose", cookie, { nights: 1, seed: 5 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { vibe_id: string | null; main: { slug: string } | null; alternates: unknown[] }[]; variety: unknown; diagnostics: { seed: number; filled: number } };
    expect(body.diagnostics.seed).toBe(5);
    expect(body.diagnostics.filled).toBe(1);
    expect(body.plan[0].vibe_id).toBe("dinner");
    expect(body.plan[0].main).not.toBeNull();
    expect(Array.isArray(body.plan[0].alternates)).toBe(true);
  });

  it("identical bodies return identical proposals (D10 at the route level)", async () => {
    stubWeatherDown();
    const { env } = memberEnv(proposeTables());
    const cookie = await loggedIn(env);
    const request = { nights: 1, seed: 42, slots: [{ vibe_id: "dinner", protein: "fish" }], nudges: { proteins: ["fish"] } };
    const a = await send(env, "POST", "/api/propose", cookie, request);
    const b = await send(env, "POST", "/api/propose", cookie, request);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it("boundary-rejects a malformed body as a structured 400", async () => {
    stubWeatherDown();
    const { env } = memberEnv(proposeTables());
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/propose", cookie, { nights: "five" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("validation_failed");
  });

});

describe("differentiators (member-app-differentiators)", () => {
  it("POST /grocery/substitutions returns the op result over the injected fake wiring — no ETag", async () => {
    const { env } = memberEnv({ grocery_list: [], sku_cache: [], pantry: [], meal_plan: [] });
    const cookie = await loggedIn(env);
    // One active row + its cached pick at the mocked wiring's location.
    await send(env, "POST", "/api/grocery/items", cookie, { name: "milk" });
    const { d1 } = { d1: null };
    void d1;
    const res = await send(env, "POST", "/api/grocery/substitutions", cookie, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeNull(); // online-only class (D12) — no ETag
    const body = (await res.json()) as {
      suggestions: { for: { name: string; key: string }; status: string; alternatives: { sku: string; reasons: string[] }[] }[];
      remaining: string[];
      location: { id: string } | null;
    };
    expect(body.location).toEqual({ id: "loc-1" });
    expect(body.remaining).toEqual([]);
    expect(body.suggestions).toHaveLength(1);
    const line = body.suggestions[0];
    expect(line.for).toMatchObject({ name: "milk", key: "milk" });
    // No sku_cache mapping seeded → an honest no_cached_pick with the search's alternative.
    expect(line.status).toBe("no_cached_pick");
    expect(line.alternatives.map((a) => a.sku)).toEqual(["ALT-1"]);
    // Slimmed (inline-substitution-hints D4): no `siblings` on the line, no
    // `flyer_as_of` on the result — those now ride read_to_buy's `enrich` read.
    expect("siblings" in line).toBe(false);
    expect("flyer_as_of" in body).toBe(false);
  });

  it("POST /grocery/substitutions paginates past the 12-line budget with honest remaining", async () => {
    const { env } = memberEnv({ grocery_list: [], sku_cache: [], pantry: [], meal_plan: [] });
    const cookie = await loggedIn(env);
    const names = Array.from({ length: 15 }, (_, i) => `item-${String(i).padStart(2, "0")}`);
    const res = await send(env, "POST", "/api/grocery/substitutions", cookie, { names });
    const body = (await res.json()) as { suggestions: unknown[]; remaining: string[] };
    expect(body.suggestions).toHaveLength(12);
    expect(body.remaining).toEqual(names.slice(12));
    // A malformed body is a 400 boundary rejection, not a 500.
    const bad = await send(env, "POST", "/api/grocery/substitutions", cookie, { names: "milk" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("validation_failed");
  });

  it("GET /grocery/to-buy default stays byte-identical; ?enrich=1 adds placement + substitutes + location + flyer_as_of", async () => {
    const { env } = memberEnv({ grocery_list: [], sku_cache: [], pantry: [], meal_plan: [] });
    const cookie = await loggedIn(env);
    await send(env, "POST", "/api/grocery/items", cookie, { name: "milk" });

    const plain = await get(env, "/api/grocery/to-buy", cookie);
    const plainBody = (await plain.json()) as { to_buy: Record<string, unknown>[]; location?: unknown; flyer_as_of?: unknown };
    expect("location" in plainBody).toBe(false);
    expect("flyer_as_of" in plainBody).toBe(false);
    expect("placement" in plainBody.to_buy[0]).toBe(false);
    expect("substitutes" in plainBody.to_buy[0]).toBe(false);

    const enriched = await get(env, "/api/grocery/to-buy?enrich=1", cookie);
    expect(enriched.status).toBe(200);
    const enrichedBody = (await enriched.json()) as {
      to_buy: Record<string, unknown>[];
      location: unknown;
      flyer_as_of: string | null;
    };
    // No profile/preferred location in this env → no resolvable store: an honest
    // null location with department-only (here: null) placements — never an error.
    expect(enrichedBody.location).toBeNull();
    expect("placement" in enrichedBody.to_buy[0]).toBe(true);
    expect(enrichedBody.to_buy[0].placement).toBeNull();
    // Substitute hints (inline-substitution-hints D1-D3): always an array, empty
    // here (no identity graph seeded) — never omitted on the enriched read.
    expect(enrichedBody.to_buy[0].substitutes).toEqual([]);
    expect(enrichedBody.flyer_as_of).toBeNull();
  });

  it("GET /cookbook/trending is ETagged, min-signal-guarded, and counts-only", async () => {
    // The production-shaped sparse log: one cook — the guard yields an EMPTY set.
    const sparse = memberEnv({ cooking_log: [{ id: 1, tenant: "casey", date: "2026-07-01", type: "recipe", recipe: "tacos" }] });
    const cookie = await loggedIn(sparse.env);
    const empty = await get(sparse.env, "/api/cookbook/trending", cookie);
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { recipes: unknown[] }).recipes).toEqual([]);

    // A threshold-crossing log (2 tenants) trends with counts only + 304 on re-read.
    const crossing = memberEnv({
      cooking_log: [
        { id: 1, tenant: "casey", date: "2026-07-01", type: "recipe", recipe: "tacos" },
        { id: 2, tenant: "pat", date: "2026-07-03", type: "recipe", recipe: "tacos" },
      ],
    });
    const cookie2 = await loggedIn(crossing.env);
    const res = await get(crossing.env, "/api/cookbook/trending", cookie2);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^W\//);
    const body = (await res.json()) as { recipes: { slug: string; cooks: number; cooks_by: number }[]; window_days: number };
    expect(body.window_days).toBe(60);
    expect(body.recipes).toHaveLength(1);
    expect(body.recipes[0]).toMatchObject({ slug: "tacos", cooks: 2, cooks_by: 2, title: "Tacos" });
    const again = await get(crossing.env, "/api/cookbook/trending", cookie2, { "If-None-Match": etag! });
    expect(again.status).toBe(304);
  });

  it("GET /cookbook/picked-for-you: empty without favorites, populated (favorites excluded) with them", async () => {
    const cold = memberEnv();
    const cookie = await loggedIn(cold.env);
    const empty = await get(cold.env, "/api/cookbook/picked-for-you", cookie);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("etag")).toMatch(/^W\//);
    expect(((await empty.json()) as { recipes: unknown[] }).recipes).toEqual([]);

    const warm = memberEnv({
      recipes: [RECIPE_ROW, { ...RECIPE_ROW, slug: "enchiladas", title: "Enchiladas" }],
      recipe_derived: [
        { slug: "tacos", description: null, embedding: JSON.stringify([1, 0]) },
        { slug: "enchiladas", description: null, embedding: JSON.stringify([0.9, 0.1]) },
      ],
      overlay: [{ tenant: "casey", recipe: "tacos", favorite: 1, reject: 0 }],
    });
    const cookie2 = await loggedIn(warm.env);
    const res = await get(warm.env, "/api/cookbook/picked-for-you", cookie2);
    const body = (await res.json()) as { recipes: { slug: string }[] };
    expect(body.recipes.map((r) => r.slug)).toEqual(["enchiladas"]); // the favorite never re-picked
  });
});

// --- spend inheritance through the shared op (spend-telemetry, route-level) ---------
// The member PATCH route is a thin adapter over the SAME updateGroceryRow op the MCP
// tool uses — so the purchase-assertion materialization, the no-linkage rule, and the
// void-on-relist all hold across the HTTP boundary with zero route-side wiring. Real
// SQLite (the fake can't join the send tables).
import { sqliteEnv } from "./sqlite-d1.js";
import { addGroceryRow, advanceInCartRows } from "../src/session-db.js";
import { snapshotStatements } from "../src/spend.js";

const send2 = send;

describe("grocery area — spend rides the shared status op (route-level)", () => {
  async function spendEnv() {
    const h = sqliteEnv(["casey"]);
    await h.env.TENANT_KV.put("invite:GOODCODE", "casey");
    const env = { ...(h.env as object), TOOL_AE: { writeDataPoint: () => {} } } as unknown as Env;
    return { h, env };
  }

  it("PATCH status:ordered materializes the linked snapshot; a re-list voids it", async () => {
    const { h, env } = await spendEnv();
    await addGroceryRow(env, "casey", { name: "Milk" }, "2026-07-11");
    const send = {
      id: "SEND-1",
      statements: snapshotStatements(
        env,
        { id: "SEND-1", tenant: "casey", store: "kroger", locationId: "loc-1", fulfillment: "kroger_online", orderListId: null, createdAt: "2026-07-11T12:00:00Z" },
        [{ lineKey: "milk", name: "Milk", sku: "S1", brand: null, size: null, quantity: 1, priceRegular: 3.5, pricePromo: 0, onSale: false, unitPrice: 3.5, savings: 0, estimated: 0, department: "dairy", provenance: "planned", forRecipes: [] }],
      ),
    };
    await advanceInCartRows(env, "casey", [{ name: "Milk", key: "milk" }], "2026-07-11", send);
    const cookie = await loggedIn(env);

    const ordered = await send2(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "ordered" });
    expect(ordered.status).toBe(200);
    expect(h.rows<{ amount: number; department: string; voided_at: string | null }>("spend_events")).toEqual([
      expect.objectContaining({ send_id: "SEND-1", line_key: "milk", amount: 3.5, department: "dairy", voided_at: null }),
    ]);

    const relist = await send2(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "active" });
    expect(relist.status).toBe(200);
    const events = h.rows<{ voided_at: string | null }>("spend_events");
    expect(events).toHaveLength(1); // voided, never deleted
    expect(events[0].voided_at).not.toBeNull();
    expect(h.rows<{ sent_in: string | null }>("grocery_list")[0].sent_in).toBeNull();
  });

  it("a manual in_cart move through the route carries no linkage — ordered writes nothing", async () => {
    const { h, env } = await spendEnv();
    await addGroceryRow(env, "casey", { name: "Milk" }, "2026-07-11");
    const cookie = await loggedIn(env);
    await send2(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "in_cart" });
    await send2(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "ordered" });
    expect(h.rows("spend_events")).toHaveLength(0);
    expect(h.rows<{ sent_in: string | null }>("grocery_list")[0].sent_in).toBeNull();
  });

  it("sent_in is not caller-writable: a PATCH carrying it never reaches the row", async () => {
    const { h, env } = await spendEnv();
    await addGroceryRow(env, "casey", { name: "Milk" }, "2026-07-11");
    const cookie = await loggedIn(env);
    // The boundary's field allowlist (coerceCommon) has no sent_in — the forged value
    // is dropped, never applied; the linkage is stamped only by the order-flush ops.
    const res = await send2(env, "PATCH", "/api/grocery/items/milk", cookie, { sent_in: "SEND-FORGED", note: "hi" });
    expect(res.status).toBe(200);
    expect(h.rows<{ sent_in: string | null; note: string }>("grocery_list")[0]).toMatchObject({
      sent_in: null,
      note: "hi",
    });
  });
});

describe("grocery area — canonical snapshot and checked route", () => {
  async function groceryEnv() {
    const h = sqliteEnv(["casey"]);
    await h.env.TENANT_KV.put("invite:GOODCODE", "casey");
    return { h, env: { ...(h.env as object), TOOL_AE: { writeDataPoint: () => {} } } as Env };
  }

  it("GET view and checked POST share the authoritative snapshot, including duplicate delivery", async () => {
    const { h, env } = await groceryEnv();
    await addGroceryRow(env, "casey", { name: "Milk" }, "2026-07-12");
    const cookie = await loggedIn(env);
    const beforeRes = await get(env, "/api/grocery/view", cookie);
    expect(beforeRes.status).toBe(200);
    const before = await beforeRes.json() as { snapshot_version: string; lines: { key: string; row_version: number }[] };
    const vars = { key: "milk", checked: true, expected_row_version: before.lines[0].row_version, snapshot_version: before.snapshot_version, occurred_at: "2026-07-12T12:00:00Z" };
    const checked = await send(env, "POST", "/api/grocery/checked", cookie, vars);
    expect(checked.status).toBe(200);
    const body = await checked.json() as { snapshot: { to_buy: string[]; lines: { key: string; checked_at: string | null }[] } };
    expect(body.snapshot.to_buy).not.toContain("milk");
    expect(body.snapshot.lines.find((line) => line.key === "milk")?.checked_at).toBe(vars.occurred_at);
    const replay = await send(env, "POST", "/api/grocery/checked", cookie, vars);
    expect(replay.status).toBe(200);
    expect(h.rows("grocery_list")).toHaveLength(1);
  });

  it("opposing stale checked state returns 409 with the full current snapshot", async () => {
    const { env } = await groceryEnv();
    await addGroceryRow(env, "casey", { name: "Milk" }, "2026-07-12");
    const cookie = await loggedIn(env);
    const before = await (await get(env, "/api/grocery/view", cookie)).json() as { snapshot_version: string };
    await send(env, "POST", "/api/grocery/checked", cookie, { key: "milk", checked: true, expected_row_version: 1, snapshot_version: before.snapshot_version });
    const stale = await send(env, "POST", "/api/grocery/checked", cookie, { key: "milk", checked: false, expected_row_version: 1, snapshot_version: before.snapshot_version });
    expect(stale.status).toBe(409);
    const error = await stale.json() as { error: string; snapshot: { snapshot_version: string; lines: unknown[] } };
    expect(error.error).toBe("conflict");
    expect(error.snapshot.lines.length).toBeGreaterThan(0);
  });

  it("rejects malformed grocery mutation bodies with validation_failed", async () => {
    const { env } = await groceryEnv(); const cookie = await loggedIn(env);
    for (const [path, body] of [
      ["checked", { key: "", checked: "yes", expected_row_version: -1, snapshot_version: "stale" }],
      ["substitution", { original_key: "milk", snapshot_version: "stale" }],
      ["coverage", { key: "milk", enabled: true, snapshot_version: "stale" }],
      ["relist", { send_id: "s", line_key: "milk", expected_row_version: 0 }],
      ["mark-placed", { send_id: "s", expected_line_keys: ["milk", "milk"], snapshot_version: "stale" }],
    ] as const) {
      const response = await send(env, "POST", `/api/grocery/${path}`, cookie, body);
      expect(response.status).toBe(400); expect((await response.json() as { error: string }).error).toBe("validation_failed");
    }
  });
});
