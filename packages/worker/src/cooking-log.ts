// Pure cooking-log logic (cooking-history capability). No I/O here so it is
// unit-testable. The cooking log now lives in the D1 `cooking_log` table (one row
// per cooking event or at-home convenience meal), NOT in cooking_log.toml — reads
// (`last_cooked`, `retrospective`) are SQL aggregations and writes go through the
// `log_cooked` tool. What remains here is the shared TYPE + the structural
// write-time validator `log_cooked` reuses; `log_cooked` layers a real
// `SELECT 1 FROM recipes WHERE slug=?` slug-resolution check on top (the corpus is
// now queryable from the Worker, so validation moved from the build to the write).
//
// `ready_to_eat` is RETIRED from the type a new entry may declare (remove-ready-eat):
// `log_cooked`'s one-window shim (cooking-write.ts) accepts it and converts it to
// `ad_hoc` before `validateNewEntry` ever runs, so this module's NEW-entry check only
// ever needs to know recipe/ad_hoc. Historical rows stored with `type = 'ready_to_eat'`
// keep it, though — nothing re-types them — so the TYPE below stays wide enough to
// represent a row read back from D1.

export const COOKING_LOG_TYPES = ["recipe", "ready_to_eat", "ad_hoc"] as const;
export type CookingLogType = (typeof COOKING_LOG_TYPES)[number];

/** The closed meal set on log rows. NULLABLE — an absent meal means "unknown / not a
 *  meal" (stories/02 Q2: `type` and `meal` are orthogonal axes; there is no fourth
 *  "other" value — a baked loaf logs `{ type: 'ad_hoc' }` with no meal). */
export const COOKING_LOG_MEALS = ["breakfast", "lunch", "dinner", "project"] as const;
export type CookingLogMeal = (typeof COOKING_LOG_MEALS)[number];

export interface CookingLogEntry {
  date: string;
  type: CookingLogType;
  /** Present iff type === "recipe". */
  recipe?: string;
  /** Present for ad_hoc (and historical ready_to_eat rows). */
  name?: string;
  /** Optional inline dimensions for non-recipe entries. */
  protein?: string;
  cuisine?: string;
  /** Which meal this event was; absent = NULL = "unknown / not a meal". Valid on all
   *  types (cooking a planned project logs `{ type: 'recipe', meal: 'project' }`). */
  meal?: CookingLogMeal;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a single new entry the agent is appending. Returns an error string,
 * or null when valid. STRUCTURAL only — `log_cooked` adds the recipe-slug
 * resolution check (`SELECT 1 FROM recipes WHERE slug=?`) at write time.
 *
 * The type check is narrower than `COOKING_LOG_TYPES`: a NEW entry is `recipe` or
 * `ad_hoc` only — `ready_to_eat` is retired from the write contract. `log_cooked`'s
 * shim converts an incoming `ready_to_eat` to `ad_hoc` before this ever runs, so an
 * entry reaching here still carrying `ready_to_eat` (or any other unknown value)
 * falls straight through to the same `validation_failed` rejection.
 */
export function validateNewEntry(entry: CookingLogEntry): string | null {
  if (!entry.date || !ISO_DATE_RE.test(entry.date)) {
    return `cooking-log entry has an invalid date: ${JSON.stringify(entry.date)}`;
  }
  if (entry.type !== "recipe" && entry.type !== "ad_hoc") {
    return `cooking-log entry has an invalid type: ${JSON.stringify(entry.type)}`;
  }
  if (entry.type === "recipe") {
    if (!entry.recipe) return "cooking-log recipe entry is missing `recipe` (slug)";
  } else if (!entry.name) {
    return `cooking-log ${entry.type} entry is missing \`name\``;
  }
  if (entry.meal !== undefined && !COOKING_LOG_MEALS.includes(entry.meal)) {
    return `cooking-log entry has an invalid meal: ${JSON.stringify(entry.meal)}`;
  }
  return null;
}
