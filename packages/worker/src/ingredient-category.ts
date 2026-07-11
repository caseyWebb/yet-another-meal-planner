// The ingredient-category scheduled pass (pantry-disposition-foundations, design D6).
// Converges the identity food-category memo (`ingredient_identity.category` — the ONE
// deterministic item→department derivation source, DECISIONS.md D17) in three bounded,
// idempotent phases per tick:
//   1. CLASSIFY: batch-prompt unclassified concrete survivor identities through the
//      `runAi` gateway (the registry's small model) into exactly one of the 14 food
//      categories or `household` (the non-food catch-all, so classification always
//      terminates). Strict parse; an unparseable/off-vocab answer leaves NULL for retry
//      (the transient-failure posture mirrors the normalize job — NULL IS the retry state).
//   2. PANTRY BACKFILL: fill NULL `pantry.category` from the memo via the identity funnel
//      (alias → identity → representative), writing only food-taxonomy values (a
//      `household` identity leaves the pantry row NULL — the pantry vocabulary is
//      food-only) and NEVER overwriting a non-NULL (member-set values are pinned).
//   3. EVENT STAMP: fill NULL (`pending`) `waste_events.department` from the memo via
//      `item_id` (any memo value, `household` included). NULL→value only — a stamped
//      department is never rewritten (design D5).
// Self-terminating: once the backlog drains every phase is a cheap no-op scan. Novel
// identities minted later by the normalize job classify on the FOLLOWING tick —
// deliberately not bolted onto capture's confirm call, so one owner/prompt/parse path
// serves initial backfill and steady state alike (cost: one tick of `pending` on a
// brand-new ingredient). Runs in the phase-1 `scheduled()` group on the internal
// env.AI/D1 budget; records `job_health` + `job_runs` under `ingredient-category`.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { runAi } from "./ai.js";
import { NORMALIZE_MODEL } from "./ingredient-classify.js";
import { readIngredientCategoryMemo } from "./corpus-db.js";
import { IDENTITY_CATEGORIES, PANTRY_CATEGORIES } from "./department.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name this pass records its health + per-run history under. */
export const CATEGORY_JOB = "ingredient-category";
/** Classify batches per tick (the phase-1 bound is BATCHES × BATCH_SIZE rows). */
export const CATEGORY_BATCHES = 2;
/** Identities per classify call — one prompt maps the whole batch id → category. */
export const CATEGORY_BATCH_SIZE = 40;

/** One unclassified identity handed to the classifier (the display label helps it judge). */
export interface UnclassifiedIdentity {
  id: string;
  display_name: string | null;
}

export interface CategoryDeps {
  /** Unclassified concrete survivors (`representative IS NULL AND concrete = 1 AND category IS NULL`), bounded. */
  unclassified(limit: number): Promise<UnclassifiedIdentity[]>;
  /** One batched classify call: id → proposed category for every input. Returns null on an
   *  unparseable response (the batch retries next tick); throws on a transient env.AI error. */
  classifyBatch(items: UnclassifiedIdentity[]): Promise<Record<string, string> | null>;
  /** Memoize one identity's category (guarded to still-NULL rows — the fill is one-shot). */
  writeMemo(id: string, category: string): Promise<void>;
  /** Pantry rows still uncategorized (`category IS NULL`), keyed for the memo join. */
  pantryPending(): Promise<{ tenant: string; normalized_name: string }[]>;
  /** Fill one pantry row's NULL category (guarded `AND category IS NULL` — never overwrites). */
  fillPantryCategory(tenant: string, normalizedName: string, category: string): Promise<void>;
  /** Waste events still pending a department (`department IS NULL`). */
  eventsPending(): Promise<{ tenant: string; id: string; item_id: string }[]>;
  /** Stamp one pending event's department (guarded `AND department IS NULL` — fill-once). */
  stampEventDepartment(tenant: string, id: string, department: string): Promise<void>;
  /** The identity funnel's memo lookup (surface key → category), shared with capture-time stamping. */
  memoLookup(keys: string[]): Promise<Map<string, string>>;
  /** The remaining classify backlog (for the run summary's convergence signal). */
  backlog(): Promise<number>;
  now(): number;
  batches: number;
  batchSize: number;
}

