// The D24 engine (households-friends-and-people-page §3): invisible declines, the
// 30-day cooldown, the swallow paths, the standing cap, household-wide blocks, the
// friend seam's live lens behavior, per-member inbox scoping, and the self-hosted
// friend-tier refusal — over the REAL migration chain.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import { insertFoundingMember, insertMember, type MemberRow } from "../src/members-db.js";
import type { Tenant } from "../src/tenant.js";
import {
  sendRequest,
  acceptRequest,
  declineRequest,
  cancelRequest,
  blockFromRequest,
  blockFriend,
  unblock,
  unfriend,
  setNickname,
  lookupHandle,
  assemblePeople,
  underPeopleLimit,
  OUTGOING_CAP,
  DECLINE_COOLDOWN_MS,
  LOOKUP_BUDGET,
} from "../src/social.js";
import { listInbox, insertRequest, friendshipExists } from "../src/social-db.js";
import { friendHouseholds, visibleSlugs, memberViewer } from "../src/visibility.js";

const NOW = 1_800_000_000_000;

interface World {
  h: SqliteEnv;
  casey: Tenant; // household A, founding member
  sam: Tenant; // household A, second member (ULID)
  pat: Tenant; // household B, founding member
  quinn: Tenant; // household B, second member (ULID)
  dana: Tenant; // household C, sole member
}

/** Three households on a SaaS deployment: casey+sam / pat+quinn / dana. */
async function world(): Promise<World> {
  const h = sqliteEnv(["casey", "pat", "dana"]);
  const d = db(h.env);
  h.raw.prepare("INSERT INTO operator_config (id, deployment_profile) VALUES (1, 'saas')").run();
  for (const t of ["casey", "pat", "dana"]) await insertFoundingMember(d, t, NOW);
  const mint = async (tenant: string, handle: string): Promise<MemberRow> => {
    const res = await insertMember(d, tenant, handle, NOW);
    if (res.kind !== "ok") throw new Error("mint failed");
    return res.member;
  };
  const sam = await mint("casey", "sam_j");
  const quinn = await mint("pat", "quinn_q");
  return {
    h,
    casey: { id: "casey", member: "casey" },
    sam: { id: "casey", member: sam.id },
    pat: { id: "pat", member: "pat" },
    quinn: { id: "pat", member: quinn.id },
    dana: { id: "dana", member: "dana" },
  };
}

/** The requester's view of their outgoing surface, as the wire would carry it. */
async function requesterView(h: SqliteEnv, viewer: Tenant): Promise<string> {
  const payload = await assemblePeople(h.env, viewer, NOW);
  return JSON.stringify(payload.awaiting);
}

describe("decline invisibility (D24)", () => {
  it("the requester's view is byte-identical before and after a decline", async () => {
    const w = await world();
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW)).toEqual({ kind: "ok" });
    const before = await requesterView(w.h, w.casey);

    const inbox = await listInbox(db(w.h.env), "pat", "pat");
    expect(inbox).toHaveLength(1);
    expect(await declineRequest(w.h.env, w.pat, inbox[0].id, NOW + 1000)).toEqual({ kind: "ok" });

    const after = await requesterView(w.h, w.casey);
    expect(after).toBe(before); // BYTE-identical — no field, count, or shape moved
    // …and the decliner's inbox is simply empty (locally unceremonious).
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
  });

  it("awaiting rows carry no state field at all", async () => {
    const w = await world();
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const payload = await assemblePeople(w.h.env, w.casey, NOW);
    expect(payload.awaiting.requests[0]).toEqual({
      id: expect.any(String),
      tier: "friend",
      to_handle: "pat",
      created_at: NOW,
    });
  });
});

