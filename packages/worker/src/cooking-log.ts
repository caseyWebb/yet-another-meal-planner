// Pure cooking-log logic (cooking-history capability). No I/O here so it is
// unit-testable. The cooking log now lives in the D1 `cooking_log` table (one row
// per cooking event or at-home convenience meal), NOT in cooking_log.toml — reads
// (`last_cooked`, `retrospective`) are SQL aggregations and writes go through the
// `log_cooked` tool. What remains here is the shared TYPE + the structural
// write-time validator `log_cooked` reuses; `log_cooked` layers a real
// `SELECT 1 FROM recipes WHERE slug=?` slug-resolution check on top (the corpus is
// now queryable from the Worker, so validation moved from the build to the write).

export const COOKING_LOG_TYPES = ["recipe", "ready_to_eat", "ad_hoc"] as const;
export type CookingLogType = (typeof COOKING_LOG_TYPES)[number];

export interface CookingLogEntry {
  date: string;
  type: CookingLogType;
  /** Present iff type === "recipe". */
  recipe?: string;
  /** Present for ready_to_eat / ad_hoc. */
  name?: string;
  /** Optional inline dimensions for non-recipe entries. */
  protein?: string;
  cuisine?: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a single new entry the agent is appending. Returns an error string,
 * or null when valid. STRUCTURAL only — `log_cooked` adds the recipe-slug
 * resolution check (`SELECT 1 FROM recipes WHERE slug=?`) at write time.
 */
export function validateNewEntry(entry: CookingLogEntry): string | null {
  if (!entry.date || !ISO_DATE_RE.test(entry.date)) {
    return `cooking-log entry has an invalid date: ${JSON.stringify(entry.date)}`;
  }
  if (!COOKING_LOG_TYPES.includes(entry.type)) {
    return `cooking-log entry has an invalid type: ${JSON.stringify(entry.type)}`;
  }
  if (entry.type === "recipe") {
    if (!entry.recipe) return "cooking-log recipe entry is missing `recipe` (slug)";
  } else if (!entry.name) {
    return `cooking-log ${entry.type} entry is missing \`name\``;
  }
  return null;
}
