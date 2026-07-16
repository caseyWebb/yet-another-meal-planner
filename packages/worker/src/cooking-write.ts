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
// Side effect: a recipe entry clears AT MOST ONE plan row, resolved by the
// DETERMINISTIC CLEAR ORDER (cooking-history capability, D26-final):
//   1. `plan_row_id` supplied — the row exists and slug-matches → clear exactly it;
//      exists but mismatches → structured `conflict`, NO log written (never clear a
//      different dish's slot); ABSENT → no clear, the log is still written, and the
//      result notes the stale id — deliberately NO fall-through to the slug stages
//      (on replay the row was already cleared; falling through would consume an
//      unrelated explicit duplicate).
//   2. Else the exact `(recipe, meal, date)` triple (requires the entry to carry a
//      meal); ties among explicit duplicates break by the earliest-due selector.
//   3. Else the earliest-due row for the slug (`planned_for ASC NULLS LAST, id ASC`),
//      EXCLUDING `meal='project'` rows unless the entry's meal is `'project'` —
//      cooking a dinner never silently consumes a same-slug project row.
//   4. No match → no clear (an off-plan cook, as today).
// The clear DELETE keys on `(tenant, id)` in the same D1 batch as the log INSERT, and
// an explicit "add again" duplicate survives the first cook — the point of duplication.
//
// Cadence side effect (converge-meal-planning-surfaces D4): a recipe entry also attributes
// meal-vibe satisfaction by a COOK-TIME COSINE MATCH — the cooked recipe's cron-captured
// embedding vs. the palette vibe vectors (`recipe_derived` / `night_vibe_derived`), scored with the
// SAME cosine helper the ranker uses and NO new AI call. The cosine candidates are MEAL-SCOPED:
// an entry carrying a meal matches only vibes of that meal; a NULL-meal entry matches all vibes
// (fail-open, the pre-meal behavior). The `from_vibe` prior is read from THE ROW ACTUALLY CLEARED
// (never a slug-global lookup) and always resets regardless of meal. Every matched vibe gets a
// `vibe_satisfaction` row in the SAME batch. `last_satisfied` stays a derived MAX(date) query
// over those rows (readVibeLastSatisfied), never written onto the vibe.
//
// The core is the shared `logCooked` operation (member-app-core D2): the MCP tool
// and the member API's `POST /api/log` both call it. The route passes
// `opts.dedupe: true` — the dedupe identity is `(date, meal, type, recipe|name)`,
// where a NULL meal matches NULL only. This is cooking_log DEDUPE IDENTITY ONLY,
// never plan-row identity. The tool keeps append-always.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError, runTool } from "./errors.js";
import { validateNewEntry, type CookingLogEntry } from "./cooking-log.js";
import { mealPlanDeleteByIdStmt } from "./session-db.js";
import { earliestDue, type PlanMeal } from "./meal-plan.js";
import { isRowId } from "./ids.js";
import { recipeVector } from "./recipe-index.js";
import { readNightVibeVectors, vibeSatisfactionInsertStmt } from "./night-vibe-db.js";
import { matchCookedVibes } from "./vibe-satisfaction.js";
import type { DeprecationWarning } from "./preferences.js";

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
  /** Which meal this event was (omitted stores NULL — "unknown / not a meal"). Valid
   *  on all types; cooking a planned project logs `{ type: 'recipe', meal: 'project' }`. */
  meal?: PlanMeal;
  /** The exact plan row to clear (clear-order step 1). A stale id logs WITHOUT
   *  clearing (no fall-through); a recipe mismatch is a conflict, nothing written. */
  plan_row_id?: string;
}

/** The plan row a cook cleared (additive; null/absent when nothing cleared). */
export interface ClearedPlanRow {
  id: string;
  recipe: string;
  meal: PlanMeal;
  planned_for: string | null;
}