describe("send responses are one shape (D24)", () => {
  it("fresh, duplicate-pending, cooldown-swallowed, and block-swallowed sends answer identically", async () => {
    const w = await world();
    const fresh = await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const dup = await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW + 1);
    // dana declines casey, then casey re-sends inside the cooldown.
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "dana" }, NOW);
    const danaInbox = await listInbox(db(w.h.env), "dana", "dana");
    await declineRequest(w.h.env, w.dana, danaInbox[0].id, NOW + 2);
    const cooled = await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "dana" }, NOW + 3);
    // pat's household blocks sam's household on the household tier, sam invites quinn.
    await sendRequest(w.h.env, w.sam, { tier: "household", handle: "quinn_q" }, NOW);
    const quinnInbox = await listInbox(db(w.h.env), "pat", w.quinn.member);
    await blockFromRequest(w.h.env, w.quinn, quinnInbox[0].id, NOW + 4);
    const blocked = await sendRequest(w.h.env, w.sam, { tier: "household", handle: "quinn_q" }, NOW + 5);

    expect(JSON.stringify(dup)).toBe(JSON.stringify(fresh));
    expect(JSON.stringify(cooled)).toBe(JSON.stringify(fresh));
    expect(JSON.stringify(blocked)).toBe(JSON.stringify(fresh));
  });
});

describe("the 30-day cooldown", () => {
  it("a re-send inside the window swallows (no inbox row, no note); after the window it delivers", async () => {
    const w = await world();
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat", note: "hi!" }, NOW);
    const first = await listInbox(db(w.h.env), "pat", "pat");
    await declineRequest(w.h.env, w.pat, first[0].id, NOW + 1000);

    // 10 days later: appears to succeed, reaches nobody, note never delivered.
    const t10 = NOW + 10 * 24 * 60 * 60 * 1000;
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat", note: "again" }, t10)).toEqual({
      kind: "ok",
    });
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    expect(await listInbox(db(w.h.env), "pat", w.quinn.member)).toHaveLength(0);
    const swallowed = w.h.rows<{ state: string; note: string | null }>("social_requests").filter((r) => r.state === "swallowed");
    expect(swallowed).toHaveLength(1);

    // Past the cooldown: the send delivers again.
    const t31 = NOW + 1000 + DECLINE_COOLDOWN_MS + 1;
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, t31)).toEqual({ kind: "ok" });
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(1);
  });

  it("cancelling a declined row does not erase the decliner's cooldown", async () => {
    const w = await world();
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", "pat");
    await declineRequest(w.h.env, w.pat, inbox[0].id, NOW + 1000);
    // The requester cancels their (still pending-looking) row, then re-sends.
    const mine = (await assemblePeople(w.h.env, w.casey, NOW)).awaiting.requests;
    expect(await cancelRequest(w.h.env, w.casey, mine[0].id)).toEqual({ kind: "ok" });
    const t10 = NOW + 10 * 24 * 60 * 60 * 1000;
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, t10)).toEqual({ kind: "ok" });
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0); // still swallowed
  });
});

describe("the standing cap", () => {
  it("counts pending + declined + swallowed alike, and cancel frees a slot", async () => {
    const w = await world();
    const d = db(w.h.env);
    // Fill casey's cap with a mix of visible states (direct inserts — the states are
    // indistinguishable to casey by construction).
    for (let i = 0; i < OUTGOING_CAP; i++) {
      const state = i % 3 === 0 ? "pending" : i % 3 === 1 ? "declined" : "swallowed";
      await insertRequest(d, {
        id: `seed${i}`,
        tier: "friend",
        from_tenant: "casey",
        from_member: "casey",
        to_tenant: `other${i}`,
        to_member: `other${i}`,
        note: null,
        display_name: null,
        state,
        created_at: NOW,
        resolved_at: state === "pending" ? null : NOW,
      });
    }
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW + 1)).toEqual({
      kind: "cap_reached",
    });
    // Cancelling ANY visible row — a swallowed one included — frees a slot, silently.
    expect(await cancelRequest(w.h.env, w.casey, "seed2")).toEqual({ kind: "ok" }); // a swallowed row
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW + 2)).toEqual({ kind: "ok" });
  });
});

