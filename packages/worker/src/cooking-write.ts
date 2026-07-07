// log_cooked — append one cooking event to the caller's D1 `cooking_log`
// (data-write-tools capability). This is the writer that replaces commit_changes'
// `cooking_log_entries`: the log left GitHub for D1 (d1-cooking-log, slice 2), so
// there is no commit_sha — it INSERTs a tenant-scoped row and returns { logged }.
//
// Validation is done HERE at write time, not at the build: the structural
// `validateNewEntry` PLUS a real `SELECT 1 FROM recipes WHERE slug=?` for recipe
// entries (the corpus is queryable from the Worker since the recipe index moved to
// D1 in slice 1) — an unresolved slug is a structured `not_found`, written nowhere.
//
// Side effect: a recipe entry clears that slug from the caller's meal plan. With the
// meal plan in D1 (slice 5), the cooking-log INSERT and the `meal_plan` row DELETE
// run in ONE D1 `batch` (transactional clear). last_cooked is NEVER written — it is
// derived by query (readLastCookedMap), so logging a recipe implicitly updates the
// recipe's effective last_cooked with no second write.
//
// The core is the shared `logCooked` operation (member-app-core D2): the MCP tool
// and the member API's `POST /api/log` both call it. The route passes
// `opts.dedupe: true` (an identical `(tenant, date, type, recipe|name)` row
// short-circuits — replay-idempotent, D8); the tool keeps append-always.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError, runTool } from "./errors.js";
import { validateNewEntry, type CookingLogEntry } from "./cooking-log.js";
import { mealPlanDeleteStmt } from "./session-db.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The raw fields a caller supplies for one cooking event (date defaults to today). */
export interface LogCookedInput {
  date?: string;
  type: CookingLogEntry["type"];
  recipe?: string;
  name?: string;
  protein?: string;
  cuisine?: string;
}

export interface LogCookedResult {
  logged: CookingLogEntry;
  /** Present (true) only when `opts.dedupe` found an identical row and skipped the insert. */
  deduped?: true;
}

/**
 * The shared log-a-cook operation: structural validation, write-time slug resolution
 * for recipe entries, the `satisfied_vibe` slot-provenance stamp (read from the
 * planned row BEFORE the clear), and the log-INSERT + meal-plan-DELETE in ONE D1
 * batch. `opts.dedupe` (route-only; default false — tool behavior unchanged) makes an
 * identical `(tenant, date, type, recipe|name)` row short-circuit to
 * `{ logged, deduped: true }` with no insert, so a replayed mutation cannot double-log.
 */
export async function logCooked(
  env: Env,
  tenant: string,
  input: LogCookedInput,
  opts: { dedupe?: boolean } = {},
): Promise<LogCookedResult> {
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

  // Replay idempotency (D8, route-only): an identical (date, type, recipe|name) row
  // already logged means this delivery is a replay — answer deduped, insert nothing.
  if (opts.dedupe) {
    const existing = await db(env).first<{ ok: number }>(
      entry.type === "recipe"
        ? "SELECT 1 AS ok FROM cooking_log WHERE tenant = ?1 AND date = ?2 AND type = ?3 AND recipe = ?4 LIMIT 1"
        : "SELECT 1 AS ok FROM cooking_log WHERE tenant = ?1 AND date = ?2 AND type = ?3 AND name = ?4 LIMIT 1",
      tenant,
      entry.date,
      entry.type,
      entry.type === "recipe" ? entry.recipe : entry.name,
    );
    if (existing) return { logged: entry, deduped: true };
  }

  // Slot provenance ("shape in → shape out"): if this recipe was planned to fill a
  // night-vibe slot, carry that vibe onto the cooking-log row so the cadence scheduler
  // can advance the vibe's last_satisfied. Read it BEFORE the clear (the DELETE below
  // removes the row). An off-plan cook (no row, or no from_vibe) leaves it null.
  let satisfiedVibe: string | null = null;
  if (entry.type === "recipe" && entry.recipe) {
    const row = await db(env).first<{ from_vibe: string | null }>(
      "SELECT from_vibe FROM meal_plan WHERE tenant = ?1 AND LOWER(recipe) = LOWER(?2) LIMIT 1",
      tenant,
      entry.recipe,
    );
    satisfiedVibe = row?.from_vibe ?? null;
  }

  // The cooking-log INSERT and (for a recipe entry) the meal-plan row DELETE run
  // in ONE D1 transaction — both per-tenant tables are in D1, so the clear is
  // atomic with the log write (resolves the slice-2 cross-store seam).
  const stmts: D1PreparedStatement[] = [
    db(env).prepare(
      "INSERT INTO cooking_log (tenant, date, type, recipe, name, protein, cuisine, satisfied_vibe) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      tenant,
      entry.date,
      entry.type,
      entry.recipe ?? null,
      entry.name ?? null,
      entry.protein ?? null,
      entry.cuisine ?? null,
      satisfiedVibe,
    ),
  ];
  if (entry.type === "recipe" && entry.recipe) {
    stmts.push(mealPlanDeleteStmt(env, tenant, entry.recipe));
  }
  await db(env).batch(stmts);

  return { logged: entry };
}

export function registerCookingWriteTools(
  server: McpServer,
  env: Env,
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
        const { logged } = await logCooked(env, username, input);
        return { logged };
      }),
  );
}
