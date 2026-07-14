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
import { retrospective, type RetrospectiveResult, type RetroConfig } from "./retrospective.js";
import { readSpendAnalyzer, type SpendAnalyzer, type SpendRange } from "./spend.js";
import { loadRecipeIndex } from "./recipe-index.js";
import { mergeOverlay, type Overlay } from "./overlay.js";
import { readOverlay, readPreferences } from "./profile-db.js";
import type { RecipeIndex } from "./recipes.js";
import { readMealPlan, applyMealPlanRowOps } from "./session-db.js";
import { stampLastPlanned } from "./discovery-db.js";

/** One D1 `cooking_log LEFT JOIN recipes` row (protein/cuisine already COALESCE'd). */
interface CookingLogJoinRow {
  type: CookingLogEntry["type"];
  date: string;
  recipe: string | null;
  name: string | null;
  protein: string | null;
  cuisine: string | null;
  meal: string | null;
}

/**
 * Load the caller's cooking history from D1 and run the retrospective aggregation.
 * The base query is the `cooking_log LEFT JOIN recipes` + COALESCE that only became
 * possible once the recipe index moved to D1 (slice 1): a recipe entry's
 * protein/cuisine come from the joined `recipes` row, a non-recipe entry's from its
 * inline columns. The recipe index + the caller's overlay + the derived last_cooked
 * are merged into an effective index for the `underused` metric (non-rejected recipes
 * not cooked in the window — reject is per-tenant, so it must be overlay-merged).
 * The `spend` section (spend-telemetry) rides the result: the shared household-scoped,
 * bounded, read-only analyzer over non-voided captured facts. Its range is independent
 * of cooking `period` and defaults to the compatible four weeks.
 */
export async function loadRetrospective(
  env: Env,
  username: string,
  period: string,
  spendRange: SpendRange = "4w",
): Promise<RetrospectiveResult & { spend: SpendAnalyzer }> {
  const rows = await db(env).all<CookingLogJoinRow>(
    "SELECT cl.type AS type, cl.date AS date, cl.recipe AS recipe, cl.name AS name, cl.meal AS meal, " +
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
    if (row.meal) entry.meal = row.meal as CookingLogEntry["meal"];
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

  const prefs = await readPreferences(env, username).catch(() => null);
  const retroPrefs = prefs && typeof prefs.retrospective === "object" && prefs.retrospective !== null
    ? (prefs.retrospective as Record<string, unknown>)
    : {};
  const num = (v: unknown): number | undefined => (typeof v === "number" && v > 0 ? v : undefined);
  const retroConfig: RetroConfig = {
    staleAfterDays: num(retroPrefs.stale_after_days),
    revealedMonths: num(retroPrefs.revealed_months),
    revealedMinCooks: num(retroPrefs.revealed_min_cooks),
  };

  const spend = await readSpendAnalyzer(env, username, spendRange);
  return { ...retrospective(entries, effective, period, new Date(), retroConfig), spend };
}

/** One member-facing cooking-log row (the web log page's read, member-app-core D4). */
export interface CookingLogListRow {
  id: number;
  date: string;
  type: CookingLogEntry["type"];
  recipe: string | null;
  name: string | null;
  /** The recipe's indexed title for recipe rows (null when unindexed / non-recipe). */
  title: string | null;
  protein: string | null;
  cuisine: string | null;
  /** Which meal this event was; NULL = unknown / not a meal (pre-meal rows stay NULL). */
  meal: string | null;
}

/** The member log read's bound: at most this many rows per call (clamped). */
export const COOKING_LOG_DEFAULT_LIMIT = 50;
export const COOKING_LOG_MAX_LIMIT = 200;

/**
 * A bounded, most-recent-first read of the caller's cooking log (`date DESC, id DESC`
 * — insertion id breaks same-day ties), recipe rows enriched with the recipe's
 * title/protein/cuisine via the same `LEFT JOIN recipes` COALESCE idiom
 * `loadRetrospective` uses. Serves the member web app's log page (D4); each row
 * carries its `id`, the delete op's address. No MCP tool reads this shape.
 */
export async function readCookingLog(
  env: Env,
  tenant: string,
  opts: { limit?: number } = {},
): Promise<CookingLogListRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? COOKING_LOG_DEFAULT_LIMIT, COOKING_LOG_MAX_LIMIT));
  return db(env).all<CookingLogListRow>(
    "SELECT cl.id AS id, cl.date AS date, cl.type AS type, cl.recipe AS recipe, cl.name AS name, cl.meal AS meal, " +
      "r.title AS title, COALESCE(cl.protein, r.protein) AS protein, COALESCE(cl.cuisine, r.cuisine) AS cuisine " +
      "FROM cooking_log cl LEFT JOIN recipes r ON cl.recipe = r.slug " +
      "WHERE cl.tenant = ?1 ORDER BY cl.date DESC, cl.id DESC LIMIT ?2",
    tenant,
    limit,
  );
}

