import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  readyToEatManager,
  registerWriteTools,
} from "../src/write-tools.js";
import { applyPantryOperations, markVerified, type PantryItem } from "../src/pantry-write.js";
import { serializeMarkdown } from "../src/serialize.js";
import { parseMarkdown } from "../src/parse.js";
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

// An in-memory fake D1 covering the profile tables the write tools touch. It routes
// by SQL prefix/table: `SELECT 1 … FROM recipes` resolves a slug against `slugs`;
// SELECT/INSERT/DELETE against profile, overlay, staples, stockup, brand_prefs,
// kitchen_equipment, and ready_to_eat read/mutate per-table row stores. UPSERTs use
// the ON CONFLICT clause's primary key. Enough fidelity to assert real round-trips.
interface FakeStore {
  env: Env;
  tables: Record<string, Record<string, unknown>[]>;
}

function fakeD1(slugs: string[]): FakeStore {
  const known = new Set(slugs);
  const tables: Record<string, Record<string, unknown>[]> = {
    profile: [],
    overlay: [],
    staples: [],
    stockup: [],
    brand_prefs: [],
    kitchen_equipment: [],
    ready_to_eat: [],
    pantry: [],
    aliases: [],
  };

  function tableOf(sql: string): string | null {
    const m = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql);
    return m ? m[1] : null;
  }

  const exec = (sql: string, binds: unknown[]): { rows: Record<string, unknown>[]; changes: number } => {
    const table = tableOf(sql);
    if (/^SELECT/i.test(sql)) {
      if (sql.includes("FROM recipes")) {
        const slug = binds[0];
        return { rows: typeof slug === "string" && known.has(slug) ? [{ ok: 1 }] : [], changes: 0 };
      }
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const tenant = binds[0];
      const recipe = binds[1]; // for the overlay point read, if any
      let rows = tables[table].filter((r) => r.tenant === tenant);
      if (sql.includes("recipe = ?2")) rows = rows.filter((r) => r.recipe === recipe);
      return { rows, changes: 0 };
    }
    if (/^DELETE/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const tenant = binds[0];
      const before = tables[table].length;
      tables[table] = tables[table].filter((r) => {
        if (r.tenant !== tenant) return true;
        if (sql.includes("recipe = ?2")) return r.recipe !== binds[1];
        if (sql.includes("term = ?2")) return r.term !== binds[1];
        if (sql.includes("normalized_name = ?2")) return r.normalized_name !== binds[1];
        return false;
      });
      return { rows: [], changes: before - tables[table].length };
    }
    if (/^INSERT/i.test(sql)) {
      if (!table || !tables[table]) return { rows: [], changes: 0 };
      const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(sql)![1].split(",").map((c) => c.trim());
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = binds[i] ?? null));
      // Resolve the primary key for ON CONFLICT upserts.
      const pk: string[] =
        table === "profile"
          ? ["tenant"]
          : table === "overlay"
            ? ["tenant", "recipe"]
            : table === "brand_prefs"
              ? ["tenant", "term"]
              : table === "ready_to_eat"
                ? ["tenant", "slug"]
                : table === "kitchen_equipment"
                  ? ["tenant", "slug"]
                  : table === "aliases"
                    ? ["variant"]
                    : ["tenant", "normalized_name"];
      const idx = tables[table].findIndex((r) => pk.every((k) => r[k] === row[k]));
      if (idx >= 0 && /ON CONFLICT/i.test(sql)) {
        tables[table][idx] = { ...tables[table][idx], ...row };
      } else {
        tables[table].push(row);
      }
      return { rows: [], changes: 1 };
    }
    return { rows: [], changes: 0 };
  };

  const makeStmt = (sql: string) => {
    let binds: unknown[] = [];
    const stmt = {
      bind(...v: unknown[]) {
        binds = v;
        return stmt;
      },
      async first<T>() {
        return (exec(sql, binds).rows[0] ?? null) as T | null;
      },
      async all<T>() {
        return { results: exec(sql, binds).rows as T[], success: true as const, meta: { changes: 0 } };
      },
      async run() {
        return { success: true as const, meta: { changes: exec(sql, binds).changes } };
      },
      __exec: () => exec(sql, binds),
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch(stmts: unknown[]) {
      for (const s of stmts) (s as { __exec: () => void }).__exec();
      return [];
    },
  } as unknown as D1Database;
  return { env: { DB } as unknown as Env, tables };
}

