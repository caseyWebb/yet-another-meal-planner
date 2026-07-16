import { describe, it, expect } from "vitest";
import {
  buildRecipeUpdate,
  registerWriteTools,
} from "../src/write-tools.js";
import { applyPantryOperations, markVerified, pantryOperationShapeError, type PantryItem } from "../src/pantry-write.js";
import { serializeMarkdown } from "../src/serialize.js";
import { validateFile } from "../src/validate.js";
import { parseMarkdown } from "../src/parse.js";
import { createR2CorpusStore, type CorpusStore } from "../src/corpus-store.js";
import { fakeR2 } from "./fake-r2.js";
import { readPreferences } from "../src/profile-db.js";
import type { Env } from "../src/env.js";

const RECIPE = "---\ntitle: Salmon\ntime_total: 30\nlast_cooked: null\n---\n\n## Ingredients\n- salmon\n";

/** A corpus store backed by an in-memory R2 fake, seeded with `files`. */
function storeWith(files: Record<string, string>): CorpusStore {
  return createR2CorpusStore(fakeR2(files).bucket);
}

// An in-memory fake D1 covering the profile tables the write tools touch. It routes
// by SQL prefix/table: `SELECT 1 … FROM recipes` resolves a slug against `slugs`;
// SELECT/INSERT/DELETE against profile, overlay, staples, stockup, brand_prefs, and
// kitchen_equipment read/mutate per-table row stores. UPSERTs use the ON CONFLICT
// clause's primary key. Enough fidelity to assert real round-trips.
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
    pantry: [],
    waste_events: [],
    ingredient_identity: [],
    ingredient_alias: [],
    novel_ingredient_terms: [],
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
      const cols = /INSERT (?:OR IGNORE )?INTO \w+ \(([^)]+)\)/.exec(sql)![1].split(",").map((c) => c.trim());
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
              : table === "kitchen_equipment"
                ? ["tenant", "slug"]
                : table === "ingredient_alias"
                  ? ["variant"]
                  : table === "ingredient_identity"
                    ? ["id"]
                    : table === "waste_events"
                      ? ["tenant", "id"]
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

  it("adds with a top-level name and merges item fields (an off-vocab category is dropped with a warning)", () => {
    const res = applyPantryOperations(
      items,
      [{ op: "add", name: "garlic", item: { category: "aromatics", note: "staple" } }],
      "2026-06-09",
    );
    expect(res.conflicts).toHaveLength(0);
    expect(res.applied).toEqual([{ op: "add", name: "garlic" }]);
    const garlic = res.items.find((i) => i.name === "garlic")!;
    expect(garlic).toMatchObject({ name: "garlic", note: "staple", added_at: "2026-06-09" });
    // "aromatics" is off the food taxonomy: accepted-and-dropped, never a rejection (D21).
    expect(garlic.category).toBeUndefined();
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ op: "add", name: "garlic", field: "category" }),
    );
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

