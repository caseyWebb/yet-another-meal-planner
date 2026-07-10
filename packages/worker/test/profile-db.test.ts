import { describe, it, expect } from "vitest";
import {
  readProfile,
  readPreferences,
  readOverlay,
  readBrandPrefs,
  readBrandTiers,
  brandStmt,
  setOverlay,
  setStaples,
} from "../src/profile-db.js";
import type { Env } from "../src/env.js";

// A tiny in-memory D1 keyed by table, routing by SQL. Enough to exercise the read
// assembly + the row writers' SQL/bind contract (a live round-trip is a deploy probe).
function fakeD1(tables: Record<string, Record<string, unknown>[]>): {
  env: Env;
  tables: Record<string, Record<string, unknown>[]>;
} {
  const store: Record<string, Record<string, unknown>[]> = {
    profile: [],
    brand_prefs: [],
    kitchen_equipment: [],
    staples: [],
    overlay: [],
    ready_to_eat: [],
    stockup: [],
    ...tables,
  };
  const tableOf = (sql: string): string | null => {
    const m = /(?:FROM|INTO|UPDATE)\s+(\w+)/i.exec(sql);
    return m ? m[1] : null;
  };
  const exec = (sql: string, binds: unknown[]) => {
    const table = tableOf(sql)!;
    if (/^SELECT/i.test(sql)) {
      const tenant = binds[0];
      let rows = (store[table] ?? []).filter((r) => r.tenant === tenant);
      if (sql.includes("recipe = ?2")) rows = rows.filter((r) => r.recipe === binds[1]);
      return { rows, changes: 0 };
    }
    if (/^DELETE/i.test(sql)) {
      const before = store[table].length;
      store[table] = store[table].filter((r) => {
        if (r.tenant !== binds[0]) return true;
        if (sql.includes("recipe = ?2")) return r.recipe !== binds[1];
        if (sql.includes("term = ?2")) return r.term !== binds[1];
        return false;
      });
      return { rows: [], changes: before - store[table].length };
    }
    if (/^INSERT/i.test(sql)) {
      const cols = /INSERT INTO \w+ \(([^)]+)\)/.exec(sql)![1].split(",").map((c) => c.trim());
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = binds[i] ?? null));
      const pk =
        table === "overlay"
          ? ["tenant", "recipe"]
          : table === "brand_prefs"
            ? ["tenant", "term"]
            : ["tenant", "normalized_name"];
      const idx = store[table].findIndex((r) => pk.every((k) => r[k] === row[k]));
      if (idx >= 0 && /ON CONFLICT/i.test(sql)) store[table][idx] = { ...store[table][idx], ...row };
      else store[table].push(row);
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
  return { env: { DB } as unknown as Env, tables: store };
}

describe("readPreferences", () => {
  it("reconstructs preferences from the profile row + brand_prefs rows", async () => {
    const { env } = fakeD1({
      profile: [
        {
          tenant: "everett",
          default_cooking_nights: 3,
          lunch_strategy: "leftovers",
          stores: JSON.stringify({ primary: "kroger" }),
          dietary: JSON.stringify({ avoid: [], limit: ["cilantro"] }),
          custom: null,
        },
      ],
      brand_prefs: [
        { tenant: "everett", term: "olive_oil", tiers: '[["Cobram"]]', any_brand: 0 },
        { tenant: "everett", term: "yellow_onion", tiers: "[]", any_brand: 1 },
      ],
    });
    const prefs = await readPreferences(env, "everett");
    expect(prefs).toEqual({
      default_cooking_nights: 3,
      lunch_strategy: "leftovers",
      stores: { primary: "kroger" },
      dietary: { avoid: [], limit: ["cilantro"] },
      // Canonical tier objects — BOTH fields always present, never a bare array.
      brands: {
        olive_oil: { tiers: [["Cobram"]], any_brand: false },
        yellow_onion: { tiers: [], any_brand: true },
      },
    });
  });

  it("tolerates a malformed stored tiers value as don't-care", async () => {
    const { env } = fakeD1({
      profile: [{ tenant: "everett", default_cooking_nights: 3 }],
      brand_prefs: [{ tenant: "everett", term: "butter", tiers: "not json", any_brand: 0 }],
    });
    const prefs = await readPreferences(env, "everett");
    expect(prefs).toMatchObject({ brands: { butter: { tiers: [], any_brand: true } } });
  });

  it("returns null when there is no profile row", async () => {
    const { env } = fakeD1({});
    expect(await readPreferences(env, "ghost")).toBeNull();
  });

  it("includes planning_cadence_days when set, and omits it when null", async () => {
    const { env } = fakeD1({
      profile: [
        { tenant: "everett", default_cooking_nights: 3, planning_cadence_days: 14 },
      ],
    });
    const prefs = await readPreferences(env, "everett");
    expect(prefs).toMatchObject({ planning_cadence_days: 14 });

    const { env: env2 } = fakeD1({
      profile: [{ tenant: "everett", default_cooking_nights: 3, planning_cadence_days: null }],
    });
    const prefs2 = await readPreferences(env2, "everett");
    expect(prefs2).not.toHaveProperty("planning_cadence_days");
  });
});