describe("buildRecipeUpdate", () => {
  // buildRecipeUpdate reads aliases from D1 (readAliases); an empty fake → {} aliases.
  const env = fakeD1([]).env;
  it("merges updates into frontmatter and preserves the body", async () => {
    const gh = ghWith({ "recipes/salmon.md": RECIPE });
    const file = await buildRecipeUpdate(gh, env, "salmon", { rating: 4, last_cooked: "2026-06-09" });
    expect(file.path).toBe("recipes/salmon.md");
    const { frontmatter, body } = parseMarkdown(file.content);
    expect(frontmatter.rating).toBe(4);
    expect(frontmatter.last_cooked).toBe("2026-06-09");
    expect(frontmatter.status).toBe("active"); // untouched
    expect(body).toContain("## Ingredients");
  });

  it("normalizes perishable_ingredients into shared content (lowercased, deduped)", async () => {
    const gh = ghWith({ "recipes/salmon.md": RECIPE }); // no aliases.toml → 404 → {} aliases
    const file = await buildRecipeUpdate(gh, env, "salmon", {
      perishable_ingredients: ["Cilantro", "cilantro", " Lime "],
    });
    const { frontmatter } = parseMarkdown(file.content);
    expect(frontmatter.perishable_ingredients).toEqual(["cilantro", "lime"]);
  });

  it("rejects a malformed slug as not_found", async () => {
    const gh = ghWith({});
    await expect(buildRecipeUpdate(gh, env, "Not A Slug", {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a missing recipe to not_found", async () => {
    const gh = ghWith({});
    await expect(buildRecipeUpdate(gh, env, "ghost", {})).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("readyToEatManager", () => {
  it("addDraft generates a slug, tags the meal, defaults to draft", () => {
    const mgr = readyToEatManager([]);
    const slug = mgr.addDraft({ meal: "dinner", name: "Kroger Frozen Lasagna" });
    expect(slug).toBe("kroger-frozen-lasagna");
    expect(mgr.touched()).toBe(true);
    const item = mgr.items()[0];
    expect(item).toMatchObject({ name: "Kroger Frozen Lasagna", slug, meal: "dinner", status: "draft" });
  });

  it("addDraft status:active lands active (onboarding path)", () => {
    const mgr = readyToEatManager([]);
    mgr.addDraft({ meal: "breakfast", name: "Overnight Oats" }, "active");
    const item = mgr.items()[0];
    expect(item).toMatchObject({ slug: "overnight-oats", status: "active" });
  });

  it("de-dupes slugs within the catalog with a numeric suffix", () => {
    const existing = [{ name: "Burrito", slug: "burrito", meal: "lunch", status: "active" }];
    const mgr = readyToEatManager(existing);
    const slug = mgr.addDraft({ meal: "lunch", name: "Burrito" });
    expect(slug).toBe("burrito-2");
  });

  it("update addresses items by slug; unknown slug is not_found", () => {
    const existing = [{ name: "Lasagna", slug: "lasagna", meal: "dinner", status: "draft" }];
    const mgr = readyToEatManager(existing);
    mgr.update("lasagna", { status: "active", rating: 4 });
    const item = mgr.items()[0];
    expect(item).toMatchObject({ slug: "lasagna", status: "active", rating: 4 });
    expect(() => mgr.update("ghost", { status: "rejected" })).toThrowError(/not.*found|ghost/i);
  });

  it("touched() is false when nothing was changed", () => {
    const mgr = readyToEatManager([]);
    expect(mgr.touched()).toBe(false);
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
// Pantry is D1-backed now (the `pantry` table in the fake D1), so the integration
// tests read back from the fake D1's table rather than capturing GitHub commit trees.
function collectTools(gh: GitHubClient, username: string, env: Env = fakeD1([]).env) {
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
    username,
  );
  return handlers;
}

describe("update_aliases (D1-backed)", () => {
  it("upserts mappings into the D1 aliases table, no git commit", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_aliases")!({
      aliases: { EVOO: "olive oil", scallions: "green onions" },
    });
    const out = JSON.parse(res.content[0].text) as { updated: number; commit_sha?: string };
    expect(out.updated).toBe(2);
    expect(out.commit_sha).toBeUndefined(); // D1-backed: not a GitHub commit
    expect(d1.tables.aliases).toEqual([
      { variant: "EVOO", canonical: "olive oil" },
      { variant: "scallions", canonical: "green onions" },
    ]);
  });

  it("re-writing a variant upserts (no duplicate row)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    await handlers.get("update_aliases")!({ aliases: { EVOO: "olive oil" } });
    await handlers.get("update_aliases")!({ aliases: { EVOO: "extra virgin olive oil" } });
    expect(d1.tables.aliases).toEqual([{ variant: "EVOO", canonical: "extra virgin olive oil" }]);
  });
});

describe("update_pantry / mark_pantry_verified (D1-backed)", () => {
  it("update_pantry add inserts a pantry row, no commit_sha", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
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
    expect(out.commit_sha).toBeUndefined(); // D1-backed: no git commit
    expect(d1.tables.pantry).toHaveLength(1);
    expect(d1.tables.pantry[0]).toMatchObject({ tenant: "everett", name: "butter", category: "fridge", normalized_name: "butter" });
  });

  it("update_pantry add works for a single minimal op (name only)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "add", name: "butter" }] });
    const out = JSON.parse(res.content[0].text) as { applied: { op: string; name: string }[] };
    expect(out.applied).toContainEqual({ op: "add", name: "butter" });
    expect(d1.tables.pantry.map((i) => i.name)).toEqual(["butter"]);
  });

  it("a lone remove against an absent pantry reports a conflict and writes nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "remove", name: "ghost" }] });
    const out = JSON.parse(res.content[0].text) as {
      applied: unknown[];
      conflicts: { op: string; name: string; reason: string }[];
    };
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toContainEqual({ op: "remove", name: "ghost", reason: "no pantry item with that name" });
    expect(d1.tables.pantry).toHaveLength(0); // no write
  });

  it("mark_pantry_verified against an absent pantry reports missing, writes nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("mark_pantry_verified")!({ items: ["butter"] });
    const out = JSON.parse(res.content[0].text) as { verified: string[]; conflicts: { op: string; name: string }[] };
    expect(out.verified).toHaveLength(0);
    expect(out.conflicts).toContainEqual({ op: "verify", name: "butter", reason: "no pantry item with that name" });
    expect(d1.tables.pantry).toHaveLength(0); // no write
  });
});

describe("rate_recipe (subjective overlay write → D1)", () => {
  it("writes only the caller's overlay row for an existing recipe, no commit_sha", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("rate_recipe")!({ slug: "miso-salmon", rating: 5 });
    const out = JSON.parse(res.content[0].text) as { slug: string; overlay: Record<string, unknown>; commit_sha?: string };
    expect(out.slug).toBe("miso-salmon");
    expect(out.overlay).toEqual({ rating: 5 });
    expect(out.commit_sha).toBeUndefined(); // D1-backed overlay, no git commit
    expect(d1.tables.overlay).toContainEqual(
      expect.objectContaining({ tenant: "everett", recipe: "miso-salmon", rating: 5 }),
    );
  });

  it("sets status and merges with an existing rating across calls", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    await handlers.get("rate_recipe")!({ slug: "miso-salmon", rating: 4 });
    const res = await handlers.get("rate_recipe")!({ slug: "miso-salmon", status: "active" });
    const out = JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> };
    expect(out.overlay).toMatchObject({ rating: 4, status: "active" });
    expect(d1.tables.overlay).toHaveLength(1);
    expect(d1.tables.overlay[0]).toMatchObject({ recipe: "miso-salmon", rating: 4, status: "active" });
  });

  it("rejects a slug not in the recipe index (not_found), writing nothing", async () => {
    const d1 = fakeD1([]); // no recipes
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("rate_recipe")!({ slug: "ghost", status: "active" });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("not_found");
    expect(d1.tables.overlay).toHaveLength(0);
  });

  it("rejects a malformed slug (not_found) before touching D1", async () => {
    const handlers = collectTools(ghWith({}), "everett", fakeD1(["miso-salmon"]).env);
    const res = await handlers.get("rate_recipe")!({ slug: "Not A Slug", rating: 3 });
    expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("not_found");
  });

  it("rejects an empty edit (neither rating nor status) with validation_failed", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("rate_recipe")!({ slug: "miso-salmon" });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(d1.tables.overlay).toHaveLength(0);
  });
});