describe("applyPantryOperations — dispose + vocabulary validation (pantry-disposition-foundations)", () => {
  const base = (): PantryItem[] => [
    {
      name: "cilantro",
      normalized_name: "cilantro",
      quantity: "1 bunch",
      category: "produce",
      location: "fridge",
      prepared_from: null,
      added_at: "2026-06-01",
    },
    {
      name: "cooked rice",
      normalized_name: "cooked rice",
      quantity: "partial",
      prepared_from: "salmon-with-rice",
    },
  ];

  it("dispose used removes the row and drafts NO waste event", () => {
    const res = applyPantryOperations(base(), [{ op: "dispose", name: "cilantro", disposition: "used" }], "2026-07-01");
    expect(res.applied).toEqual([{ op: "dispose", name: "cilantro", disposition: "used" }]);
    expect(res.items.map((i) => i.name)).toEqual(["cooked rice"]);
    expect(res.wasteEvents).toHaveLength(0);
  });

  it("dispose waste removes the row and drafts one event with the row's snapshot", () => {
    const res = applyPantryOperations(
      base(),
      [{ op: "dispose", name: "cilantro", disposition: "waste", reason: "over_ripe", occurred_at: "2026-06-30" }],
      "2026-07-01",
    );
    expect(res.applied).toEqual([{ op: "dispose", name: "cilantro", disposition: "waste" }]);
    expect(res.wasteEvents).toEqual([
      {
        name: "cilantro",
        item_id: "cilantro",
        prepared_from: null,
        quantity: "1 bunch",
        category: "produce",
        reason: "over_ripe",
        occurred_at: "2026-06-30",
      },
    ]);
  });

  it("a disposed leftover's draft carries prepared_from (the leftovers stamp input)", () => {
    const res = applyPantryOperations(
      base(),
      [{ op: "dispose", name: "cooked rice", disposition: "waste", reason: "forgot" }],
      "2026-07-01",
    );
    expect(res.wasteEvents[0]).toMatchObject({ item_id: "cooked rice", prepared_from: "salmon-with-rice" });
  });

  it("dispose of an absent row is a per-op conflict", () => {
    const res = applyPantryOperations(base(), [{ op: "dispose", name: "ghost", disposition: "waste", reason: "forgot" }], "2026-07-01");
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts).toContainEqual({ op: "dispose", name: "ghost", reason: "no pantry item with that name" });
  });

  it("shape violations are signaled by pantryOperationShapeError (validation_failed, not conflicts)", () => {
    expect(pantryOperationShapeError({ op: "dispose", name: "x" }, 0)).toMatch(/disposition/);
    expect(pantryOperationShapeError({ op: "dispose", name: "x", disposition: "waste" }, 0)).toMatch(/reason/);
    expect(pantryOperationShapeError({ op: "dispose", name: "x", disposition: "waste", reason: "vibes" }, 0)).toMatch(/reason/);
    expect(
      pantryOperationShapeError({ op: "dispose", name: "x", disposition: "waste", reason: "forgot", event_id: "bad id!" }, 0),
    ).toMatch(/event_id/);
    expect(
      pantryOperationShapeError({ op: "dispose", name: "x", disposition: "waste", reason: "forgot", occurred_at: "June 30" }, 0),
    ).toMatch(/occurred_at/);
    // Well-shaped ops (dispose and non-dispose) pass.
    expect(
      pantryOperationShapeError(
        { op: "dispose", name: "x", disposition: "waste", reason: "forgot", event_id: "01JXYZ", occurred_at: "2026-06-30" },
        0,
      ),
    ).toBeNull();
    expect(pantryOperationShapeError({ op: "dispose", name: "x", disposition: "used" }, 0)).toBeNull();
    expect(pantryOperationShapeError({ op: "add", item: { name: "x" } }, 0)).toBeNull();
  });

  it("an off-vocabulary location is a per-op conflict, never a silent write", () => {
    const res = applyPantryOperations(base(), [{ op: "add", item: { name: "peas", location: "garage" } }], "2026-07-01");
    expect(res.applied).toHaveLength(0);
    expect(res.conflicts).toContainEqual(
      expect.objectContaining({ op: "add", name: "peas", reason: expect.stringContaining("location") }),
    );
    expect(res.items.find((i) => i.name === "peas")).toBeUndefined();
  });

  it("a legacy location-flavored category transposes onto location for the deprecation window", () => {
    const res = applyPantryOperations(base(), [{ op: "add", item: { name: "peas", category: "freezer" } }], "2026-07-01");
    expect(res.applied).toEqual([{ op: "add", name: "peas" }]);
    const peas = res.items.find((i) => i.name === "peas")!;
    expect(peas.location).toBe("freezer");
    expect(peas.category).toBeUndefined();
    expect(res.warnings).toContainEqual(expect.objectContaining({ op: "add", name: "peas", field: "category" }));
    // "spices" is ALSO a 14-vocab food category — the vocab check wins on WRITE (D7's
    // ordering), so it stores as the category; only the READ filter maps it onto location.
    const res2 = applyPantryOperations(base(), [{ op: "add", item: { name: "cumin", category: "spices" } }], "2026-07-01");
    const cumin = res2.items.find((i) => i.name === "cumin")!;
    expect(cumin.category).toBe("spices");
    expect(cumin.location).toBeUndefined();
  });

  it("an in-vocabulary category and location are stored as given", () => {
    const res = applyPantryOperations(
      base(),
      [{ op: "add", item: { name: "flour", category: "baking", location: "cabinet" } }],
      "2026-07-01",
    );
    expect(res.warnings).toHaveLength(0);
    expect(res.items.find((i) => i.name === "flour")).toMatchObject({ category: "baking", location: "cabinet" });
  });

  it("an off-vocabulary category is accepted-and-dropped with a warning (the shipped app's 'other')", () => {
    const res = applyPantryOperations(base(), [{ op: "add", item: { name: "peas", category: "other" } }], "2026-07-01");
    expect(res.applied).toEqual([{ op: "add", name: "peas" }]);
    const peas = res.items.find((i) => i.name === "peas")!;
    expect(peas.category).toBeUndefined();
    expect(peas.location).toBeUndefined();
    expect(res.warnings).toContainEqual(
      expect.objectContaining({ op: "add", name: "peas", field: "category", reason: expect.stringContaining("off-vocabulary") }),
    );
  });

  it("a dropped category on a merge preserves the existing row's category", () => {
    const res = applyPantryOperations(
      base(),
      [{ op: "add", item: { name: "cilantro", category: "other", quantity: "2 bunches" } }],
      "2026-07-01",
    );
    const cilantro = res.items.find((i) => i.name === "cilantro")!;
    expect(cilantro.category).toBe("produce"); // the bad incoming value never clobbers
    expect(cilantro.quantity).toBe("2 bunches");
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
// `registerWriteTools` no longer takes a corpus store (update_recipe left the MCP
// surface); `_store` is kept as a parameter so every existing call site below —
// most of which have nothing to do with recipe content — needs no change.
function collectTools(_store: CorpusStore, username: string, env: Env = fakeD1([]).env) {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { text: string }[] }>>();
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (input: unknown) => Promise<{ content: { text: string }[] }>) => {
      handlers.set(name, handler);
    },
  };
  registerWriteTools(
    server as unknown as Parameters<typeof registerWriteTools>[0],
    env,
    username,
  );
  return handlers;
}

