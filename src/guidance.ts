// Read + write logic for the curated `guidance/` content trees — markdown corpora
// at the data-repo root (shared, read by all tenants), organized by DOMAIN
// subdirectory: `guidance/ingredient_storage/` (curated, read-only put-away advice),
// `guidance/cooking_techniques/` (agent-writable technique memories), and
// `guidance/purchasing/` (agent-writable buy-side selection/quality advice). The files
// are class/technique/item-keyed markdown; mapping an item/step to a slug is the agent's
// world-knowledge job (no manifest). Factored out of tools.ts so the list/read/save
// behavior is unit-testable against a fake CorpusStore (mirrors recipes.ts).
//
// The read posture mirrors the former storage-guidance module; the WRITE posture
// (save_guidance) mirrors the shared-and-agent-writable corpora (stores/feeds), but
// is gated by a WRITABLE-domain allowlist so `ingredient_storage` stays read-only —
// the guarantee is enforced by the allowlist, not by the absence of a write tool.

import { type CorpusStore, readCorpusFile } from "./corpus-store.js";
import { parseMarkdown } from "./parse.js";
import { ToolError } from "./errors.js";

const ROOT = "guidance";

/** The controlled vocabulary of guidance domains; each maps to `guidance/<domain>/`. */
export const GUIDANCE_DOMAINS = ["ingredient_storage", "cooking_techniques", "purchasing"] as const;
export type GuidanceDomain = (typeof GUIDANCE_DOMAINS)[number];

/** Domains `save_guidance` may write. `ingredient_storage` is excluded → read-only. */
export const WRITABLE_DOMAINS: readonly GuidanceDomain[] = ["cooking_techniques", "purchasing"];

// Read slugs allow an optional leading underscore for relational files
// (`_ethylene` in ingredient_storage). Anchored, so it also rejects path traversal.
const READ_SLUG_RE = /^_?[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Write slugs are plain kebab-case (no leading underscore — relational files are
// curated config, not agent-authored). Anchored, so it also rejects path traversal.
const WRITE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function dirFor(domain: GuidanceDomain): string {
  return `${ROOT}/${domain}`;
}

/** Throw `validation_failed` for a domain outside the controlled vocabulary. */
function assertDomain(domain: string): asserts domain is GuidanceDomain {
  if (!(GUIDANCE_DOMAINS as readonly string[]).includes(domain)) {
    throw new ToolError("validation_failed", `Unknown guidance domain: ${domain}`, { domain });
  }
}

/** Throw `validation_failed` for a domain not on the writable allowlist. */
function assertWritableDomain(domain: string): asserts domain is GuidanceDomain {
  assertDomain(domain);
  if (!WRITABLE_DOMAINS.includes(domain)) {
    throw new ToolError(
      "validation_failed",
      `The \`${domain}\` guidance domain is read-only and cannot be written`,
      { domain },
    );
  }
}

/** Strip the `.md` extension from a guidance file name; null for non-markdown entries. */
export function slugFromFile(name: string): string | null {
  if (!name.endsWith(".md")) return null;
  return name.slice(0, -3);
}

export interface GuidanceListing {
  slug: string;
  description?: string;
}

/** List one domain's slugs (each with its optional one-line frontmatter `description`). */
async function listDomain(store: CorpusStore, domain: GuidanceDomain): Promise<GuidanceListing[]> {
  const dir = dirFor(domain);
  // An absent tree is not an error — `listDir` returns [] (the agent simply has nothing
  // vetted to offer); a genuine store failure surfaces as a structured ToolError.
  const entries = await store.listDir(dir);
  const slugs = entries
    .filter((e) => e.type === "file")
    .map((e) => slugFromFile(e.name))
    .filter((s): s is string => s !== null);
  const listings = await Promise.all(
    slugs.map(async (slug) => {
      const text = await readCorpusFile(
        store,
        `${dir}/${slug}.md`,
        "not_found",
        `Unknown guidance slug: ${slug}`,
      );
      const { frontmatter } = parseMarkdown(text, `${dir}/${slug}.md`);
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description : undefined;
      return description ? { slug, description } : { slug };
    }),
  );
  listings.sort((a, b) => a.slug.localeCompare(b.slug));
  return listings;
}

export interface DomainListing {
  domain: GuidanceDomain;
  entries: GuidanceListing[];
}

/**
 * List available guidance slugs. With `domain`, return that one domain's entries
 * (`{ domain, entries }`); without it, return every domain's entries grouped by
 * domain (`{ domains: [...] }`). An absent corpus tree yields an empty listing,
 * never an error.
 */
export async function listGuidance(
  store: CorpusStore,
  domain?: string,
): Promise<{ domain: GuidanceDomain; entries: GuidanceListing[] } | { domains: DomainListing[] }> {
  if (domain !== undefined) {
    assertDomain(domain);
    return { domain, entries: await listDomain(store, domain) };
  }
  const domains = await Promise.all(
    GUIDANCE_DOMAINS.map(async (d) => ({ domain: d, entries: await listDomain(store, d) })),
  );
  return { domains };
}

export interface GuidanceEntry {
  slug: string;
  content: string;
}

/**
 * Read the named entries' raw markdown content within one domain. An unknown (or
 * malformed) slug, or an unknown domain, yields a structured error per errors.ts.
 */
export async function readGuidance(
  store: CorpusStore,
  domain: string,
  slugs: string[],
): Promise<{ domain: GuidanceDomain; entries: GuidanceEntry[] }> {
  assertDomain(domain);
  const dir = dirFor(domain);
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      if (!READ_SLUG_RE.test(slug)) {
        throw new ToolError("not_found", `Unknown guidance slug: ${slug}`, { slug });
      }
      const content = await readCorpusFile(
        store,
        `${dir}/${slug}.md`,
        "not_found",
        `Unknown guidance slug: ${slug}`,
      );
      return { slug, content };
    }),
  );
  return { domain, entries };
}

