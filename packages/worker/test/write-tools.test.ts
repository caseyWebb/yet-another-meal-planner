import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  readyToEatManager,
  registerWriteTools,
} from "../src/write-tools.js";
import { applyPantryOperations, markVerified, type PantryItem } from "../src/pantry-write.js";
import { ToolError } from "../src/errors.js";
import { serializeMarkdown } from "../src/serialize.js";
import { validateFile } from "../src/validate.js";
import { parseMarkdown } from "../src/parse.js";
import { createR2CorpusStore, type CorpusStore } from "../src/corpus-store.js";
import { fakeR2 } from "./fake-r2.js";
import type { Env } from "../src/env.js";

const RECIPE = "---\ntitle: Salmon\ntime_total: 30\nlast_cooked: null\n---\n\n## Ingredients\n- salmon\n";

/** A corpus store backed by an in-memory R2 fake, seeded with `files`. */
function storeWith(files: Record<string, string>): CorpusStore {
  return createR2CorpusStore(fakeR2(files).bucket);
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
    ingredient_identity: [],
    ingredient_alias: [],
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
                  : table === "ingredient_alias"
                    ? ["variant"]
                    : table === "ingredient_identity"
                      ? ["id"]
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
    const store = storeWith({ "recipes/salmon.md": RECIPE });
    const file = await buildRecipeUpdate(store, env, "salmon", { cuisine: "japanese", last_cooked: "2026-06-09" });
    expect(file.path).toBe("recipes/salmon.md");
    const { frontmatter, body } = parseMarkdown(file.content);
    expect(frontmatter.cuisine).toBe("japanese");
    expect(frontmatter.last_cooked).toBe("2026-06-09");
    expect(frontmatter.title).toBe("Salmon"); // untouched
    expect(body).toContain("## Ingredients");
  });

  it("normalizes perishable_ingredients into shared content (lowercased, deduped)", async () => {
    const store = storeWith({ "recipes/salmon.md": RECIPE }); // no aliases.toml → 404 → {} aliases
    const file = await buildRecipeUpdate(store, env, "salmon", {
      perishable_ingredients: ["Cilantro", "cilantro", " Lime "],
    });
    const { frontmatter } = parseMarkdown(file.content);
    expect(frontmatter.perishable_ingredients).toEqual(["cilantro", "lime"]);
  });

  it("accepts a novel duplicate_of field through the pass-through frontmatter (the merge flow's write path)", async () => {
    // recipe-dedup: the agent-guided merge marks the duplicate `duplicate_of: <survivor>`
    // via update_recipe — a pass-through field, so an otherwise-compliant recipe stays
    // valid under the merged-content contract check (validateFile) and the marker rides
    // through to the serialized frontmatter.
    const compliant = serializeMarkdown(
      {
        title: "Homemade Pasta Dough",
        source: null,
        time_total: 45,
        dietary: [],
        pairs_with: [],
        requires_equipment: [],
      },
      "## Ingredients\n- flour\n\n## Instructions\n1. knead\n",
    );
    const store = storeWith({ "recipes/homemade-pasta-dough.md": compliant });
    const file = await buildRecipeUpdate(store, env, "homemade-pasta-dough", { duplicate_of: "fresh-pasta" });
    expect(() => validateFile(file.path, file.content)).not.toThrow();
    const { frontmatter } = parseMarkdown(file.content);
    expect(frontmatter.duplicate_of).toBe("fresh-pasta");
    expect(frontmatter.title).toBe("Homemade Pasta Dough"); // untouched
  });

  it("rejects a malformed slug as not_found", async () => {
    const store = storeWith({});
    await expect(buildRecipeUpdate(store, env, "Not A Slug", {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("maps a missing recipe to not_found", async () => {
    const store = storeWith({});
    await expect(buildRecipeUpdate(store, env, "ghost", {})).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("readyToEatManager", () => {
  it("add generates a slug, tags the meal, and lands available (no status)", () => {
    const mgr = readyToEatManager([]);
    const slug = mgr.add({ meal: "dinner", name: "Kroger Frozen Lasagna" });
    expect(slug).toBe("kroger-frozen-lasagna");
    expect(mgr.touched()).toBe(true);
    const item = mgr.items()[0];
    expect(item).toMatchObject({ name: "Kroger Frozen Lasagna", slug, meal: "dinner" });
    expect("status" in item).toBe(false);
  });

  it("de-dupes slugs within the catalog with a numeric suffix", () => {
    const existing = [{ name: "Burrito", slug: "burrito", meal: "lunch" }];
    const mgr = readyToEatManager(existing);
    const slug = mgr.add({ meal: "lunch", name: "Burrito" });
    expect(slug).toBe("burrito-2");
  });

  it("update sets favorite/reject by slug; unknown slug is not_found", () => {
    const existing = [{ name: "Lasagna", slug: "lasagna", meal: "dinner" }];
    const mgr = readyToEatManager(existing);
    mgr.update("lasagna", { favorite: true });
    expect(mgr.items()[0]).toMatchObject({ slug: "lasagna", favorite: true });
    expect(() => mgr.update("ghost", { reject: true })).toThrowError(/not.*found|ghost/i);
  });

  it("an unknown slug is not_found even when the patch also carries protected keys", () => {
    // The slug lookup runs FIRST: the caller addressed a nonexistent item, and that
    // is the more actionable error than what the patch happened to contain.
    const mgr = readyToEatManager([{ name: "Lasagna", slug: "lasagna", meal: "dinner" }]);
    try {
      mgr.update("ghost", { slug: "renamed" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).code).toBe("not_found");
    }
    expect(mgr.touched()).toBe(false);
  });

  it("favorite and reject are mutually exclusive on update", () => {
    const existing = [{ name: "Lasagna", slug: "lasagna", meal: "dinner", reject: true }];
    const mgr = readyToEatManager(existing);
    mgr.update("lasagna", { favorite: true });
    expect(mgr.items()[0]).toMatchObject({ slug: "lasagna", favorite: true, reject: false });
  });

  it("touched() is false when nothing was changed", () => {
    const mgr = readyToEatManager([]);
    expect(mgr.touched()).toBe(false);
  });

  it("update accepts every documented mutable field in place", () => {
    const existing = [{ name: "Lasagna", slug: "lasagna", meal: "dinner", category: null, brand: null, notes: null }];
    const mgr = readyToEatManager(existing);
    mgr.update("lasagna", {
      name: "Frozen Lasagna",
      category: "frozen",
      brand: "Kroger",
      notes: "425F for 50 min",
      favorite: true,
    });
    expect(mgr.touched()).toBe(true);
    expect(mgr.items()[0]).toMatchObject({
      slug: "lasagna",
      meal: "dinner",
      name: "Frozen Lasagna",
      category: "frozen",
      brand: "Kroger",
      notes: "425F for 50 min",
      favorite: true,
    });
  });

  it("update rejects identity/provenance keys with validation_failed listing the offenders", () => {
    const existing = [{ name: "Lasagna", slug: "lasagna", meal: "dinner", discovery_source: "kroger-flyer" }];
    const mgr = readyToEatManager(existing);
    try {
      mgr.update("lasagna", {
        slug: "renamed",
        meal: "lunch",
        discovery_source: "hand-edit",
        added_at: "2026-01-01",
        discovered_at: "2026-01-01",
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).code).toBe("validation_failed");
      expect((e as ToolError).context.fields).toEqual([
        "slug",
        "meal",
        "discovery_source",
        "added_at",
        "discovered_at",
      ]);
    }
    // Nothing committed: the item is untouched and the manager reports no change.
    expect(mgr.touched()).toBe(false);
    expect(mgr.items()[0]).toMatchObject({ slug: "lasagna", meal: "dinner", discovery_source: "kroger-flyer" });
  });

  it("update rejects a mixed patch (allowed + protected keys) wholesale — nothing committed", () => {
    const existing = [{ name: "Lasagna", slug: "lasagna", meal: "dinner" }];
    const mgr = readyToEatManager(existing);
    try {
      mgr.update("lasagna", { name: "Better Lasagna", slug: "better-lasagna" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).code).toBe("validation_failed");
      expect((e as ToolError).context.fields).toEqual(["slug"]); // only the offenders are listed
    }
    expect(mgr.touched()).toBe(false);
    expect(mgr.items()[0].name).toBe("Lasagna"); // the allowed edit did NOT partially apply
  });
});

describe("serializeMarkdown round-trip", () => {
  it("keeps a date-like string a string", () => {
    const text = serializeMarkdown({ last_cooked: "2026-06-09", protein: "fish" }, "body\n");
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

  it("an injected normalize merges surface-form variants onto one canonical id", () => {
    // Pantry is food by construction, so production injects IngredientContext.resolve. A
    // resolver mapping both scallion surface forms to `green onion` merges the add into the
    // existing row rather than duplicating it.
    const normalize = (s: string): string =>
      ({ scallions: "green onion", "green onions": "green onion" })[s.toLowerCase()] ?? s.toLowerCase();
    const existing: PantryItem[] = [
      { name: "scallions", category: "fridge", quantity: "1 bunch", added_at: "2026-01-01", last_verified_at: "2026-06-01" },
    ];
    const res = applyPantryOperations(
      existing,
      [{ op: "add", item: { name: "green onions", quantity: "2 bunches" } }],
      "2026-06-09",
      normalize,
    );
    expect(res.items).toHaveLength(1);
    expect(res.applied).toEqual([{ op: "add", name: "green onions", merged: true }]);
    expect(res.items[0].quantity).toBe("2 bunches");
    expect(res.items[0].added_at).toBe("2026-01-01"); // preserved
  });

  it("a merge is keep-first: the surviving row keeps its name/display_name, not the incoming surface form (reify-ingredient-display-names)", () => {
    const normalize = (s: string): string =>
      ({ scallions: "green onion", "green onions": "green onion" })[s.toLowerCase()] ?? s.toLowerCase();
    const existing: PantryItem[] = [
      {
        name: "scallions",
        normalized_name: "green onion",
        display_name: "Scallions",
        category: "fridge",
        quantity: "1 bunch",
        added_at: "2026-01-01",
        last_verified_at: "2026-06-01",
      },
    ];
    const res = applyPantryOperations(
      existing,
      [{ op: "add", item: { name: "green onions", quantity: "2 bunches" } }],
      "2026-06-09",
      normalize,
    );
    expect(res.items).toHaveLength(1);
    expect(res.applied).toEqual([{ op: "add", name: "green onions", merged: true }]);
    const row = res.items[0];
    expect(row.name).toBe("scallions"); // keep-first: NOT overwritten with "green onions"
    expect(row.display_name).toBe("Scallions"); // display preserved across the merge
    expect(row.normalized_name).toBe("green onion"); // stored key preserved
    expect(row.quantity).toBe("2 bunches"); // other fields still overlaid
    expect(row.added_at).toBe("2026-01-01"); // original preserved
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
function collectTools(store: CorpusStore, username: string, env: Env = fakeD1([]).env) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerWriteTools(
    server as unknown as Parameters<typeof registerWriteTools>[0],
    store,
    env,
    username,
  );
  return handlers;
}

describe("update_aliases (D1-backed)", () => {
  it("upserts mappings into the D1 identity + alias tables as human edits, no git commit", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_aliases")!({
      aliases: { EVOO: "olive oil", scallions: "green onions" },
    });
    const out = JSON.parse(res.content[0].text) as { updated: number; commit_sha?: string };
    expect(out.updated).toBe(2);
    expect(out.commit_sha).toBeUndefined(); // D1-backed: not a GitHub commit
    // Variants are lowercased and written source='human' into the alias front-door.
    expect(d1.tables.ingredient_alias.map((r) => ({ variant: r.variant, id: r.id, source: r.source }))).toEqual([
      { variant: "evoo", id: "olive oil", source: "human" },
      { variant: "scallions", id: "green onions", source: "human" },
    ]);
    // The target ids are minted as base-level identity nodes.
    expect(d1.tables.ingredient_identity.map((r) => r.id).sort()).toEqual(["green onions", "olive oil"]);
  });

  it("re-writing a variant upserts (no duplicate row)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_aliases")!({ aliases: { EVOO: "olive oil" } });
    await handlers.get("update_aliases")!({ aliases: { EVOO: "extra virgin olive oil" } });
    expect(d1.tables.ingredient_alias.map((r) => ({ variant: r.variant, id: r.id }))).toEqual([
      { variant: "evoo", id: "extra virgin olive oil" },
    ]);
  });
});

describe("update_pantry / mark_pantry_verified (D1-backed)", () => {
  it("update_pantry add inserts a pantry row, no commit_sha", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
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
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "add", name: "butter" }] });
    const out = JSON.parse(res.content[0].text) as { applied: { op: string; name: string }[] };
    expect(out.applied).toContainEqual({ op: "add", name: "butter" });
    expect(d1.tables.pantry.map((i) => i.name)).toEqual(["butter"]);
  });

  it("a lone remove against an absent pantry reports a conflict and writes nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
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
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("mark_pantry_verified")!({ items: ["butter"] });
    const out = JSON.parse(res.content[0].text) as { verified: string[]; conflicts: { op: string; name: string }[] };
    expect(out.verified).toHaveLength(0);
    expect(out.conflicts).toContainEqual({ op: "verify", name: "butter", reason: "no pantry item with that name" });
    expect(d1.tables.pantry).toHaveLength(0); // no write
  });
});

describe("toggle_favorite / toggle_reject (subjective overlay write → D1)", () => {
  it("toggle_favorite writes only the caller's overlay row, no commit_sha", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("toggle_favorite")!({ slug: "miso-salmon", favorite: true });
    const out = JSON.parse(res.content[0].text) as { slug: string; overlay: Record<string, unknown>; commit_sha?: string };
    expect(out.slug).toBe("miso-salmon");
    expect(out.overlay).toEqual({ favorite: true });
    expect(out.commit_sha).toBeUndefined(); // D1-backed overlay, no git commit
    expect(d1.tables.overlay).toContainEqual(
      expect.objectContaining({ tenant: "everett", recipe: "miso-salmon", favorite: 1 }),
    );
  });

  it("toggle_reject hides a recipe for the caller via a single overlay row", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("toggle_reject")!({ slug: "miso-salmon", reject: true });
    const out = JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> };
    expect(out.overlay).toEqual({ reject: true });
    expect(d1.tables.overlay).toHaveLength(1);
    expect(d1.tables.overlay[0]).toMatchObject({ recipe: "miso-salmon", favorite: null, reject: 1 });
  });

  it("favorite and reject are mutually exclusive: rejecting clears a prior favorite", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("toggle_favorite")!({ slug: "miso-salmon", favorite: true });
    const res = await handlers.get("toggle_reject")!({ slug: "miso-salmon", reject: true });
    const out = JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> };
    expect(out.overlay).toEqual({ reject: true }); // favorite cleared
    expect(d1.tables.overlay).toHaveLength(1);
    expect(d1.tables.overlay[0]).toMatchObject({ recipe: "miso-salmon", favorite: null, reject: 1 });
  });

  it("un-favoriting clears the field, DELETEing a row with nothing else set", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("toggle_favorite")!({ slug: "miso-salmon", favorite: true });
    const res = await handlers.get("toggle_favorite")!({ slug: "miso-salmon", favorite: false });
    expect((JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> }).overlay).toEqual({});
    expect(d1.tables.overlay).toHaveLength(0);
  });

  it("toggle_reject rejects a slug not in the recipe index (not_found), writing nothing", async () => {
    const d1 = fakeD1([]); // no recipes
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("toggle_reject")!({ slug: "ghost", reject: true });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("not_found");
    expect(d1.tables.overlay).toHaveLength(0);
  });

  it("toggle_favorite rejects a malformed slug (not_found) before touching D1", async () => {
    const handlers = collectTools(storeWith({}), "everett", fakeD1(["miso-salmon"]).env);
    const res = await handlers.get("toggle_favorite")!({ slug: "Not A Slug", favorite: true });
    expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("not_found");
  });
});

