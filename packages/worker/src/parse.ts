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
  const body = text.slice(match[0].length);
  return { frontmatter, body };
}