export interface CategorySummary {
  /** Identities memoized this tick (in-vocab classifier answers only). */
  classified: number;
  /** NULL pantry categories filled from the memo this tick. */
  pantry_filled: number;
  /** Pending waste-event departments stamped from the memo this tick. */
  events_stamped: number;
  /** Unclassified concrete survivors remaining after the tick (drains to 0). */
  backlog: number;
}

/** Phase 1: classify a bounded batch of unclassified identities into the memo. */
async function classifyPhase(deps: CategoryDeps, summary: CategorySummary): Promise<void> {
  const rows = await deps.unclassified(deps.batches * deps.batchSize);
  for (let start = 0; start < rows.length; start += deps.batchSize) {
    const batch = rows.slice(start, start + deps.batchSize);
    let answers: Record<string, string> | null;
    try {
      answers = await deps.classifyBatch(batch);
    } catch (e) {
      // Transient env.AI failure: leave the whole batch NULL for a later tick (NULL is the
      // retry state), never fail the tick's remaining phases.
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ingredient-category] classify batch failed:", msg);
      continue;
    }
    if (!answers) continue; // unparseable → retry next tick
    for (const row of batch) {
      const category = answers[row.id];
      // Strict: write only exact in-vocab answers; anything else stays NULL for retry.
      if (typeof category === "string" && (IDENTITY_CATEGORIES as readonly string[]).includes(category)) {
        await deps.writeMemo(row.id, category);
        summary.classified++;
      }
    }
  }
}

/** Phase 2: fill NULL pantry categories from the memo (food-taxonomy values only). */
async function pantryFillPhase(deps: CategoryDeps, summary: CategorySummary): Promise<void> {
  const pending = await deps.pantryPending();
  if (pending.length === 0) return;
  const memo = await deps.memoLookup(pending.map((r) => r.normalized_name));
  for (const row of pending) {
    const category = memo.get(row.normalized_name);
    // `household` never lands on a pantry row — the pantry category is the food vocabulary.
    if (category && (PANTRY_CATEGORIES as readonly string[]).includes(category)) {
      await deps.fillPantryCategory(row.tenant, row.normalized_name, category);
      summary.pantry_filled++;
    }
  }
}

/** Phase 3: stamp pending waste-event departments from the memo (any memo value). */
async function eventStampPhase(deps: CategoryDeps, summary: CategorySummary): Promise<void> {
  const pending = await deps.eventsPending();
  if (pending.length === 0) return;
  const memo = await deps.memoLookup(pending.map((r) => r.item_id));
  for (const row of pending) {
    const category = memo.get(row.item_id);
    if (category) {
      await deps.stampEventDepartment(row.tenant, row.id, category);
      summary.events_stamped++;
    }
  }
}

/** The core pass, pure w.r.t. its injected deps (unit-testable without env). */
export async function reconcileCategories(deps: CategoryDeps): Promise<CategorySummary> {
  const summary: CategorySummary = { classified: 0, pantry_filled: 0, events_stamped: 0, backlog: 0 };
  await classifyPhase(deps, summary);
  // Phases 2/3 run AFTER classify so the tick's fresh memos backfill/stamp the same tick.
  await pantryFillPhase(deps, summary);
  await eventStampPhase(deps, summary);
  summary.backlog = await deps.backlog();
  return summary;
}

// --- the batched classify call ------------------------------------------------

const CLASSIFY_SYSTEM_PROMPT = [
  "You classify grocery ingredient identities into ONE analytics department each, for a kitchen-inventory system.",
  "",
  `Departments (choose EXACTLY one per item): ${IDENTITY_CATEGORIES.join(" | ")}.`,
  "",
  "Rules:",
  "- household is ONLY for non-food items (kitchen supplies, paper goods, cleaning products). Everything edible gets a food department.",
  "- Judge the item as PURCHASED at the store: rice/pasta/oats → grains; flour/sugar/yeast/cocoa → baking; canned/jarred shelf goods (canned tomatoes, broth, beans) → canned; sauces/dressings/mustards/pickles → condiments; cooking oils and vinegars → oils; dried herbs/spices/blends → spices; bread/tortillas/pastry → bakery; fish/shellfish → seafood; fresh fruit/vegetables/herbs → produce; milk/cheese/butter/eggs → dairy; frozen-aisle items → frozen; chips/crackers/sweets → snacks; coffee/tea/juice/soda → beverages.",
  "- Each item is given as its canonical id plus an optional display label. Classify the product the id names; ignore packaging noise.",
  'Return STRICT JSON only, no prose: an object mapping EVERY input id (verbatim) to its department, e.g. {"cilantro":"produce","aa batteries":"household"}.',
].join("\n");

