// The D23 member-move primitive (households-friends-and-people-page §5): the explicit
// manifest (moved vs untouched, byte-level), session re-key + stale-record death, grant
// non-survival, the spawn collision ladder, household-accept dissolution end-to-end,
// and the floor/size-bound refusals — over the REAL migration chain.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import app from "../src/api/app.js";
import { insertFoundingMember, insertMember, type MemberRow } from "../src/members-db.js";
import { createSession, readSession, SESSION_PREFIX } from "../src/session.js";
import { resolveIdentity, directoryFromEnv } from "../src/tenant.js";
import { moveMember, moveIntoSpawn, claimSpawnTenantId } from "../src/member-move.js";
import { sendRequest, acceptRequest, mintInvite } from "../src/social.js";
import { listInbox, getInvite, friendshipExists, insertFriendship } from "../src/social-db.js";

const NOW = 1_800_000_000_000;
const CSRF = { "X-App-Csrf": "1" };

async function mint(h: SqliteEnv, tenant: string, handle: string): Promise<MemberRow> {
  const res = await insertMember(db(h.env), tenant, handle, NOW);
  if (res.kind !== "ok") throw new Error("mint failed");
  return res.member;
}

describe("the move manifest", () => {
  it("moves exactly the member-scoped rows; household state and authored notes stay put", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");

    // Member-scoped state that MOVES:
    h.raw
      .prepare(
        "INSERT INTO webauthn_credentials (tenant, credential_id, public_key, sign_count, created_at, member) VALUES ('casey', 'cred1', 'pk', 0, 1, ?)",
      )
      .run(sam.id);
    h.raw
      .prepare("INSERT INTO nicknames (tenant, viewer_member, target_member, nickname, updated_at) VALUES ('casey', ?, 'casey', 'Chef', 1)")
      .run(sam.id);
    // State that STAYS: household rows, a nickname TARGETING sam, sam's authored note.
    h.raw.prepare("INSERT INTO pantry (tenant, name, normalized_name) VALUES ('casey', 'beans', 'beans')").run();
    h.raw
      .prepare("INSERT INTO nicknames (tenant, viewer_member, target_member, nickname, updated_at) VALUES ('casey', 'casey', ?, 'Sam', 1)")
      .run(sam.id);
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('stew', 'Stew')").run();
    h.raw
      .prepare("INSERT INTO recipe_notes (id, recipe, author, body, created_at) VALUES ('n1', 'stew', ?, 'salty', '2026-01-01')")
      .run(sam.id);
    h.raw
      .prepare("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('stew', 'casey', 'casey', 'agent', '2026-01-01')")
      .run();

    const before = {
      pantry: JSON.stringify(h.rows("pantry")),
      notes: JSON.stringify(h.rows("recipe_notes")),
      imports: JSON.stringify(h.rows("recipe_imports")),
    };

    const { tenant: spawned } = await moveIntoSpawn(h.env, sam, NOW + 1);
    expect(spawned).toBe("sam_j"); // the handle was free

    // Moved (tenant re-keyed; ids and handles NEVER change):
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: sam.id, tenant: "sam_j", handle: "sam_j" }));
    expect(h.rows("webauthn_credentials")[0]).toMatchObject({ credential_id: "cred1", tenant: "sam_j", member: sam.id });
    expect(h.rows("nicknames")).toContainEqual(
      expect.objectContaining({ viewer_member: sam.id, tenant: "sam_j", nickname: "Chef" }),
    );
    // Untouched, byte-level: household state, the nickname targeting sam (a stable
    // member-id reference), sam's authored notes (keyed by member id), and the
    // household's WHOLE cookbook — the leaver takes zero recipe_imports rows.
    expect(JSON.stringify(h.rows("pantry"))).toBe(before.pantry);
    expect(JSON.stringify(h.rows("recipe_notes"))).toBe(before.notes);
    expect(JSON.stringify(h.rows("recipe_imports"))).toBe(before.imports);
    expect(h.rows("nicknames")).toContainEqual(
      expect.objectContaining({ viewer_member: "casey", target_member: sam.id, tenant: "casey", nickname: "Sam" }),
    );
    // The spawned household is allowlisted + registered, founded by the mover.
    expect(await h.env.TENANT_KV.get("tenant:sam_j")).toBe(JSON.stringify({ id: "sam_j" }));
    expect(h.rows("tenants")).toContainEqual(expect.objectContaining({ id: "sam_j" }));
    expect(h.rows("recipe_imports").filter((r) => (r as { tenant: string }).tenant === "sam_j")).toHaveLength(0);
  });

  it("sessions survive re-keyed; a raced stale record 401s; grants stop resolving", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");
    const samToken = await createSession(h.env.TENANT_KV, "casey", sam.id, NOW);
    const caseyToken = await createSession(h.env.TENANT_KV, "casey", "casey", NOW);

    await moveIntoSpawn(h.env, sam, NOW + 1);

    // sam's record now carries the new tenant; casey's is untouched.
    expect((await readSession(h.env.TENANT_KV, samToken))?.tenant).toBe("sam_j");
    expect((await readSession(h.env.TENANT_KV, caseyToken))?.tenant).toBe("casey");

    // The re-keyed session resolves in the new household with no re-login.
    const whoami = await app.request(
      "http://127.0.0.1/api/session",
      { headers: { cookie: `__Host-session=${samToken}` } },
      h.env,
    );
    expect(whoami.status).toBe(200);
    expect(((await whoami.json()) as { tenant: { id: string } }).tenant.id).toBe("sam_j");

    // A raced/missed record still carrying the OLD tenant never resolves.
    await h.env.TENANT_KV.put(
      `${SESSION_PREFIX}${samToken}`,
      JSON.stringify({ tenant: "casey", member: sam.id, created_at: NOW, refreshed_at: NOW }),
    );
    const stale = await app.request(
      "http://127.0.0.1/api/session",
      { headers: { cookie: `__Host-session=${samToken}` } },
      h.env,
    );
    expect(stale.status).toBe(401);

    // The MCP grant pairing (old tenant, member) fails — the member re-connects.
    const grant = await resolveIdentity(h.env, "casey", sam.id, directoryFromEnv(h.env));
    expect(grant).toMatchObject({ error: "unauthorized" });
    const fresh = await resolveIdentity(h.env, "sam_j", sam.id, directoryFromEnv(h.env));
    expect(fresh).toEqual({ id: "sam_j", member: sam.id });
  });
});

