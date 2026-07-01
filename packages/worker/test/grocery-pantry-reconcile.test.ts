import { describe, it, expect } from "vitest";
import { fakeD1 } from "./fake-d1.js";
import { planReconcile, reconcileGroceryPantryKeys, runReconcileJob, RECONCILE_JOB } from "../src/grocery-pantry-reconcile.js";
import { readJobHealth } from "../src/health.js";

// The D2 backfill: re-key stale FOOD grocery/pantry rows from a `normalizeName` key onto the
// canonical id (`resolve`), merging collisions. `planReconcile` is the pure core; the driver
// wires it to the D1 tables + the shared resolver.

interface GRow {
  tenant: string;
  normalized_name: string;
  name: string;
  quantity: string | null;
  kind: string | null;
  domain: string | null;
  status: string | null;
  source: string | null;
  for_recipes: string | null;
  note: string | null;
  added_at: string | null;
  ordered_at: string | null;
}

function grow(over: Partial<GRow> & { name: string; normalized_name: string }): GRow {
  return {
    tenant: "t1",
    quantity: "1",
    kind: "grocery",
    domain: "grocery",
    status: "active",
    source: "ad_hoc",
    for_recipes: "[]",
    note: null,
    added_at: "2026-06-01",
    ordered_at: null,
    ...over,
  };
}

// A resolver that collapses scallion surface forms onto one canonical id (else lowercase).
const resolve = (n: string): string =>
  ({ scallions: "green onion", "green onions": "green onion" })[n.trim().toLowerCase()] ?? n.trim().toLowerCase();
const gkey = (r: GRow): string => (r.kind === "grocery" && (r.domain ?? "grocery") === "grocery" ? resolve(r.name) : r.name.toLowerCase());

describe("planReconcile (pure grouping/delete logic)", () => {
  const keep = (rs: GRow[]) => rs[0]; // trivial merge — grouping/delete is what's under test here

  it("skips a row already keyed on its canonical id", () => {
    expect(planReconcile([grow({ name: "eggs", normalized_name: "eggs" })], gkey, keep)).toEqual([]);
  });

  it("re-keys a stale singleton: delete the old PK, upsert under the target", () => {
    const plans = planReconcile([grow({ name: "scallions", normalized_name: "scallions" })], gkey, keep); // → "green onion"
    expect(plans).toHaveLength(1);
    expect(plans[0].deletes).toEqual([{ tenant: "t1", normalized_name: "scallions" }]);
    expect(plans[0].upsert.name).toBe("scallions");
  });

  it("groups a collision (two surface forms) into ONE plan, deleting both stale PKs", () => {
    const rows = [
      grow({ name: "scallions", normalized_name: "scallions" }),
      grow({ name: "green onions", normalized_name: "green onions" }),
    ];
    const plans = planReconcile(rows, gkey, keep);
    expect(plans).toHaveLength(1);
    expect(new Set(plans[0].deletes.map((d) => d.normalized_name))).toEqual(new Set(["scallions", "green onions"]));
  });

  it("does not delete a canonical PK in a collision — only the stale one moves", () => {
    const rows = [
      grow({ name: "green onion", normalized_name: "green onion" }), // already canonical
      grow({ name: "scallions", normalized_name: "scallions" }), // stale, same target
    ];
    const plans = planReconcile(rows, gkey, keep);
    expect(plans).toHaveLength(1);
    expect(plans[0].deletes).toEqual([{ tenant: "t1", normalized_name: "scallions" }]); // NOT "green onion"
  });
});

// --- driver, over the real resolver + fake D1 -------------------------------

function seed(grocery: GRow[], pantry: Record<string, unknown>[] = []) {
  return fakeD1({
    tables: {
      grocery_list: grocery as unknown as Record<string, unknown>[],
      pantry,
      ingredient_identity: [{ id: "green onion", base: "green onion", representative: null }],
      ingredient_alias: [
        { variant: "scallions", id: "green onion" },
        { variant: "green onions", id: "green onion" },
      ],
      novel_ingredient_terms: [],
    },
  });
}