describe("blocks bind the household", () => {
  it("one member's block swallows a request re-addressed to a DIFFERENT member", async () => {
    const w = await world();
    // casey sends a friend request to pat; QUINN blocks from the inbox row.
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", w.quinn.member);
    expect(inbox).toHaveLength(1); // a friend request reaches every household member
    await blockFromRequest(w.h.env, w.quinn, inbox[0].id, NOW + 1);
    // The pending row was swallowed at block time; the requester's view is unchanged.
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    expect((await assemblePeople(w.h.env, w.casey, NOW)).awaiting.requests).toHaveLength(1);
    // Re-addressing the request to the OTHER member of the household swallows too.
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "quinn_q" }, NOW + 2)).toEqual({ kind: "ok" });
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    expect(await listInbox(db(w.h.env), "pat", w.quinn.member)).toHaveLength(0);
  });

  it("block-from-awaiting cancels the household's own outgoing request", async () => {
    const w = await world();
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const mine = (await assemblePeople(w.h.env, w.casey, NOW)).awaiting.requests;
    await blockFromRequest(w.h.env, w.casey, mine[0].id, NOW + 1);
    // The outgoing row is cancelled (gone from awaiting) and pat's inbox is empty.
    expect((await assemblePeople(w.h.env, w.casey, NOW)).awaiting.requests).toHaveLength(0);
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    // And future requests FROM pat's household swallow.
    await sendRequest(w.h.env, w.pat, { tier: "friend", handle: "casey" }, NOW + 2);
    expect(await listInbox(db(w.h.env), "casey", "casey")).toHaveLength(0);
  });

  it("unblock delivers nothing retroactively; new sends deliver again", async () => {
    const w = await world();
    await blockFriend(w.h.env, w.pat, "casey", NOW); // friend-tier block (no prior edge)
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW + 1);
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    await unblock(w.h.env, w.pat, "friend", "casey");
    // The swallowed row stays swallowed forever.
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    // A fresh send now delivers (no decline ever happened — no cooldown).
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW + 2);
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(1);
  });
});

describe("friendships and the live lens", () => {
  async function seedRecipeWithGrant(h: SqliteEnv, slug: string, tenant: string): Promise<void> {
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES (?, ?)").run(slug, slug);
    h.raw
      .prepare("INSERT INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?, ?, ?, 'agent', '2026-01-01')")
      .run(slug, tenant, tenant);
  }

  it("any member's accept mints the edge and grants immediate mutual visibility; sever hides; re-accept restores", async () => {
    const w = await world();
    await seedRecipeWithGrant(w.h, "pats-stew", "pat");
    await seedRecipeWithGrant(w.h, "caseys-tacos", "casey");

    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", w.quinn.member);
    // QUINN (non-founding) accepts — household authority.
    expect(await acceptRequest(w.h.env, w.quinn, inbox[0].id, {}, NOW + 1)).toEqual({ kind: "ok" });
    expect(await friendshipExists(db(w.h.env), "casey", "pat")).toBe(true);
    // The request resolved for the whole household.
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0);
    // The unchanged seam provider now feeds the lens: mutual visibility on the next read.
    expect(await friendHouseholds(w.h.env, "casey")).toEqual(["pat"]);
    expect(await visibleSlugs(w.h.env, memberViewer("casey"))).toContain("pats-stew");
    expect(await visibleSlugs(w.h.env, memberViewer("pat"))).toContain("caseys-tacos");

    // Sever (unfriend): hidden on the NEXT read, no notification anywhere.
    await unfriend(w.h.env, w.pat, "casey");
    expect(await visibleSlugs(w.h.env, memberViewer("casey"))).not.toContain("pats-stew");
    expect(await visibleSlugs(w.h.env, memberViewer("pat"))).not.toContain("caseys-tacos");

    // Re-request + accept restores (no block, no cooldown — a plain unfriend).
    await sendRequest(w.h.env, w.pat, { tier: "friend", handle: "sam_j" }, NOW + 2);
    const caseyInbox = await listInbox(db(w.h.env), "casey", "casey");
    expect(await acceptRequest(w.h.env, w.casey, caseyInbox[0].id, {}, NOW + 3)).toEqual({ kind: "ok" });
    expect(await visibleSlugs(w.h.env, memberViewer("casey"))).toContain("pats-stew");
  });

  it("blocking from a friend row severs the edge in the same operation", async () => {
    const w = await world();
    await seedRecipeWithGrant(w.h, "pats-stew", "pat");
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", "pat");
    await acceptRequest(w.h.env, w.pat, inbox[0].id, {}, NOW + 1);
    expect(await visibleSlugs(w.h.env, memberViewer("casey"))).toContain("pats-stew");

    await blockFriend(w.h.env, w.casey, "pat", NOW + 2);
    expect(await friendshipExists(db(w.h.env), "casey", "pat")).toBe(false);
    expect(await visibleSlugs(w.h.env, memberViewer("casey"))).not.toContain("pats-stew");
    // …and pat's future friend requests to casey's household swallow.
    await sendRequest(w.h.env, w.pat, { tier: "friend", handle: "casey" }, NOW + 3);
    expect(await listInbox(db(w.h.env), "casey", "casey")).toHaveLength(0);
  });
});

