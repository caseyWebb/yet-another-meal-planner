// The `cookbook` area (member-app-core): browse index, keyword search, new-for-me,
// recipe detail, similar recipes, and the group notes — every endpoint a thin adapter
// over the SAME named ops the MCP tools call (design page→endpoint→op map). Session-
// gated per route (requireSession is attached inline — there is no global default-deny
// on the /api mount). Reads flow through `jsonWithEtag` (conditional requests); the
// note writes are class (b): keyed on (author, slug, client-minted created_at), so an
// offline replay converges instead of duplicating or failing (D8/D14).

import { Hono } from "hono";
import { ToolError } from "../errors.js";
import { requireSession, type ApiEnv } from "../session.js";
import { jsonWithEtag } from "./etag.js";
import { jsonBody } from "./middleware.js";
import { loadRecipeIndex, loadRecipeEmbeddings } from "../recipe-index.js";
import { rankByKeyword, toHit, type CookbookHit } from "../cookbook-search.js";
import { nearestNeighbors } from "../cookbook-similar.js";
import { readRecipeDetail } from "../tools.js";
import { readNewForMe } from "../discovery-db.js";
import { NEW_FOR_ME_WINDOW_DAYS } from "../discovery-tools.js";
import { readTrending, readPickedForYou } from "../cookbook-rows.js";
import {
  isVisible,
  memberViewer,
  visibleSlugProvenance,
  lensHouseholds,
  ANONYMOUS,
  type Viewer,
  type Provenance,
} from "../visibility.js";
import {
  readRecipeNotes,
  insertRecipeNote,
  updateRecipeNote,
  removeRecipeNote,
  hasOwnRecipeNote,
  type NoteTier,
} from "../corpus-db.js";
import { groupFavorites, resolveNoteTier } from "../notes-tools.js";
import { directoryFromEnv } from "../tenant.js";
import type { RecipeIndex, IndexedRecipe } from "../recipes.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The shared LENS-SCOPED index read (the member viewer's position through the shared
 *  enforcement point), with the same `index_unavailable` remap `search_recipes` uses. */
