import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRetrospective, registerCookingTools } from "../src/cooking-tools.js";
import { readSpendAnalyzer } from "../src/spend.js";
import { readWasteAnalyzer } from "../src/waste-analyzer.js";
import type { Env } from "../src/env.js";
import { sqliteEnv } from "./sqlite-d1.js";
import { invokeTool, withServer } from "./tool-harness.js";

// A fake D1Database that routes by SQL: the `cooking_log LEFT JOIN recipes` window
// query returns `joinRows`; `SELECT * FROM recipes` returns `recipeRows`.
// `throwOnRecipes` simulates an unreadable recipes table (index_unavailable).
function envWith(
  joinRows: Record<string, unknown>[],
  recipeRows: Record<string, unknown>[],
  opts: { throwOnRecipes?: boolean } = {},
): Env {
  const makeStmt = (sql: string) => {
    const stmt = {
      bind() {
        return stmt;
      },
      async all<T>() {
        if (sql.includes("FROM cooking_log")) {
          return { results: joinRows as T[], success: true as const, meta: { changes: 0 } };
        }
        if (sql.includes("FROM recipes")) {
          if (opts.throwOnRecipes) throw new Error("no such table: recipes");
          return { results: recipeRows as T[], success: true as const, meta: { changes: 0 } };
        }
        return { results: [] as T[], success: true as const, meta: { changes: 0 } };
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { success: true as const, meta: { changes: 0 } };
      },
    };
    return stmt;
  };
  const DB = {
    prepare: (sql: string) => makeStmt(sql) as unknown as D1PreparedStatement,
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { DB } as unknown as Env;
}

// One D1 `recipes` row (objective columns only — JSON arrays as TEXT).
const TACOS_ROW = {
  slug: "tacos",
  title: "Tacos",
  protein: "beef",
  cuisine: "mexican",
  time_total: null,
  ingredients_key: null,
  source_url: null,
  tags: null,
  course: null,
  season: null,
  dietary: null,
  pairs_with: null,
  perishable_ingredients: null,
  requires_equipment: null,
  extra: null,
};

describe("loadRetrospective — D1 cooking_log + recipe index", () => {
  it("aggregates protein/cuisine from the joined cooking_log rows", async () => {
    // The join row carries protein/cuisine already COALESCE'd in (recipe-derived).
    const joinRows = [{ type: "recipe", date: "2026-06-10", recipe: "tacos", name: null, protein: "beef", cuisine: "mexican" }];
    const env = envWith(joinRows, [TACOS_ROW]);
    const r = await loadRetrospective(env, "everett", "all");
    expect(r.recipes_cooked.find((x) => x.recipe === "tacos")).toBeTruthy();
    expect(r.protein_mix.beef).toBe(1);
    expect(r.cuisine_mix.mexican).toBe(1);
  });

  it("counts a non-recipe entry's inline dims", async () => {
    const joinRows = [{ type: "ad_hoc", date: "2026-06-11", recipe: null, name: "stir fry", protein: "chicken", cuisine: null }];
    const env = envWith(joinRows, []);
    const r = await loadRetrospective(env, "everett", "all");
    expect(r.protein_mix.chicken).toBe(1);
    expect(r.cuisine_mix.unknown).toBe(1);
  });

  it("surfaces index_unavailable when the recipes table is unreadable", async () => {
    const joinRows = [{ type: "recipe", date: "2026-06-10", recipe: "tacos", name: null, protein: "beef", cuisine: "mexican" }];
    const env = envWith(joinRows, [], { throwOnRecipes: true });
    await expect(loadRetrospective(env, "everett", "all")).rejects.toMatchObject({
      code: "index_unavailable",
    });
  });

  it("validates the Waste mapping before recipe-index storage reads", async () => {
    const env = envWith([], [], { throwOnRecipes: true });
    await expect(
      loadRetrospective(env, "everett", "all", "4w", "4w", "waste-avoidability-unknown"),
    ).rejects.toMatchObject({
      code: "validation_failed",
      message: "unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1",
    });
  });

  it("an empty log is not an error — empty history", async () => {
    const env = envWith([], []);
    const r = await loadRetrospective(env, "everett", "all");
    expect(r.recipes_cooked).toEqual([]);
  });
});

describe("retrospective MCP Spend and Waste adapters", () => {
  function seedSpend(
    h: ReturnType<typeof sqliteEnv>,
    tenant: string,
    sendId: string,
    amount: number,
  ): void {
    h.raw.prepare(
      "INSERT INTO spend_events (send_id,line_key,tenant,occurred_on,name,sku,quantity,unit_price,amount,savings,estimated,department,provenance,store,fulfillment,voided_at) " +
        "VALUES (?,?,?,?,?,NULL,1,?,?,0,0,'produce','planned','kroger','kroger_online',NULL)",
    ).run(sendId, sendId.toLowerCase(), tenant, new Date().toISOString().slice(0, 10), sendId, amount, amount);
  }

  function seedWaste(
    h: ReturnType<typeof sqliteEnv>,
    tenant: string,
    id: string,
    item: string,
    reason: string,
  ): void {
    const today = new Date().toISOString().slice(0, 10);
    h.raw.prepare(
      "INSERT INTO waste_events " +
        "(tenant,id,name,item_id,prepared_from,quantity,department,reason,occurred_at,created_at) " +
        "VALUES (?,?,?,?,NULL,'1','produce',?,?,?)",
    ).run(tenant, id, item, item, reason, today, `${today}T12:00:00.000Z`);
  }

  it("registers the exact retrospective read selectors and leaves source tables unchanged", async () => {
    const h = sqliteEnv(["everett", "casey"]);
    seedSpend(h, "everett", "OWN", 24);
    seedSpend(h, "casey", "OTHER", 900);
    seedWaste(h, "everett", "W-OWN", "own", "forgot");
    seedWaste(h, "casey", "W-OTHER", "other", "spoiled");
    h.raw.prepare(
      "INSERT INTO cooking_log (tenant,date,type,recipe,meal) VALUES (?,?,?,?,?)",
    ).run("everett", new Date().toISOString().slice(0, 10), "recipe", "stew", "dinner");
    const server = new McpServer({ name: "retrospective-spend-test", version: "0" });
    registerCookingTools(server, h.env, "everett");
    const stateBefore = {
      spend: h.rows("spend_events"),
      waste: h.rows("waste_events"),
      cooking: h.rows("cooking_log"),
    };

    await withServer(server, async (client) => {
      const tools = (await client.listTools()).tools;
      const retrospectiveTool = tools.find((tool) => tool.name === "retrospective")!;
      expect(retrospectiveTool.description).toMatch(/period.*recipes_cooked.*protein_mix.*cuisine_mix/is);
      expect(retrospectiveTool.description).toMatch(/missing dimensions.*unknown/is);
      expect(retrospectiveTool.description).toMatch(/meal-aware.*cadence.*cooks_per_week.*by_meal.*meal_unknown.*NULL-meal.*never assigned a fabricated meal/is);
      expect(retrospectiveTool.description).toMatch(/ready_to_eat.*retirement/is);
      expect(retrospectiveTool.description).not.toMatch(/cook_vs_convenience/is);
      expect(retrospectiveTool.description).not.toMatch(/ready_to_eat_favorites/is);
      expect(retrospectiveTool.description).toMatch(/underused.*independent of period.*favorites plus revealed favorites.*3 times.*12 months.*fixed 30 days.*in season.*rejected recipes are excluded/is);
      expect(retrospectiveTool.description).toMatch(/why.*favorite.*revealed.*all-time.*cook_count.*stalest-first.*capped at 15.*underused_count.*pre-cap/is);
      expect(retrospectiveTool.description).toMatch(/spend_range.*4w.*8w.*12w/is);
      expect(retrospectiveTool.description).toMatch(/Spend analyzer.*independent of cooking period.*UTC ISO-Monday.*coverage-aware totals.*awaiting_mark_placed/is);
      expect(retrospectiveTool.description).toMatch(/waste_range.*4w.*8w.*12w.*default.*4w/is);
      expect(retrospectiveTool.description).toMatch(/waste_mapping_version.*immutable avoidability mapping.*default current/is);
      expect(retrospectiveTool.description).toMatch(/Waste analyzer.*captured Waste.*last-paid Spend history.*coverage.*weekly buckets.*KPIs.*breakdowns.*most-wasted.*insight/is);
      expect(retrospectiveTool.description).toMatch(/read-only/is);
      const properties = (retrospectiveTool.inputSchema as {
        properties?: Record<string, unknown>;
      }).properties ?? {};
      expect(Object.keys(properties).sort()).toEqual([
        "period",
        "spend_range",
        "waste_mapping_version",
        "waste_range",
      ]);
      expect(properties).not.toHaveProperty("range");
      expect(properties).not.toHaveProperty("mapping_version");

      const omitted = await invokeTool(client, "retrospective", { period: "week" });
      expect(omitted.isError).toBe(false);
      const omittedResult = omitted.result as {
        period: string;
        spend: { range: string; weeks: unknown[]; coverage: { monetary: { known_amount: number } } };
        waste: {
          range: string;
          weeks: unknown[];
          coverage: { monetary: { event_count: number; known_amount: number } };
          avoidability_mapping: { version: string; current_version: string; is_current: boolean };
        };
      };
      expect(omittedResult.period).toBe("week");
      expect(omittedResult.spend.range).toBe("4w");
      expect(omittedResult.spend.weeks).toHaveLength(4);
      expect(omittedResult.spend.coverage.monetary.known_amount).toBe(24);
      expect(omittedResult.waste).toMatchObject({
        range: "4w",
        coverage: { monetary: { event_count: 1, known_amount: 24 } },
        avoidability_mapping: {
          version: "waste-avoidability-v1",
          current_version: "waste-avoidability-v1",
          is_current: true,
        },
      });
      expect(omittedResult.waste.weeks).toHaveLength(4);
      expect(omittedResult.waste).toEqual(await readWasteAnalyzer(h.env, "everett", "4w"));

      const explicit = await invokeTool(client, "retrospective", {
        period: "all",
        spend_range: "12w",
        waste_range: "8w",
        waste_mapping_version: "waste-avoidability-v1",
      });
      expect(explicit.isError).toBe(false);
      const explicitResult = explicit.result as {
        period: string;
        spend: Awaited<ReturnType<typeof readSpendAnalyzer>>;
        waste: Awaited<ReturnType<typeof readWasteAnalyzer>>;
      };
      expect(explicitResult.period).toBe("all");
      expect(explicitResult.spend.range).toBe("12w");
      expect(explicitResult.spend.weeks).toHaveLength(12);
      expect(explicitResult.spend).toEqual(await readSpendAnalyzer(h.env, "everett", "12w"));
      expect(explicitResult.waste.range).toBe("8w");
      expect(explicitResult.waste.weeks).toHaveLength(8);
      expect(explicitResult.waste).toEqual(
        await readWasteAnalyzer(h.env, "everett", "8w", "waste-avoidability-v1"),
      );

      const twelveWeekWaste = await invokeTool(client, "retrospective", {
        period: "month",
        spend_range: "4w",
        waste_range: "12w",
      });
      expect(twelveWeekWaste.isError).toBe(false);
      expect(twelveWeekWaste.result).toMatchObject({
        period: "month",
        spend: { range: "4w", weeks: expect.any(Array) },
        waste: { range: "12w", weeks: expect.any(Array) },
      });
      expect((twelveWeekWaste.result as { spend: { weeks: unknown[] }; waste: { weeks: unknown[] } }).spend.weeks).toHaveLength(4);
      expect((twelveWeekWaste.result as { spend: { weeks: unknown[] }; waste: { weeks: unknown[] } }).waste.weeks).toHaveLength(12);

      const invalid = await invokeTool(client, "retrospective", { spend_range: "quarter" });
      expect(invalid).toMatchObject({ isError: true, result: { error: "validation_failed" } });

      const invalidWasteRange = await invokeTool(client, "retrospective", { waste_range: "quarter" });
      expect(invalidWasteRange).toMatchObject({ isError: true, result: { error: "validation_failed" } });

      const unknownMapping = await invokeTool(client, "retrospective", {
        waste_mapping_version: "waste-avoidability-unknown",
      });
      expect(unknownMapping).toMatchObject({
        isError: true,
        result: {
          error: "validation_failed",
          message: "unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1",
        },
      });
    });

    expect({
      spend: h.rows("spend_events"),
      waste: h.rows("waste_events"),
      cooking: h.rows("cooking_log"),
    }).toEqual(stateBefore);
  });

  it("keeps direct and profile-style callers on compatible four-week Spend/Waste defaults", async () => {
    const h = sqliteEnv(["everett"]);
    seedSpend(h, "everett", "OWN", 18);
    seedWaste(h, "everett", "W-OWN", "own", "forgot");
    const result = await loadRetrospective(h.env, "everett", "month");
    expect(result.period).toBe("month");
    expect(result.spend.range).toBe("4w");
    expect(result.spend).toEqual(await readSpendAnalyzer(h.env, "everett", "4w"));
    expect(result.spend).toMatchObject({
      weekly_budget: null,
      awaiting_mark_placed: 0,
      weeks: expect.arrayContaining([
        expect.objectContaining({ total: 18, savings: 0, events: 1, estimated: 0 }),
      ]),
    });
    expect(result.waste.range).toBe("4w");
    expect(result.waste).toEqual(await readWasteAnalyzer(h.env, "everett", "4w"));
    expect(result.waste).toMatchObject({
      status: "complete",
      coverage: { monetary: { event_count: 1, known_amount: 18 } },
      avoidability_mapping: {
        version: "waste-avoidability-v1",
        current_version: "waste-avoidability-v1",
        is_current: true,
      },
    });
  });
});