/** Extract the JSON object from a model response (object passthrough or fenced/prose text). */
function parseClassifyResponse(response: unknown): Record<string, string> | null {
  let raw: unknown = response;
  if (typeof response === "string") {
    const start = response.indexOf("{");
    const end = response.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    try {
      raw = JSON.parse(response.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v.trim().toLowerCase();
  }
  return out;
}

/** One batched classify call through the metered `runAi` seam (`ingredient-category`). */
async function classifyIdentityBatch(
  env: Env,
  items: UnclassifiedIdentity[],
): Promise<Record<string, string> | null> {
  const lines = items.map((it) =>
    it.display_name ? `${JSON.stringify(it.id)} (label: ${JSON.stringify(it.display_name)})` : JSON.stringify(it.id),
  );
  const res = await runAi<{ response?: unknown }>(
    env,
    { activity: "ingredient-category", trigger: "cron", calls: items.length },
    NORMALIZE_MODEL,
    {
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: `ITEMS:\n${lines.join("\n")}` },
      ],
      max_tokens: 2048,
      temperature: 0,
    },
  );
  return parseClassifyResponse(res?.response);
}

/** Wire the real env for the scheduled handler. */
export function buildCategoryDeps(env: Env): CategoryDeps {
  return {
    unclassified: (limit) =>
      db(env).all<UnclassifiedIdentity>(
        "SELECT id, display_name FROM ingredient_identity " +
          "WHERE representative IS NULL AND concrete = 1 AND category IS NULL ORDER BY id LIMIT ?1",
        limit,
      ),
    classifyBatch: (items) => classifyIdentityBatch(env, items),
    writeMemo: async (id, category) => {
      await db(env).run(
        "UPDATE ingredient_identity SET category = ?1 WHERE id = ?2 AND category IS NULL",
        category,
        id,
      );
    },
    pantryPending: () =>
      db(env).all<{ tenant: string; normalized_name: string }>(
        "SELECT tenant, normalized_name FROM pantry WHERE category IS NULL",
      ),
    fillPantryCategory: async (tenant, normalizedName, category) => {
      await db(env).run(
        "UPDATE pantry SET category = ?1 WHERE tenant = ?2 AND normalized_name = ?3 AND category IS NULL",
        category,
        tenant,
        normalizedName,
      );
    },
    eventsPending: () =>
      db(env).all<{ tenant: string; id: string; item_id: string }>(
        "SELECT tenant, id, item_id FROM waste_events WHERE department IS NULL",
      ),
    stampEventDepartment: async (tenant, id, department) => {
      await db(env).run(
        "UPDATE waste_events SET department = ?1 WHERE tenant = ?2 AND id = ?3 AND department IS NULL",
        department,
        tenant,
        id,
      );
    },
    memoLookup: (keys) => readIngredientCategoryMemo(env, keys),
    backlog: async () => {
      const row = await db(env).first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM ingredient_identity WHERE representative IS NULL AND concrete = 1 AND category IS NULL",
      );
      return row?.n ?? 0;
    },
    now: () => Date.now(),
    batches: CATEGORY_BATCHES,
    batchSize: CATEGORY_BATCH_SIZE,
  };
}

/**
 * One scheduled run: do the pass, record the `ingredient-category` job_health + job_run rows
 * (a tenant-clean `{ classified, pantry_filled, events_stamped, backlog }` summary), and
 * rethrow so the platform's cron status reflects a hard failure (mirrors runNormalizeJob).
 * The admin jobs surface reads `job_health` generically, so the pass appears with no
 * admin-panel change.
 */
export async function runCategoryJob(env: Env, deps: CategoryDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const s = await reconcileCategories(deps);
    await writeJobHealth(env, CATEGORY_JOB, { ok: true, last_run_at: startedAt, summary: { ...s } });
    await writeJobRun(env, CATEGORY_JOB, {
      ok: true,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { ...s },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-category] pass failed:", msg);
    await writeJobHealth(env, CATEGORY_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(
      () => {},
    );
    await writeJobRun(env, CATEGORY_JOB, {
      ok: false,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
