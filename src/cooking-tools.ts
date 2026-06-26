// Read + analysis tools for the cooking-history / meal-planning capabilities:
//   read_meal_plan  — current committed cook intent (D1-backed, for session resume)
//   update_meal_plan — add/remove planned entries in the D1 `meal_plan` table
//   retrospective   — aggregate the D1 cooking_log over a period (real mixes,
//                     cadence, cook-vs-convenience, ready-to-eat favorites,
//                     underused), joining type=recipe rows to the recipe index for
//                     protein/cuisine.
// Appending a cooking event rides the log_cooked tool (src/cooking-write.ts).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { ToolError, runTool } from "./errors.js";
import { db } from "./db.js";
import type { CookingLogEntry } from "./cooking-log.js";
import { type MealPlanOp } from "./meal-plan.js";
import { retrospective, type RetrospectiveResult } from "./retrospective.js";
import { loadRecipeIndex } from "./recipe-index.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { readOverlay } from "./profile-db.js";
import type { RecipeIndex } from "./recipes.js";
import { readMealPlan, applyMealPlanRowOps } from "./session-db.js";

/** One D1 `cooking_log LEFT JOIN recipes` row (protein/cuisine already COALESCE'd). */
interface CookingLogJoinRow {
  type: CookingLogEntry["type"];
  date: string;
  recipe: string | null;
  name: string | null;
  protein: string | null;
  cuisine: string | null;
}

/**
 * Load the caller's cooking history from D1 and run the retrospective aggregation.
 * The base query is the `cooking_log LEFT JOIN recipes` + COALESCE that only became
 * possible once the recipe index moved to D1 (slice 1): a recipe entry's
 * protein/cuisine come from the joined `recipes` row, a non-recipe entry's from its
 * inline columns. The recipe index + the caller's overlay + the derived last_cooked
 * are merged into an effective index for the `underused` metric (non-rejected recipes
 * not cooked in the window — reject is per-tenant, so it must be overlay-merged).
 */
export async function loadRetrospective(
  env: Env,
  username: string,
  period: string,
): Promise<RetrospectiveResult> {
  const rows = await db(env).all<CookingLogJoinRow>(
    "SELECT cl.type AS type, cl.date AS date, cl.recipe AS recipe, cl.name AS name, " +
      "COALESCE(cl.protein, r.protein) AS protein, COALESCE(cl.cuisine, r.cuisine) AS cuisine " +
      "FROM cooking_log cl LEFT JOIN recipes r ON cl.recipe = r.slug " +
      "WHERE cl.tenant = ?1",
    username,
  );

  const entries: CookingLogEntry[] = rows.map((row) => {
    const entry: CookingLogEntry = { date: row.date, type: row.type };
    if (row.recipe) entry.recipe = row.recipe;
    if (row.name) entry.name = row.name;
    if (row.protein) entry.protein = row.protein;
    if (row.cuisine) entry.cuisine = row.cuisine;
    return entry;
  });

  // Effective index for `underused`: shared objective fields (D1) merged with the
  // caller's overlay (favorite/reject) and the cooking-log-derived last_cooked.
  const index = await loadRecipeIndex(env).catch((e) => {
    throw new ToolError(
      "index_unavailable",
      `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
  const overlay: Overlay = await readOverlay(env, username);

  // last_cooked per recipe (MAX date over the caller's recipe entries) from the
  // already-loaded rows — no second query.
  const lastCooked = new Map<string, string>();
  for (const e of entries) {
    if (e.type !== "recipe" || !e.recipe || !e.date) continue;
    const prev = lastCooked.get(e.recipe);
    if (prev === undefined || e.date > prev) lastCooked.set(e.recipe, e.date);
  }

  const effective: RecipeIndex = {};
  for (const [slug, entry] of Object.entries(index)) {
    effective[slug] = { ...mergeOverlay(entry, overlay[slug], lastCooked.get(slug)), slug };
  }

  return retrospective(entries, effective, period);
}

export function registerCookingTools(
  server: McpServer,
  env: Env,
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
        const planned = await readMealPlan(env, username);
        return { planned };
      }),
  );

  server.registerTool(
    "update_meal_plan",
    {
      description:
        "Add or remove planned meal entries. `add` upserts by recipe slug (updating planned_for and merging sides); `remove` drops every row for the slug. Call this after logging a cooked meal to remove it from the plan. Returns { applied, conflicts } with no commit_sha (D1-backed).",
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
        const { applied, conflicts } = await applyMealPlanRowOps(env, username, ops as MealPlanOp[]);
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
    ({ period }) => runTool(() => loadRetrospective(env, username, period ?? "month")),
  );
}
