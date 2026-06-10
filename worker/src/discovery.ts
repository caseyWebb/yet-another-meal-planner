// Pure helpers for the discovery tools (recipe-discovery capability): URL
// canonicalization, corpus dedup, slug derivation, and the create_recipe file
// builder. Kept I/O-light (only buildNewRecipe touches the GitHub client, to
// read for a collision) so the logic is unit-testable.

import type { GitHubClient, TreeFile } from "./github.js";
import { readOptional } from "./gh-read.js";
import { serializeMarkdown } from "./serialize.js";
import { ToolError } from "./errors.js";
import { truncate } from "./text.js";
import type { FeedItem } from "./feeds.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUMMARY_MAX = 300;

export interface Candidate {
  url: string;
  title: string;
  source: string;
  feed_weight: number;
  summary: string | null;
}

export interface FeedEntry {
  item: FeedItem;
  feedName: string;
  feedWeight: number;
}

/** Strip query + fragment + trailing slash so tracker-wrapped and bare links compare equal. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return raw.trim();
  }
}

/** Canonicalized `source:` URLs of every recipe in `_indexes/recipes.json` (absent → empty set). */
export function extractRecipeSources(indexRaw: string | null): Set<string> {
  const set = new Set<string>();
  if (!indexRaw) return set;
  let index: unknown;
  try {
    index = JSON.parse(indexRaw);
  } catch {
    return set;
  }
  if (index && typeof index === "object") {
    for (const entry of Object.values(index as Record<string, unknown>)) {
      const src = (entry as Record<string, unknown> | null)?.source;
      if (typeof src === "string" && src) set.add(canonicalizeUrl(src));
    }
  }
  return set;
}

/** Dedup feed entries against the corpus (`seen`) and within the pool; canonicalize URLs. */
export function buildCandidates(entries: FeedEntry[], seen: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  const localSeen = new Set(seen);
  for (const { item, feedName, feedWeight } of entries) {
    const url = canonicalizeUrl(item.link);
    if (localSeen.has(url)) continue;
    localSeen.add(url);
    out.push({
      url,
      title: item.title,
      source: feedName,
      feed_weight: feedWeight,
      summary: item.summary ? truncate(item.summary, SUMMARY_MAX) : null,
    });
  }
  return out;
}

/** Title → plain slug (lowercase, accents stripped, non-alphanumerics → hyphens). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the TreeFile for a new draft recipe. Derives the slug from the title (or
 * uses `slugOverride`), defaults `status` to "draft" so a discovery import never
 * lands active by omission, and guards the `## Ingredients`/`## Instructions` H2
 * contract so a malformed body can't be committed as a build-breaker. Refuses to
 * overwrite an existing recipe (slug_exists).
 */
export async function buildNewRecipe(
  gh: GitHubClient,
  frontmatter: Record<string, unknown>,
  body: string,
  slugOverride?: string,
): Promise<{ slug: string; file: TreeFile }> {
  const title = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const slug = slugOverride ?? slugify(title);
  if (!SLUG_RE.test(slug)) {
    throw new ToolError("validation_failed", "create_recipe needs a `title` (or a valid slug) to name the file", {
      slug,
    });
  }
  if (!/^##\s+Ingredients\s*$/m.test(body) || !/^##\s+Instructions\s*$/m.test(body)) {
    throw new ToolError(
      "validation_failed",
      "recipe body must contain both '## Ingredients' and '## Instructions' H2 sections",
      { slug },
    );
  }

  const path = `recipes/${slug}.md`;
  const existing = await readOptional(gh, path);
  if (existing !== null) {
    throw new ToolError("slug_exists", `A recipe already exists at ${path}`, { slug });
  }

  const fm = "status" in frontmatter ? frontmatter : { ...frontmatter, status: "draft" };
  return { slug, file: { path, content: serializeMarkdown(fm, body) } };
}
