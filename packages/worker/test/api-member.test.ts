// Route-level tests for the member core's /api areas (member-app-core): every
// endpoint is a thin adapter over the shared ops, session-gated PER ROUTE (there is
// no global default-deny — the sweep below proves no route was left open), errors
// cross the boundary as structured bodies with the D8-mapped statuses (409 conflict,
// 412 failed If-Match, 400 boundary rejections), and the D7 suggest gate throttles
// without touching derivation.
import { describe, it, expect, vi } from "vitest";
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
    runDerivation: vi.fn(async () => ({ candidates: [{ id: "cozy", vibe: "cozy braise" }], enqueued: 1, source: "clusters" })),
  };
});
import { runDerivation } from "../src/night-vibe-suggest.js";
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
      ...tables,
    },
  });
  const tenantKv = memKv({ "tenant:casey": JSON.stringify({ id: "casey" }), "invite:GOODCODE": "casey" });
  const env = {
    ...(d1.env as object),
    TENANT_KV: tenantKv,
    KROGER_KV: memKv(),
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
  ["GET", "/api/cookbook/index"],
  ["GET", "/api/cookbook/new-for-me"],
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
  ["POST", "/api/grocery/items"],
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
  ["GET", "/api/vibes"],
  ["GET", "/api/vibes/weeknight"],
  ["POST", "/api/vibes"],
  ["PATCH", "/api/vibes/weeknight"],
  ["DELETE", "/api/vibes/weeknight"],
  ["GET", "/api/vibes/proposals"],
  ["POST", "/api/vibes/proposals/p1/confirm"],
  ["POST", "/api/vibes/suggest"],
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

    const index = await get(env, "/api/cookbook/index", cookie);
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
        { tenant: "casey", recipe: "tacos", planned_for: "2026-07-10", sides: '["rice","beans"]', from_vibe: "weeknight" },
      ],
    });
    const cookie = await loggedIn(env);
    const res = await send(env, "POST", "/api/plan/ops", cookie, {
      ops: [{ op: "set", recipe: "tacos", sides: ["rice"], planned_for: null }],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: unknown[] }).applied).toEqual([{ op: "set", recipe: "tacos" }]);
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

  it("in-cart is an explicit set; the boundary rejects status: ordered outright", async () => {
    const { env, d1 } = memberEnv({ grocery_list: [groceryRow("active")] });
    const cookie = await loggedIn(env);

    const inCart = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "in_cart" });
    expect(inCart.status).toBe(200);
    expect(d1.tables.grocery_list[0].status).toBe("in_cart");
    const back = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "active" });
    expect(back.status).toBe(200);

    // The member boundary rejects "ordered" even from in_cart — no order affordance in P1.
    await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "in_cart" });
    const ordered = await send(env, "PATCH", "/api/grocery/items/milk", cookie, { status: "ordered" });
    expect(ordered.status).toBe(400);
    const shape = (await ordered.json()) as { error: string; message: string };
    expect(shape.error).toBe("validation_failed");
    expect(d1.tables.grocery_list[0].status).toBe("in_cart"); // unchanged
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

describe("pantry area", () => {
  it("reads, applies row ops, and verify stamps today", async () => {
    const { env, d1 } = memberEnv({
      pantry: [{ tenant: "casey", name: "Jasmine rice", normalized_name: "jasmine rice", quantity: "2 lb", category: "grain", prepared_from: null, added_at: "2026-06-01", last_verified_at: "2026-06-01", notes: null }],
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

describe("profile area", () => {
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

    const bare = await send(env, "PATCH", "/api/profile/preferences", cookie, { patch: { default_cooking_nights: 4 } });
    expect(bare.status).toBe(412);
    expect(((await bare.json()) as { error: string }).error).toBe("conflict");
    expect(d1.tables.profile).toHaveLength(0); // nothing stored

    const read = await get(env, "/api/profile/preferences", cookie);
    const etag = read.headers.get("etag")!;
    const ok = await send(env, "PATCH", "/api/profile/preferences", cookie, { patch: { default_cooking_nights: 4 } }, { "If-Match": etag });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { preferences: { default_cooking_nights: number } }).preferences.default_cooking_nights).toBe(4);
    expect(ok.headers.get("etag")).toMatch(/^W\//); // the fresh representation rides back

    // The old ETag is now stale — a raced second writer is refused, not clobbered.
    const stale = await send(env, "PATCH", "/api/profile/preferences", cookie, { patch: { default_cooking_nights: 2 } }, { "If-Match": etag });
    expect(stale.status).toBe(412);
    expect(d1.tables.profile[0].default_cooking_nights).toBe(4);
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

  it("suggest gate: a fresh healthy archetype-derive run throttles WITHOUT running derivation", async () => {
    const now = Date.now();
    const { env } = memberEnv({
      job_health: [{ name: "archetype-derive", ok: 1, last_run_at: now - 60_000, summary: "{}" }],
    });
    const cookie = await loggedIn(env);
    vi.mocked(runDerivation).mockClear();
    const res = await send(env, "POST", "/api/vibes/suggest", cookie, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { throttled: boolean; retry_after_ms?: number };
    expect(body.throttled).toBe(true);
    expect(body.retry_after_ms).toBeGreaterThan(0);
    expect(runDerivation).not.toHaveBeenCalled();
  });

  it("suggest gate: a stale last run lets derivation run (proposals land in the queue)", async () => {
    const now = Date.now();
    const { env } = memberEnv({
      job_health: [{ name: "archetype-derive", ok: 1, last_run_at: now - 30 * 60 * 60 * 1000, summary: "{}" }],
    });
    const cookie = await loggedIn(env);
    vi.mocked(runDerivation).mockClear();
    const res = await send(env, "POST", "/api/vibes/suggest", cookie, {});
    const body = (await res.json()) as { throttled: boolean; enqueued?: number };
    expect(body.throttled).toBe(false);
    expect(body.enqueued).toBe(1);
    expect(runDerivation).toHaveBeenCalledTimes(1);
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
