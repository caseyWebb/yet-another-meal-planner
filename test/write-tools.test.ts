import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  readyToEatManager,
  registerWriteTools,
} from "../src/write-tools.js";
import { applyPantryOperations, markVerified, type PantryItem } from "../src/pantry-write.js";
import { serializeMarkdown } from "../src/serialize.js";
import { parseMarkdown, parseToml } from "../src/parse.js";
import { GitHubError, type GitHubClient } from "../src/github.js";
import type { Env } from "../src/env.js";

const RECIPE = "---\ntitle: Salmon\nstatus: active\nlast_cooked: null\nrating: null\n---\n\n## Ingredients\n- salmon\n";

function ghWith(files: Record<string, string>): GitHubClient {
  return {
    async getFile(path: string) {
      if (path in files) return files[path];
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async listDir(path: string) {
      throw new GitHubError(404, `Not found: ${path}`);
    },
    async getRef() {
      return "x";
    },
    async getCommitTree() {
      return "x";
    },
    async createTree() {
      return "x";
    },
    async createCommit() {
      return "x";
    },
    async updateRef() {},
    async createIssue() {
      return { url: "https://example.test/issues/1", number: 1 };
    },
    async getPagesUrl() {
      return { url: null, enabled: false };
    },
  };
}

// Minimal KV fake backed by a Map; user-kv helpers use get/put/delete only.
function fakeKv(initial: Record<string, string> = {}): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
    delete: async (k: string) => {
      store.delete(k);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

// A fake D1 answering the recipe-resolution SELECT used by rate_recipe. `slugs`
// is the set of recipes that exist; `SELECT 1 … WHERE slug=?1` returns a row iff
// the bound slug is in it. No writes go through D1 here (the overlay is KV-backed).
function fakeD1(slugs: string[]): Env {
  const known = new Set(slugs);
  const makeStmt = () => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async first<T>() {
        const slug = binds[0];
        return (typeof slug === "string" && known.has(slug) ? { ok: 1 } : null) as T | null;
      },
      async all<T>() {
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        return { success: true as const, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: () => makeStmt() as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { DB } as unknown as Env;
}

describe("buildRecipeUpdate", () => {
  it("merges updates into frontmatter and preserves the body", async () => {
    const gh = ghWith({ "recipes/salmon.md": RECIPE });
    const file = await buildRecipeUpdate(gh, "salmon", { rating: 4, last_cooked: "2026-06-09" });
    expect(file.path).toBe("recipes/salmon.md");
    const { frontmatter, body } = parseMarkdown(file.content);
    expect(frontmatter.rating).toBe(4);
    expect(frontmatter.last_cooked).toBe("2026-06-09");
    expect(frontmatter.status).toBe("active"); // untouched
    expect(body).toContain("## Ingredients");
  });

  it("normalizes perishable_ingredients into shared content (lowercased, deduped)", async () => {
    const gh = ghWith({ "recipes/salmon.md": RECIPE }); // no aliases.toml → 404 → {} aliases
    const file = await buildRecipeUpdate(gh, "salmon", {
      perishable_ingredients: ["Cilantro", "cilantro", " Lime "],
    });
    const { frontmatter } = parseMarkdown(file.content);
    expect(frontmatter.perishable_ingredients).toEqual(["cilantro", "lime"]);
  });

  it("rejects a malformed slug as not_found", async () => {
    const gh = ghWith({});
    await expect(buildRecipeUpdate(gh, "Not A Slug", {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a missing recipe to not_found", async () => {
    const gh = ghWith({});
    await expect(buildRecipeUpdate(gh, "ghost", {})).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("readyToEatManager", () => {
  it("addDraft generates a slug, tags the meal, defaults to draft", () => {
    const mgr = readyToEatManager(null);
    const slug = mgr.addDraft({ meal: "dinner", name: "Kroger Frozen Lasagna" });
    expect(slug).toBe("kroger-frozen-lasagna");
    const content = mgr.serialize();
    expect(content).not.toBeNull();
    const item = (parseToml(content!).items as Record<string, unknown>[])[0];
    // null fields (rating/sku) are omitted by TOML serialization — assert the present ones.
    expect(item).toMatchObject({ name: "Kroger Frozen Lasagna", slug, meal: "dinner", status: "draft" });
    expect(typeof item.discovered_at).toBe("string"); // drafts carry a discovered_at date
  });

  it("addDraft status:active lands active with no discovered_at (onboarding path)", () => {
    const mgr = readyToEatManager(null);
    mgr.addDraft({ meal: "breakfast", name: "Overnight Oats" }, "active");
    const item = (parseToml(mgr.serialize()!).items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({ slug: "overnight-oats", status: "active" });
    expect(item.discovered_at).toBeUndefined(); // null → omitted in TOML
  });

  it("de-dupes slugs within the file with a numeric suffix", () => {
    const existing = '[[items]]\nname = "Burrito"\nslug = "burrito"\nmeal = "lunch"\nstatus = "active"\n';
    const mgr = readyToEatManager(existing);
    const slug = mgr.addDraft({ meal: "lunch", name: "Burrito" });
    expect(slug).toBe("burrito-2");
  });

  it("update addresses items by slug; unknown slug is not_found", () => {
    const existing = '[[items]]\nname = "Lasagna"\nslug = "lasagna"\nmeal = "dinner"\nstatus = "draft"\n';
    const mgr = readyToEatManager(existing);
    mgr.update("lasagna", { status: "active", rating: 4 });
    const item = (parseToml(mgr.serialize()!).items as Record<string, unknown>[])[0];
    expect(item).toMatchObject({ slug: "lasagna", status: "active", rating: 4 });
    expect(() => mgr.update("ghost", { status: "rejected" })).toThrowError(/not.*found|ghost/i);
  });

  it("serialize() is null when nothing was touched", () => {
    const mgr = readyToEatManager("");
    expect(mgr.serialize()).toBeNull();
  });
});

describe("serializeMarkdown round-trip", () => {
  it("keeps a date-like string a string", () => {
    const text = serializeMarkdown({ last_cooked: "2026-06-09", status: "active" }, "body\n");
    const { frontmatter } = parseMarkdown(text);
    expect(frontmatter.last_cooked).toBe("2026-06-09");
    expect(typeof frontmatter.last_cooked).toBe("string");
  });
});

describe("applyPantryOperations", () => {
  const items: PantryItem[] = [
    { name: "milk", category: "fridge", quantity: "full", last_verified_at: "2026-06-01" },
  ];

  it("adds, removes, and verifies, reporting conflicts", () => {
    const res = applyPantryOperations(
      items,
      [
        { op: "add", item: { name: "eggs", category: "fridge", quantity: "12" } },
        { op: "remove", name: "milk" },
        { op: "remove", name: "ghee" }, // conflict
        { op: "verify", name: "eggs" },
      ],
      "2026-06-09",
    );
    const names = res.items.map((i) => i.name);
    expect(names).toContain("eggs");
    expect(names).not.toContain("milk");
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ op: "remove", name: "ghee" });
    const eggs = res.items.find((i) => i.name === "eggs")!;
    expect(eggs.last_verified_at).toBe("2026-06-09");
  });

  it("adds with a top-level name and merges item fields", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", name: "garlic", item: { category: "aromatics", note: "staple" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "garlic" }]);
    const garlic = res.items.find((i) => i.name === "garlic")!;
    expect(garlic).toMatchObject({ name: "garlic", category: "aromatics", note: "staple", added_at: "2026-06-09" });
  });

  it("conflicts only when no name is resolvable from either location", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", item: { category: "aromatics" } }],
      "2026-06-09",
    );
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts[0]).toMatchObject({ op: "add", reason: expect.stringContaining("requires a name") });
  });

  it("inserts a new entry when the name is not already in the pantry", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", item: { name: "butter", category: "fridge", quantity: "1 lb" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "butter" }]);
    expect(res.items).toHaveLength(2);
    expect(res.items.find((i) => i.name === "butter")).toMatchObject({ quantity: "1 lb", added_at: "2026-06-09" });
  });

  it("merges into the existing entry when the name already exists, preserving added_at", () => {
    const existing: PantryItem[] = [
      { name: "milk", category: "fridge", quantity: "full", added_at: "2026-01-01", last_verified_at: "2026-06-01" },
    ];
    const res = applyPantryOperations(
      existing,
      [{ op: "add", item: { name: "milk", quantity: "low" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "milk", merged: true }]);
    expect(res.items).toHaveLength(1);
    const milk = res.items[0];
    expect(milk.quantity).toBe("low");
    expect(milk.added_at).toBe("2026-01-01");
    expect(milk.last_verified_at).toBe("2026-06-09");
  });

  it("upsert match is case-insensitive", () => {
    const existing: PantryItem[] = [
      { name: "olive oil", category: "pantry", quantity: "partial", added_at: "2026-01-01", last_verified_at: "2026-06-01" },
    ];
    const res = applyPantryOperations(
      existing,
      [{ op: "add", item: { name: "Olive Oil", quantity: "low" } }],
      "2026-06-09",
    );
    expect(res.items).toHaveLength(1);
    expect(res.applied).toEqual([{ op: "add", name: "Olive Oil", merged: true }]);
    expect(res.items[0].quantity).toBe("low");
  });
});

describe("markVerified", () => {
  const items: PantryItem[] = [{ name: "milk", last_verified_at: "2026-06-01" }];

  it("resets verified items and reports missing", () => {
    const res = markVerified(items, ["milk", "ghee"], "2026-06-09");
    expect(res.items[0].last_verified_at).toBe("2026-06-09");
    expect(res.verified).toEqual(["milk"]);
    expect(res.missing).toEqual(["ghee"]);
  });
});

// Invoke the real registered write-tool handlers through a minimal fake server.
// Pantry is KV-backed now, so the integration tests read back from the fake KV
// (state:<username>:pantry) rather than capturing GitHub commit trees.
function collectTools(gh: GitHubClient, dataKv: KVNamespace, username: string, env: Env = fakeD1([])) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerWriteTools(
    server as unknown as Parameters<typeof registerWriteTools>[0],
    gh,
    env,
    dataKv,
    username,
  );
  return handlers;
}

describe("update_pantry / mark_pantry_verified (KV-backed)", () => {
  it("update_pantry add seeds the pantry key when none exists yet, no commit_sha", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett");
    const res = await handlers.get("update_pantry")!({
      operations: [{ op: "add", item: { name: "butter", category: "fridge" } }],
    });
    const out = JSON.parse(res.content[0].text) as {
      applied: { op: string; name: string }[];
      conflicts: unknown[];
      commit_sha?: string;
    };
    expect(out.applied).toContainEqual({ op: "add", name: "butter" });
    expect(out.conflicts).toHaveLength(0);
    expect(out.commit_sha).toBeUndefined(); // KV-backed: no git commit
    const items = JSON.parse(store.get("state:everett:pantry")!) as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "butter", category: "fridge" });
  });

  it("update_pantry add works for a single minimal op (name only)", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett");
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "add", name: "butter" }] });
    const out = JSON.parse(res.content[0].text) as { applied: { op: string; name: string }[] };
    expect(out.applied).toContainEqual({ op: "add", name: "butter" });
    const items = JSON.parse(store.get("state:everett:pantry")!) as Record<string, unknown>[];
    expect(items.map((i) => i.name)).toEqual(["butter"]);
  });

  it("a lone remove against an absent pantry reports a conflict and writes nothing", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett");
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "remove", name: "ghost" }] });
    const out = JSON.parse(res.content[0].text) as {
      applied: unknown[];
      conflicts: { op: string; name: string; reason: string }[];
    };
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toContainEqual({ op: "remove", name: "ghost", reason: "no pantry item with that name" });
    expect(store.has("state:everett:pantry")).toBe(false); // no write
  });

  it("mark_pantry_verified against an absent pantry reports missing, writes nothing", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett");
    const res = await handlers.get("mark_pantry_verified")!({ items: ["butter"] });
    const out = JSON.parse(res.content[0].text) as { verified: string[]; conflicts: { op: string; name: string }[] };
    expect(out.verified).toHaveLength(0);
    expect(out.conflicts).toContainEqual({ op: "verify", name: "butter", reason: "no pantry item with that name" });
    expect(store.has("state:everett:pantry")).toBe(false); // no write
  });
});

