// Recipe-note visibility tiers (note-visibility-tiers, D30-final) over REAL migrated
// SQLite — the tier predicate, the members join, and the friend seam are genuine SQL
// here, not fake-d1 regex simulation. Covered: the own / same-household / friend /
// non-friend / anonymous × public / friends / private matrix under both deployment
// profiles; live-lens retroactivity (friendship insert/delete, re-tier); NULL-tier
// healing (rollback-window rows); the dual-write invariant (`private` always
// consistent with `tier` — the previous Worker's read stays correct); the handle
// join + fallback; the MCP tools' tier/alias contract and the write-side lens gate.
// Store notes stay on the binary private model (untouched — asserted last).

import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { registerNoteTools } from "../src/notes-tools.js";
import {
  readRecipeNotes,
  readPublicRecipeNotes,
  insertRecipeNote,
  updateRecipeNote,
  removeRecipeNote,
  readStoreNotes,
  insertStoreNote,
  type NoteTier,
} from "../src/corpus-db.js";
import { insertFoundingMember } from "../src/members-db.js";
import { db } from "../src/db.js";
import type { Tenant } from "../src/tenant.js";

const A = "casey"; // household A (the authoring household)
const A2 = "kid01"; // second member of household A (member id ≠ tenant id)
const B = "pat"; // household B — A's friend when the fixture says so
const C = "riley"; // household C — never A's friend

function setProfile(h: SqliteEnv, profile: "self-hosted" | "saas"): void {
  h.raw
    .prepare(
      "INSERT INTO operator_config (id, deployment_profile) VALUES (1, ?) " +
        "ON CONFLICT(id) DO UPDATE SET deployment_profile = excluded.deployment_profile",
    )
    .run(profile);
}

function grant(h: SqliteEnv, recipe: string, tenant: string): void {
  h.raw
    .prepare("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?, ?, ?, 'agent', '2026-01-01')")
    .run(recipe, tenant, tenant);
}

/** An ACCEPTED friendship edge, stored once as the canonically ordered pair. */
function befriend(h: SqliteEnv, x: string, y: string): void {
  const [a, b] = x < y ? [x, y] : [y, x];
  h.raw
    .prepare("INSERT INTO friendships (tenant_a, tenant_b, requested_by, created_at) VALUES (?, ?, ?, 1000)")
    .run(a, b, a);
}

function unfriend(h: SqliteEnv, x: string, y: string): void {
  const [a, b] = x < y ? [x, y] : [y, x];
  h.raw.prepare("DELETE FROM friendships WHERE tenant_a = ? AND tenant_b = ?").run(a, b);
}

/**
 * The shared fixture: "tacos" seeded + granted to every household (lens-visible to
 * all three — note visibility is then PURELY the tier rules), founding members for
 * A/B/C, a second member in household A, and three notes by A — one per tier.
 */
async function fixture(profile: "self-hosted" | "saas" = "saas"): Promise<SqliteEnv> {
  const h = sqliteEnv([A, B, C]);
  setProfile(h, profile);
  h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('tacos', 'Tacos')").run();
  for (const t of [A, B, C]) grant(h, "tacos", t);
  for (const [t, at] of [[A, 1000], [B, 2000], [C, 3000]] as const) await insertFoundingMember(db(h.env), t, at);
  h.raw.prepare("INSERT INTO members (id, tenant, handle, created_at) VALUES (?, ?, 'kiddo', 4000)").run(A2, A);
  await insertRecipeNote(h.env, "tacos", A, { created_at: "2026-06-01T00:00:00.000Z", body: "pub note", tags: [], tier: "public" });
  await insertRecipeNote(h.env, "tacos", A, { created_at: "2026-06-02T00:00:00.000Z", body: "fr note", tags: [], tier: "friends" });
  await insertRecipeNote(h.env, "tacos", A, { created_at: "2026-06-03T00:00:00.000Z", body: "priv note", tags: [], tier: "private" });
  return h;
}

const bodiesFor = async (h: SqliteEnv, member: string, tenant: string): Promise<string[]> =>
  (await readRecipeNotes(h.env, "tacos", { member, tenant })).map((n) => n.body);

