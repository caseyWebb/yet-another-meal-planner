import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRetrospective, registerCookingTools } from "../src/cooking-tools.js";
import { readSpendAnalyzer } from "../src/spend.js";
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

  it("an empty log is not an error — empty history", async () => {
    const env = envWith([], []);
    const r = await loadRetrospective(env, "everett", "all");
    expect(r.recipes_cooked).toEqual([]);
  });
});

describe("retrospective MCP Spend adapter", () => {
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

  it("registers optional spend_range, preserves cooking period, and exposes no Spend writer", async () => {
    const h = sqliteEnv(["everett", "casey"]);
    seedSpend(h, "everett", "OWN", 24);
    seedSpend(h, "casey", "OTHER", 900);
    h.raw.prepare(
      "INSERT INTO cooking_log (tenant,date,type,recipe,meal) VALUES (?,?,?,?,?)",
    ).run("everett", new Date().toISOString().slice(0, 10), "recipe", "stew", "dinner");
    const server = new McpServer({ name: "retrospective-spend-test", version: "0" });
    registerCookingTools(server, h.env, "everett");
    const stateBefore = {
      spend: h.rows("spend_events"),
      cooking: h.rows("cooking_log"),
    };

    await withServer(server, async (client) => {
      const tools = (await client.listTools()).tools;
      const retrospectiveTool = tools.find((tool) => tool.name === "retrospective")!;
      expect(retrospectiveTool.description).toMatch(/period.*recipes_cooked.*protein_mix.*cuisine_mix/is);
      expect(retrospectiveTool.description).toMatch(/missing dimensions.*unknown/is);
      expect(retrospectiveTool.description).toMatch(/meal-aware.*cadence.*cooks_per_week.*by_meal.*meal_unknown.*NULL-meal.*never assigned a fabricated meal/is);
      expect(retrospectiveTool.description).toMatch(/cook_vs_convenience.*frequency-ranked.*ready_to_eat_favorites/is);
      expect(retrospectiveTool.description).toMatch(/underused.*independent of period.*favorites plus revealed favorites.*3 times.*12 months.*fixed 30 days.*in season.*rejected recipes are excluded/is);
      expect(retrospectiveTool.description).toMatch(/why.*favorite.*revealed.*all-time.*cook_count.*stalest-first.*capped at 15.*underused_count.*pre-cap/is);
      expect(retrospectiveTool.description).toMatch(/spend_range.*4w.*8w.*12w/is);
      expect(retrospectiveTool.description).toMatch(/Spend analyzer.*independent of cooking period.*UTC ISO-Monday.*coverage-aware totals.*awaiting_mark_placed/is);
      expect(retrospectiveTool.description).toMatch(/read-only/is);
      expect(tools.some((tool) => /spend/i.test(tool.name))).toBe(false);

      const omitted = await invokeTool(client, "retrospective", { period: "week" });
      expect(omitted.isError).toBe(false);
      const omittedResult = omitted.result as {
        period: string;
        spend: { range: string; weeks: unknown[]; coverage: { monetary: { known_amount: number } } };
      };
      expect(omittedResult.period).toBe("week");
      expect(omittedResult.spend.range).toBe("4w");
      expect(omittedResult.spend.weeks).toHaveLength(4);
      expect(omittedResult.spend.coverage.monetary.known_amount).toBe(24);

      const explicit = await invokeTool(client, "retrospective", { period: "all", spend_range: "12w" });
      expect(explicit.isError).toBe(false);
      const explicitResult = explicit.result as { period: string; spend: Awaited<ReturnType<typeof readSpendAnalyzer>> };
      expect(explicitResult.period).toBe("all");
      expect(explicitResult.spend.range).toBe("12w");
      expect(explicitResult.spend.weeks).toHaveLength(12);
      expect(explicitResult.spend).toEqual(await readSpendAnalyzer(h.env, "everett", "12w"));

      const invalid = await invokeTool(client, "retrospective", { spend_range: "quarter" });
      expect(invalid).toMatchObject({ isError: true, result: { error: "validation_failed" } });
    });

    expect({
      spend: h.rows("spend_events"),
      cooking: h.rows("cooking_log"),
    }).toEqual(stateBefore);
  });

  it("keeps direct and profile-style callers on the compatible four-week default", async () => {
    const h = sqliteEnv(["everett"]);
    seedSpend(h, "everett", "OWN", 18);
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
  });
});