describe("profile writes → D1 (staples / stockup / kitchen / ready-to-eat)", () => {
  it("update_staples upserts staple rows with a normalized_name", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
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
    const handlers = collectTools(storeWith({}), "everett", d1.env);
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
    const handlers = collectTools(storeWith({}), "everett", d1.env);
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
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("add_draft_ready_to_eat")!({
      items: [{ meal: "dinner", name: "Frozen Lasagna" }],
    });
    const out = JSON.parse(res.content[0].text) as { added: { slug: string }[] };
    expect(out.added[0].slug).toBe("frozen-lasagna");
    expect(d1.tables.ready_to_eat).toContainEqual(
      expect.objectContaining({ tenant: "everett", slug: "frozen-lasagna", meal: "dinner" }),
    );
  });
});

describe("update_preferences (merge-patch → D1)", () => {
  it("partial patch merges without clobbering siblings", async () => {
    const d1 = fakeD1([]);
    d1.tables.profile.push({ tenant: "everett", stores: JSON.stringify({ primary: "kroger" }) });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({
      patch: { stores: { preferred_location: "Kroger - 76137" } },
    });
    const stores = JSON.parse(d1.tables.profile[0].stores as string);
    expect(stores).toEqual({ primary: "kroger", preferred_location: "Kroger - 76137" });
  });

  it("brands tri-state: value UPSERTs, [] is don't-care, null DELETEs", async () => {
    const d1 = fakeD1([]);
    d1.tables.brand_prefs.push({ tenant: "everett", term: "canola_oil", ranks: '["Crisco"]' });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({
      patch: { brands: { olive_oil: ["Cobram"], yellow_onion: [], canola_oil: null } },
    });
    const byTerm = Object.fromEntries(d1.tables.brand_prefs.map((r) => [r.term, r.ranks]));
    expect(byTerm.olive_oil).toBe('["Cobram"]');
    expect(byTerm.yellow_onion).toBe("[]");
    expect("canola_oil" in byTerm).toBe(false); // deleted → ambiguous
  });

  it("normalizes the brand-pref key to the matcher's lookup form (quantity stripped, brandKey)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    // A raw, quantity-prefixed, mixed-case term must land under the SAME key the matcher reads:
    // brandKey(normalizeIngredient("2 lb Ground Beef")) === "ground_beef".
    await handlers.get("update_preferences")!({
      patch: { brands: { "2 lb Ground Beef": ["Laura's Lean"] } },
    });
    const byTerm = Object.fromEntries(d1.tables.brand_prefs.map((r) => [r.term, r.ranks]));
    expect(byTerm.ground_beef).toBe('["Laura\'s Lean"]');
    expect("2 lb Ground Beef" in byTerm).toBe(false);
  });

  it("rejects an unknown top-level key toward custom, storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { spice_tolerance: "high" } });
    const out = JSON.parse(res.content[0].text) as { error: string; message?: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/custom/);
    expect(d1.tables.profile).toHaveLength(0);
  });

  it("rejects a type-invalid merged result (bad enum), storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { lunch_strategy: "sometimes" } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("malformed_data");
    expect(d1.tables.profile).toHaveLength(0);
  });
});