describe("tier visibility matrix (SaaS)", () => {
  it("the author sees their own notes at every tier", async () => {
    const h = await fixture("saas");
    expect(await bodiesFor(h, A, A)).toEqual(["pub note", "fr note", "priv note"]);
  });

  it("a same-household member sees public + friends, never the author's private", async () => {
    const h = await fixture("saas");
    expect(await bodiesFor(h, A2, A)).toEqual(["pub note", "fr note"]);
  });

  it("a friend household's member sees public + friends", async () => {
    const h = await fixture("saas");
    befriend(h, A, B);
    expect(await bodiesFor(h, B, B)).toEqual(["pub note", "fr note"]);
  });

  it("a non-friend household's member sees only public", async () => {
    const h = await fixture("saas");
    expect(await bodiesFor(h, C, C)).toEqual(["pub note"]);
  });

  it("the anonymous read is tier-scoped in SQL: exactly the public tier", async () => {
    const h = await fixture("saas");
    const notes = await readPublicRecipeNotes(h.env, "tacos");
    expect(notes.map((n) => n.body)).toEqual(["pub note"]);
    expect(notes.every((n) => n.tier === "public")).toBe(true);
  });

  it("returns handle + tier + derived private on every note", async () => {
    const h = await fixture("saas");
    const [pub, fr, priv] = await readRecipeNotes(h.env, "tacos", { member: A, tenant: A });
    expect(pub).toMatchObject({ author: A, handle: A, tier: "public", private: false });
    expect(fr).toMatchObject({ tier: "friends", private: false });
    expect(priv).toMatchObject({ tier: "private", private: true });
  });

  it("the handle falls back to the author id when no member row resolves (never drops the note)", async () => {
    const h = await fixture("saas");
    h.raw.prepare("DELETE FROM members WHERE id = ?").run(A);
    const notes = await readRecipeNotes(h.env, "tacos", { member: A, tenant: A });
    expect(notes.map((n) => n.handle)).toEqual([A, A, A]);
  });
});

describe("tier visibility matrix (self-hosted)", () => {
  it("implicit all-to-all: every member sees friends-tier notes — the pre-tier shared read", async () => {
    const h = await fixture("self-hosted");
    expect(await bodiesFor(h, C, C)).toEqual(["pub note", "fr note"]);
    expect(await bodiesFor(h, B, B)).toEqual(["pub note", "fr note"]);
  });

  it("private stays author-only even under all-to-all (member-level, not household)", async () => {
    const h = await fixture("self-hosted");
    expect(await bodiesFor(h, A2, A)).toEqual(["pub note", "fr note"]);
    expect(await bodiesFor(h, A, A)).toContain("priv note");
  });

  it("the anonymous read is still public-only", async () => {
    const h = await fixture("self-hosted");
    expect((await readPublicRecipeNotes(h.env, "tacos")).map((n) => n.body)).toEqual(["pub note"]);
  });
});

describe("live-lens retroactivity", () => {
  it("a new friendship reveals existing friends notes on the very next read; severing hides them", async () => {
    const h = await fixture("saas");
    expect(await bodiesFor(h, B, B)).toEqual(["pub note"]);
    befriend(h, A, B);
    expect(await bodiesFor(h, B, B)).toEqual(["pub note", "fr note"]);
    unfriend(h, A, B);
    expect(await bodiesFor(h, B, B)).toEqual(["pub note"]);
  });

  it("re-tiering applies immediately in both directions", async () => {
    const h = await fixture("saas");
    // friends → public: the non-friend household sees it on the next read.
    expect(await updateRecipeNote(h.env, "tacos", A, "2026-06-02T00:00:00.000Z", { tier: "public" })).toBe("public");
    expect(await bodiesFor(h, C, C)).toEqual(["pub note", "fr note"]);
    // public → private: gone for everyone but the author.
    expect(await updateRecipeNote(h.env, "tacos", A, "2026-06-01T00:00:00.000Z", { tier: "private" })).toBe("private");
    expect(await bodiesFor(h, C, C)).toEqual(["fr note"]);
    expect(await bodiesFor(h, A, A)).toEqual(["pub note", "fr note", "priv note"]);
  });
});

