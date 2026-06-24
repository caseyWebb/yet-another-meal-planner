// Serialization helpers for the write path. Counterpart to parse.ts: turn structured
// data back into the repo's on-disk text. After d1-shared-corpus (slice 6) the only
// on-disk text the Worker writes is recipe markdown (everything else is D1), so this is
// just the markdown (YAML frontmatter + body) serializer.

import { dump as dumpYaml } from "js-yaml";

// A `none`/empty `protein` or `cuisine` means "no protein focus / unclassified" —
// a legitimate state the coarse controlled vocab has no slot for, and which the
// schema already expresses as ABSENCE (warn-only, never a hard failure). The
// recipe write path strips such a value before serialization so the field is
// simply not written, rather than rejected by the vocab check. A non-`none`
// off-vocab value (e.g. "shrimp") is left in place and is caught by validateFile.
const EMPTY_VARIETY_VALUES = new Set(["none", "n/a", "na", ""]);

/**
 * Drop `protein`/`cuisine` from recipe frontmatter when their value is `none` or
 * empty (case-insensitive). Mutates and returns the passed object. Applied by the
 * recipe write builders (create_recipe / update_recipe) before serialization.
 */
export function stripEmptyVarietyDimensions(
  frontmatter: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of ["protein", "cuisine"] as const) {
    const value = frontmatter[key];
    if (typeof value === "string" && EMPTY_VARIETY_VALUES.has(value.trim().toLowerCase())) {
      delete frontmatter[key];
    }
  }
  return frontmatter;
}

/** Reassemble a markdown file from frontmatter + body (inverse of parseMarkdown). */
export function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  // dumpYaml ends with a trailing newline; quotes date-like strings to keep them strings.
  const yaml = dumpYaml(frontmatter, { lineWidth: -1 });
  return `---\n${yaml}---\n${body}`;
}
