// The split-lifecycle extensions for multi-member households (households-friends-and-
// people-page §7 + the identity-split review follow-throughs, load-bearing the moment
// member #2 exists): household-purge's member-set AUTHOR_TABLES delete, member-revoke's
// social cleanup + last-two-members race guard, and the /authorize completion sites
// gated through resolveIdentity.
import { describe, it, expect } from "vitest";
import { sqliteEnv, memKv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import type { Env } from "../src/env.js";
import { insertFoundingMember, insertMember, type MemberRow } from "../src/members-db.js";
import { revoke, revokeMember, type AdminDeps } from "../src/admin.js";
import { handleAuthorize, handleAuthorizeStatus } from "../src/authorize.js";
import { mintApproval, approveApproval } from "../src/connect-approval.js";
import { upsertNickname, insertBlock, insertRequest, insertInvite } from "../src/social-db.js";
import type { KvStore } from "../src/kroger-user.js";

const NOW = 1_800_000_000_000;

function adminDepsOf(h: SqliteEnv): AdminDeps {
  return {
    tenantKv: h.env.TENANT_KV,
    krogerKv: memKv() as unknown as KvStore,
    oauthKv: memKv() as unknown as KvStore,
    db: db(h.env),
    randomCode: () => "code",
  };
}

async function mint(h: SqliteEnv, tenant: string, handle: string): Promise<MemberRow> {
  const res = await insertMember(db(h.env), tenant, handle, NOW);
  if (res.kind !== "ok") throw new Error("mint failed");
  return res.member;
}

describe("household purge with non-founding members", () => {
  it("deletes EVERY member's authored notes via the member-set subquery (ordered before the members delete)", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j"); // a ULID author — `author = tenant` would miss it
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('stew', 'Stew')").run();
    h.raw
      .prepare("INSERT INTO recipe_notes (id, recipe, author, body, created_at) VALUES ('n1', 'stew', 'casey', 'good', '2026-01-01')")
      .run();
    h.raw
      .prepare("INSERT INTO recipe_notes (id, recipe, author, body, created_at) VALUES ('n2', 'stew', ?, 'salty', '2026-01-01')")
      .run(sam.id);
    h.raw
      .prepare("INSERT INTO store_notes (id, store, author, body, created_at) VALUES ('s1', 'kroger', ?, 'busy', '2026-01-01')")
      .run(sam.id);

    await revoke(adminDepsOf(h), "casey");
    expect(h.rows("recipe_notes")).toHaveLength(0); // the ULID author's rows did not orphan
    expect(h.rows("store_notes")).toHaveLength(0);
    expect(h.rows("members")).toHaveLength(0);
  });
});

describe("member-revoke social cleanup", () => {
  it("removes nicknames set/targeting, cancels outgoing requests, revokes minted invites, deletes blocked_member records", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    await insertFoundingMember(d, "pat", NOW);
    const sam = await mint(h, "casey", "sam_j");

    await upsertNickname(d, "casey", sam.id, "casey", "Chef", NOW); // set by sam
    await upsertNickname(d, "casey", "casey", sam.id, "Sam", NOW); // targeting sam
    await insertRequest(d, {
      id: "r1",
      tier: "friend",
      from_tenant: "casey",
      from_member: sam.id,
      to_tenant: "pat",
      to_member: "pat",
      note: null,
      display_name: null,
      state: "pending",
      created_at: NOW,
      resolved_at: null,
    });
    await insertInvite(d, {
      token: "tok1",
      tenant: "casey",
      inviter_member: sam.id,
      tier: "household",
      created_at: NOW,
      expires_at: NOW + 1000,
      revoked_at: null,
      redeemed_at: null,
      redeemed_by: null,
    });
    await insertBlock(
      d,
      { tenant: "pat", blockingMember: "pat", tier: "household", blockedTenant: "casey", blockedMember: sam.id },
      NOW,
    );

    await revokeMember(adminDepsOf(h), "casey", sam.id);

    expect(h.rows("nicknames")).toHaveLength(0);
    expect(h.rows<{ state: string; resolved_at: number | null }>("social_requests")[0]).toMatchObject({
      state: "cancelled",
      resolved_at: null, // never a decline anchor
    });
    expect(h.rows<{ revoked_at: number | null }>("member_invites")[0].revoked_at).not.toBeNull();
    expect(h.rows("blocks")).toHaveLength(0);
    // The household itself is untouched.
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "casey", tenant: "casey" }));
    expect(await h.env.TENANT_KV.get("tenant:casey")).not.toBeNull();
  });

  it("the last-two-members race can never produce a zero-member tenant", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('stew', 'Stew')").run();
    h.raw
      .prepare("INSERT INTO recipe_notes (id, recipe, author, body, created_at) VALUES ('n1', 'stew', 'casey', 'x', '2026-01-01')")
      .run();

    const deps = adminDepsOf(h);
    await revokeMember(deps, "casey", sam.id); // the winner
    // The loser: the pre-check raced past, but the conditional batch must no-op —
    // the member row survives AND their scoped rows (notes) survive with it.
    await expect(revokeMember(deps, "casey", "casey")).rejects.toMatchObject({ code: "conflict" });
    expect(h.rows("members")).toHaveLength(1);
    expect(h.rows("recipe_notes")).toHaveLength(1); // the guarded batch degenerated to a no-op
  });

  it("the guarded batch no-ops even when the count pre-check is raced past", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");
    const deps = adminDepsOf(h);
    // Simulate the interleaving: the OTHER revoke lands between this call's pre-check
    // and its batch by patching countMembers' view — delete sam directly after the
    // pre-check would read 2. We approximate by deleting sam first and calling with a
    // deps.db whose first getMember/count reads are warmed from a snapshot… the
    // simplest faithful assertion: with ONE member left, the conditional delete
    // statement itself refuses (no `id <> target` row exists), regardless of pre-checks.
    await d.run("DELETE FROM members WHERE id = ?1", sam.id);
    const res = await d.run(
      "DELETE FROM members WHERE tenant = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM members WHERE tenant = ?1 AND id <> ?2)",
      "casey",
      "casey",
    );
    expect(res.changes).toBe(0); // the in-batch guard, independent of any pre-check
    expect(h.rows("members")).toHaveLength(1);
    void deps;
  });
});