describe("reconcileGroceryPantryKeys (driver)", () => {
  it("re-keys a stale food grocery row onto the canonical id, dropping the old PK", async () => {
    const { env, tables } = seed([grow({ name: "scallions", normalized_name: "scallions" })]);
    const res = await reconcileGroceryPantryKeys(env);
    expect(res.grocery_rekeyed).toBe(1);
    const keys = tables.grocery_list.map((r) => r.normalized_name);
    expect(keys).toEqual(["green onion"]); // old "scallions" PK gone, one canonical row
    expect(tables.grocery_list[0].name).toBe("scallions"); // display name untouched
  });

  it("merges a real collision into one row without losing for_recipes / status / added_at", async () => {
    const { env, tables } = seed([
      grow({ name: "scallions", normalized_name: "scallions", for_recipes: '["stir-fry"]', added_at: "2026-06-05" }),
      grow({ name: "green onions", normalized_name: "green onions", for_recipes: '["tacos"]', added_at: "2026-06-01", status: "in_cart" }),
    ]);
    await reconcileGroceryPantryKeys(env);
    expect(tables.grocery_list).toHaveLength(1);
    const row = tables.grocery_list[0];
    expect(row.normalized_name).toBe("green onion");
    expect(JSON.parse(row.for_recipes as string).sort()).toEqual(["stir-fry", "tacos"]);
    expect(row.status).toBe("in_cart"); // most-advanced status survives
    expect(row.added_at).toBe("2026-06-01"); // earliest added_at survives
  });

  it("leaves a non-food row on normalizeName (never resolved)", async () => {
    const { env, tables } = seed([
      grow({ name: "scallions", normalized_name: "scallions", kind: "household", domain: "home-improvement" }),
    ]);
    const res = await reconcileGroceryPantryKeys(env);
    expect(res.grocery_rekeyed).toBe(0);
    expect(tables.grocery_list[0].normalized_name).toBe("scallions"); // unchanged
  });

  it("is idempotent — a second pass over canonical rows re-keys nothing", async () => {
    const { env } = seed([grow({ name: "scallions", normalized_name: "scallions" })]);
    await reconcileGroceryPantryKeys(env);
    const res2 = await reconcileGroceryPantryKeys(env);
    expect(res2).toEqual({ grocery_rekeyed: 0, pantry_rekeyed: 0, truncated: false });
  });

  it("re-keys a stale food pantry row too", async () => {
    const { env, tables } = seed(
      [],
      [
        {
          tenant: "t1",
          name: "scallions",
          normalized_name: "scallions",
          quantity: "partial",
          category: "fridge",
          prepared_from: null,
          added_at: "2026-06-01",
          last_verified_at: "2026-06-10",
          notes: null,
        },
      ],
    );
    const res = await reconcileGroceryPantryKeys(env);
    expect(res.pantry_rekeyed).toBe(1);
    expect(tables.pantry.map((r) => r.normalized_name)).toEqual(["green onion"]);
    expect(tables.pantry[0].quantity).toBe("partial");
  });
});

// --- job wrapper: records `grocery-reconcile` health + rethrows on failure ---

describe("runReconcileJob (observability wrapper)", () => {
  it("records a healthy grocery-reconcile job_health with a counts-only summary", async () => {
    const { env } = seed([grow({ name: "scallions", normalized_name: "scallions" })]);
    await runReconcileJob(env);
    const health = await readJobHealth(env, RECONCILE_JOB);
    expect(health).not.toBeNull();
    expect(health!.ok).toBe(true);
    expect(health!.summary).toEqual({ grocery_rekeyed: 1, pantry_rekeyed: 0, truncated: false });
  });

  it("rethrows on a storage failure so the cron status reflects it", async () => {
    // A DB whose every statement throws — the reconcile read fails, the wrapper rethrows.
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return this;
            },
            async all() {
              throw new Error("D1_ERROR: unreachable");
            },
            async first() {
              throw new Error("D1_ERROR: unreachable");
            },
            async run() {
              throw new Error("D1_ERROR: unreachable");
            },
          };
        },
        async batch() {
          throw new Error("D1_ERROR: unreachable");
        },
      },
    } as unknown as import("../src/env.js").Env;
    await expect(runReconcileJob(env)).rejects.toThrow();
  });
});