describe("profile writes → D1 (staples / stockup / kitchen / ready-to-eat)", () => {
  it("update_staples upserts staple rows with a normalized_name", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_staples")!({
      add: [{ name: "Olive Oil" }, { name: "Eggs", perishable: true }],
    });
    const out = JSON.parse(res.content[0].text) as { added: number; removed: number };
    expect(out.added).toBe(2);
    expect(d1.tables.staples.map((r) => r.normalized_name).sort()).toEqual(["eggs", "olive oil"]);
    expect(d1.tables.staples.find((r) => r.name === "Eggs")!.perishable).toBe(1);
  });

  it("update_stockup writes rows and the freezer estimate onto the profile row", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    await handlers.get("update_stockup")!({
      items: [{ name: "Chicken Thighs", unit: "lb" }],
      freezer_capacity_estimate: "moderate",
    });
    expect(d1.tables.stockup).toContainEqual(
      expect.objectContaining({ tenant: "everett", name: "Chicken Thighs", unit: "lb" }),
    );
    expect(d1.tables.profile[0]).toMatchObject({ tenant: "everett", freezer_capacity_estimate: "moderate" });
  });

  it("update_kitchen replaces equipment rows and stores notes JSON on the profile row", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_kitchen")!({
      operations: [
        { op: "add", slug: "blender" },
        { op: "set_note", key: "ovens", value: 2 },
      ],
    });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: unknown[] };
    expect(out.applied).toHaveLength(2);
    expect(d1.tables.kitchen_equipment).toContainEqual({ tenant: "everett", slug: "blender" });
    expect(JSON.parse(d1.tables.profile[0].kitchen_notes as string)).toEqual({ ovens: 2 });
  });

  it("add_draft_ready_to_eat writes a catalog row keyed by generated slug", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("add_draft_ready_to_eat")!({
      items: [{ meal: "dinner", name: "Frozen Lasagna" }],
    });
    const out = JSON.parse(res.content[0].text) as { added: { slug: string }[] };
    expect(out.added[0].slug).toBe("frozen-lasagna");
    expect(d1.tables.ready_to_eat).toContainEqual(
      expect.objectContaining({ tenant: "everett", slug: "frozen-lasagna", meal: "dinner", status: "draft" }),
    );
  });
});