describe("readBrandTiers", () => {
  it("maps term → canonical tier object", async () => {
    const { env } = fakeD1({
      brand_prefs: [
        { tenant: "everett", term: "olive_oil", tiers: '[["A","B"],["C"]]', any_brand: 0 },
        { tenant: "everett", term: "onion", tiers: "[]", any_brand: 1 },
      ],
    });
    expect(await readBrandTiers(env, "everett")).toEqual({
      olive_oil: { tiers: [["A", "B"], ["C"]], any_brand: false },
      onion: { tiers: [], any_brand: true },
    });
  });
});

describe("readBrandPrefs (the matcher-facing projection)", () => {
  it("flattens singleton tiers byte-identical to the legacy ranked lists", async () => {
    // The migrated production fixtures (design.md D2): each legacy rank became its
    // own tier, so the projection reproduces the pre-migration lists exactly.
    const { env } = fakeD1({
      brand_prefs: [
        { tenant: "everett", term: "butter", tiers: '[["Challenge"],["Tillamook"],["Kerrygold"]]', any_brand: 0 },
        { tenant: "everett", term: "canned_tomatoes", tiers: '[["DeLallo"],["Muir Glen"],["Cento"]]', any_brand: 0 },
        { tenant: "everett", term: "paper_towels", tiers: '[["Viva"]]', any_brand: 0 },
      ],
    });
    expect(await readBrandPrefs(env, "everett")).toEqual({
      butter: ["Challenge", "Tillamook", "Kerrygold"],
      canned_tomatoes: ["DeLallo", "Muir Glen", "Cento"],
      paper_towels: ["Viva"],
    });
  });

  it("flattens a multi-brand tier in tier order, and don't-care to []", async () => {
    const { env } = fakeD1({
      brand_prefs: [
        { tenant: "everett", term: "olive_oil", tiers: '[["A","B"],["C"]]', any_brand: 0 },
        { tenant: "everett", term: "onion", tiers: "[]", any_brand: 1 },
      ],
    });
    expect(await readBrandPrefs(env, "everett")).toEqual({ olive_oil: ["A", "B", "C"], onion: [] });
  });
});

describe("brandStmt", () => {
  it("UPSERTs the canonical tiers/any_brand columns and DELETEs on null", async () => {
    const { env, tables } = fakeD1({});
    const d1 = (env as unknown as { DB: { batch(s: unknown[]): Promise<unknown[]> } }).DB;
    await d1.batch([brandStmt(env, "everett", "butter", { tiers: [["Challenge"], ["Kerrygold"]] })]);
    expect(tables.brand_prefs).toContainEqual(
      expect.objectContaining({
        tenant: "everett",
        term: "butter",
        tiers: '[["Challenge"],["Kerrygold"]]',
        any_brand: 0,
      }),
    );
    await d1.batch([brandStmt(env, "everett", "butter", { tiers: [], any_brand: true })]);
    expect(tables.brand_prefs).toContainEqual(
      expect.objectContaining({ term: "butter", tiers: "[]", any_brand: 1 }),
    );
    await d1.batch([brandStmt(env, "everett", "butter", null)]);
    expect(tables.brand_prefs).toHaveLength(0);
  });
});

