// Read + analysis tools for the cooking-history / meal-planning capabilities:
//   read_meal_plan  — current committed cook intent (KV-backed, for session resume)
//   update_meal_plan — add/remove planned entries in KV
//   retrospective   — aggregate cooking_log.toml over a period (real mixes,
//                     cadence, cook-vs-convenience, ready-to-eat favorites,
//                     underused), joining type=recipe entries to the recipe index.
// Writes (appending log entries) ride commit_changes.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { GitHubClient } from "./github.js";
import { readOptional } from "./gh-read.js";
import { parseToml } from "./parse.js";
import { ToolError, runTool } from "./errors.js";
import { COOKING_LOG_PATH, entriesOf } from "./cooking-log.js";
import { applyMealPlanOps, type MealPlanOp } from "./meal-plan.js";
import { retrospective, type RetrospectiveResult } from "./retrospective.js";
import { loadRecipeIndex } from "./recipe-index.js";
import { getMealPlanState, writeMealPlanState } from "./user-kv.js";

export async function loadRetrospective(
  personalGh: GitHubClient,
  env: Env,
  period: string,
): Promise<RetrospectiveResult> {
  const logText = await readOptional(personalGh, COOKING_LOG_PATH);
  const entries = logText ? entriesOf(parseToml(logText, COOKING_LOG_PATH)) : [];

  // The recipe index now lives in the D1 `recipes` table; loadRecipeIndex rebuilds
  // the same in-memory RecipeIndex retrospective consumes (objective fields only —
  // status/last_cooked are per-tenant and not in the shared table). An unreadable
  // table throws a `storage_error`; remap it to `index_unavailable`.
  const index = await loadRecipeIndex(env).catch((e) => {
    throw new ToolError(
      "index_unavailable",
      `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  return retrospective(entries, index, period);
}

export function registerCookingTools(
  server: McpServer,
  gh: GitHubClient,
  env: Env,
  dataKv: KVNamespace,
  username: string,
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
        const planned = await getMealPlanState(dataKv, username);
        return { planned };
      }),
  );

  server.registerTool(
    "update_meal_plan",
    {
      description:
        "Add or remove planned meal entries. `add` upserts by recipe slug (updating planned_for and merging sides); `remove` drops every row for the slug. Call this after logging a cooked meal to remove it from the plan. Returns { applied, conflicts } with no commit_sha (KV-backed).",
      inputSchema: {
        ops: z.array(
          z.object({
            op: z.enum(["add", "remove"]),
            recipe: z.string(),
            planned_for: z.string().nullable().optional(),
            sides: z.array(z.string()).optional(),
          }),
        ),
      },
    },
    ({ ops }) =>
      runTool(async () => {
        const current = await getMealPlanState(dataKv, username);
        const { items, applied, conflicts } = applyMealPlanOps(current, ops as MealPlanOp[]);
        if (applied.length > 0) {
          await writeMealPlanState(dataKv, username, items);
        }
        return { applied, conflicts };
      }),
  );

  server.registerTool(
    "retrospective",
    {
      description:
        "Aggregate cooking history over a period from the cooking log. period accepts 'Nd' (e.g. '30d'), 'week', 'month', 'quarter', 'year', or 'all'. Returns recipes_cooked, protein_mix, cuisine_mix (non-recipe entries counted via inline dims; missing → 'unknown'), cadence (cooks/week, recipe+ad_hoc only), cook_vs_convenience (cooked vs ready_to_eat), ready_to_eat_favorites (frequency-ranked), and underused (active recipes not cooked in the window).",
      inputSchema: { period: z.string().optional() },
    },
    ({ period }) => runTool(() => loadRetrospective(gh, env, period ?? "month")),
  );
}
