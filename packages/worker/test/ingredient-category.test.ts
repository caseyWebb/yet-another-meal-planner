import { describe, it, expect } from "vitest";
import {
  reconcileCategories,
  runCategoryJob,
  buildCategoryDeps,
  CATEGORY_JOB,
  type CategoryDeps,
  type UnclassifiedIdentity,
} from "../src/ingredient-category.js";
import { readIngredientCategoryMemo } from "../src/corpus-db.js";
import { readJobHealth } from "../src/health.js";
import { fakeD1 } from "./fake-d1.js";

// The identity-category convergence pass (pantry-disposition-foundations design D6):
// classify → pantry backfill → event stamp, each bounded + idempotent, tested through
// injected deps (the runNormalizeJob idiom) with an in-memory store.

interface Store {
  identities: { id: string; display_name: string | null; category: string | null }[];
  pantry: { tenant: string; normalized_name: string; category: string | null }[];
  events: { tenant: string; id: string; item_id: string; department: string | null }[];
}

function depsOver(
  store: Store,
  classify: (items: UnclassifiedIdentity[]) => Promise<Record<string, string> | null>,
  calls: { classify: number } = { classify: 0 },
): CategoryDeps {
  return {
    unclassified: async (limit) =>
      store.identities.filter((r) => r.category == null).slice(0, limit).map(({ id, display_name }) => ({ id, display_name })),
    classifyBatch: (items) => {
      calls.classify++;
      return classify(items);
    },
    writeMemo: async (id, category) => {
      const row = store.identities.find((r) => r.id === id);
      if (row && row.category == null) row.category = category;
    },
    pantryPending: async () =>
      store.pantry.filter((r) => r.category == null).map(({ tenant, normalized_name }) => ({ tenant, normalized_name })),
    fillPantryCategory: async (tenant, key, category) => {
      const row = store.pantry.find((r) => r.tenant === tenant && r.normalized_name === key);
      if (row && row.category == null) row.category = category;
    },
    eventsPending: async () =>
      store.events.filter((r) => r.department == null).map(({ tenant, id, item_id }) => ({ tenant, id, item_id })),
    stampEventDepartment: async (tenant, id, department) => {
      const row = store.events.find((r) => r.tenant === tenant && r.id === id);
      if (row && row.department == null) row.department = department;
    },
    memoLookup: async (keys) => {
      const out = new Map<string, string>();
      for (const key of keys) {
        const cat = store.identities.find((r) => r.id === key)?.category;
        if (cat) out.set(key, cat);
      }
      return out;
    },
    backlog: async () => store.identities.filter((r) => r.category == null).length,
    now: () => 1_752_192_000_000,
    batches: 2,
    batchSize: 2,
  };
}