describe("rate_recipe (subjective overlay write)", () => {
  it("writes only the caller's overlay for an existing recipe, no commit_sha", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett", fakeD1(["miso-salmon"]));
    const res = await handlers.get("rate_recipe")!({ slug: "miso-salmon", rating: 5 });
    const out = JSON.parse(res.content[0].text) as { slug: string; overlay: Record<string, unknown>; commit_sha?: string };
    expect(out.slug).toBe("miso-salmon");
    expect(out.overlay).toEqual({ rating: 5 });
    expect(out.commit_sha).toBeUndefined(); // KV-backed overlay, no git commit
    // The KV overlay bundle (profile:<username>) carries the new row.
    const bundle = JSON.parse(store.get("profile:everett")!) as { overlay: string };
    const overlay = parseToml(bundle.overlay) as { overlay: Record<string, unknown> };
    expect(overlay.overlay["miso-salmon"]).toMatchObject({ rating: 5 });
  });

  it("sets status and merges with an existing rating across calls", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett", fakeD1(["miso-salmon"]));
    await handlers.get("rate_recipe")!({ slug: "miso-salmon", rating: 4 });
    const res = await handlers.get("rate_recipe")!({ slug: "miso-salmon", status: "active" });
    const out = JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> };
    expect(out.overlay).toMatchObject({ rating: 4, status: "active" });
    const bundle = JSON.parse(store.get("profile:everett")!) as { overlay: string };
    const overlay = parseToml(bundle.overlay) as { overlay: Record<string, unknown> };
    expect(overlay.overlay["miso-salmon"]).toMatchObject({ rating: 4, status: "active" });
  });

  it("rejects a slug not in the recipe index (not_found), writing nothing", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett", fakeD1([])); // no recipes
    const res = await handlers.get("rate_recipe")!({ slug: "ghost", status: "active" });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("not_found");
    expect(store.has("profile:everett")).toBe(false);
  });

  it("rejects a malformed slug (not_found) before touching D1", async () => {
    const { kv } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett", fakeD1(["miso-salmon"]));
    const res = await handlers.get("rate_recipe")!({ slug: "Not A Slug", rating: 3 });
    expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("not_found");
  });

  it("rejects an empty edit (neither rating nor status) with validation_failed", async () => {
    const { kv, store } = fakeKv();
    const handlers = collectTools(ghWith({}), kv, "everett", fakeD1(["miso-salmon"]));
    const res = await handlers.get("rate_recipe")!({ slug: "miso-salmon" });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(store.has("profile:everett")).toBe(false);
  });
});

