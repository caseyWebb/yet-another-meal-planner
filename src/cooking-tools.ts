// Read + analysis tools for the cooking-history / meal-planning capabilities:
//   read_meal_plan — current committed cook intent (for session resume)
//   retrospective  — aggregate cooking_log.toml over a period (real mixes,
//                    cadence, cook-vs-convenience, ready-to-eat favorites,
//                    underused), joining type=recipe entries to the recipe index.
// Writes (appending log entries, mutating the plan) ride commit_changes.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { ToolError, runTool } from "./errors.js";
import { COOKING_LOG_PATH, entriesOf } from "./cooking-log.js";
import { MEAL_PLAN_PATH, plannedOf } from "./meal-plan.js";
import { retrospective, type RetrospectiveResult } from "./retrospective.js";
import type { RecipeIndex } from "./recipes.js";

export async function loadRetrospective(
  personalGh: GitHubClient,
  dataKv: KVNamespace,
  period: string,
): Promise<RetrospectiveResult> {
  const logText = await readOptional(personalGh, COOKING_LOG_PATH);
  const entries = logText ? entriesOf(parseToml(logText, COOKING_LOG_PATH)) : [];

  const raw = await dataKv.get("index:recipes");
  if (raw === null) throw new ToolError("index_unavailable", "the recipe index is unavailable");
  let index: RecipeIndex;
  try {
    index = JSON.parse(raw) as RecipeIndex;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("index_unavailable", `the recipe index is malformed: ${message}`);
  }
  return retrospective(entries, index, period);
}

export function registerCookingTools(
  server: McpServer,
  gh: GitHubClient,
  dataKv: KVNamespace,
): void {
  server.registerTool(
    "read_meal_plan",
    {
      description:
        "Return the current meal plan: the recipes committed to cook next (transient cook intent). Use at session start to resume — surface DUE rows (planned_for on/before today, or unset) and ask which were cooked.",
      inputSchema: {},
    },
    () =>
      runTool(async () => {
        const text = await readOptional(gh, MEAL_PLAN_PATH);
        const planned = text ? plannedOf(parseToml(text, MEAL_PLAN_PATH)) : [];
        return { planned };
      }),
  );

  server.registerTool(
    "retrospective",
    {
      description:
        "Aggregate cooking history over a period from the cooking log. period accepts 'Nd' (e.g. '30d'), 'week', 'month', 'quarter', 'year', or 'all'. Returns recipes_cooked, protein_mix, cuisine_mix (non-recipe entries counted via inline dims; missing → 'unknown'), cadence (cooks/week, recipe+ad_hoc only), cook_vs_convenience (cooked vs ready_to_eat), ready_to_eat_favorites (frequency-ranked), and underused (active recipes not cooked in the window).",
      inputSchema: { period: z.string().optional() },
    },
    ({ period }) => runTool(() => loadRetrospective(gh, dataKv, period ?? "month")),
  );
}
