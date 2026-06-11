// Read-side logic for the curated `storage_guidance/` content tree — a class-keyed
// markdown corpus at the data-repo root (shared, read by all tenants). There is NO
// write path: the tree is hand-maintained curated config, never an agent side-effect
// file. Factored out of tools.ts so the list/read behavior is unit-testable against
// a fake GitHubClient (mirrors recipes.ts / kitchen.ts).

import { GitHubError, type GitHubClient } from "./github.js";
import { readFile } from "./gh-read.js";
import { parseMarkdown } from "./parse.js";
import { ToolError } from "./errors.js";

const DIR = "storage_guidance";

// Class slugs are lowercase, hyphen-separated, with an optional leading underscore
// for relational files (`_ethylene`). Anchored, so it also rejects path traversal.
const SLUG_RE = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Strip the `.md` extension from a guidance file name; null for non-markdown entries. */
export function slugFromFile(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  return name.slice(0, -3);
}

export interface GuidanceListing {
  slug: string;
  description?: string;
}

/**
 * List the available guidance class slugs, each with its optional one-line
 * `description` (from the file's frontmatter). Returns `{ entries: [] }` when the
 * tree does not exist yet (an absent `storage_guidance/` is not an error — the
 * agent simply has nothing vetted to offer).
 */
export async function listStorageGuidance(gh: GitHubClient): Promise<{ entries: GuidanceListing[] }> {
  let dir;
  try {
    dir = await gh.listDir(DIR);
  } catch (e) {
    if (e instanceof GitHubError) {
      if (e.status === 404) return { entries: [] };
      throw new ToolError("upstream_unavailable", e.message);
    }
    throw e;
  }
  const slugs = dir
    .filter((e) => e.type === "file")
    .map((e) => slugFromFile(e.name))
    .filter((s): s is string => s !== null);
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const text = await readFile(
        gh,
        `${DIR}/${slug}.md`,
        "not_found",
        `Unknown storage-guidance slug: ${slug}`,
      );
      const { frontmatter } = parseMarkdown(text, `${DIR}/${slug}.md`);
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description : undefined;
      return description ? { slug, description } : { slug };
    }),
  );
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  return { entries };
}

export interface GuidanceEntry {
  slug: string;
  content: string;
}

/**
 * Read the named guidance entries' raw markdown content. An unknown (or malformed)
 * slug yields a structured `not_found`, per the errors.ts convention.
 */
export async function readStorageGuidance(
  gh: GitHubClient,
  slugs: string[],
): Promise<{ entries: GuidanceEntry[] }> {
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      if (!SLUG_RE.test(slug)) {
        throw new ToolError("not_found", `Unknown storage-guidance slug: ${slug}`, { slug });
      }
      const content = await readFile(
        gh,
        `${DIR}/${slug}.md`,
        "not_found",
        `Unknown storage-guidance slug: ${slug}`,
      );
      return { slug, content };
    }),
  );
  return { entries };
}
