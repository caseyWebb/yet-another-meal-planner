// Pure cooking-log logic (cooking-history capability). No I/O here so it is
// unit-testable; the tool/commit wrappers supply the parsed file and today's
// date. cooking_log.toml is the durable, append-only spine: one entry per
// cooking event or at-home convenience meal. `last_cooked` on a recipe is
// DERIVED from it (max entry date for that slug) — see deriveLastCooked.

export const COOKING_LOG_PATH = "cooking_log.toml";
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

/** Coerce a raw parsed entry into a CookingLogEntry, dropping unknown fields. */
export function coerceEntry(raw: Record<string, unknown>): CookingLogEntry {
  const rawType = raw.type;
  const type: CookingLogType =
    rawType === "recipe" || rawType === "ready_to_eat" || rawType === "ad_hoc"
      ? rawType
      : "ad_hoc";
  const entry: CookingLogEntry = {
    date: typeof raw.date === "string" ? raw.date : "",
    type,
  };
  if (typeof raw.recipe === "string") entry.recipe = raw.recipe;
  if (typeof raw.name === "string") entry.name = raw.name;
  if (typeof raw.protein === "string") entry.protein = raw.protein;
  if (typeof raw.cuisine === "string") entry.cuisine = raw.cuisine;
  return entry;
}

/** Read the entries array out of a parsed cooking_log.toml (empty when absent). */
export function entriesOf(parsed: Record<string, unknown>): CookingLogEntry[] {
  const raw = Array.isArray(parsed.entries) ? (parsed.entries as Record<string, unknown>[]) : [];
  return raw.map(coerceEntry);
}

/**
 * Validate a single new entry the agent is appending. Returns an error string,
 * or null when valid. Structural only — recipe-slug resolution is the build
 * Action's job (the Worker has no corpus access on workerd).
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

/** Append new entries to the existing list (append-only — order preserved). */
export function appendEntries(
  existing: CookingLogEntry[],
  additions: CookingLogEntry[],
): CookingLogEntry[] {
  return [...existing, ...additions];
}

/**
 * Map each recipe slug present among `entries` (type === "recipe") to its
 * latest cooked date. This is the source of truth for frontmatter `last_cooked`.
 */
export function deriveLastCooked(entries: CookingLogEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) {
    if (e.type !== "recipe" || !e.recipe || !e.date) continue;
    const prev = out.get(e.recipe);
    if (prev === undefined || e.date > prev) out.set(e.recipe, e.date);
  }
  return out;
}