// update_aliases leaves the MCP surface (ingredient-normalization, data-write-tools):
// human alias/display-name overrides are an operator admin write over the same shared
// `addAliases` operation now — see test/corpus-db.test.ts for its coverage.

describe("update_pantry (D1-backed) — pantry ops, verify, and the absorbed kitchen ops", () => {
  it("update_pantry add inserts a pantry row, no commit_sha (a legacy category transposes onto location)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({
      operations: [{ op: "add", item: { name: "butter", category: "fridge" } }],
    });
    const out = JSON.parse(res.content[0].text) as {
      applied: { op: string; name: string }[];
      conflicts: unknown[];
      warnings?: { op: string; name: string; field: string }[];
      commit_sha?: string;
    };
    expect(out.applied).toContainEqual({ op: "add", name: "butter" });
    expect(out.conflicts).toHaveLength(0);
    expect(out.commit_sha).toBeUndefined(); // D1-backed: no git commit
    // The D21 shim: "fridge" is a legacy location-flavored category — transposed onto
    // `location`, category stored NULL, flagged in `warnings`.
    expect(out.warnings).toContainEqual(expect.objectContaining({ op: "add", name: "butter", field: "category" }));
    expect(d1.tables.pantry).toHaveLength(1);
    expect(d1.tables.pantry[0]).toMatchObject({
      tenant: "everett",
      name: "butter",
      location: "fridge",
      category: null,
      normalized_name: "butter",
    });
  });

  it("update_pantry dispose(waste) removes the row and returns applied; missing reason is validation_failed", async () => {
    const d1 = fakeD1([]);
    d1.tables.pantry.push({
      tenant: "everett",
      name: "cilantro",
      normalized_name: "cilantro",
      quantity: "1 bunch",
      category: "produce",
      location: "fridge",
      prepared_from: null,
      added_at: "2026-06-01",
      last_verified_at: "2026-06-01",
      notes: null,
    });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({
      operations: [{ op: "dispose", name: "cilantro", disposition: "waste", reason: "over_ripe" }],
    });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: unknown[] };
    expect(out.applied).toContainEqual({ op: "dispose", name: "cilantro", disposition: "waste" });
    expect(d1.tables.pantry).toHaveLength(0);
    expect(d1.tables.waste_events).toHaveLength(1);
    expect(d1.tables.waste_events[0]).toMatchObject({ tenant: "everett", item_id: "cilantro", department: "produce", reason: "over_ripe" });

    // Shape violation: waste without a reason is a whole-call validation_failed, nothing written.
    const bad = await handlers.get("update_pantry")!({
      operations: [{ op: "dispose", name: "ghost", disposition: "waste" }],
    });
    const err = JSON.parse(bad.content[0].text) as { error?: string };
    expect(err.error).toBe("validation_failed");
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

  it("update_pantry verify resets last_verified_at — the sole verification surface (mark_pantry_verified retired)", async () => {
    const d1 = fakeD1([]);
    d1.tables.pantry.push({
      tenant: "everett",
      name: "Olive Oil",
      normalized_name: "olive oil",
      quantity: "low",
      last_verified_at: "2026-06-01",
    });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({
      operations: [{ op: "verify", name: "Olive Oil" }],
    });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: unknown[] };
    expect(out.applied).toHaveLength(1);
    expect(out.conflicts).toHaveLength(0);
    expect(d1.tables.pantry[0].last_verified_at).not.toBe("2026-06-01");
  });

  it("update_pantry verify against an absent item is a conflict, writes nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "verify", name: "butter" }] });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: { op: string; name: string }[] };
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toContainEqual({ op: "verify", name: "butter", reason: "no pantry item with that name" });
    expect(d1.tables.pantry).toHaveLength(0); // no write
  });

  it("update_pantry equip adds an owned equipment slug; unequip removes it (kitchen-equipment)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({
      operations: [
        { op: "equip", slug: "blender" },
        { op: "set_kitchen_note", key: "ovens", value: 2 },
      ],
    });
    const out = JSON.parse(res.content[0].text) as { applied: { op: string; target: string }[]; conflicts: unknown[] };
    expect(out.applied).toEqual(
      expect.arrayContaining([{ op: "equip", target: "blender" }, { op: "set_kitchen_note", target: "ovens" }]),
    );
    expect(out.conflicts).toHaveLength(0);
    expect(d1.tables.kitchen_equipment).toContainEqual({ tenant: "everett", slug: "blender" });
    expect(JSON.parse(d1.tables.profile[0].kitchen_notes as string)).toEqual({ ovens: 2 });

    const removed = await handlers.get("update_pantry")!({ operations: [{ op: "unequip", slug: "blender" }] });
    const removedOut = JSON.parse(removed.content[0].text) as { applied: { op: string; target: string }[] };
    expect(removedOut.applied).toEqual([{ op: "unequip", target: "blender" }]);
    expect(d1.tables.kitchen_equipment).toHaveLength(0);
  });

  it("update_pantry equip is idempotent for an already-owned slug (no-op, not a conflict)", async () => {
    const d1 = fakeD1([]);
    d1.tables.kitchen_equipment.push({ tenant: "everett", slug: "blender" });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "equip", slug: "blender" }] });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: unknown[] };
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toHaveLength(0);
    expect(d1.tables.kitchen_equipment).toHaveLength(1);
  });

  it("update_pantry equip of an off-vocabulary slug is a conflict, never a silent write", async () => {
    const handlers = collectTools(storeWith({}), "everett", fakeD1([]).env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "equip", slug: "air-fryer" }] });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: { op: string; target: string }[] };
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toEqual([
      { op: "equip", target: "air-fryer", reason: expect.stringContaining("not a known equipment slug") },
    ]);
  });

  it("update_pantry unequip of an absent slug is a conflict", async () => {
    const handlers = collectTools(storeWith({}), "everett", fakeD1([]).env);
    const res = await handlers.get("update_pantry")!({ operations: [{ op: "unequip", slug: "blender" }] });
    const out = JSON.parse(res.content[0].text) as { applied: unknown[]; conflicts: { op: string; target: string }[] };
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toEqual([{ op: "unequip", target: "blender", reason: expect.any(String) }]);
  });

  it("a single call mixing pantry and kitchen ops applies both independently", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_pantry")!({
      operations: [
        { op: "add", item: { name: "butter", category: "fridge" } },
        { op: "equip", slug: "sous-vide-circulator" },
      ],
    });
    const out = JSON.parse(res.content[0].text) as { applied: { op: string }[] };
    expect(out.applied.map((a) => a.op).sort()).toEqual(["add", "equip"]);
    expect(d1.tables.pantry.map((i) => i.name)).toEqual(["butter"]);
    expect(d1.tables.kitchen_equipment).toContainEqual({ tenant: "everett", slug: "sous-vide-circulator" });
  });
});