describe("dual-write + NULL-tier healing (rollback safety)", () => {
  it("insert and update keep `private` consistent with `tier`", async () => {
    const h = await fixture("saas");
    const rows = () =>
      h.raw.prepare("SELECT tier, private FROM recipe_notes ORDER BY created_at").all() as { tier: string | null; private: number }[];
    expect(rows().map((r) => [r.tier, r.private])).toEqual([
      ["public", 0],
      ["friends", 0],
      ["private", 1],
    ]);
    await updateRecipeNote(h.env, "tacos", A, "2026-06-01T00:00:00.000Z", { tier: "private" });
    await updateRecipeNote(h.env, "tacos", A, "2026-06-03T00:00:00.000Z", { tier: "friends" });
    expect(rows().map((r) => [r.tier, r.private])).toEqual([
      ["private", 1],
      ["friends", 0],
      ["friends", 0],
    ]);
  });

  it("a previous Worker's read (private = 0 OR author = ?) never sees a tier-'private' note", async () => {
    const h = await fixture("saas");
    const legacy = h.raw
      .prepare("SELECT body FROM recipe_notes WHERE recipe = 'tacos' AND (private = 0 OR author = ?)")
      .all(C) as { body: string }[];
    expect(legacy.map((r) => r.body)).toEqual(["pub note", "fr note"]);
  });

  it("a NULL-tier row (written during a rollback window) heals via COALESCE: private=1 reads as private, else friends", async () => {
    const h = await fixture("saas");
    h.raw
      .prepare(
        "INSERT INTO recipe_notes (id, recipe, author, body, tags, private, created_at) VALUES " +
          "('pat tacos t9', 'tacos', ?, 'old-code shared', '[]', 0, '2026-06-09T00:00:00.000Z')," +
          "('pat tacos t10', 'tacos', ?, 'old-code secret', '[]', 1, '2026-06-10T00:00:00.000Z')",
      )
      .run(B, B);
    befriend(h, A, B);
    // A (friend of B) sees the NULL-tier shared row as friends; B's private row stays B's.
    const forA = await readRecipeNotes(h.env, "tacos", { member: A, tenant: A });
    expect(forA.find((n) => n.body === "old-code shared")).toMatchObject({ tier: "friends", private: false });
    expect(forA.some((n) => n.body === "old-code secret")).toBe(false);
    const forB = await readRecipeNotes(h.env, "tacos", { member: B, tenant: B });
    expect(forB.find((n) => n.body === "old-code secret")).toMatchObject({ tier: "private", private: true });
    // The first patch on a NULL-tier row heals the column itself (converge organically).
    expect(await updateRecipeNote(h.env, "tacos", B, "2026-06-09T00:00:00.000Z", { body: "healed" })).toBe("friends");
    const healed = h.raw.prepare("SELECT tier, private FROM recipe_notes WHERE id = 'pat tacos t9'").get() as {
      tier: string | null;
      private: number;
    };
    expect(healed).toEqual({ tier: "friends", private: 0 });
  });
});

