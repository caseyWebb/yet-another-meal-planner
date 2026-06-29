import { describe, it, expect } from "vitest";
import {
  recipeList,
  recipeDetail,
  memberDetail,
  readTable,
  guidanceListing,
  guidanceObject,
} from "../src/admin-data.js";
import type { Env } from "../src/env.js";
import { fakeD1 } from "./fake-d1.js";
import { fakeR2 } from "./fake-r2.js";

/** Build an Env over an in-memory D1 + R2 corpus for the explorer reads. */
function makeEnv(opts: { tables?: Record<string, Record<string, unknown>[]>; r2?: Record<string, string> } = {}) {
  const d1 = fakeD1({ tables: opts.tables });
  const r2 = fakeR2(opts.r2 ?? {});
  const env = { ...d1.env, CORPUS: r2.bucket } as unknown as Env;
  return { env, d1, r2 };
}

describe("recipeDetail — cross-tier projection status", () => {
  it("indexed: R2 source + a recipes row", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo" }], recipe_derived: [{ slug: "foo", description: "A dish.", embedding: "[0.1]" }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.status).toBe("indexed");
    expect(d.source).toBe("# Foo");
    expect(d.projection).toMatchObject({ slug: "foo", title: "Foo" });
    expect(d.derived).toEqual({ description: "A dish.", has_embedding: true, state: "described" });
    expect(d.reconcile_message).toBeNull();
  });

  it("skipped: R2 source, no recipes row, carries the reconcile reason", async () => {
    const { env } = makeEnv({
      tables: { reconcile_errors: [{ slug: "bar", path: "recipes/bar.md", message: 'cuisine "tex-mex" is not in the vocab', recorded_at: "2026-06-27" }] },
      r2: { "recipes/bar.md": "# Bar" },
    });
    const d = await recipeDetail(env, "bar");
    expect(d.status).toBe("skipped");
    expect(d.projection).toBeNull();
    expect(d.reconcile_message).toBe('cuisine "tex-mex" is not in the vocab');
  });

  it("pending: R2 source, no recipes row, no reconcile entry", async () => {
    const { env } = makeEnv({ r2: { "recipes/baz.md": "# Baz" } });
    const d = await recipeDetail(env, "baz");
    expect(d.status).toBe("pending");
    expect(d.reconcile_message).toBeNull();
  });

  it("orphaned: a recipes row with no R2 source", async () => {
    const { env } = makeEnv({ tables: { recipes: [{ slug: "qux", title: "Qux" }] } });
    const d = await recipeDetail(env, "qux");
    expect(d.status).toBe("orphaned");
    expect(d.source).toBeNull();
  });

  it("not_found: neither tier has the slug", async () => {
    const { env } = makeEnv();
    await expect(recipeDetail(env, "ghost")).rejects.toMatchObject({ code: "not_found" });
  });

  it("derived state is pending when the description is null", async () => {
    const { env } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo" }], recipe_derived: [{ slug: "foo", description: null, embedding: null }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.derived).toEqual({ description: null, has_embedding: false, state: "pending" });
  });
});

describe("recipeDetail — body (frontmatter-stripped, for client rendering)", () => {
  it("strips the YAML frontmatter fence, leaving the body; raw source unchanged", async () => {
    const src = "---\ntitle: Foo\ncuisine: italian\n---\n## Ingredients\n- eggs\n\n## Instructions\n1. Cook.\n";
    const { env } = makeEnv({ tables: { recipes: [{ slug: "foo", title: "Foo" }] }, r2: { "recipes/foo.md": src } });
    const d = await recipeDetail(env, "foo");
    expect(d.source).toBe(src);
    expect(d.body).toBe("## Ingredients\n- eggs\n\n## Instructions\n1. Cook.\n");
  });

  it("returns the whole text as body when there's no frontmatter", async () => {
    const { env } = makeEnv({ r2: { "recipes/baz.md": "# Baz\n\nNo frontmatter here." } });
    const d = await recipeDetail(env, "baz");
    expect(d.body).toBe("# Baz\n\nNo frontmatter here.");
  });

  it("falls back to the whole source when the frontmatter YAML is malformed (never throws)", async () => {
    const bad = "---\nfoo: [unclosed\n---\n## Instructions\n1. Cook.\n";
    const { env } = makeEnv({ r2: { "recipes/bar.md": bad } });
    const d = await recipeDetail(env, "bar");
    expect(d.status).toBe("pending");
    expect(d.body).toBe(bad);
  });

  it("body is null for an orphaned slug with no R2 source", async () => {
    const { env } = makeEnv({ tables: { recipes: [{ slug: "qux", title: "Qux" }] } });
    const d = await recipeDetail(env, "qux");
    expect(d.body).toBeNull();
  });
});

describe("recipeDetail — cross-tenant aggregate names tenants (no redaction)", () => {
  it("lists each tenant's disposition and every author's notes, including private", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [{ slug: "foo", title: "Foo" }],
        overlay: [
          { tenant: "alice", recipe: "foo", favorite: 1, reject: null },
          { tenant: "bob", recipe: "foo", favorite: null, reject: 1 },
        ],
        recipe_notes: [
          { id: "n1", recipe: "foo", author: "alice", body: "shared note", tags: "[]", private: 0, created_at: "2026-06-01" },
          { id: "n2", recipe: "foo", author: "carol", body: "secret", tags: "[]", private: 1, created_at: "2026-06-02" },
        ],
      },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const d = await recipeDetail(env, "foo");
    expect(d.dispositions).toEqual([
      { tenant: "alice", favorite: true, reject: false },
      { tenant: "bob", favorite: false, reject: true },
    ]);
    expect(d.notes.map((n) => n.author)).toEqual(["carol", "alice"]); // created_at DESC
    expect(d.notes.find((n) => n.author === "carol")).toMatchObject({ private: 1, body: "secret" });
  });
});