describe("update_kitchen / update_staples / update_stockup — retired MCP tools", () => {
  it("leave the surface: the underlying operations (setKitchen/updateStaples/addStockup) are unit-tested on their own, and update_pantry's equip/unequip/set_kitchen_note ops absorb kitchen edits (kitchen-equipment)", () => {
    const handlers = collectTools(storeWith({}), "everett", fakeD1([]).env);
    expect(handlers.has("update_kitchen")).toBe(false);
    expect(handlers.has("update_staples")).toBe(false);
    expect(handlers.has("update_stockup")).toBe(false);
    expect(handlers.has("mark_pantry_verified")).toBe(false);
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

describe("set_recipe_disposition (data-write-tools) — the fused verb toggle_favorite/toggle_reject alias onto", () => {
  it("favorite sets the flag and clears any prior hide", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("set_recipe_disposition")!({ slug: "miso-salmon", disposition: "hide" });
    const res = await handlers.get("set_recipe_disposition")!({ slug: "miso-salmon", disposition: "favorite" });
    const out = JSON.parse(res.content[0].text) as { slug: string; overlay: Record<string, unknown>; commit_sha?: string };
    expect(out.slug).toBe("miso-salmon");
    expect(out.overlay).toEqual({ favorite: true }); // hide cleared by construction
    expect(out.commit_sha).toBeUndefined();
    expect(d1.tables.overlay).toHaveLength(1);
    expect(d1.tables.overlay[0]).toMatchObject({ recipe: "miso-salmon", favorite: 1, reject: null });
  });

  it("hide sets the reject flag and clears any prior favorite", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("set_recipe_disposition")!({ slug: "miso-salmon", disposition: "favorite" });
    const res = await handlers.get("set_recipe_disposition")!({ slug: "miso-salmon", disposition: "hide" });
    const out = JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> };
    expect(out.overlay).toEqual({ reject: true });
    expect(d1.tables.overlay[0]).toMatchObject({ recipe: "miso-salmon", favorite: null, reject: 1 });
  });

  it("none clears both flags, deleting the row when nothing else is set", async () => {
    const d1 = fakeD1(["miso-salmon"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("set_recipe_disposition")!({ slug: "miso-salmon", disposition: "favorite" });
    const res = await handlers.get("set_recipe_disposition")!({ slug: "miso-salmon", disposition: "none" });
    const out = JSON.parse(res.content[0].text) as { overlay: Record<string, unknown> };
    expect(out.overlay).toEqual({});
    expect(d1.tables.overlay).toHaveLength(0);
  });

  it("rejects an unknown slug with a structured not_found, writing nothing", async () => {
    const d1 = fakeD1([]); // no recipes
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("set_recipe_disposition")!({ slug: "ghost", disposition: "favorite" });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("not_found");
    expect(d1.tables.overlay).toHaveLength(0);
  });

  it("toggle_favorite/toggle_reject (the alias pair) and set_recipe_disposition converge on the identical overlay row", async () => {
    // Alias dispatch parity (mcp-tool-gating D3): a stale toggle_reject(true) call and
    // an equivalent set_recipe_disposition(slug, \"hide\") call land the SAME overlay
    // state for two different (but equivalent) recipes.
    const d1 = fakeD1(["recipe-a", "recipe-b"]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const viaAlias = await handlers.get("toggle_reject")!({ slug: "recipe-a", reject: true });
    const viaFused = await handlers.get("set_recipe_disposition")!({ slug: "recipe-b", disposition: "hide" });
    const aliasOut = JSON.parse(viaAlias.content[0].text) as { overlay: Record<string, unknown> };
    const fusedOut = JSON.parse(viaFused.content[0].text) as { overlay: Record<string, unknown> };
    expect(aliasOut.overlay).toEqual(fusedOut.overlay);
    expect(aliasOut.overlay).toEqual({ reject: true });
  });
});

describe("the ready-to-eat write tools are gone (remove-ready-to-eat)", () => {
  it("add_draft_ready_to_eat and update_ready_to_eat are not registered by registerWriteTools", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    expect(handlers.has("add_draft_ready_to_eat")).toBe(false);
    expect(handlers.has("update_ready_to_eat")).toBe(false);
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

  it("brands tri-state: tier object UPSERTs, { any_brand: true } is don't-care, null DELETEs", async () => {
    const d1 = fakeD1([]);
    d1.tables.brand_prefs.push({ tenant: "everett", term: "canola_oil", tiers: '[["Crisco"]]', any_brand: 0 });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({
      patch: {
        brands: {
          olive_oil: { tiers: [["Cobram", "California Olive Ranch"], ["Cento"]] },
          yellow_onion: { any_brand: true },
          canola_oil: null,
        },
      },
    });
    const byTerm = Object.fromEntries(d1.tables.brand_prefs.map((r) => [r.term, r]));
    expect(byTerm.olive_oil).toMatchObject({
      tiers: '[["Cobram","California Olive Ranch"],["Cento"]]',
      any_brand: 0,
    });
    expect(byTerm.yellow_onion).toMatchObject({ tiers: "[]", any_brand: 1 }); // don't-care
    expect("canola_oil" in byTerm).toBe(false); // deleted → ambiguous
    // A fully-current patch carries NO warnings.
    expect(JSON.parse(res.content[0].text)).toEqual({ updated: "preferences" });
  });

  it("a partial family patch UPSERTs the MERGED value (stored tiers preserved)", async () => {
    const d1 = fakeD1([]);
    d1.tables.profile.push({ tenant: "everett" }); // the write path always upserts the singleton row
    d1.tables.brand_prefs.push({
      tenant: "everett",
      term: "butter",
      tiers: '[["Challenge"],["Kerrygold"]]',
      any_brand: 0,
    });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({
      patch: { brands: { butter: { any_brand: true } } },
    });
    expect(d1.tables.brand_prefs).toContainEqual(
      expect.objectContaining({ term: "butter", tiers: '[["Challenge"],["Kerrygold"]]', any_brand: 1 }),
    );
  });

  it("accepts a legacy flat rank list for one window, converting it and warning", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({
      patch: { brands: { butter: ["Challenge", "Kerrygold"], yellow_onion: [] } },
    });
    const out = JSON.parse(res.content[0].text) as {
      updated: string;
      warnings?: { key: string; reason: string; superseded_by: string }[];
    };
    expect(out.updated).toBe("preferences"); // the stale write SUCCEEDS — never bounced
    expect(out.warnings).toEqual(
      expect.arrayContaining([
        { key: "brands.butter", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }" },
        { key: "brands.yellow_onion", reason: "deprecated_shape", superseded_by: "{ tiers, any_brand }" },
      ]),
    );
    const byTerm = Object.fromEntries(d1.tables.brand_prefs.map((r) => [r.term, r]));
    expect(byTerm.butter).toMatchObject({ tiers: '[["Challenge"],["Kerrygold"]]', any_brand: 0 });
    expect(byTerm.yellow_onion).toMatchObject({ tiers: "[]", any_brand: 1 });
  });

  it("rejects the all-empty family value toward null, storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({
      patch: { brands: { butter: { tiers: [], any_brand: false } } },
    });
    const out = JSON.parse(res.content[0].text) as { error: string; message: string };
    expect(out.error).toBe("malformed_data");
    expect(out.message).toMatch(/null/);
    expect(d1.tables.brand_prefs).toHaveLength(0);
  });

  it("rejects a brand duplicated across tiers, storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({
      patch: { brands: { butter: { tiers: [["Kerrygold"], ["kerrygold", "Plugra"]] } } },
    });
    const out = JSON.parse(res.content[0].text) as { error: string; message: string };
    expect(out.error).toBe("malformed_data");
    expect(out.message).toMatch(/kerrygold/i);
    expect(d1.tables.brand_prefs).toHaveLength(0);
  });

  it("a validation-rejected brands patch enqueues NO novel terms (stores nothing on failure)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    // "dragonfruit jam" is novel to the (empty) identity graph, but the family value
    // is invalid — the resolve for key computation must not capture it.
    const res = await handlers.get("update_preferences")!({
      patch: { brands: { "dragonfruit jam": { tiers: [], any_brand: false } } },
    });
    expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("malformed_data");
    expect(d1.tables.novel_ingredient_terms).toHaveLength(0);
    expect(d1.tables.brand_prefs).toHaveLength(0);
  });

  it("a valid brands patch still captures its novel term for the graph (deferred past validation)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({
      patch: { brands: { "dragonfruit jam": { tiers: [["Bonne Maman"]] } } },
    });
    expect(d1.tables.novel_ingredient_terms).toContainEqual(
      expect.objectContaining({ term: "dragonfruit jam" }),
    );
  });

  it("weekly_budget round-trips as a defined scalar: set → read → null deletes", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({ patch: { weekly_budget: 95 } });
    expect(d1.tables.profile[0]).toMatchObject({ tenant: "everett", weekly_budget: 95 });
    // The assembled preferences object (the read_user_profile source) carries it.
    expect((await readPreferences(d1.env, "everett"))?.weekly_budget).toBe(95);

    // null deletes back to unset — the profile column clears and the read hides it.
    await handlers.get("update_preferences")!({ patch: { weekly_budget: null } });
    expect(d1.tables.profile[0].weekly_budget).toBeNull();
    expect((await readPreferences(d1.env, "everett"))?.weekly_budget).toBeUndefined();
  });

  it("weekly_budget rejects a negative or non-numeric value with malformed_data, storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    for (const bad of [-5, "95"]) {
      const res = await handlers.get("update_preferences")!({ patch: { weekly_budget: bad } });
      expect((JSON.parse(res.content[0].text) as { error: string }).error).toBe("malformed_data");
    }
    expect(d1.tables.profile).toHaveLength(0);
  });

  it("normalizes the brand-pref key to the matcher's lookup form (quantity stripped, brandKey)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    // A raw, quantity-prefixed, mixed-case term must land under the SAME key the matcher reads:
    // brandKey(normalizeIngredient("2 lb Ground Beef")) === "ground_beef".
    await handlers.get("update_preferences")!({
      patch: { brands: { "2 lb Ground Beef": { tiers: [["Laura's Lean"]] } } },
    });
    const byTerm = Object.fromEntries(d1.tables.brand_prefs.map((r) => [r.term, r]));
    expect(byTerm.ground_beef).toMatchObject({ tiers: '[["Laura\'s Lean"]]', any_brand: 0 });
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

  it("rejects a type-invalid merged result (bad cadence), storing nothing", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { cadence: { dinner: 9 } } });
    const out = JSON.parse(res.content[0].text) as { error: string };
    expect(out.error).toBe("malformed_data");
    expect(d1.tables.profile).toHaveLength(0);
  });

  it("accepts-and-drops a retired key with a warnings entry — never validation_failed, never the custom hint, nothing stored (D21)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { lunch_strategy: "sometimes, off-enum even" } });
    const out = JSON.parse(res.content[0].text) as { updated?: string; warnings?: unknown[]; error?: string };
    expect(out.error).toBeUndefined();
    expect(out.updated).toBe("preferences");
    expect(out.warnings).toEqual([{ key: "lunch_strategy", reason: "retired", superseded_by: "meal vibes" }]);
    // Dropped: no profile column written, and nothing routed into custom.
    expect(d1.tables.profile.filter((r) => r.lunch_strategy != null)).toHaveLength(0);
    expect(d1.tables.profile.filter((r) => r.custom != null)).toHaveLength(0);
  });

  it("aliases default_cooking_nights onto cadence.dinner with a warning, never writing the frozen column", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_preferences")!({ patch: { default_cooking_nights: 4 } });
    const out = JSON.parse(res.content[0].text) as { updated?: string; warnings?: unknown[] };
    expect(out.updated).toBe("preferences");
    expect(out.warnings).toEqual([{ key: "default_cooking_nights", reason: "aliased", superseded_by: "cadence.dinner" }]);
    const row = d1.tables.profile[0];
    expect(JSON.parse(row.cadence as string)).toEqual({ dinner: 4 });
    expect(row.default_cooking_nights ?? null).toBeNull();
  });

  it("cadence merges PER KEY over the stored map", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_preferences")!({ patch: { cadence: { breakfast: 0, lunch: 0, dinner: 5 } } });
    await handlers.get("update_preferences")!({ patch: { cadence: { lunch: 2 } } });
    expect(JSON.parse(d1.tables.profile[0].cadence as string)).toEqual({ breakfast: 0, lunch: 2, dinner: 5 });
    // Per-key null clears one meal; cadence: null clears the map.
    await handlers.get("update_preferences")!({ patch: { cadence: { dinner: null } } });
    expect(JSON.parse(d1.tables.profile[0].cadence as string)).toEqual({ breakfast: 0, lunch: 2 });
    await handlers.get("update_preferences")!({ patch: { cadence: null } });
    expect(d1.tables.profile[0].cadence ?? null).toBeNull();
  });
});

