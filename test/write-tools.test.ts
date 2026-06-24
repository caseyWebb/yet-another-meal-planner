import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  splitRecipeUpdate,
  readyToEatManager,
  registerWriteTools,
} from "../src/write-tools.js";
import { applyPantryOperations, markVerified, type PantryItem } from "../src/pantry-write.js";
import { serializeMarkdown } from "../src/serialize.js";
import { parseMarkdown, parseToml } from "../src/parse.js";
import { GitHubError, type GitHubClient } from "../src/github.js";

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

describe("splitRecipeUpdate (content vs overlay routing)", () => {
  it("routes rating/status to the overlay and everything else to content", () => {
    const r = splitRecipeUpdate({ title: "X", protein: "beef", rating: 5, status: "active" });
    expect(r.content).toEqual({ title: "X", protein: "beef" });
    expect(r.overlayEdit).toEqual({ rating: 5, status: "active" });
    expect(r.hadLastCooked).toBe(false);
  });

  it("flags last_cooked and never routes it to content or overlay", () => {
    const r = splitRecipeUpdate({ title: "X", last_cooked: "2026-06-09" });
    expect(r.hadLastCooked).toBe(true);
    expect(r.content).toEqual({ title: "X" });
    expect(r.overlayEdit).toEqual({});
  });

  it("routes pairs_with and standalone to shared content, not the overlay", () => {
    const r = splitRecipeUpdate({ pairs_with: ["steamed-rice"], standalone: true });
    expect(r.content).toEqual({ pairs_with: ["steamed-rice"], standalone: true });
    expect(r.overlayEdit).toEqual({});
  });

  it("routes perishable_ingredients to shared content, not the overlay", () => {
    const r = splitRecipeUpdate({ perishable_ingredients: ["cilantro"] });
    expect(r.content).toEqual({ perishable_ingredients: ["cilantro"] });
    expect(r.overlayEdit).toEqual({});
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
function collectTools(gh: GitHubClient, dataKv: KVNamespace, username: string) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerWriteTools(
    server as unknown as Parameters<typeof registerWriteTools>[0],
    gh,
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
