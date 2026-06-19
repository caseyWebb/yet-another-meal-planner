// Serialization helpers for the write path. Counterpart to parse.ts: turn
// structured data back into the repo's on-disk text. TOML round-trips lose
// comments, so for the agent-writable item files (pantry, grocery_list) we
// preserve the leading documentation header and let smol-toml own the data body.

import { dump as dumpYaml } from "js-yaml";
import { stringify as stringifyTomlRaw } from "smol-toml";

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

/**
 * Split a TOML document into its leading comment/blank header (documentation)
 * and the rest. The header is the contiguous run of lines from the top that are
 * blank or start with `#`, up to the first data line.
 */
export function splitTomlHeader(text: string): { header: string; rest: string } {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    break;
  }
  return { header: lines.slice(0, i).join("\n"), rest: lines.slice(i).join("\n") };
}

/**
 * Serialize a parsed TOML object back to text, preserving `originalText`'s
 * leading documentation header. Used for the item-array files so first write
 * doesn't strip their header comments.
 */
export function stringifyTomlWithHeader(
  originalText: string,
  data: Record<string, unknown>,
): string {
  const body = stringifyTomlRaw(data);
  const { header } = splitTomlHeader(originalText);
  const trimmedHeader = header.replace(/\s+$/, "");
  if (trimmedHeader === "") return `${body}\n`;
  return `${trimmedHeader}\n\n${body}\n`;
}
