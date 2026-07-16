// Member invite links + the signup fork (households-friends-and-people-page §4), at
// the route boundary: `/api/join/:token` dead-token uniformity, household member
// mints, friend-tier tenant+edge mints, signed-in conversions, blocked-party
// consumption, the invite-kind trio separation, and the per-IP limiters.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import app from "../src/api/app.js";
import type { Env } from "../src/env.js";
import { insertFoundingMember, insertMember } from "../src/members-db.js";
import { createSession } from "../src/session.js";
import { mintInvite } from "../src/social.js";
import { getInvite, insertBlock, friendshipExists } from "../src/social-db.js";
import { createGroupInvite } from "../src/admin.js";
import type { Tenant } from "../src/tenant.js";

const NOW = Date.now(); // route handlers stamp real time; expiries are relative to it
const CSRF = { "X-App-Csrf": "1" };

function get(env: Env, path: string, headers: Record<string, string> = {}) {
  return app.request(`http://127.0.0.1${path}`, { headers }, env);
}

function post(env: Env, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(
    `http://127.0.0.1${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...CSRF, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

async function saasWorld(): Promise<{ h: SqliteEnv; casey: Tenant }> {
  const h = sqliteEnv(["casey", "pat"]);
  h.raw.prepare("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')").run();
  await insertFoundingMember(db(h.env), "casey", NOW);
  await insertFoundingMember(db(h.env), "pat", NOW);
  return { h, casey: { id: "casey", member: "casey" } };
}

async function cookieFor(h: SqliteEnv, tenant: string, member: string): Promise<string> {
  const token = await createSession(h.env.TENANT_KV, tenant, member, NOW);
  return `__Host-session=${token}`;
}

async function mintToken(h: SqliteEnv, actor: Tenant, tier: "household" | "friend"): Promise<string> {
  const res = await mintInvite(h.env, actor, tier, NOW);
  if (res.kind !== "ok") throw new Error("mint refused");
  return res.token;
}

describe("GET /api/join/:token", () => {
  it("a valid token returns the inviter handle and tier", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "household");
    const res = await get(h.env, `/api/join/${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inviter_handle: "casey", tier: "household", signed_in: false });
  });

  it("the four dead states are byte-identical: unknown, expired, revoked, redeemed", async () => {
    const { h, casey } = await saasWorld();
    const expired = await mintToken(h, casey, "household");
    h.raw.prepare("UPDATE member_invites SET expires_at = 1 WHERE token = ?").run(expired);
    const revoked = await mintToken(h, casey, "household");
    h.raw.prepare("UPDATE member_invites SET revoked_at = 2 WHERE token = ?").run(revoked);
    const redeemed = await mintToken(h, casey, "household");
    h.raw.prepare("UPDATE member_invites SET redeemed_at = 3, redeemed_by = 'x' WHERE token = ?").run(redeemed);

    const bodies: string[] = [];
    const statuses: number[] = [];
    for (const tok of ["completely-unknown", expired, revoked, redeemed]) {
      const res = await get(h.env, `/api/join/${tok}`);
      statuses.push(res.status);
      bodies.push(await res.text());
    }
    expect(new Set(statuses).size).toBe(1);
    expect(new Set(bodies).size).toBe(1); // byte-identical
  });

  it("a friend-tier link is uniformly dead under self-hosted", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "friend");
    h.raw.prepare("UPDATE operator_config SET deployment_profile = 'self-hosted' WHERE id = 1").run();
    const res = await get(h.env, `/api/join/${token}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_or_expired");
  });

  it("rate-limits per IP", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "household");
    let limited = false;
    for (let i = 0; i < 35; i++) {
      const res = await get(h.env, `/api/join/${token}`, { "CF-Connecting-IP": "6.6.6.6" });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

describe("POST /api/join/:token — signed-out household redemption", () => {
  it("mints a ULID member in the inviter's household, consumes the token, signs the redeemer in", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "household");
    const res = await post(h.env, `/api/join/${token}`, { handle: "grandma_j", display_name: "Grandma" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { id: string; member: string }; handle: string };
    expect(body.tenant.id).toBe("casey"); // NO new tenant
    expect(body.tenant.member).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // a server ULID
    expect(body.handle).toBe("grandma_j");
    expect(res.headers.get("set-cookie")).toContain("__Host-session="); // the standard member-bound session
    // The token is consumed, with the resulting member recorded.
    const invite = await getInvite(db(h.env), token);
    expect(invite?.redeemed_at).not.toBeNull();
    expect(invite?.redeemed_by).toBe(body.tenant.member);
    // The self-introduction seeded the existing members' nicknames.
    expect(h.rows("nicknames")).toContainEqual(
      expect.objectContaining({ viewer_member: "casey", target_member: body.tenant.member, nickname: "Grandma" }),
    );
    // Only one winner: a second redemption of the same token is uniformly dead.
    const again = await post(h.env, `/api/join/${token}`, { handle: "other_one" }, { "CF-Connecting-IP": "2.2.2.2" });
    expect(again.status).toBe(404);
    expect(((await again.json()) as { error: string }).error).toBe("invalid_or_expired");
  });

  it("a grammar-violating handle is refused; a taken handle refunds the token", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "household");
    const bad = await post(h.env, `/api/join/${token}`, { handle: "Has-Hyphen" });
    expect(bad.status).toBe(400);

    // "pat" collides with pat's founding handle: refused, and the single use REFUNDED.
    const taken = await post(h.env, `/api/join/${token}`, { handle: "pat" }, { "CF-Connecting-IP": "3.3.3.3" });
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { error: string }).error).toBe("handle_taken");
    expect((await getInvite(db(h.env), token))?.redeemed_at).toBeNull(); // still live
    const retry = await post(h.env, `/api/join/${token}`, { handle: "grandpa_j" }, { "CF-Connecting-IP": "4.4.4.4" });
    expect(retry.status).toBe(200);
  });

  it("refuses a ninth member without consuming the token", async () => {
    const { h, casey } = await saasWorld();
    for (let i = 2; i <= 8; i++) await insertMember(db(h.env), "casey", `member_${i}`, NOW);
    const token = await mintToken(h, casey, "household");
    const res = await post(h.env, `/api/join/${token}`, { handle: "ninth_one" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("household_full");
    expect((await getInvite(db(h.env), token))?.redeemed_at).toBeNull(); // NOT consumed
  });
});

describe("POST /api/join/:token — signed-out friend redemption", () => {
  it("mints a tenant exactly like signup PLUS the edge, committed with the consumption", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "friend");
    const res = await post(h.env, `/api/join/${token}`, { username: "bob" });
    expect(res.status).toBe(200);
    // An ordinary blank self-service tenant…
    expect(await h.env.TENANT_KV.get("tenant:bob")).toBe(JSON.stringify({ id: "bob" }));
    expect(h.rows("tenants")).toContainEqual(expect.objectContaining({ id: "bob", via_code: null }));
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "bob", tenant: "bob", handle: "bob" }));
    // …PLUS exactly one friendship edge to the inviter's household.
    expect(await friendshipExists(db(h.env), "bob", "casey")).toBe(true);
    expect((await getInvite(db(h.env), token))?.redeemed_by).toBe("bob");
    expect(res.headers.get("set-cookie")).toContain("__Host-session=");
  });

  it("a taken username refunds the token; group codes mint NO edge (regression)", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "friend");
    const res = await post(h.env, `/api/join/${token}`, { username: "pat" });
    expect(res.status).toBe(409);
    expect((await getInvite(db(h.env), token))?.redeemed_at).toBeNull();

    // The group-code path stays edge-free.
    const { code } = await createGroupInvite(h.env, { cap: 1 }, NOW);
    const signup = await post(h.env, "/api/signup", { code, username: "solo" });
    expect(signup.status).toBe(200);
    expect(h.rows("friendships")).toHaveLength(0);
  });
});

describe("POST /api/join/:token — signed-in conversions", () => {
  it("a friend-tier link creates the edge after confirm, idempotently", async () => {
    const { h, casey } = await saasWorld();
    const token = await mintToken(h, casey, "friend");
    const cookie = await cookieFor(h, "pat", "pat");

    const preview = await post(h.env, `/api/join/${token}`, {}, { cookie });
    expect(((await preview.json()) as { status: string }).status).toBe("confirm_required");
    expect((await getInvite(db(h.env), token))?.redeemed_at).toBeNull(); // preview consumes nothing

    const res = await post(h.env, `/api/join/${token}`, { confirm: true }, { cookie });
    expect(res.status).toBe(200);
    expect(await friendshipExists(db(h.env), "pat", "casey")).toBe(true);

    // Already friends + a second link: still ok (idempotent), token spent.
    const token2 = await mintToken(h, casey, "friend");
    const res2 = await post(h.env, `/api/join/${token2}`, { confirm: true }, { cookie });
    expect(res2.status).toBe(200);
    expect(h.rows("friendships")).toHaveLength(1);
  });

  it("a household-tier link converts to the accept flow: manifest first, then move + dissolution", async () => {
    const { h, casey } = await saasWorld();
    h.raw.prepare("INSERT INTO pantry (tenant, name, normalized_name) VALUES ('pat', 'beans', 'beans')").run();
    const token = await mintToken(h, casey, "household");
    const cookie = await cookieFor(h, "pat", "pat");

    const preview = await post(h.env, `/api/join/${token}`, {}, { cookie });
    const previewBody = (await preview.json()) as { status: string; not_carried_over: string[] };
    expect(previewBody.status).toBe("confirm_required");
    expect(previewBody.not_carried_over).toContain("pantry");
    expect(previewBody.not_carried_over).toContain("cooking history"); // the v1 reduction, stated

    const res = await post(h.env, `/api/join/${token}`, { confirm: true }, { cookie });
    expect(res.status).toBe(200);
    // pat is a member of casey; tenant pat retired.
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "pat", tenant: "casey" }));
    expect(await h.env.TENANT_KV.get("tenant:pat")).toBeNull();
    expect(h.rows("tenants").map((r) => (r as { id: string }).id)).not.toContain("pat");
    expect(h.rows("pantry")).toHaveLength(0); // household state purged
  });

  it("a blocked party's redemption consumes the token, creates nothing, and is indistinguishable from a dead link", async () => {
    const { h, casey } = await saasWorld();
    await insertBlock(
      db(h.env),
      { tenant: "casey", blockingMember: "casey", tier: "friend", blockedTenant: "pat" },
      NOW,
    );
    const token = await mintToken(h, casey, "friend");
    const cookie = await cookieFor(h, "pat", "pat");

    const res = await post(h.env, `/api/join/${token}`, { confirm: true }, { cookie });
    const deadRes = await get(h.env, "/api/join/definitely-unknown", { "CF-Connecting-IP": "8.8.8.8" });
    expect(res.status).toBe(deadRes.status);
    expect(await res.text()).toBe(await deadRes.text()); // the swallow posture
    expect(h.rows("friendships")).toHaveLength(0); // nothing created
    expect((await getInvite(db(h.env), token))?.redeemed_at).not.toBeNull(); // consumed
  });
});

describe("the invite-kind trio never crosses", () => {
  it("a member invite token fails the login and group-signup paths; foreign codes fail /join", async () => {
    const { h, casey } = await saasWorld();
    const memberToken = await mintToken(h, casey, "household");

    // Member token → /api/session (KV bootstrap login path): uniform 401.
    const login = await post(h.env, "/api/session", { invite_code: memberToken });
    expect(login.status).toBe(401);

    // Member token → /api/signup (group-code path): uniform code_unusable 401.
    const signup = await post(h.env, "/api/signup", { code: memberToken, username: "someone" });
    expect(signup.status).toBe(401);

    // Group code → /join: uniformly dead.
    const { code } = await createGroupInvite(h.env, { cap: 5 }, NOW);
    const joinWithGroup = await get(h.env, `/api/join/${code}`, { "CF-Connecting-IP": "7.7.7.7" });
    expect(joinWithGroup.status).toBe(404);

    // KV bootstrap code → /join: uniformly dead.
    await h.env.TENANT_KV.put("invite:BOOTSTRAP", JSON.stringify({ v: 1, tenant: "casey", member: "casey", single_use: true }));
    const joinWithBootstrap = await get(h.env, "/api/join/BOOTSTRAP", { "CF-Connecting-IP": "7.7.7.8" });
    expect(joinWithBootstrap.status).toBe(404);
  });

  it("rate-limits redemption per IP", async () => {
    const { h } = await saasWorld();
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await post(h.env, "/api/join/whatever", { handle: "x" }, { "CF-Connecting-IP": "5.5.5.5" });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});
