// Workers-runtime-safe parsing (design D3). No gray-matter: split the frontmatter
// fence by hand and parse YAML with js-yaml (pure JS, runs on workerd). After
// d1-shared-corpus (slice 6) the data path has no TOML — recipe frontmatter is the
// only structured text the Worker parses — so there is no longer a TOML parser here.
// Parse failures become a structured `malformed_data` error.

import { load as loadYaml } from "js-yaml";
import { ToolError } from "./errors.js";

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Normalize a Date-valued frontmatter value back to the string it was authored
 * as. js-yaml's own default schema keeps an unquoted `2026-06-09` a plain string,
 * but a YAML 1.1 timestamp resolver (other authoring tooling, older js-yaml) turns
 * it into a JS Date — and re-serializing that Date dumps `2026-06-09T00:00:00.000Z`,
 * drifting the file on every write. Normalizing at PARSE makes the data self-heal
 * on the next write: a midnight-UTC Date collapses to its authored `YYYY-MM-DD`
 * form; a Date carrying a real time component keeps the full ISO string (preserve
 * information, never truncate a genuine timestamp). Exported for direct testing —
 * the bundled js-yaml never produces Dates, so this can't be exercised via text.
 */
export function normalizeDateValue(value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  const iso = value.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}

/**
 * Split a markdown document into parsed YAML frontmatter and the remaining
 * body. A document without a leading `---` fence yields empty frontmatter and
 * the whole text as body.
 */
export function parseMarkdown(text: string, label = "document"): ParsedMarkdown {
  const match = FENCE.exec(text);
  if (!match) {
    return { frontmatter: {}, body: text };
  }

  let parsed: unknown;
  try {
    parsed = loadYaml(match[1]);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new ToolError("malformed_data", `Invalid YAML frontmatter in ${label}: ${message}`);
  }

  const frontmatter =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  // Date values never leave the parser (see normalizeDateValue) — so a subsequent
  // serializeMarkdown of this frontmatter is round-trip stable.
  for (const [key, value] of Object.entries(frontmatter)) {
    const normalized = normalizeDateValue(value);
    if (normalized !== value) frontmatter[key] = normalized;
  }
  const body = text.slice(match[0].length);
  return { frontmatter, body };
}