describe("reconcileCategories", () => {
  it("classify writes only in-vocab answers and defers unparseable/off-vocab for retry", async () => {
    const store: Store = {
      identities: [
        { id: "cilantro", display_name: "Cilantro", category: null },
        { id: "aa batteries", display_name: null, category: null },
        { id: "mystery", display_name: null, category: null },
      ],
      pantry: [],
      events: [],
    };
    const summary = await reconcileCategories(
      depsOver(store, async () => ({
        cilantro: "produce",
        "aa batteries": "household",
        mystery: "weird stuff", // off-vocab → left NULL, retried later
      })),
    );
    expect(summary.classified).toBe(2);
    expect(store.identities.find((r) => r.id === "cilantro")!.category).toBe("produce");
    expect(store.identities.find((r) => r.id === "aa batteries")!.category).toBe("household");
    expect(store.identities.find((r) => r.id === "mystery")!.category).toBeNull();
    expect(summary.backlog).toBe(1);
  });

  it("a transient classify failure leaves the batch NULL and never fails the tick's later phases", async () => {
    const store: Store = {
      identities: [
        { id: "cilantro", display_name: null, category: null },
        { id: "green onion", display_name: null, category: "produce" },
      ],
      pantry: [{ tenant: "casey", normalized_name: "green onion", category: null }],
      events: [],
    };
    const summary = await reconcileCategories(
      depsOver(store, async () => {
        throw new Error("AI outage");
      }),
    );
    expect(store.identities.find((r) => r.id === "cilantro")!.category).toBeNull(); // NULL is the retry state
    expect(summary.pantry_filled).toBe(1); // phase 2 still ran off the standing memo
    expect(store.pantry[0].category).toBe("produce");
  });

  it("pantry fill skips non-NULL rows and household identities (food vocab only)", async () => {
    const store: Store = {
      identities: [
        { id: "green onion", display_name: null, category: "produce" },
        { id: "paper towels", display_name: null, category: "household" },
      ],
      pantry: [
        { tenant: "casey", normalized_name: "green onion", category: null },
        { tenant: "casey", normalized_name: "paper towels", category: null },
        // Member-set values are pinned — never overwritten even when the memo disagrees.
        { tenant: "everett", normalized_name: "green onion", category: "condiments" },
      ],
      events: [],
    };
    const summary = await reconcileCategories(depsOver(store, async () => ({})));
    expect(summary.pantry_filled).toBe(1);
    expect(store.pantry[0].category).toBe("produce");
    expect(store.pantry[1].category).toBeNull(); // household never lands on a pantry row
    expect(store.pantry[2].category).toBe("condiments"); // pinned
  });

  it("event stamp fills NULL departments only (household included) and never rewrites", async () => {
    const store: Store = {
      identities: [
        { id: "green onion", display_name: null, category: "produce" },
        { id: "paper towels", display_name: null, category: "household" },
      ],
      pantry: [],
      events: [
        { tenant: "casey", id: "01A", item_id: "green onion", department: null },
        { tenant: "casey", id: "01B", item_id: "paper towels", department: null },
        { tenant: "casey", id: "01C", item_id: "green onion", department: "leftovers" }, // stamped — immutable
        { tenant: "casey", id: "01D", item_id: "unknown thing", department: null }, // no memo yet — stays pending
      ],
    };
    const summary = await reconcileCategories(depsOver(store, async () => ({})));
    expect(summary.events_stamped).toBe(2);
    expect(store.events[0].department).toBe("produce");
    expect(store.events[1].department).toBe("household"); // any memo value, household included
    expect(store.events[2].department).toBe("leftovers"); // never rewritten
    expect(store.events[3].department).toBeNull();
  });

  it("self-terminates: an empty backlog performs no model calls and reports a no-op run", async () => {
    const store: Store = {
      identities: [{ id: "cilantro", display_name: null, category: "produce" }],
      pantry: [{ tenant: "casey", normalized_name: "cilantro", category: "produce" }],
      events: [{ tenant: "casey", id: "01A", item_id: "cilantro", department: "produce" }],
    };
    const calls = { classify: 0 };
    const summary = await reconcileCategories(depsOver(store, async () => ({}), calls));
    expect(calls.classify).toBe(0); // nothing unclassified → no model call
    expect(summary).toEqual({ classified: 0, pantry_filled: 0, events_stamped: 0, backlog: 0 });
  });

  it("bounds phase 1 to batches × batchSize per tick", async () => {
    const store: Store = {
      identities: Array.from({ length: 7 }, (_, i) => ({ id: `item-${i}`, display_name: null, category: null })),
      pantry: [],
      events: [],
    };
    const calls = { classify: 0 };
    const summary = await reconcileCategories(
      depsOver(store, async (items) => Object.fromEntries(items.map((it) => [it.id, "snacks"])), calls),
    );
    expect(calls.classify).toBe(2); // 2 batches of 2 (deps.batchSize = 2)
    expect(summary.classified).toBe(4); // bounded — the rest wait for later ticks
    expect(summary.backlog).toBe(3);
  });
});

describe("readIngredientCategoryMemo (the shared memo funnel)", () => {
  it("resolves a key via identity / alias / representative and prefers the survivor's own value", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          { id: "green onion", base: "green onion", representative: null, category: "produce" },
          { id: "scallion", base: "scallion", representative: "green onion", category: null },
          { id: "unclassified thing", base: "unclassified thing", representative: null, category: null },
        ],
        ingredient_alias: [
          { variant: "scallions", id: "scallion" },
          { variant: "green onions", id: "green onion" },
        ],
        novel_ingredient_terms: [],
      },
    });
    const memo = await readIngredientCategoryMemo(env, [
      "green onion", // direct id
      "scallion", // merged loser id → survivor's category
      "scallions", // alias variant → merged id → survivor
      "unclassified thing", // no memo → absent
      "never seen", // unknown → absent
    ]);
    expect(memo.get("green onion")).toBe("produce");
    expect(memo.get("scallion")).toBe("produce");
    expect(memo.get("scallions")).toBe("produce");
    expect(memo.has("unclassified thing")).toBe(false);
    expect(memo.has("never seen")).toBe(false);
  });
});

describe("runCategoryJob (observability wrapper) + buildCategoryDeps SQL", () => {
  it("records ingredient-category job_health with the counts summary over the real deps", async () => {
    const { env } = fakeD1({
      tables: {
        ingredient_identity: [
          // Already classified — the SQL selection must skip it (category IS NULL).
          { id: "green onion", base: "green onion", representative: null, concrete: 1, category: "produce" },
          // A merged loser and a concept node — never selected.
          { id: "scallion", base: "scallion", representative: "green onion", concrete: 1, category: null },
          { id: "hot sauces (various)", base: "hot sauces (various)", representative: null, concrete: 0, category: null },
        ],
        ingredient_alias: [],
        novel_ingredient_terms: [],
        pantry: [{ tenant: "casey", name: "Scallions", normalized_name: "green onion", category: null, prepared_from: null }],
        waste_events: [],
        job_runs: [],
      },
    });
    await runCategoryJob(env, buildCategoryDeps(env));
    const health = await readJobHealth(env, CATEGORY_JOB);
    expect(health).not.toBeNull();
    expect(health!.ok).toBe(true);
    // No unclassified concrete survivors → zero classify work; the standing memo fills the pantry row.
    expect(health!.summary).toMatchObject({ classified: 0, pantry_filled: 1, events_stamped: 0 });
  });
});