describe("request scoping", () => {
  it("a household invitation is visible ONLY to the invitee, and only their accept acts", async () => {
    const w = await world();
    await sendRequest(w.h.env, w.casey, { tier: "household", handle: "quinn_q" }, NOW);
    expect(await listInbox(db(w.h.env), "pat", w.quinn.member)).toHaveLength(1);
    expect(await listInbox(db(w.h.env), "pat", "pat")).toHaveLength(0); // NOT pat's row
    const row = (await listInbox(db(w.h.env), "pat", w.quinn.member))[0];
    // pat (not the invitee) cannot accept or decline it.
    expect(await acceptRequest(w.h.env, w.pat, row.id, { confirm: true }, NOW + 1)).toEqual({ kind: "not_found" });
    expect(await declineRequest(w.h.env, w.pat, row.id, NOW + 1)).toEqual({ kind: "not_found" });
  });

  it("honest errors: own household, already friends, unknown handle", async () => {
    const w = await world();
    expect(await sendRequest(w.h.env, w.casey, { tier: "household", handle: "sam_j" }, NOW)).toEqual({
      kind: "own_household",
    });
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "nobody" }, NOW)).toEqual({
      kind: "not_found",
    });
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", "pat");
    await acceptRequest(w.h.env, w.pat, inbox[0].id, {}, NOW + 1);
    expect(await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "quinn_q" }, NOW + 2)).toEqual({
      kind: "already_friends",
    });
  });

  it("notes are capped and stored as inert text; swallowed notes reach no read", async () => {
    const w = await world();
    expect(
      (await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat", note: "x".repeat(201) }, NOW)).kind,
    ).toBe("validation_failed");
    const md = "**markdown** [link](https://x)";
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat", note: md }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", "pat");
    expect(inbox[0].note).toBe(md); // verbatim inert text — rendering never interprets it
    // Block, then a swallowed note must never surface in ANY aggregate.
    await blockFromRequest(w.h.env, w.pat, inbox[0].id, NOW + 1);
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat", note: "SECRET-NOTE" }, NOW + 2);
    for (const viewer of [w.pat, w.quinn]) {
      const payload = JSON.stringify(await assemblePeople(w.h.env, viewer, NOW + 3));
      expect(payload).not.toContain("SECRET-NOTE");
    }
  });
});