describe("recipeList — every slug with status", () => {
  it("surfaces indexed, skipped, and orphaned slugs together", async () => {
    const { env } = makeEnv({
      tables: {
        recipes: [{ slug: "foo", title: "Foo" }, { slug: "qux", title: "Qux" }],
        reconcile_errors: [{ slug: "bar", path: "recipes/bar.md", message: "bad", recorded_at: "2026-06-27" }],
      },
      r2: { "recipes/foo.md": "# Foo", "recipes/bar.md": "# Bar" },
    });
    const { recipes } = await recipeList(env);
    const byslug = Object.fromEntries(recipes.map((r) => [r.slug, r.status]));
    expect(byslug).toEqual({ foo: "indexed", bar: "skipped", qux: "orphaned" });
  });
});

describe("memberDetail — full per-tenant state, no redaction", () => {
  it("assembles pantry/session/overlay/cooking_log and the member's private note", async () => {
    const { env } = makeEnv({
      tables: {
        profile: [{ tenant: "alice", taste: "likes spice" }],
        pantry: [{ tenant: "alice", name: "olive oil", normalized_name: "olive oil", quantity: "partial", category: "pantry" }],
        cooking_log: [{ id: 1, tenant: "alice", date: "2026-06-20", type: "recipe", recipe: "foo", name: null, protein: null, cuisine: null }],
        recipe_notes: [{ id: "n1", recipe: "foo", author: "alice", body: "my private note", tags: "[]", private: 1, created_at: "2026-06-01" }],
      },
    });
    const m = await memberDetail(env, "alice");
    expect(m.id).toBe("alice");
    expect(m.pantry).toHaveLength(1);
    expect(m.cooking_log).toHaveLength(1);
    expect(m.recipe_notes).toHaveLength(1);
    expect(m.recipe_notes[0]).toMatchObject({ private: 1, body: "my private note" });
  });
});

describe("readTable — fixed, allowlisted, bounded", () => {
  it("bounds sku_cache to the default limit", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ ingredient: `i${i}`, location_id: "L", sku: `s${i}`, brand: null, size: null, last_used: "2026-06-01" }));
    const { env } = makeEnv({ tables: { sku_cache: rows } });
    const page = await readTable(env, "corpus", "sku_cache");
    expect(page.rows.length).toBe(200);
    expect(page.columns).toContain("ingredient");
  });

  it("rejects an unknown table", async () => {
    const { env } = makeEnv();
    await expect(readTable(env, "corpus", "secrets")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a table from another group (no cross-group read)", async () => {
    const { env } = makeEnv();
    await expect(readTable(env, "system", "sku_cache")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("guidance R2 browse — confinement + normalization", () => {
  const guidance = {
    "guidance/cooking_techniques/sear.md": "# Searing",
    "guidance/ingredient_storage/onions.md": "# Onions",
  };

  it("lists the guidance tree at the root (default prefix)", async () => {
    const { env } = makeEnv({ r2: guidance });
    const listing = await guidanceListing(env);
    expect(listing.entries.map((e) => e.name).sort()).toEqual(["cooking_techniques", "ingredient_storage"]);
    expect(listing.entries.every((e) => e.type === "dir")).toBe(true);
  });

  it("a bare `guidance` prefix lists the root, not guidance/guidance", async () => {
    const { env } = makeEnv({ r2: guidance });
    const listing = await guidanceListing(env, "guidance");
    expect(listing.entries.length).toBe(2);
  });

  it("returns a guidance object's markdown (rooted or relative path)", async () => {
    const { env } = makeEnv({ r2: guidance });
    expect((await guidanceObject(env, "guidance/cooking_techniques/sear.md")).markdown).toBe("# Searing");
    expect((await guidanceObject(env, "cooking_techniques/sear.md")).markdown).toBe("# Searing");
  });

  it("rejects a `..` traversal out of the subtree", async () => {
    const { env } = makeEnv({ r2: guidance });
    await expect(guidanceObject(env, "../secrets.md")).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a non-markdown object and an absent object", async () => {
    const { env } = makeEnv({ r2: guidance });
    await expect(guidanceObject(env, "guidance/cooking_techniques")).rejects.toMatchObject({ code: "not_found" });
    await expect(guidanceObject(env, "guidance/missing.md")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("read-only guarantee", () => {
  it("never writes D1 or R2 while serving reads", async () => {
    const { env, d1, r2 } = makeEnv({
      tables: { recipes: [{ slug: "foo", title: "Foo" }], aliases: [{ variant: "EVOO", canonical: "olive oil" }] },
      r2: { "recipes/foo.md": "# Foo" },
    });
    const before = r2.objects.size;
    await recipeDetail(env, "foo");
    await recipeList(env);
    await readTable(env, "corpus", "aliases");
    await memberDetail(env, "alice");
    expect(d1.batches).toHaveLength(0); // no write batch ran
    expect(r2.objects.size).toBe(before); // no R2 put/delete
  });
});

// The read-only JSON data API (`GET /admin/api/data/*`) is retired: the Hono data explorer
// SSRs these views by calling the same `admin-data.ts` readers directly (covered above and in
// admin-data-views.test.ts). The Access gate is covered in admin.test.ts / admin-app.test.ts.