describe("MCP tool contract (tier param, deprecated alias, write gate)", () => {
  function notesServer(h: SqliteEnv, tenant: Tenant): McpServer {
    const server = new McpServer({ name: "notes-test", version: "0.0.0" });
    registerNoteTools(server, tenant, { list: async () => [A, B, C] }, h.env);
    return server;
  }
  const asBody = (r: unknown): Record<string, unknown> => r as Record<string, unknown>;

  it("add_recipe_note defaults to friends and returns the tier; a stale plugin's private alias still works", async () => {
    const h = await fixture("saas");
    const server = notesServer(h, { id: B, member: B });
    // The note id keys on the server-minted created_at (ms precision) — space the
    // calls so same-ms invocations can't collide on the PK.
    const tick = () => new Promise((r) => setTimeout(r, 2));
    const [plain, aliasTrue, aliasFalse, both] = await withServer(server, async (c) => {
      const plain = await invokeTool(c, "add_recipe_note", { slug: "tacos", body: "defaulted" });
      await tick();
      const aliasTrue = await invokeTool(c, "add_recipe_note", { slug: "tacos", body: "alias secret", private: true });
      await tick();
      const aliasFalse = await invokeTool(c, "add_recipe_note", { slug: "tacos", body: "alias shared", private: false });
      await tick();
      const both = await invokeTool(c, "add_recipe_note", { slug: "tacos", body: "tier wins", private: true, tier: "public" });
      return [plain, aliasTrue, aliasFalse, both];
    });
    expect(asBody(plain.result).tier).toBe("friends");
    expect(asBody(aliasTrue.result).tier).toBe("private");
    expect(asBody(aliasFalse.result).tier).toBe("friends");
    expect(asBody(both.result).tier).toBe("public");
    const stored = h.raw.prepare("SELECT body, tier, private FROM recipe_notes WHERE author = ? ORDER BY created_at").all(B) as {
      body: string;
      tier: string;
      private: number;
    }[];
    expect(stored.map((r) => [r.body, r.tier, r.private])).toEqual([
      ["defaulted", "friends", 0],
      ["alias secret", "private", 1],
      ["alias shared", "friends", 0],
      ["tier wins", "public", 0],
    ]);
  });

  it("add_recipe_note is lens-gated: out-of-lens and nonexistent slugs return the identical not_found, and no row lands", async () => {
    const h = await fixture("saas");
    h.raw.prepare("INSERT INTO recipes (slug, title) VALUES ('b-only', 'B Only')").run();
    grant(h, "b-only", B); // visible to B, outside C's lens (no friendship)
    const server = notesServer(h, { id: C, member: C });
    const [hidden, missing] = await withServer(server, async (c) => [
      await invokeTool(c, "add_recipe_note", { slug: "b-only", body: "should not land" }),
      await invokeTool(c, "add_recipe_note", { slug: "no-such-dish", body: "should not land" }),
    ]);
    for (const [out, slug] of [
      [hidden, "b-only"],
      [missing, "no-such-dish"],
    ] as const) {
      expect(out.isError).toBe(true);
      expect(out.result).toEqual({ error: "not_found", message: `Unknown recipe slug: ${slug}`, slug });
    }
    expect(h.raw.prepare("SELECT COUNT(*) AS n FROM recipe_notes WHERE author = ?").get(C)).toEqual({ n: 0 });
  });

  it("update_recipe_note re-tiers via tier or the alias, stays self-scoped, and returns the resulting tier", async () => {
    const h = await fixture("saas");
    const server = notesServer(h, { id: A, member: A });
    const [retier, alias, notMine] = await withServer(server, async (c) => [
      await invokeTool(c, "update_recipe_note", { slug: "tacos", created_at: "2026-06-02T00:00:00.000Z", tier: "public" }),
      await invokeTool(c, "update_recipe_note", { slug: "tacos", created_at: "2026-06-01T00:00:00.000Z", private: true }),
      await invokeTool(c, "update_recipe_note", { slug: "tacos", created_at: "2099-01-01T00:00:00.000Z", body: "nope" }),
    ]);
    expect(asBody(retier.result).tier).toBe("public");
    expect(asBody(alias.result).tier).toBe("private");
    expect(notMine.isError).toBe(true);
    expect(asBody(notMine.result).error).toBe("not_found");
  });

  it("read_recipe_notes returns tier-shaped entries and never another member's private note", async () => {
    const h = await fixture("saas");
    befriend(h, A, B);
    const server = notesServer(h, { id: B, member: B });
    const [read] = await withServer(server, async (c) => [await invokeTool(c, "read_recipe_notes", { slug: "tacos" })]);
    const notes = (asBody(read.result).notes ?? []) as { body: string; handle: string; tier: NoteTier; private: boolean }[];
    expect(notes.map((n) => n.body)).toEqual(["pub note", "fr note"]);
    expect(notes[0]).toMatchObject({ handle: A, tier: "public", private: false });
    expect(notes.some((n) => n.private || n.tier === "private")).toBe(false);
  });
});

describe("note removal + store notes (untouched binary model)", () => {
  it("remove stays self-scoped", async () => {
    const h = await fixture("saas");
    expect(await removeRecipeNote(h.env, "tacos", B, "2026-06-01T00:00:00.000Z")).toBe(false);
    expect(await removeRecipeNote(h.env, "tacos", A, "2026-06-01T00:00:00.000Z")).toBe(true);
    expect(await bodiesFor(h, A, A)).toEqual(["fr note", "priv note"]);
  });

  it("store notes keep the binary own-private + group-shared read", async () => {
    const h = sqliteEnv([A, B]);
    await insertStoreNote(h.env, "west-7th", A, { created_at: "2026-06-01", body: "Aisle 7: baking", tags: ["layout"], private: false });
    await insertStoreNote(h.env, "west-7th", B, { created_at: "2026-06-02", body: "my coupon stash", tags: [], private: true });
    expect((await readStoreNotes(h.env, "west-7th", A)).map((n) => n.body)).toEqual(["Aisle 7: baking"]);
    expect((await readStoreNotes(h.env, "west-7th", B)).map((n) => n.body)).toContain("my coupon stash");
  });
});