describe("update_preferences (merge-patch → D1)", () => {
  it("partial patch merges without clobbering siblings", async () => {
    const d1 = fakeD1([]);
    d1.tables.profile.push({ tenant: "everett", stores: JSON.stringify({ primary: "kroger" }) });
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({
      patch: { stores: { preferred_location: "Kroger - 76137" } },
    });
    const stores = JSON.parse(d1.tables.profile[0].stores as string);
    expect(stores).toEqual({ primary: "kroger", preferred_location: "Kroger - 76137" });
  });

  it("brands tri-state: value UPSERTs, [] is don't-care, null DELETEs", async () => {
    const d1 = fakeD1([]);
    d1.tables.brand_prefs.push({ tenant: "everett", term: "canola_oil", ranks: '["Crisco"]' });
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({
      patch: { brands: { olive_oil: ["Cobram"], yellow_onion: [], canola_oil: null } },
    });
    const byTerm = Object.fromEntries(d1.tables.brand_prefs.map((r) => [r.term, r.ranks]));
    expect(byTerm.olive_oil).toBe('["Cobram"]');
    expect(byTerm.yellow_onion).toBe("[]");
    expect("canola_oil" in byTerm).toBe(false); // deleted → ambiguous
  });

  it("rejects an unknown top-level key toward custom, storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { spice_tolerance: "high" } });
    const out = JSON.parse(res.content[0].text) as { error: string; message?: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/custom/);
    expect(d1.tables.profile).toHaveLength(0);
  });

  it("rejects a type-invalid merged result (bad enum), storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(ghWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { lunch_strategy: "sometimes" } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("malformed_data");
    expect(d1.tables.profile).toHaveLength(0);
  });
});

describe("update_recipe (objective-only)", () => {
  const RECIPE_MD = "---\ntitle: Salmon\nstatus: active\n---\n\n## Ingredients\n- salmon\n";

  it("rejects a status edit, directing the caller to rate_recipe, writing nothing", async () => {
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { status: "active" } });
    const out = JSON.parse(res.content[0].text) as { error: string; message?: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/rate_recipe/);
  });

  it("rejects a rating edit toward rate_recipe", async () => {
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { rating: 5 } });
    expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("validation_failed");
  });

  it("still rejects last_cooked toward log_cooked", async () => {
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { last_cooked: "2026-06-09" } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/log_cooked/);
  });

  it("commits an objective frontmatter edit and returns updated_fields", async () => {
    const handlers = collectTools(ghWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { time_total: 30 } });
    const out = JSON.parse(res.content[0].text) as { slug: string; updated_fields: string[]; commit_sha: string };
    expect(out.slug).toBe("salmon");
    expect(out.updated_fields).toEqual(["time_total"]);
    expect(out.commit_sha).toBe("x"); // ghWith fake returns "x" for createCommit
  });
});