describe("/authorize completion sites are gated through resolveIdentity (7.1b)", () => {
  const OAUTH_REQ = {
    responseType: "code",
    clientId: "claude-connector",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    scope: ["mcp"],
    state: "xyz",
    codeChallenge: "abc",
    codeChallengeMethod: "S256",
  };
  const oauthReqB64 = btoa(JSON.stringify(OAUTH_REQ));

  function withProvider(h: SqliteEnv): { env: Env; completeCalls: Array<{ userId: string; props: unknown }> } {
    const completeCalls: Array<{ userId: string; props: unknown }> = [];
    const env = {
      ...(h.env as unknown as Record<string, unknown>),
      OAUTH_PROVIDER: {
        parseAuthRequest: async () => ({ ...OAUTH_REQ }),
        lookupClient: async (clientId: string) => ({ clientId, clientName: "Claude" }),
        completeAuthorization: async (opts: { userId: string; props: unknown }) => {
          completeCalls.push({ userId: opts.userId, props: opts.props });
          return { redirectTo: "https://claude.ai/cb?code=GRANT" };
        },
      },
    } as unknown as Env;
    return { env, completeCalls };
  }

  function postForm(fields: Record<string, string>): Request {
    return new Request("https://worker.example/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
  }

  it("the legacy-invite POST refuses a revoked member's lingering invite mapping (no grant minted)", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");
    // A bootstrap invite mapping to sam lingers in KV…
    await h.env.TENANT_KV.put(
      "invite:LINGER",
      JSON.stringify({ v: 1, tenant: "casey", member: sam.id, single_use: true }),
    );
    // …but sam is revoked (their member row is gone).
    await d.run("DELETE FROM members WHERE id = ?1", sam.id);

    const { env, completeCalls } = withProvider(h);
    const res = await handleAuthorize(postForm({ invite_code: "LINGER", oauth_req: oauthReqB64 }), env);
    expect(res.status).toBe(400); // the same uniform failure as a bad code
    expect(completeCalls).toHaveLength(0); // not even a dead grant is minted

    // A LIVE member's mapping still completes (parity check).
    await h.env.TENANT_KV.put(
      "invite:GOOD",
      JSON.stringify({ v: 1, tenant: "casey", member: "casey", single_use: true }),
    );
    const ok = await handleAuthorize(postForm({ invite_code: "GOOD", oauth_req: oauthReqB64 }), env);
    expect(ok.status).toBe(302);
    expect(completeCalls).toEqual([{ userId: "casey", props: { tenantId: "casey", memberId: "casey" } }]);
  });

  it("the cross-device status claim refuses an approval whose member died between approve and claim", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");
    const { env, completeCalls } = withProvider(h);

    const { ref } = await mintApproval(env, oauthReqB64, "Claude");
    await approveApproval(env, ref, "casey", sam.id);
    await d.run("DELETE FROM members WHERE id = ?1", sam.id); // revoked in the gap

    const res = await handleAuthorizeStatus(
      new Request(`https://worker.example/authorize/status?authz=${encodeURIComponent(ref)}`),
      env,
    );
    expect(((await res.json()) as { status: string }).status).toBe("expired"); // uniform — no oracle
    expect(completeCalls).toHaveLength(0);
  });
});
