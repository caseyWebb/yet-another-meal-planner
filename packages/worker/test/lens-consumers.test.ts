// Per-consumer lens enforcement (deployment-profiles-and-visibility-lens): the 404-
// indistinguishability guarantee — out-of-lens and nonexistent slugs take the IDENTICAL
// not_found/404 path with NO R2 body read — asserted on each point-read consumer
// (readRecipeDetail, read_recipe_notes, /cookbook/<slug>, recipe_site_url), plus
// per-consumer invisibility for the whole-index and aggregate reads (loadRecipeIndex,
// the anonymous /cookbook index/search, notes aggregation, readNewForMe's member
// filter). Real migrated SQLite + a GET-counting R2 fake, so "no body read" is observed,
// not inferred.
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { fakeR2 } from "./fake-r2.js";
import { withServer, invokeTool } from "./tool-harness.js";
import { readRecipeDetail, buildServer } from "../src/tools.js";
import { registerNoteTools } from "../src/notes-tools.js";
import { handleCookbook } from "../src/cookbook.js";
import { loadRecipeIndex } from "../src/recipe-index.js";
import { readNewForMe } from "../src/discovery-db.js";
import { readRecipeNotes, insertRecipeNote } from "../src/corpus-db.js";
import { groupFavorites } from "../src/notes-tools.js";
import { CURATED_TENANT, memberViewer, lensHouseholds } from "../src/visibility.js";
import { insertFoundingMember } from "../src/members-db.js";
import { db } from "../src/db.js";
import { ToolError } from "../src/errors.js";
import type { Tenant } from "../src/tenant.js";

const A = "casey"; // the caller's household
const B = "pat"; // another household — never A's friend (the seam is empty)
const CALLER: Tenant = { id: A, member: A };

function recipeMd(title: string): string {
  return [
    "---",
    `title: ${title}`,
    "protein: fish",
    "time_total: 25",
    "---",
    "",
    "## Ingredients",
    "- fish",
    "",
    "## Instructions",
    "1. Cook it.",
    "",
  ].join("\n");
}

function seedRecipe(h: SqliteEnv, slug: string, discoveredAt: string | null = null): void {
  h.raw
    .prepare("INSERT INTO recipes (slug, title, discovered_at) VALUES (?, ?, ?)")
    .run(slug, slug.toUpperCase(), discoveredAt);
}

function grant(h: SqliteEnv, recipe: string, tenant: string, via = "agent"): void {
  h.raw
    .prepare("INSERT OR IGNORE INTO recipe_imports (recipe, tenant, member, via, imported_at) VALUES (?, ?, ?, ?, '2026-01-01')")
    .run(recipe, tenant, tenant, via);
}

function setProfile(h: SqliteEnv, profile: "self-hosted" | "saas"): void {
  h.raw
    .prepare(
      "INSERT INTO operator_config (id, deployment_profile) VALUES (1, ?) " +
        "ON CONFLICT(id) DO UPDATE SET deployment_profile = excluded.deployment_profile",
    )
    .run(profile);
}

/**
 * Wire a GET-counting R2 corpus onto the env: readRecipeDetail / the cookbook build their
 * own store from `env.CORPUS`, so counting THIS bucket's gets observes whether any body
 * read happened. Every slug gets a body — an out-of-lens slug's body exists, and the test
 * proves it is never touched.
 */
function armCorpus(h: SqliteEnv, slugs: string[]): { gets: () => number } {
  const files: Record<string, string> = {};
  for (const s of slugs) files[`recipes/${s}.md`] = recipeMd(s.toUpperCase());
  const r2 = fakeR2(files);
  let gets = 0;
  const bucket = r2.bucket as unknown as { get: (key: string) => Promise<unknown> };
  const realGet = bucket.get.bind(bucket);
  bucket.get = async (key: string) => {
    gets++;
    return realGet(key);
  };
  (h.env as unknown as { CORPUS: unknown }).CORPUS = r2.bucket;
  return { gets: () => gets };
}

/** The standard SaaS fixture: an own recipe, a hidden (other-household) recipe, a curated one. */
function saasFixture(h: SqliteEnv): { gets: () => number } {
  for (const s of ["own-dish", "hidden-dish", "curated-dish"]) seedRecipe(h, s);
  grant(h, "own-dish", A);
  grant(h, "hidden-dish", B);
  grant(h, "curated-dish", CURATED_TENANT, "curated");
  setProfile(h, "saas");
  return armCorpus(h, ["own-dish", "hidden-dish", "curated-dish"]);
}

async function toolError(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError);
    return e as ToolError;
  }
  throw new Error("expected a ToolError");
}