describe("nickname seeding and privacy", () => {
  it("a friend accept seeds the display name for viewers WITHOUT an existing alias", async () => {
    const w = await world();
    // quinn already calls casey "Neighbor".
    await setNickname(w.h.env, w.quinn, "casey", "Neighbor", NOW);
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat", display_name: "Casey K." }, NOW);
    const inbox = await listInbox(db(w.h.env), "pat", "pat");
    await acceptRequest(w.h.env, w.pat, inbox[0].id, {}, NOW + 1);
    // pat (no alias) got the seed; quinn's existing alias is untouched.
    const patView = await assemblePeople(w.h.env, w.pat, NOW + 2);
    expect(patView.friends[0].nickname).toBe("Casey K.");
    const quinnView = await assemblePeople(w.h.env, w.quinn, NOW + 2);
    expect(quinnView.friends[0].nickname).toBe("Neighbor");
  });

  it("nicknames are never disclosed to their subject or a third member", async () => {
    const w = await world();
    await setNickname(w.h.env, w.casey, w.sam.member, "Mom", NOW);
    // sam's own reads never contain it.
    const samView = JSON.stringify(await assemblePeople(w.h.env, w.sam, NOW));
    expect(samView).not.toContain("Mom");
    // casey sees it.
    const caseyView = await assemblePeople(w.h.env, w.casey, NOW);
    expect(caseyView.members.find((m) => m.id === w.sam.member)?.nickname).toBe("Mom");
    // self-nicknames refused; empty-save clears.
    expect((await setNickname(w.h.env, w.casey, "casey", "Me", NOW)).kind).toBe("self");
    expect((await setNickname(w.h.env, w.casey, w.sam.member, "", NOW)).kind).toBe("ok");
    expect((await assemblePeople(w.h.env, w.casey, NOW)).members.find((m) => m.id === w.sam.member)?.nickname).toBeNull();
  });
});

describe("the self-hosted profile gate", () => {
  it("friend-tier lookup/send/accept refuse; household tier works unchanged", async () => {
    const w = await world();
    // Mint a pending friend request while SaaS, then flip the profile.
    await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "pat" }, NOW);
    const pending = (await listInbox(db(w.h.env), "pat", "pat"))[0];
    w.h.raw.prepare("UPDATE operator_config SET deployment_profile = 'self-hosted' WHERE id = 1").run();

    expect(await lookupHandle(w.h.env, "friend", "pat")).toEqual({ kind: "profile_disabled" });
    expect((await sendRequest(w.h.env, w.casey, { tier: "friend", handle: "dana" }, NOW + 1)).kind).toBe(
      "profile_disabled",
    );
    expect((await acceptRequest(w.h.env, w.pat, pending.id, {}, NOW + 2)).kind).toBe("profile_disabled");

    // Household tier is unaffected.
    expect((await lookupHandle(w.h.env, "household", "quinn_q")).kind).toBe("found");
    expect(await sendRequest(w.h.env, w.casey, { tier: "household", handle: "quinn_q" }, NOW + 3)).toEqual({
      kind: "ok",
    });
    // …and the aggregate serves no friend-tier data.
    const payload = await assemblePeople(w.h.env, w.pat, NOW + 4);
    expect(payload.profile).toBe("self-hosted");
    expect(payload.friends).toEqual([]);
    expect(payload.inbox.every((r) => r.tier === "household")).toBe(true);
  });
});

describe("the shared limiter", () => {
  it("both keys must admit, and the limiter fails OPEN on storage errors", async () => {
    const w = await world();
    for (let i = 0; i < LOOKUP_BUDGET.max; i++) {
      expect(await underPeopleLimit(w.h.env, "lookup", "casey", "1.2.3.4", NOW + i)).toBe(true);
    }
    // The member key is exhausted — a different IP doesn't help.
    expect(await underPeopleLimit(w.h.env, "lookup", "casey", "9.9.9.9", NOW + 100)).toBe(false);
    // A different member from the SAME first IP: the IP key is exhausted too.
    expect(await underPeopleLimit(w.h.env, "lookup", "pat", "1.2.3.4", NOW + 101)).toBe(false);

    // Fail-open: a throwing KV never rejects a legitimate call.
    const broken = {
      ...w.h.env,
      KROGER_KV: {
        get: async () => {
          throw new Error("kv down");
        },
        put: async () => {
          throw new Error("kv down");
        },
      } as unknown as KVNamespace,
    };
    expect(await underPeopleLimit(broken as typeof w.h.env, "lookup", "casey", "1.2.3.4", NOW)).toBe(true);
  });
});
