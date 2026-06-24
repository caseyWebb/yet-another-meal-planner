// log_cooked — append one cooking event to the caller's D1 `cooking_log`
// (data-write-tools capability). This is the writer that replaces commit_changes'
// `cooking_log_entries`: the log left GitHub for D1 (d1-cooking-log, slice 2), so
// there is no commit_sha — it INSERTs a tenant-scoped row and returns { logged }.
//
// Validation is now done HERE at write time, not at the build: the structural
// `validateNewEntry` PLUS a real `SELECT 1 FROM recipes WHERE slug=?` for recipe
// entries (the corpus is queryable from the Worker since the recipe index moved to
// D1 in slice 1) — an unresolved slug is a structured `not_found`, written nowhere.
//
// Side effect preserved from commit_changes: a recipe entry clears that slug from
// the caller's meal plan (still KV until slice 5). last_cooked is NEVER written —
// it is derived by query (getLastCookedMap), so logging a recipe implicitly updates
// the recipe's effective last_cooked with no second write.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError, runTool } from "./errors.js";
import { validateNewEntry, type CookingLogEntry } from "./cooking-log.js";
import { applyMealPlanOps } from "./meal-plan.js";
import { getMealPlanState, writeMealPlanState } from "./user-kv.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function registerCookingWriteTools(
  server: McpServer,
  env: Env,
  dataKv: KVNamespace,
  username: string,
): void {
  server.registerTool(
    "log_cooked",
    {
      description:
        "Log one cooking event to the caller's cooking history (D1-backed, no commit_sha). `type` is recipe | ready_to_eat | ad_hoc; `date` defaults to today (ISO YYYY-MM-DD). A `recipe` entry needs a `recipe` slug that MUST resolve against the recipe index (an unknown slug is rejected, not_found) and clears that recipe from the meal plan; a ready_to_eat / ad_hoc entry needs a `name` and may carry inline `protein`/`cuisine` dimensions. last_cooked is DERIVED from the log — never set it by hand; logging a recipe updates its effective last_cooked automatically. Ready-to-eat consumption is a { type:'ready_to_eat' } entry. Returns { logged }.",
      inputSchema: {
        date: z.string().optional(),
        type: z.enum(["recipe", "ready_to_eat", "ad_hoc"]),
        recipe: z.string().optional(),
        name: z.string().optional(),
        protein: z.string().optional(),
        cuisine: z.string().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        const entry: CookingLogEntry = {
          date: input.date && input.date.length > 0 ? input.date : today(),
          type: input.type,
        };
        if (typeof input.recipe === "string") entry.recipe = input.recipe;
        if (typeof input.name === "string") entry.name = input.name;
        if (typeof input.protein === "string") entry.protein = input.protein;
        if (typeof input.cuisine === "string") entry.cuisine = input.cuisine;

        // Structural validation first (date / type / required field per type).
        const structural = validateNewEntry(entry);
        if (structural) throw new ToolError("validation_failed", structural);

        // Write-time slug resolution: a recipe entry must reference a real recipe.
        if (entry.type === "recipe") {
          const row = await db(env).first<{ ok: number }>(
            "SELECT 1 AS ok FROM recipes WHERE slug = ?1 LIMIT 1",
            entry.recipe,
          );
          if (!row) {
            throw new ToolError("not_found", `Unknown recipe slug: ${entry.recipe}`, { slug: entry.recipe });
          }
        }

        await db(env).run(
          "INSERT INTO cooking_log (tenant, date, type, recipe, name, protein, cuisine) " +
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
          username,
          entry.date,
          entry.type,
          entry.recipe ?? null,
          entry.name ?? null,
          entry.protein ?? null,
          entry.cuisine ?? null,
        );

        // Recipe entry: clear that recipe from the KV meal plan (the side effect
        // commit_changes performed). Cross-store (D1 + KV) and so non-atomic — the
        // same non-atomicity commit_changes had; resolves when the meal plan joins D1.
        if (entry.type === "recipe" && entry.recipe) {
          const current = await getMealPlanState(dataKv, username);
          const { items, applied } = applyMealPlanOps(current, [{ op: "remove", recipe: entry.recipe }]);
          if (applied.length > 0) await writeMealPlanState(dataKv, username, items);
        }

        return { logged: entry };
      }),
  );
}