export interface LogCookedResult {
  logged: CookingLogEntry;
  /** Present (true) only when `opts.dedupe` found an identical row and skipped the insert. */
  deduped?: true;
  /** The one plan row this cook cleared, when any. */
  cleared_plan_row?: ClearedPlanRow | null;
  /** e.g. the stale-plan_row_id note ("already cleared — logged without clearing"). */
  note?: string;
  /** The D21 deprecation convention: present only when a deprecated input shape was
   *  accepted and converted. Today: an incoming `type: "ready_to_eat"` converted to
   *  `type: "ad_hoc"` (remove-ready-to-eat's one-window shim). */
  warnings?: DeprecationWarning[];
}

interface PlanRowLite {
  id: string;
  recipe: string;
  meal: PlanMeal;
  planned_for: string | null;
  from_vibe: string | null;
}

/**
 * The shared log-a-cook operation: structural validation, write-time slug resolution
 * for recipe entries, the DETERMINISTIC plan-row clear (at most ONE row, module doc
 * above), the meal-scoped cook-time cosine vibe-satisfaction attribution (the
 * `from_vibe` prior read from the row actually cleared), and the log-INSERT +
 * meal-plan-DELETE-by-id + `vibe_satisfaction` INSERTs in ONE D1 batch. `opts.dedupe`
 * (route-only; default false — tool behavior unchanged) makes an identical
 * `(date, meal, type, recipe|name)` row (NULL meal matches NULL only) short-circuit
 * to `{ logged, deduped: true }` with no insert, so a replayed mutation cannot
 * double-log.
 */