describe("readRecipeDetail — 404 indistinguishability, no R2 read", () => {
  it("out-of-lens and nonexistent slugs throw byte-identical not_found shapes with ZERO body reads", async () => {
    const h = sqliteEnv([A, B]);
    const corpus = saasFixture(h);
    const hidden = await toolError(readRecipeDetail(h.env, A, "hidden-dish"));
    const missing = await toolError(readRecipeDetail(h.env, A, "no-such-dish"));
    for (const [err, slug] of [
      [hidden, "hidden-dish"],
      [missing, "no-such-dish"],
    ] as const) {
      expect(err.code).toBe("not_found");
      expect(err.message).toBe(`Unknown recipe slug: ${slug}`);
      expect(err.context).toEqual({ slug });
    }
    // The serialized shapes differ ONLY by the slug the caller supplied.
    expect(Object.keys(hidden.toShape())).toEqual(Object.keys(missing.toShape()));
    // The lens gate ran BEFORE existence disclosure: hidden-dish's body was never fetched.
    expect(corpus.gets()).toBe(0);
  });

  it("a lens-visible slug still reads normally (the positive control)", async () => {
    const h = sqliteEnv([A, B]);
    const corpus = saasFixture(h);
    const detail = await readRecipeDetail(h.env, A, "own-dish");
    expect(detail.slug).toBe("own-dish");
    expect(detail.frontmatter.title).toBe("OWN-DISH");
    expect(corpus.gets()).toBe(1);
  });
});

describe("read_recipe_notes — lens gate before any note disclosure", () => {
  function notesServer(h: SqliteEnv, tenant: Tenant): McpServer {
    const server = new McpServer({ name: "notes-test", version: "0.0.0" });
    registerNoteTools(server, tenant, { list: async () => [A, B] }, h.env);
    return server;
  }

  it("out-of-lens and nonexistent slugs return the identical structured not_found; no note leaks", async () => {
    const h = sqliteEnv([A, B]);
    saasFixture(h);
    await insertFoundingMember(db(h.env), A, 1000);
    await insertFoundingMember(db(h.env), B, 2000);
    // A shared note on the hidden recipe — it must never be disclosed to A.
    await insertRecipeNote(h.env, "hidden-dish", B, { created_at: "2026-06-01", body: "secret spin", tags: [], tier: "friends" });
    const server = notesServer(h, CALLER);
    const [hidden, missing] = await withServer(server, async (c) => [
      await invokeTool(c, "read_recipe_notes", { slug: "hidden-dish" }),
      await invokeTool(c, "read_recipe_notes", { slug: "no-such-dish" }),
    ]);
    for (const [out, slug] of [
      [hidden, "hidden-dish"],
      [missing, "no-such-dish"],
    ] as const) {
      expect(out.isError).toBe(true);
      expect(out.result).toEqual({ error: "not_found", message: `Unknown recipe slug: ${slug}`, slug });
    }
  });

  it("SaaS aggregation excludes a non-lens household's shared note AND favorite; self-hosted includes them", async () => {
    const h = sqliteEnv([A, B]);
    // Both households hold grants on the same recipe — visible to both, but B is not in
    // A's lens (the empty friend seam), so B's activity is outside A's group signal.
    seedRecipe(h, "shared-dish");
    grant(h, "shared-dish", A);
    grant(h, "shared-dish", B);
    await insertFoundingMember(db(h.env), A, 1000);
    await insertFoundingMember(db(h.env), B, 2000);
    await insertRecipeNote(h.env, "shared-dish", B, { created_at: "2026-06-01", body: "pat's shared tip", tags: [], tier: "friends" });
    h.raw.exec("INSERT INTO overlay (tenant, recipe, favorite) VALUES ('pat', 'shared-dish', 1)");

    // Self-hosted (default profile): the lens households are "everyone" — B contributes.
    const lensAll = await lensHouseholds(h.env, A);
    expect(lensAll).toBeNull();
    expect((await readRecipeNotes(h.env, "shared-dish", { member: A, tenant: A })).map((n) => n.body)).toEqual(["pat's shared tip"]);
    expect(await groupFavorites(h.env, "shared-dish", [A, B])).toEqual([{ author: B }]);

    // SaaS: the lens is A's household only — B's note and favorite vanish from the aggregate.
    setProfile(h, "saas");
    const lensOwn = await lensHouseholds(h.env, A);
    expect(lensOwn).toEqual([A]);
    expect(await readRecipeNotes(h.env, "shared-dish", { member: A, tenant: A })).toEqual([]);
    expect(await groupFavorites(h.env, "shared-dish", lensOwn!)).toEqual([]);
  });
});

