// Pure helpers for the discovery tools (recipe-discovery capability): URL
// canonicalization, corpus dedup, slug derivation, and the create_recipe file
// builder. Kept I/O-light (only buildNewRecipe touches the GitHub client, to
// read for a collision) so the logic is unit-testable.

import type { Env } from "./env.js";
import type { GitHubClient, TreeFile } from "./github.js";
import { readOptional } from "./gh-read.js";
import { readAliases } from "./corpus-db.js";
import { normalizePerishables } from "./matching.js";
import { serializeMarkdown, stripEmptyVarietyDimensions } from "./serialize.js";
import { ToolError } from "./errors.js";
import { truncate } from "./text.js";
import { canonicalizeUrl } from "./url.js";
import type { FeedItem } from "./feeds.js";

// Re-exported from its dependency-free home (src/url.ts) so existing importers keep
// using `discovery.js` while corpus-db can share it without an import cycle.
export { canonicalizeUrl } from "./url.js";

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

/**
 * Canonicalized `source` URLs of every indexed recipe, for corpus dedup. The
 * source-URL projection now lives in the D1 `recipes` table (`source_url` column),
 * read via `recipeSourceMap(env)` (raw URL → slug). Stored values are raw, so we
 * canonicalize each here so tracker-wrapped feed links compare equal. Absent → empty set.
 */
export function extractRecipeSources(sourceMap: Map<string, string>): Set<string> {
  const set = new Set<string>();
  for (const src of sourceMap.keys()) {
    if (src) set.add(canonicalizeUrl(src));
  }
  return set;
}

/**
 * Map canonicalized `source` URL → recipe slug for every indexed recipe (from the
 * D1 `recipes` table via `recipeSourceMap(env)`). Drives idempotent import (§6.4):
 * a parsed page whose source is already in this map is reused, not re-created.
 * First slug wins on a (rare) canonical-source collision.
 */
export function indexSourceToSlug(sourceMap: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [src, slug] of sourceMap) {
    if (!src) continue;
    const c = canonicalizeUrl(src);
    if (!map.has(c)) map.set(c, slug);
  }
  return map;
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

// The discovery inbox is the D1 `discovery_candidates` table now (slice 6) — read via
// corpus-db `readDiscoveryInbox(env)` (no more TOML flatten).

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
 * Build the TreeFile for a new recipe. Derives the slug from the title (or uses
 * `slugOverride`) and guards the `## Ingredients`/`## Instructions` H2 contract so a
 * malformed body can't be committed as a build-breaker. Stamps NO `status`: the
 * per-tenant status lifecycle is retired, so an imported recipe is an available corpus
 * recipe by default (opt-out visibility). Refuses to overwrite an existing recipe
 * (slug_exists).
 */
export async function buildNewRecipe(
  gh: GitHubClient,
  env: Env,
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

  // No `status` is stamped — the per-tenant status lifecycle is retired and an
  // imported recipe lands available by default. A lingering `status` supplied by a
  // stale caller is dropped so it never re-enters the corpus as objective content.
  const fm: Record<string, unknown> = { ...frontmatter };
  delete fm.status;
  // Canonicalize perishable_ingredients (objective shared content) at create the
  // same way the verify matcher normalizes, so overlap lines up across recipes.
  if ("perishable_ingredients" in fm) {
    fm.perishable_ingredients = normalizePerishables(fm.perishable_ingredients, await readAliases(env));
  }
  // Treat a none/empty protein|cuisine as absent so a no-protein dish writes
  // cleanly instead of tripping the controlled-vocabulary check.
  stripEmptyVarietyDimensions(fm);
  return { slug, file: { path, content: serializeMarkdown(fm, body) } };
}