export async function logCooked(
  env: Env,
  tenant: string,
  input: LogCookedInput,
  opts: { dedupe?: boolean } = {},
): Promise<LogCookedResult> {
  // One-window accept-and-convert shim (remove-ready-to-eat, the D21 deprecation
  // convention): a stale plugin's `type: "ready_to_eat"` is accepted and converted to
  // `type: "ad_hoc"` HERE, before structural validation, dedupe, and the plan-clear
  // logic below ever run — so all of it operates on the converted form (name/date/
  // meal/inline dims carry over unchanged; `ad_hoc` never clears a plan row, same as
  // `ready_to_eat` never did). After the window (a follow-up tasklet, not this change),
  // removing this conversion lets `ready_to_eat` fall straight through to
  // `validateNewEntry`'s generic invalid-type rejection.
  const convertedFromReadyToEat = input.type === "ready_to_eat";
  const entry: CookingLogEntry = {
    date: input.date && input.date.length > 0 ? input.date : today(),
    type: convertedFromReadyToEat ? "ad_hoc" : input.type,
  };
  if (typeof input.recipe === "string") entry.recipe = input.recipe;
  if (typeof input.name === "string") entry.name = input.name;
  if (typeof input.protein === "string") entry.protein = input.protein;
  if (typeof input.cuisine === "string") entry.cuisine = input.cuisine;
  if (typeof input.meal === "string") entry.meal = input.meal;

  // Structural validation first (date / type / required field per type).
  const structural = validateNewEntry(entry);
  if (structural) throw new ToolError("validation_failed", structural);
  if (input.plan_row_id !== undefined && !isRowId(input.plan_row_id)) {
    throw new ToolError("validation_failed", `invalid plan_row_id: ${input.plan_row_id}`);
  }

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

  // Replay idempotency (route-only): an identical (date, meal, type, recipe|name) row
  // already logged means this delivery is a replay — answer deduped, insert nothing.
  // `meal IS ?` so a NULL meal matches NULL only — this identity is the cooking_log
  // DEDUPE identity only, never plan-row identity.
  if (opts.dedupe) {
    const existing = await db(env).first<{ ok: number }>(
      entry.type === "recipe"
        ? "SELECT 1 AS ok FROM cooking_log WHERE tenant = ?1 AND date = ?2 AND type = ?3 AND recipe = ?4 AND meal IS ?5 LIMIT 1"
        : "SELECT 1 AS ok FROM cooking_log WHERE tenant = ?1 AND date = ?2 AND type = ?3 AND name = ?4 AND meal IS ?5 LIMIT 1",
      tenant,
      entry.date,
      entry.type,
      entry.type === "recipe" ? entry.recipe : entry.name,
      entry.meal ?? null,
    );
    if (existing) return { logged: entry, deduped: true };
  }

  // The deterministic clear order (recipe entries only): resolve WHICH plan row this
  // cook clears — at most one — and read `from_vibe` from that row (the guaranteed-
  // reset prior comes from the row actually cleared, never a slug-global LIMIT 1).
  let cleared: PlanRowLite | null = null;
  let note: string | undefined;
  if (entry.type === "recipe" && entry.recipe) {
    if (input.plan_row_id !== undefined) {
      const row = await db(env).first<PlanRowLite>(
        "SELECT id, recipe, meal, planned_for, from_vibe FROM meal_plan WHERE tenant = ?1 AND id = ?2",
        tenant,
        input.plan_row_id,
      );
      if (row) {
        if (row.recipe.toLowerCase() !== entry.recipe.toLowerCase()) {
          // Never clear a different dish's slot — structured conflict, NO log written.
          throw new ToolError("conflict", `plan_row_id '${input.plan_row_id}' addresses a different recipe (${row.recipe})`, {
            plan_row_id: input.plan_row_id,
            recipe: row.recipe,
          });
        }
        cleared = row;
      } else {
        // Stale id: the row was already cleared (a replay) — log WITHOUT clearing, and
        // deliberately do NOT fall through to the slug stages (that would consume an
        // unrelated explicit duplicate).
        note = `plan row '${input.plan_row_id}' no longer exists — logged without clearing a plan row`;
      }
    } else {
      const rows = await db(env).all<PlanRowLite>(
        "SELECT id, recipe, meal, planned_for, from_vibe FROM meal_plan WHERE tenant = ?1 AND LOWER(recipe) = LOWER(?2)",
        tenant,
        entry.recipe,
      );
      // Step 2: the exact (recipe, meal, date) triple, when the entry carries a meal;
      // ties among explicit duplicates break by the earliest-due selector.
      if (entry.meal) {
        const exact = rows.filter((r) => r.meal === entry.meal && r.planned_for === entry.date);
        cleared = earliestDue(exact);
      }
      // Step 3: earliest-due for the slug. A 'project' entry clears ONLY project rows;
      // any other entry excludes project rows — so cooking a dinner never silently
      // consumes a project row, and cooking a project never clears a dated meal slot.
      if (!cleared) {
        const eligible = rows.filter((r) => (entry.meal === "project" ? r.meal === "project" : r.meal !== "project"));
        cleared = earliestDue(eligible);
      }
      // Step 4: no match → no clear (an off-plan cook, as today).
    }
  }

  // Cook-time vibe-satisfaction attribution (D4): cosine-match the cooked recipe against the
  // palette and record every vibe it satisfies, unioned with the cleared row's from_vibe prior.
  // MEAL-SCOPED: an entry with a meal restricts cosine candidates to vibes of that meal; a
  // NULL-meal entry matches all vibes (fail-open). Both embeddings are cron-captured
  // (recipe_derived / night_vibe_derived) — NO env.AI call here.
  const satisfiedVibe = cleared?.from_vibe ?? null;
  let vibeMatches: { vibe_id: string; score: number }[] = [];
  if (entry.type === "recipe" && entry.recipe) {
    // A 'project' meal scopes to vibes whose meal is 'project' — vibes never carry it,
    // so the cosine candidate set is empty by construction (projects are not vibe-driven);
    // the from_vibe prior still resets.
    const vibeVectors = await readNightVibeVectors(env, tenant, entry.meal);
    if (satisfiedVibe || vibeVectors.size > 0) {
      const recipeVec = (await recipeVector(env, entry.recipe)) ?? [];
      vibeMatches = matchCookedVibes(recipeVec, vibeVectors, satisfiedVibe);
    }
  }

  // The cooking-log INSERT, the meal-plan row DELETE-by-id (when a row cleared), and the
  // vibe_satisfaction INSERTs run in ONE D1 transaction. The satisfaction inserts follow the
  // log insert so their `(SELECT MAX(id) FROM cooking_log …)` resolves to the row just written.
  const stmts: D1PreparedStatement[] = [
    db(env).prepare(
      "INSERT INTO cooking_log (tenant, date, type, recipe, name, protein, cuisine, meal, satisfied_vibe) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      tenant,
      entry.date,
      entry.type,
      entry.recipe ?? null,
      entry.name ?? null,
      entry.protein ?? null,
      entry.cuisine ?? null,
      entry.meal ?? null,
      satisfiedVibe,
    ),
  ];
  if (cleared) {
    stmts.push(mealPlanDeleteByIdStmt(env, tenant, cleared.id));
  }
  for (const m of vibeMatches) {
    stmts.push(vibeSatisfactionInsertStmt(env, tenant, m.vibe_id, entry.date, m.score));
  }
  await db(env).batch(stmts);

  const result: LogCookedResult = { logged: entry };
  if (entry.type === "recipe") {
    result.cleared_plan_row = cleared
      ? { id: cleared.id, recipe: cleared.recipe, meal: cleared.meal, planned_for: cleared.planned_for ?? null }
      : null;
  }
  if (note) result.note = note;
  if (convertedFromReadyToEat) {
    result.warnings = [{ key: "type", reason: "retired", superseded_by: "ad_hoc" }];
  }
  return result;
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
        "Log one cooking event to the caller's cooking history (D1-backed, no commit_sha). `type` is recipe | ad_hoc; `date` defaults to today (ISO YYYY-MM-DD). `meal` (breakfast | lunch | dinner | project) is optional on every type — omitted stores NULL, meaning 'unknown / not a meal' (a baked loaf logs with NO meal; never guess `project` — cooking a PLANNED project logs { type: 'recipe', meal: 'project' }). A `recipe` entry needs a `recipe` slug that MUST resolve against the recipe index (an unknown slug is rejected, not_found) and clears AT MOST ONE meal-plan row by a deterministic order: (1) a supplied `plan_row_id` clears exactly that row — if that row now holds a DIFFERENT recipe the call is a structured `conflict` and nothing is written, and if the row no longer exists the cook is still logged with `cleared_plan_row: null` plus a note (deliberately NO fall-through to the slug stages, so a replay never consumes an unrelated duplicate); (2) else the exact (recipe, meal, date) match when the entry carries a meal; (3) else the earliest-due row for the slug (planned_for ASC NULLS LAST, id ASC), never consuming a meal='project' row unless the entry's meal IS 'project'; (4) no match → no clear (an off-plan cook). An explicitly-duplicated recipe therefore survives its first cook — one cook clears one row. Vibe satisfaction is attributed at cook time by cosine against the palette, scoped to vibes of the entry's meal (a NULL meal matches all vibes), with the cleared row's from_vibe as a guaranteed reset. An `ad_hoc` entry needs a `name` and may carry inline `protein`/`cuisine` dimensions. last_cooked is DERIVED from the log — never set it by hand; logging a recipe updates its effective last_cooked automatically. For one deprecation window, a stale `type: \"ready_to_eat\"` write is still accepted and CONVERTED to `ad_hoc` (name/date/meal/inline dims carried over as-is; dedupe and the plan-clear logic run on the converted form) — the success return then carries `warnings: [{ key: \"type\", reason: \"retired\", superseded_by: \"ad_hoc\" }]`; after the window it is rejected like any unknown type. Returns { logged, cleared_plan_row? ({ id, recipe, meal, planned_for } | null), note?, warnings? }.",
      inputSchema: {
        date: z.string().optional(),
        type: z.enum(["recipe", "ad_hoc", "ready_to_eat"]),
        recipe: z.string().optional(),
        name: z.string().optional(),
        protein: z.string().optional(),
        cuisine: z.string().optional(),
        meal: z.enum(["breakfast", "lunch", "dinner", "project"]).optional(),
        plan_row_id: z.string().optional(),
      },
    },
    (input) =>
      runTool(async () => {
        const { logged, cleared_plan_row, note, warnings } = await logCooked(env, username, input);
        return {
          logged,
          ...(cleared_plan_row !== undefined ? { cleared_plan_row } : {}),
          ...(note ? { note } : {}),
          ...(warnings ? { warnings } : {}),
        };
      }),
  );
}