describe("/cookbook — the anonymous bottom position", () => {
  const get = (path: string) => new Request(`https://yamp.example.com${path}`);

  it("SaaS: index, ?q= page, and search JSON are curated-only", async () => {
    const h = sqliteEnv([A, B]);
    saasFixture(h);
    const index = await (await handleCookbook(get("/cookbook"), h.env)).text();
    expect(index).toContain("curated-dish");
    expect(index).not.toContain("own-dish");
    expect(index).not.toContain("hidden-dish");
    // The server-rendered ?q= page and the JSON endpoint share the same lens'd candidate set.
    const q = await (await handleCookbook(get("/cookbook?q=dish"), h.env)).text();
    expect(q).toContain("curated-dish");
    expect(q).not.toContain("hidden-dish");
    const json = (await (await handleCookbook(get("/cookbook/search?q=dish"), h.env)).json()) as {
      results: Array<{ slug: string }>;
    };
    expect(json.results.map((r) => r.slug)).toEqual(["curated-dish"]);
  });

  it("out-of-lens and nonexistent slugs 404 with byte-identical bodies and no R2 read", async () => {
    const h = sqliteEnv([A, B]);
    const corpus = saasFixture(h);
    const hidden = await handleCookbook(get("/cookbook/hidden-dish"), h.env);
    const missing = await handleCookbook(get("/cookbook/no-such-dish"), h.env);
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
    expect(corpus.gets()).toBe(0); // the lens gate ran before the body read
  });

  it("self-hosted parity: every attached recipe renders on index, search, and detail", async () => {
    const h = sqliteEnv([A, B]);
    for (const s of ["own-dish", "hidden-dish"]) seedRecipe(h, s);
    grant(h, "own-dish", A);
    grant(h, "hidden-dish", B); // any household's grant admits the anonymous reader
    armCorpus(h, ["own-dish", "hidden-dish"]);
    const index = await (await handleCookbook(get("/cookbook"), h.env)).text();
    expect(index).toContain("own-dish");
    expect(index).toContain("hidden-dish");
    const detail = await handleCookbook(get("/cookbook/hidden-dish"), h.env);
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("HIDDEN-DISH");
  });
});

describe("loadRecipeIndex — the whole-index consumers' shared gate", () => {
  it("a SaaS member's index carries own + curated and NOT another household's recipe", async () => {
    const h = sqliteEnv([A, B]);
    saasFixture(h);
    const index = await loadRecipeIndex(h.env, memberViewer(A));
    expect(Object.keys(index).sort()).toEqual(["curated-dish", "own-dish"]);
  });
});

describe("readNewForMe — per-MEMBER attribution within the household", () => {
  it("match rows for member A never surface for member B of the same household", async () => {
    const h = sqliteEnv([A]);
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    seedRecipe(h, "for-casey", recent);
    seedRecipe(h, "for-alex", recent);
    grant(h, "for-casey", A);
    grant(h, "for-alex", A);
    h.raw.exec(
      "INSERT INTO discovery_matches (recipe, tenant, member, score, matched_at) VALUES " +
        `('for-casey', '${A}', 'casey', 0.8, '${recent}'), ('for-alex', '${A}', 'alex', 0.8, '${recent}')`,
    );
    const floor = new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10);
    expect((await readNewForMe(h.env, A, "casey", floor)).map((r) => r.slug)).toEqual(["for-casey"]);
    expect((await readNewForMe(h.env, A, "alex", floor)).map((r) => r.slug)).toEqual(["for-alex"]);
  });
});

describe("recipe_site_url — the lens-aware link matrix (through the real buildServer)", () => {
  async function invoke(h: SqliteEnv, args: Record<string, unknown>) {
    const server = buildServer(h.env, CALLER, "https://yamp.example.com");
    return withServer(server, (c) => invokeTool(c, "recipe_site_url", args));
  }

  it("no-arg root; public scope for anonymously-visible; member scope for caller-only; not_found beyond the lens", async () => {
    const h = sqliteEnv([A, B]);
    saasFixture(h);

    const root = await invoke(h, {});
    expect(root.result).toEqual({ url: "https://yamp.example.com/cookbook", enabled: true });

    // Curated → inside the anonymous lens → the public link that never 404s for a visitor.
    const pub = await invoke(h, { slug: "curated-dish" });
    expect(pub.result).toEqual({ url: "https://yamp.example.com/cookbook/curated-dish", enabled: true, scope: "public" });

    // Own grant, not anonymous → the member app detail link, never a broken public link.
    const member = await invoke(h, { slug: "own-dish" });
    expect(member.result).toEqual({ url: "https://yamp.example.com/recipe/own-dish", enabled: true, scope: "member" });

    // Out-of-lens and nonexistent are the same structured not_found (no slug oracle).
    const hidden = await invoke(h, { slug: "hidden-dish" });
    const missing = await invoke(h, { slug: "no-such-dish" });
    expect(hidden.isError).toBe(true);
    expect(hidden.result).toEqual({ error: "not_found", message: "Unknown recipe slug: hidden-dish", slug: "hidden-dish" });
    expect(missing.result).toEqual({ error: "not_found", message: "Unknown recipe slug: no-such-dish", slug: "no-such-dish" });
  });
});