async function loadIndex(env: Parameters<typeof loadRecipeIndex>[0], viewer: Viewer): Promise<RecipeIndex> {
  return loadRecipeIndex(env, viewer).catch((e) => {
    throw new ToolError(
      "index_unavailable",
      `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
}

function requireSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
}

/** Enum-validate a note-tier body field: absent → undefined; anything else must be one
 *  of the three tiers (a typo'd tier must never silently default an audience). */
function parseTier(value: unknown, slug: string): NoteTier | undefined {
  if (value === undefined) return undefined;
  if (value === "public" || value === "friends" || value === "private") return value;
  throw new ToolError("validation_failed", "tier must be one of 'public', 'friends', 'private'", { slug });
}

/** The lens gate for slug-addressed reads: out-of-lens and nonexistent slugs take the
 *  IDENTICAL not_found path — no existence disclosure, no body read (shared-corpus D11). */
async function requireVisible(env: Parameters<typeof loadRecipeIndex>[0], viewer: Viewer, slug: string): Promise<void> {
  requireSlug(slug);
  if (!(await isVisible(env, viewer, slug))) {
    throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  }
}

/** A member cookbook hit: the compact shape plus the row's PROVENANCE for the caller's
 *  household — `own` | `friend` | `curated`, the highest-precedence grant admitting it —
 *  so list surfaces render curated (and later friend) provenance without a second read. */
export interface MemberCookbookHit extends CookbookHit {
  provenance: Provenance;
}

function withProvenance(hits: CookbookHit[], provenance: Map<string, Provenance>): MemberCookbookHit[] {
  // Every hit came through the lens, so a missing map entry cannot happen in practice;
  // `own` is the inert fallback that never renders a badge.
  return hits.map((h) => ({ ...h, provenance: provenance.get(h.slug) ?? "own" }));
}

/** Title-sorted compact hits over the whole index (the browse page's all-recipes list). */
function indexHits(index: RecipeIndex): CookbookHit[] {
  return Object.values(index)
    .map(toHit)
    .sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
}

export const cookbookArea = new Hono<ApiEnv>()
  // Browse: the full index as title-sorted compact hits. Registered BEFORE the
  // :slug param route; named /recipes (NOT /index — hono's `hc` reserves the
  // `index` key for a route at "/", so a literal /index segment is unreachable
  // through the typed client).
  .get("/cookbook/recipes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const viewer = memberViewer(tenant.id, tenant.member);
    const [index, provenance] = await Promise.all([
      loadIndex(c.env, viewer),
      visibleSlugProvenance(c.env, viewer),
    ]);
    return jsonWithEtag(c, { recipes: withProvenance(indexHits(index), provenance) });
  })
  // Browse: "New for you" — the per-member discovery read with its watermark (D5).
  // Attribution is per-MEMBER (the discovery_matches.member key) while visibility is
  // per-household; visibility events (friend links, curated landings) never feed it.
  .get("/cookbook/new-for-me", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const floor = new Date(Date.now() - NEW_FOR_ME_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const recipes = await readNewForMe(c.env, tenant.id, tenant.member, floor);
    return jsonWithEtag(c, { recipes });
  })
  // Browse: "New & trending"'s trending half (member-app-differentiators D7) — the
  // group-wide windowed cooking_log aggregation, counts only, min-signal-guarded
  // (sparse single-cook history reads as an honest EMPTY set), caller's rejects
  // filtered. Registered before the :slug param routes (the P1 ordering note).
  .get("/cookbook/trending", requireSession, async (c) => {
    const tenant = c.get("tenant");
    return jsonWithEtag(c, await readTrending(c.env, tenant.id));
  })
  // Browse: "Picked for you" (member-app-differentiators D8) — the deterministic
  // favorites-centroid rankCandidates wrap over stored vectors (zero AI calls);
  // no favorites → an empty list, never a backfill from the general index.
  .get("/cookbook/picked-for-you", requireSession, async (c) => {
    const tenant = c.get("tenant");
    return jsonWithEtag(c, await readPickedForYou(c.env, tenant.id));
  })
  // Keyword search — the SAME pure ranker the public /cookbook/search serves (D6),
  // over the member's lens rather than the anonymous lens.
  .get("/cookbook/search", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const viewer = memberViewer(tenant.id, tenant.member);
    const q = c.req.query("q") ?? "";
    const [index, provenance] = await Promise.all([
      loadIndex(c.env, viewer),
      visibleSlugProvenance(c.env, viewer),
    ]);
    return jsonWithEtag(c, { q, results: withProvenance(rankByKeyword(index, q), provenance) });
  })
  // Recipe detail: the extracted read_recipe assembly (overlay-merged + derived
  // description; lens-gated inside the op — out-of-lens ⇒ the identical not_found).
  .get("/cookbook/recipes/:slug", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const detail = await readRecipeDetail(c.env, tenant.id, c.req.param("slug"));
    return jsonWithEtag(c, detail);
  })
  // Similar recipes: pure cosine over cron-captured vectors (same floor/cap as the
  // cookbook). The candidate set is restricted to the caller's lens BEFORE neighbor
  // selection, so an out-of-lens recipe never occupies a slot or leaks existence.
  .get("/cookbook/recipes/:slug/similar", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const viewer = memberViewer(tenant.id, tenant.member);
    const slug = c.req.param("slug");
    await requireVisible(c.env, viewer, slug);
    const [embeddings, index] = await Promise.all([loadRecipeEmbeddings(c.env), loadIndex(c.env, viewer)]);
    const visibleEmbeddings = new Map<string, number[]>();
    for (const [s, vec] of embeddings) {
      if (index[s] !== undefined) visibleEmbeddings.set(s, vec);
    }
    const similar = nearestNeighbors(slug, visibleEmbeddings)
      .map((s) => index[s])
      .filter((r): r is IndexedRecipe => r != null)
      .map(toHit);
    return jsonWithEtag(c, { slug, similar });
  })
  // Group notes + favorites for a recipe (the tier rules live in the op). Lens-bound:
  // unreachable for an out-of-lens slug (the identical not_found). Notes are
  // tier-filtered in the op's one query; favorites aggregate over the caller's LENS
  // households only (every household under self-hosted — today's read; own +
  // friend-seam households under SaaS). `anonymously_visible` is the composer's datum
  // for the conditional Public copy — one anonymous point query on the lens.
  .get("/cookbook/recipes/:slug/notes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    await requireVisible(c.env, memberViewer(tenant.id, tenant.member), slug);
    const lens = await lensHouseholds(c.env, tenant.id);
    const ids = lens ?? (await directoryFromEnv(c.env).list());
    const [notes, favorites, anonymouslyVisible] = await Promise.all([
      readRecipeNotes(c.env, slug, { member: tenant.member, tenant: tenant.id }),
      groupFavorites(c.env, slug, ids),
      isVisible(c.env, ANONYMOUS, slug),
    ]);
    return jsonWithEtag(c, { slug, notes, favorites, anonymously_visible: anonymouslyVisible });
  })
  // Note add — class (b): identity is (author, slug, CLIENT-minted created_at), so a
  // replayed delivery finds its row and converges (deduped) instead of duplicating.
  // Author is the resolved MEMBER (attribution, member-identity-split D8); creation is
  // lens-gated (a member only annotates recipes they can see — out-of-lens and
  // nonexistent slugs take the identical not_found). `tier` sets the audience
  // (default 'friends'); the legacy `private` boolean is the deprecated alias.
  .post("/cookbook/recipes/:slug/notes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    if (!SLUG_RE.test(slug)) throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
    const body = await jsonBody<{ body?: unknown; tags?: unknown; tier?: unknown; private?: unknown; created_at?: unknown }>(c);
    const text = typeof body.body === "string" ? body.body : "";
    if (!text.trim()) throw new ToolError("validation_failed", "note body must not be empty", { slug });
    const createdAt = typeof body.created_at === "string" ? body.created_at : "";
    if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
      throw new ToolError("validation_failed", "created_at must be a client-minted ISO timestamp", { slug });
    }
    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
    const tier = resolveNoteTier(parseTier(body.tier, slug), body.private === true ? true : undefined) ?? "friends";
    if (!(await isVisible(c.env, memberViewer(tenant.id, tenant.member), slug))) {
      throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    }
    if (await hasOwnRecipeNote(c.env, slug, tenant.member, createdAt)) {
      return c.json({ slug, author: tenant.member, created_at: createdAt, tier, deduped: true });
    }
    await insertRecipeNote(c.env, slug, tenant.member, {
      created_at: createdAt,
      body: text,
      tags,
      tier,
    });
    return c.json({ slug, author: tenant.member, created_at: createdAt, tier });
  })
  // Note edit — author-scoped by construction (the op only ever touches the caller's
  // own row), so it stays UNGATED by the lens: an author can always re-tier (e.g.
  // privatize) or fix their own note even after the recipe leaves their lens (a
  // friendship sever) — no oracle, no new annotation. Passing `tier` re-tiers.
  .patch("/cookbook/recipes/:slug/notes/:created_at", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    const createdAt = c.req.param("created_at");
    if (!SLUG_RE.test(slug)) throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
    const body = await jsonBody<{ body?: unknown; tags?: unknown; tier?: unknown; private?: unknown }>(c);
    if (typeof body.body === "string" && !body.body.trim()) {
      throw new ToolError("validation_failed", "note body must not be empty", { slug });
    }
    const tier = await updateRecipeNote(c.env, slug, tenant.member, createdAt, {
      body: typeof body.body === "string" ? body.body : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
      tier: resolveNoteTier(parseTier(body.tier, slug), typeof body.private === "boolean" ? body.private : undefined),
    });
    if (tier === null) {
      throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at: createdAt });
    }
    return c.json({ slug, author: tenant.member, created_at: createdAt, tier });
  })
  // Note delete — class (b): a second delivery finds nothing and reports converged.
  // Self-scoped like the edit, and ungated for the same reason.
  .delete("/cookbook/recipes/:slug/notes/:created_at", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    const createdAt = c.req.param("created_at");
    if (!SLUG_RE.test(slug)) throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
    const removed = await removeRecipeNote(c.env, slug, tenant.member, createdAt);
    return c.json({ slug, created_at: createdAt, removed });
  });