/**
 * Delete ONE of the caller's own cooking-log rows by its `id` PK — tenant-scoped, so
 * another member's row is unreachable (reported not-found, nothing deleted).
 * Everything derived from the log (`last_cooked` MAX(date), the retrospective, vibe
 * cadence recency) reflects the deletion organically on the next read — none of it is
 * materialized. Web-only (D4); no MCP tool.
 */
export async function deleteCookingLogRow(
  env: Env,
  tenant: string,
  id: number,
): Promise<{ found: boolean }> {
  const r = await db(env).run("DELETE FROM cooking_log WHERE tenant = ?1 AND id = ?2", tenant, id);
  return { found: r.changes > 0 };
}

/**
 * The `update_meal_plan` composition as a shared operation (member-app-core D2):
 * `applyMealPlanRowOps` + the new-for-me watermark advance (`stampLastPlanned`)
 * whenever an add APPLIED — bound together so no caller (tool or member API's
 * `POST /api/plan/ops`) can commit a plan without advancing the watermark.
 */
export async function applyMealPlanOpsForTenant(
  env: Env,
  tenant: string,
  ops: MealPlanOp[],
): Promise<Awaited<ReturnType<typeof applyMealPlanRowOps>>> {
  const result = await applyMealPlanRowOps(env, tenant, ops);
  // Committing planned recipes advances the new-for-me watermark, so the next
  // list_new_for_me returns only discoveries imported after this plan.
  if (result.applied.some((a) => a.op === "add")) {
    await stampLastPlanned(env, tenant, new Date().toISOString().slice(0, 10));
  }
  return result;
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
        "Return the current meal plan: the slots committed to cook next (transient cook intent). Returns { planned: [{ id, recipe, meal, planned_for, sides?, from_vibe? }] } — a FLAT ordered array (grouped-by-meal is an ORDERING guarantee, not nesting): dated rows first by (planned_for, breakfast < lunch < dinner), then undated rows grouped by meal, then meal='project' rows last, with ties broken by id ASC (an arbitrary-but-deterministic tiebreak — never read meaning into an id). Each row's `id` is THE address for row-level edits (update_meal_plan set/remove by id, log_cooked's plan_row_id) and the offline-replay key; a recipe may legitimately occupy several rows (explicit duplication). Use at session start to resume — surface DUE rows (planned_for on/before today, or unset) and ask which were cooked.",
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
        "Add, remove, or edit planned rows — SLOT-grain, keyed by opaque row `id` (client-mintable; the offline-replay key). Each row carries `meal` (breakfast | lunch | dinner | project; default dinner). `add` resolves deterministically: (1) a supplied `id` that already exists REPLAYS as an update of that row (sides unioned, planned_for/meal/from_vibe set when supplied; an id holding a DIFFERENT recipe is a per-op conflict) — so redelivering the same op never duplicates; (2) else `duplicate: true` INSERTS a second row for an already-planned recipe — the ONE way to plan a recipe twice, never any other spelling; (3) else the add COALESCES onto the recipe's existing row slug-globally across ALL meals (case-insensitive): no row → insert; exactly one → update it (a supplied `meal` MOVES the row between meals; the response reports the SURVIVING row's id with coalesced: true — adopt that id, your supplied one is discarded); more than one (explicit duplicates exist) → a per-op conflict carrying `candidates` [{ id, meal, planned_for, sides? }] — re-issue by id or with duplicate: true, never an auto-pick. `remove` takes EXACTLY ONE of `id` or `recipe`: by id it is IDEMPOTENT (applied with removed: 0|1 — a missing id is never a conflict, replay-safe); by recipe slug (optionally narrowed by `meal`) it deletes ALL matching rows (applied with removed: N and the ids; zero matches is a conflict). `set` addresses by `id` (must exist; may change ANY field including `recipe` — the swap-in-slot — and `meal`) or by slug (optionally narrowed by `meal`; requires a UNIQUE match — several matches return the `candidates` conflict; a slug-addressed set cannot change `recipe`): a supplied `sides` array replaces the row's sides WHOLESALE (an empty array removes them all — the only way to remove a side); a supplied `planned_for` sets the date and an EXPLICIT `planned_for: null` clears it (unschedules); `from_vibe` supplied sets (null clears), absent preserves. PROJECT rows (meal: 'project' — bakes, preserves, big batch cooking) carry NO date and NO sides: an op that would produce a dated or sided project row is a per-op conflict ('project rows carry no date or sides'); a `set` moving a row to project may itself pass planned_for: null and sides: [] to satisfy that. Cooking is logged with log_cooked (which clears its own row) — call `remove` only to drop an ABANDONED plan. Returns { applied, conflicts } with no commit_sha (D1-backed); applied entries carry the row id acted on.",
      inputSchema: {
        ops: z.array(
          z.object({
            op: z.enum(["add", "remove", "set"]),
            id: z.string().optional(),
            recipe: z.string().optional(),
            meal: z.enum(["breakfast", "lunch", "dinner", "project"]).optional(),
            duplicate: z.boolean().optional(),
            planned_for: z.string().nullable().optional(),
            sides: z.array(z.string()).optional(),
            from_vibe: z.string().nullable().optional(),
          }),
        ),
      },
    },
    ({ ops }) =>
      runTool(async () => {
        const { applied, conflicts } = await applyMealPlanOpsForTenant(env, username, ops as MealPlanOp[]);
        return { applied, conflicts };
      }),
  );

  server.registerTool(
    "retrospective",
    {
      description:
        "Aggregate cooking history over a period from the cooking log. `period` accepts 'Nd' (e.g. '30d'), 'week', 'month', 'quarter', 'year', or 'all', and scopes `recipes_cooked`, `protein_mix`, `cuisine_mix` (non-recipe entries count through inline dimensions; missing dimensions bucket under `unknown`), meal-aware `cadence` (`cooks_per_week` counts recipe + ad_hoc only; `by_meal` counts breakfast/lunch/dinner/project rows whose meal is set; `meal_unknown` counts NULL-meal rows, which remain in the overall figure and are never assigned a fabricated meal), `cook_vs_convenience`, and frequency-ranked `ready_to_eat_favorites`. `underused` is independent of period: loved recipes — the caller's favorites plus revealed favorites cooked at least 3 times in the trailing 12 months — that are never cooked or stale for a fixed 30 days and in season now; rejected recipes are excluded. Each underused item carries `why` (`favorite` or `revealed`) and all-time `cook_count`, sorts stalest-first, and the list is capped at 15 while `underused_count` reports the pre-cap total. Optional `spend_range` independently accepts `4w`, `8w`, or `12w` (default `4w`). `spend` is the household's read-only Spend analyzer, independent of cooking period: bounded UTC ISO-Monday windows over captured non-voided facts with coverage-aware totals, weekly buckets, cost per meal, matched trend, budget comparisons, captured department/store/planned-vs-impulse breakdowns, deterministic top drivers and insight, plus `awaiting_mark_placed`. Treat partial or unavailable values as such; never infer missing spend, and never count awaiting rows as spend. This tool is read-only and no Spend-write tool exists.",
      inputSchema: {
        period: z.string().optional(),
        spend_range: z.enum(["4w", "8w", "12w"]).optional(),
      },
    },
    ({ period, spend_range }) => runTool(() => loadRetrospective(env, username, period ?? "month", spend_range ?? "4w")),
  );
}
