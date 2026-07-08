import { vi, describe, it, expect } from "vitest";
import { mintIngestKey } from "../src/ingest-db.js";
import { CONTRACT_VERSION, type BatchResponse } from "@grocery-agent/contract";
import { fakeD1 } from "./fake-d1.js";

// Exercises the TOP-LEVEL dispatch in src/index.ts's `defaultHandler` (not `handleIngest`
// in isolation): proves the key-authed ingest carve-out (`/admin/api/ingest`, :92) is
// checked BEFORE the Access-gated `/admin` dispatch (:104) — reordering index.ts breaks
// these. `src/index.ts` can't be imported as-is under plain-node vitest: both
// `@cloudflare/workers-oauth-provider` and `agents/mcp` import `cloudflare:workers`
// unconditionally at module scope, which the default ESM loader rejects outside workerd.
// Neither package is otherwise exercised by the two dispatch branches under test (our
// requests never hit `/mcp`, `/token`, or `/register`), so both are `vi.mock`'d to a bare
// stand-in that forwards straight to the REAL `defaultHandler` the real `index.ts`
// constructs — the actual dispatch order under test is untouched.

const { capture } = vi.hoisted(() => {
  let handler: { fetch(request: Request, env: unknown, ctx?: unknown): Promise<Response> } | undefined;
  return {
    capture: {
      set(h: typeof handler) {
        handler = h;
      },
      get(): NonNullable<typeof handler> {
        if (!handler) throw new Error("OAuthProvider never constructed — did index.ts change its wiring?");
        return handler;
      },
    },
  };
});

vi.mock("@cloudflare/workers-oauth-provider", () => ({
  OAuthProvider: class {
    constructor(opts: { defaultHandler: { fetch(request: Request, env: unknown, ctx?: unknown): Promise<Response> } }) {
      capture.set(opts.defaultHandler);
    }
    fetch(request: Request, env: unknown, ctx: unknown) {
      // None of this test's URLs are `/mcp`, `/token`, `/register`, or a well-known
      // discovery path, so the real provider always falls through to `defaultHandler` for
      // them — this stand-in goes straight there.
      return capture.get().fetch(request, env, ctx);
    }
  },
}));

vi.mock("agents/mcp", () => ({
  createMcpHandler: () => () => new Response("unused by this test", { status: 501 }),
}));

const { default: worker } = await import("../src/index.js");

const NOW = 1_800_000_000_000;

/** A no-op ExecutionContext — neither dispatch path under test reads it. */
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

function freshEnv() {
  return fakeD1({ tables: { ingest_keys: [], ingest_candidates: [], ingest_pushes: [] } });
}

/** A v2 recipe observation (see ingest.test.ts). */
const obs = (n: number) => ({
  kind: "recipe" as const,
  title: `Recipe ${n}`,
  ingredients: ["4 lb short ribs", "2 cups red wine"],
  instructions: ["Sear.", "Braise 3h."],
  source: `https://cooking.example.com/r${n}`,
});

const batch = (observations: unknown[]) => ({
  capability: "recipe-scrape",
  source: "NYT Cooking",
  satellite_version: "1.0.0",
  contract_version: CONTRACT_VERSION,
  observations,
});

describe("top-level worker.fetch dispatch (src/index.ts)", () => {
  it("routes POST /admin/api/ingest through the key-authed carve-out, never the Access gate", async () => {
    const f = freshEnv();
    const { secret } = await mintIngestKey(f.env, "home-nas", NOW);
    // Deliberately NO `Cf-Access-Jwt-Assertion` header — reaching `handleIngest`'s key auth
    // (not the admin app's `accessGate`) is exactly what this test proves.
    const req = new Request("https://host/admin/api/ingest", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(batch([obs(1)])),
    });

    const res = await worker.fetch(req, f.env, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BatchResponse;
    expect(body).toMatchObject({ received: 1, accepted: 1 });
    expect(f.tables.ingest_candidates).toHaveLength(1);
  });

  it("gates a different /admin/api/* route behind Access — 404, Access unconfigured", async () => {
    const f = freshEnv();
    // A real registered route (GET /admin/api/tenants) with no Access headers and no
    // ACCESS_TEAM_DOMAIN/ACCESS_AUD configured: `requireAccess`'s disposition is
    // "disabled" on this non-loopback host, so `accessGate` 404s before the route ever runs.
    const req = new Request("https://host/admin/api/tenants", { method: "GET" });

    const res = await worker.fetch(req, f.env, ctx);
    expect(res.status).toBe(404);
  });
});
