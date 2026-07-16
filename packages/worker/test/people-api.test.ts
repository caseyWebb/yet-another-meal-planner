// Route-level mapping for the People area (households-friends-and-people-page §6.1):
// the aggregate shape, the structured `rate_limited` 429 on lookup/send, the
// `profile_disabled` 403 under self-hosted, and the nickname PUT (upsert/empty-clear).
// Session gating itself rides the api-member.test.ts sweep.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import app from "../src/api/app.js";
import type { Env } from "../src/env.js";
import { insertFoundingMember, insertMember } from "../src/members-db.js";
import { createSession } from "../src/session.js";
import { LOOKUP_BUDGET } from "../src/social.js";

const NOW = Date.now();
const CSRF = { "X-App-Csrf": "1" };

async function world(profile: "saas" | "self-hosted" = "saas"): Promise<{ h: SqliteEnv; cookie: string; samId: string }> {
  const h = sqliteEnv(["casey", "pat"]);
  h.raw.prepare("INSERT INTO operator_config (id, deployment_profile) VALUES (1, ?)").run(profile);
  await insertFoundingMember(db(h.env), "casey", NOW);
  await insertFoundingMember(db(h.env), "pat", NOW);
  const sam = await insertMember(db(h.env), "casey", "sam_j", NOW);
  if (sam.kind !== "ok") throw new Error("mint failed");
  const token = await createSession(h.env.TENANT_KV, "casey", "casey", NOW);
  return { h, cookie: `__Host-session=${token}`, samId: sam.member.id };
}

function get(env: Env, path: string, cookie: string) {
  return app.request(`http://127.0.0.1${path}`, { headers: { cookie } }, env);
}

function send(env: Env, method: string, path: string, cookie: string, body?: unknown, ip = "1.1.1.1") {
  return app.request(
    `http://127.0.0.1${path}`,
    {
      method,
      headers: { "content-type": "application/json", ...CSRF, cookie, "CF-Connecting-IP": ip },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

describe("GET /api/people", () => {
  it("serves the aggregate: members with the viewer's nicknames, inbox, awaiting, profile", async () => {
    const { h, cookie, samId } = await world();
    await send(h.env, "PUT", `/api/people/nicknames/${samId}`, cookie, { nickname: "Mom" });
    const res = await get(h.env, "/api/people", cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profile: string;
      members: { handle: string; you: boolean; nickname: string | null }[];
      inbox: unknown[];
      awaiting: { requests: unknown[]; invites: unknown[] };
      household_max: number;
    };
    expect(body.profile).toBe("saas");
    expect(body.household_max).toBe(8);
    expect(body.members).toHaveLength(2);
    expect(body.members.find((m) => m.you)?.handle).toBe("casey");
    expect(body.members.find((m) => !m.you)?.nickname).toBe("Mom");
  });
});

describe("rate limiting at the route (structured 429)", () => {
  it("lookup answers rate_limited 429 once the window is spent", async () => {
    const { h, cookie } = await world();
    let last: Response | null = null;
    for (let i = 0; i <= LOOKUP_BUDGET.max; i++) {
      last = await send(h.env, "POST", "/api/people/lookup", cookie, { tier: "household", handle: "pat" });
    }
    expect(last!.status).toBe(429);
    expect(((await last!.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("send answers rate_limited 429 once the daily budget is spent", async () => {
    const { h, cookie } = await world();
    let last: Response | null = null;
    for (let i = 0; i <= 10; i++) {
      last = await send(h.env, "POST", "/api/people/requests", cookie, { tier: "friend", handle: "pat" });
    }
    expect(last!.status).toBe(429);
  });
});

describe("profile gating at the route", () => {
  it("friend-tier lookup/send/invite answer profile_disabled 403 under self-hosted", async () => {
    const { h, cookie } = await world("self-hosted");
    for (const [path, body] of [
      ["/api/people/lookup", { tier: "friend", handle: "pat" }],
      ["/api/people/requests", { tier: "friend", handle: "pat" }],
      ["/api/people/invites", { tier: "friend" }],
    ] as const) {
      const res = await send(h.env, "POST", path, cookie, body);
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe("profile_disabled");
    }
    // Household tier stays live.
    const ok = await send(h.env, "POST", "/api/people/invites", cookie, { tier: "household" });
    expect(ok.status).toBe(200);
  });
});

describe("nickname PUT", () => {
  it("upserts, clears on empty save, and refuses self/unknown targets", async () => {
    const { h, cookie, samId } = await world();
    expect((await send(h.env, "PUT", `/api/people/nicknames/${samId}`, cookie, { nickname: "Mom" })).status).toBe(200);
    const cleared = await send(h.env, "PUT", `/api/people/nicknames/${samId}`, cookie, { nickname: "" });
    expect(((await cleared.json()) as { cleared: boolean }).cleared).toBe(true);
    expect(h.rows("nicknames")).toHaveLength(0);
    expect((await send(h.env, "PUT", "/api/people/nicknames/casey", cookie, { nickname: "Me" })).status).toBe(400);
    expect((await send(h.env, "PUT", "/api/people/nicknames/ghost", cookie, { nickname: "X" })).status).toBe(404);
  });
});