describe("update_recipe (objective-only)", () => {
  const RECIPE_MD = "---\ntitle: Salmon\nstatus: active\n---\n\n## Ingredients\n- salmon\n";

  it("rejects a status edit, directing the caller to rate_recipe, writing nothing", async () => {
    const { kv } = fakeKv();
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), kv, "everett", fakeD1(["salmon"]));
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { status: "active" } });
    const out = JSON.parse(res.content[0].text) as { error: string; message?: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/rate_recipe/);
  });

  it("rejects a rating edit toward rate_recipe", async () => {
    const { kv } = fakeKv();
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), kv, "everett", fakeD1(["salmon"]));
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { rating: 5 } });
    expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("validation_failed");
  });

  it("still rejects last_cooked toward log_cooked", async () => {
    const { kv } = fakeKv();
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), kv, "everett", fakeD1(["salmon"]));
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { last_cooked: "2026-06-09" } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/log_cooked/);
  });

  it("commits an objective frontmatter edit and returns updated_fields", async () => {
    const { kv } = fakeKv();
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), kv, "everett", fakeD1(["salmon"]));
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { time_total: 30 } });
    const out = JSON.parse(res.content[0].text) as { slug: string; updated_fields: string[]; commit_sha: string };
    expect(out.slug).toBe("salmon");
    expect(out.updated_fields).toEqual(["time_total"]);
    expect(out.commit_sha).toBe("x"); // ghWith fake returns "x" for createCommit
  });
});