describe("the spawn id ladder", () => {
  it("takes the handle when free, else the smallest hyphen suffix", async () => {
    const h = sqliteEnv(["bob"]); // "bob" is an allowlisted tenant already
    await db(h.env).run("INSERT INTO tenants (id, created_at, via_code) VALUES ('bob-2', 1, NULL)"); // …and bob-2 is registered
    expect(await claimSpawnTenantId(h.env, "bob", NOW)).toBe("bob-3");
    expect(await claimSpawnTenantId(h.env, "zoe", NOW)).toBe("zoe");
  });
});

describe("floors and bounds", () => {
  it("the last member can neither leave nor be removed; the refusal names the alternatives", async () => {
    const h = sqliteEnv(["solo"]);
    await insertFoundingMember(db(h.env), "solo", NOW);
    const row = h.rows("members")[0] as unknown as MemberRow;
    await expect(moveIntoSpawn(h.env, row, NOW)).rejects.toMatchObject({
      code: "conflict",
      message: expect.stringMatching(/household/i),
    });
  });

  it("a destination at the size bound refuses the move", async () => {
    const h = sqliteEnv(["casey", "big"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    await insertFoundingMember(d, "big", NOW);
    const sam = await mint(h, "casey", "sam_j");
    for (let i = 2; i <= 8; i++) await mint(h, "big", `big_${i}`);
    await expect(moveMember(h.env, sam, "big")).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("household-accept with dissolution (end-to-end)", () => {
  it("moves the sole member, re-keys grants with duplicate collapse, purges and retires the old tenant", async () => {
    const h = sqliteEnv(["casey", "bob", "zoe"]);
    const d = db(h.env);
    h.raw.prepare("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')").run();
    for (const t of ["casey", "bob", "zoe"]) await insertFoundingMember(d, t, NOW);

    // bob's household state + grants (one overlapping with casey's), social footprint.
    h.raw.prepare("INSERT INTO pantry (tenant, name, normalized_name) VALUES ('bob', 'rice', 'rice')").run();
    for (const [recipe, tenant] of [
      ["shared-dish", "bob"],
      ["shared-dish", "casey"], // the absorber already holds this grant — collapse
      ["bobs-own", "bob"],
    ] as const) {
      h.raw
        .prepare("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?, ?, ?, 'agent', '2026-01-01')")
        .run(recipe, tenant, tenant);
    }
    await insertFriendship(d, "bob", "zoe", "bob", NOW); // severed by dissolution
    await sendRequest(h.env, { id: "bob", member: "bob" }, { tier: "friend", handle: "zoe" }, NOW); // pending outgoing…
    const bobInvite = await mintInvite(h.env, { id: "bob", member: "bob" }, "household", NOW);
    if (bobInvite.kind !== "ok") throw new Error("mint failed");
    const bobSession = await createSession(h.env.TENANT_KV, "bob", "bob", NOW);
    await h.env.KROGER_KV.put("kroger:refresh:bob", "tok");

    // casey invites bob; bob accepts — confirm gate first.
    await sendRequest(h.env, { id: "casey", member: "casey" }, { tier: "household", handle: "bob" }, NOW);
    const invitation = (await listInbox(d, "bob", "bob"))[0];
    const gate = await acceptRequest(h.env, { id: "bob", member: "bob" }, invitation.id, {}, NOW + 1);
    expect(gate.kind).toBe("confirm_required");
    if (gate.kind === "confirm_required") {
      expect(gate.not_carried_over).toContain("pantry");
      expect(gate.not_carried_over).toContain("taste and dietary text"); // the v1 reduction, stated
      expect(gate.reconnect).toMatch(/re-connect/i);
    }
    // Nothing moved at the gate.
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "bob", tenant: "bob" }));

    const done = await acceptRequest(
      h.env,
      { id: "bob", member: "bob" },
      invitation.id,
      { confirm: true, display_name: "Bobby" },
      NOW + 2,
    );
    expect(done).toEqual({ kind: "ok" });

    // bob is a member of casey, id and handle unchanged.
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "bob", tenant: "casey", handle: "bob" }));
    // Grants re-keyed with the duplicate collapsed (first provenance wins).
    const imports = h.rows<{ recipe: string; tenant: string }>("recipe_imports");
    expect(imports.filter((r) => r.tenant === "bob")).toHaveLength(0);
    expect(imports.filter((r) => r.recipe === "shared-dish" && r.tenant === "casey")).toHaveLength(1);
    expect(imports).toContainEqual(expect.objectContaining({ recipe: "bobs-own", tenant: "casey" }));
    // Household rows purged; member rows survived in the absorber.
    expect(h.rows("pantry")).toHaveLength(0);
    // The old tenant retired: allowlist, registry, friendships, awaiting rows, invites.
    expect(await h.env.TENANT_KV.get("tenant:bob")).toBeNull();
    expect(h.rows("tenants").map((r) => (r as { id: string }).id)).not.toContain("bob");
    expect(await friendshipExists(d, "bob", "zoe")).toBe(false);
    const outgoing = h.rows<{ from_tenant: string; state: string }>("social_requests").filter(
      (r) => r.from_tenant === "bob" && r.state === "pending",
    );
    expect(outgoing).toHaveLength(0); // terminally resolved
    expect(await getInvite(d, bobInvite.token)).toBeNull(); // the tenant sweep removed it
    expect(await h.env.KROGER_KV.get("kroger:refresh:bob")).toBeNull();
    // bob's session survived, re-keyed to the absorbing household.
    expect((await readSession(h.env.TENANT_KV, bobSession))?.tenant).toBe("casey");
    // The mover's self-introduction seeded casey's nickname.
    expect(h.rows("nicknames")).toContainEqual(
      expect.objectContaining({ viewer_member: "casey", target_member: "bob", nickname: "Bobby" }),
    );
  });

  it("a mid-dissolution failure leaves the old tenant FULLY intact and the invitation retryable", async () => {
    const h = sqliteEnv(["casey", "bob"]);
    const d = db(h.env);
    h.raw.prepare("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')").run();
    await insertFoundingMember(d, "casey", NOW);
    await insertFoundingMember(d, "bob", NOW);
    h.raw.prepare("INSERT INTO pantry (tenant, name, normalized_name) VALUES ('bob', 'rice', 'rice')").run();
    h.raw
      .prepare("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES ('bobs-own', 'bob', 'bob', 'agent', '2026-01-01')")
      .run();
    await db(h.env).run("INSERT INTO tenants (id, created_at, via_code) VALUES ('bob', 1, NULL)");

    await sendRequest(h.env, { id: "casey", member: "casey" }, { tier: "household", handle: "bob" }, NOW);
    const invitation = (await listInbox(d, "bob", "bob"))[0];

    // Inject a failure into the dissolution batch's FIRST statement (the members
    // re-tenant) — the whole move+dissolve batch must roll back as one.
    h.raw.exec("CREATE TRIGGER fail_move BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT, 'injected'); END");
    await expect(
      acceptRequest(h.env, { id: "bob", member: "bob" }, invitation.id, { confirm: true }, NOW + 1),
    ).rejects.toMatchObject({ code: "storage_error" });

    // NOTHING dissolved: bob is still bob's (sole, live) member, household state and
    // grants untouched, registry + allowlist intact — no zero-member zombie tenant.
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "bob", tenant: "bob" }));
    expect(h.rows("pantry")).toHaveLength(1);
    expect(h.rows("recipe_imports")).toContainEqual(expect.objectContaining({ recipe: "bobs-own", tenant: "bob" }));
    expect(h.rows("tenants").map((r) => (r as { id: string }).id)).toContain("bob");
    expect(await h.env.TENANT_KV.get("tenant:bob")).not.toBeNull();
    // …and the invitation was REVERTED to pending (never consumed without the move).
    expect(await listInbox(d, "bob", "bob")).toHaveLength(1);

    // Clear the fault: the SAME invitation accepts cleanly (retryable end-to-end).
    h.raw.exec("DROP TRIGGER fail_move");
    expect(await acceptRequest(h.env, { id: "bob", member: "bob" }, invitation.id, { confirm: true }, NOW + 2)).toEqual(
      { kind: "ok" },
    );
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "bob", tenant: "casey" }));
    expect(h.rows("pantry")).toHaveLength(0);
    expect(await h.env.TENANT_KV.get("tenant:bob")).toBeNull();
  });

  it("a member of a multi-member household is refused with the leave-first pointer", async () => {
    const h = sqliteEnv(["casey", "pat"]);
    const d = db(h.env);
    h.raw.prepare("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')").run();
    await insertFoundingMember(d, "casey", NOW);
    await insertFoundingMember(d, "pat", NOW);
    await mint(h, "pat", "quinn_q"); // pat's household has two members

    await sendRequest(h.env, { id: "casey", member: "casey" }, { tier: "household", handle: "pat" }, NOW);
    const invitation = (await listInbox(d, "pat", "pat"))[0];
    const res = await acceptRequest(h.env, { id: "pat", member: "pat" }, invitation.id, { confirm: true }, NOW + 1);
    expect(res.kind).toBe("multi_member");
    // Nothing moved.
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: "pat", tenant: "pat" }));
  });

  it("evicting a member moves them into a spawn via the API-facing flow", async () => {
    const h = sqliteEnv(["casey"]);
    const d = db(h.env);
    await insertFoundingMember(d, "casey", NOW);
    const sam = await mint(h, "casey", "sam_j");
    const cookie = `__Host-session=${await createSession(h.env.TENANT_KV, "casey", "casey", NOW)}`;
    const res = await app.request(
      `http://127.0.0.1/api/people/members/${sam.id}/remove`,
      { method: "POST", headers: { "content-type": "application/json", ...CSRF, cookie }, body: "{}" },
      h.env,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { moved_to: string }).moved_to).toBe("sam_j");
    expect(h.rows("members")).toContainEqual(expect.objectContaining({ id: sam.id, tenant: "sam_j" }));
  });
});