/**
 * Ensure the markdown `content` records `source` in its frontmatter. If a leading
 * `---` fence is present, inject a `source:` line (unless one is already there);
 * otherwise prepend a fresh frontmatter block. Returns content unchanged when no
 * source is supplied.
 */
function withSource(content: string, source?: string): string {
  if (!source) return content;
  const fence = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (fence) {
    if (/^\s*source\s*:/m.test(fence[1])) return content; // already recorded; don't duplicate
    const rest = content.slice(fence[0].length);
    return `---\n${fence[1]}\nsource: ${source}\n---\n${rest.startsWith("\n") ? "" : "\n"}${rest}`;
  }
  return `---\nsource: ${source}\n---\n\n${content}`;
}

/**
 * Create or refine a single guidance entry. Gated by the WRITABLE-domain allowlist:
 * a write to `ingredient_storage` (or any non-allowlisted/unknown domain) is rejected
 * with `validation_failed` and nothing is committed. There is exactly one file per
 * slug — saving an existing slug overwrites/refines it (no append). `content` is the
 * full markdown the agent composes; `source`, when given, is recorded in frontmatter.
 */
export async function saveGuidance(
  store: CorpusStore,
  domain: string,
  slug: string,
  content: string,
  source?: string,
): Promise<{ domain: GuidanceDomain; slug: string; path: string }> {
  assertWritableDomain(domain);
  if (!WRITE_SLUG_RE.test(slug)) {
    throw new ToolError("validation_failed", `Invalid guidance slug: ${slug}`, { slug });
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new ToolError("validation_failed", "guidance content must not be empty", { slug });
  }
  // One slug = one object: the write is a single-object R2 put (atomic at the object
  // level), overwriting/refining any existing entry. No commit/sha — the corpus is R2,
  // not git (git history for the corpus is a deliberately-accepted loss).
  const path = `${dirFor(domain)}/${slug}.md`;
  await store.put(path, withSource(content, source));
  return { domain, slug, path };
}