describe("update_recipe (objective-only)", () => {
  // A contract-compliant base recipe, so a one-field objective patch produces a still
  // compliant merged result (the merged result is what the commit engine validates).
  const RECIPE_MD = [
    "---",
    "title: Salmon",
    "description: A simple weeknight salmon.",
    "ingredients_key: [salmon]",
    "course: [main]",
    "protein: fish",
    "cuisine: japanese",
    "time_total: null",
    "source: null",
    "dietary: []",
    "season: []",
    "tags: []",
    "pairs_with: []",
    "perishable_ingredients: []",
    "requires_equipment: []",
    'side_search_terms: ["a bright cucumber salad"]',
    "---",
    "",
    "## Ingredients",
    "- salmon",
    "",
    "## Instructions",
    "1. cook",
    "",
  ].join("\n");

  it("rejects a reject edit, directing the caller to toggle_reject, writing nothing", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { reject: true } });
    const out = JSON.parse(res.content[0].text) as { error: string; message?: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/toggle_reject/);
  });

  it("rejects a retired status edit (steered away from objective content)", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { status: "active" } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
  });

  it("rejects a favorite edit toward toggle_favorite", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { favorite: true } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/toggle_favorite/);
  });

  it("still rejects last_cooked toward log_cooked", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { last_cooked: "2026-06-09" } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/log_cooked/);
  });

  it("persists an objective frontmatter edit and returns updated_fields (no commit — R2)", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { time_total: 30 } });
    const out = JSON.parse(res.content[0].text) as { slug: string; updated_fields: string[]; commit_sha?: string };
    expect(out.slug).toBe("salmon");
    expect(out.updated_fields).toEqual(["time_total"]);
    expect(out.commit_sha).toBeUndefined(); // R2 single-object put — no git commit
  });

  it("validates the MERGED result: a one-field patch on a compliant recipe succeeds", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { cuisine: "korean" } });
    const out = JSON.parse(res.content[0].text) as { slug?: string; error?: string; commit_sha?: string };
    expect(out.error).toBeUndefined();
    expect(out.slug).toBe("salmon");
  });

  it("rejects a patch that empties a required field (merged result is non-compliant)", async () => {
    const handlers = collectTools(storeWith({ "recipes/salmon.md": RECIPE_MD }), "everett", fakeD1(["salmon"]).env);
    const res = await handlers.get("update_recipe")!({ slug: "salmon", updates: { ingredients_key: [] } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("validation_failed");
    expect(JSON.stringify(out)).toMatch(/ingredients_key/);
  });
});