describe("readOverlay / setOverlay", () => {
  it("round-trips a favorite row through the overlay table", async () => {
    const { env, tables } = fakeD1({});
    await setOverlay(env, "everett", "tacos", { favorite: true });
    expect(tables.overlay).toContainEqual(
      expect.objectContaining({ tenant: "everett", recipe: "tacos", favorite: 1, reject: null }),
    );
    expect(await readOverlay(env, "everett")).toEqual({ tacos: { favorite: true } });
  });

  it("round-trips a reject row, storing favorite as NULL", async () => {
    const { env, tables } = fakeD1({});
    await setOverlay(env, "everett", "tacos", { reject: true });
    expect(tables.overlay).toContainEqual(
      expect.objectContaining({ tenant: "everett", recipe: "tacos", favorite: null, reject: 1 }),
    );
    expect(await readOverlay(env, "everett")).toEqual({ tacos: { reject: true } });
  });

  it("DELETEs the row when given null", async () => {
    const { env, tables } = fakeD1({ overlay: [{ tenant: "everett", recipe: "tacos", favorite: 1, reject: null }] });
    await setOverlay(env, "everett", "tacos", null);
    expect(tables.overlay).toHaveLength(0);
  });
});

describe("setStaples", () => {
  it("delete-then-inserts with a normalized_name", async () => {
    const { env, tables } = fakeD1({});
    await setStaples(env, "everett", [{ name: "Olive Oil" }, { name: "Eggs", perishable: true }]);
    expect(tables.staples.map((r) => r.normalized_name).sort()).toEqual(["eggs", "olive oil"]);
    expect(tables.staples.find((r) => r.name === "Eggs")!.perishable).toBe(1);
  });
});

describe("readProfile assembly", () => {
  it("assembles the full agent-facing shape from rows", async () => {
    const { env } = fakeD1({
      profile: [
        {
          tenant: "everett",
          taste: "spicy",
          diet_principles: "fish weekly",
          default_cooking_nights: 3,
          stores: JSON.stringify({ primary: "kroger" }),
          kitchen_notes: JSON.stringify({ ovens: 2 }),
          freezer_capacity_estimate: "moderate",
        },
      ],
      kitchen_equipment: [{ tenant: "everett", slug: "blender" }],
      staples: [{ tenant: "everett", name: "Eggs", normalized_name: "eggs", perishable: 1 }],
      stockup: [{ tenant: "everett", name: "Salmon", normalized_name: "salmon", unit: "lb" }],
      ready_to_eat: [
        { tenant: "everett", slug: "oats", meal: "breakfast", name: "Oats", favorite: 1, reject: null },
      ],
    });
    const profile = await readProfile(env, "everett");
    expect(profile.taste).toBe("spicy");
    expect(profile.diet_principles).toBe("fish weekly");
    expect(profile.preferences).toMatchObject({ default_cooking_nights: 3, stores: { primary: "kroger" } });
    expect(profile.kitchen).toEqual({ owned: ["blender"], notes: { ovens: 2 } });
    expect(profile.staples).toEqual([{ name: "Eggs", perishable: true }]);
    expect(profile.stockup).toMatchObject({ freezer_capacity_estimate: "moderate" });
    expect(profile.ready_to_eat[0]).toMatchObject({ slug: "oats", meal: "breakfast", favorite: true, reject: false });
  });

  it("an absent tenant assembles an empty profile (null preferences, empty lists)", async () => {
    const { env } = fakeD1({});
    const profile = await readProfile(env, "ghost");
    expect(profile.preferences).toBeNull();
    expect(profile.taste).toBeNull();
    expect(profile.kitchen).toEqual({ owned: [], notes: {} });
    expect(profile.staples).toEqual([]);
    expect(profile.ready_to_eat).toEqual([]);
    expect(profile.stockup).toBeNull();
  });
});