// update_recipe leaves the MCP surface (data-write-tools, recipe-discovery): member
// recipe editing belongs to the web app; the retained `buildRecipeUpdate` operation
// core (its merge/canonicalization behavior) is covered by the "buildRecipeUpdate"
// describe block above, which the future admin merge screen will reuse directly.
describe("update_recipe / update_kitchen / update_staples / update_stockup / update_aliases / mark_pantry_verified — retired MCP tools", () => {
  it("none of the retired tools register", () => {
    const handlers = collectTools(storeWith({}), "everett", fakeD1([]).env);
    for (const name of ["update_recipe", "update_kitchen", "update_staples", "update_stockup", "update_aliases", "mark_pantry_verified"]) {
      expect(handlers.has(name), `${name} should not be registered`).toBe(false);
    }
  });
});

describe("update_taste (data-write-tools) — replace (default) vs. append mode", () => {
  it("replace (default, no mode) overwrites the narrative verbatim", async () => {
    const d1 = fakeD1([]);
    d1.tables.profile.push({ tenant: "everett", taste: "loves garlic" });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    const res = await handlers.get("update_taste")!({ content: "loves ginger instead" });
    const out = JSON.parse(res.content[0].text) as { updated: string; commit_sha?: string };
    expect(out.updated).toBe("taste");
    expect(out.commit_sha).toBeUndefined();
    expect(d1.tables.profile[0].taste).toBe("loves ginger instead");
  });

  it("append adds to the end with a blank-line separator, preserving the existing narrative", async () => {
    const d1 = fakeD1([]);
    d1.tables.profile.push({ tenant: "everett", taste: "loves garlic" });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_taste")!({ content: "dislikes cilantro", mode: "append" });
    expect(d1.tables.profile[0].taste).toBe("loves garlic\n\ndislikes cilantro");
  });

  it("append onto a null/absent narrative behaves as replace (no leading separator)", async () => {
    const d1 = fakeD1([]);
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_taste")!({ content: "loves garlic", mode: "append" });
    expect(d1.tables.profile[0].taste).toBe("loves garlic");
  });

  it("update_diet_principles stays replace-only (no mode parameter)", async () => {
    const d1 = fakeD1([]);
    d1.tables.profile.push({ tenant: "everett", diet_principles: "no shellfish" });
    const handlers = collectTools(storeWith({}), "everett", d1.env);
    await handlers.get("update_diet_principles")!({ content: "no shellfish, low sodium" });
    expect(d1.tables.profile[0].diet_principles).toBe("no shellfish, low sodium");
  });
});
