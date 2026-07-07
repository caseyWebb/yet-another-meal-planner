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
import {
  readRecipeNotes,
  insertRecipeNote,
  updateRecipeNote,
  removeRecipeNote,
} from "../corpus-db.js";
import { groupFavorites } from "../notes-tools.js";
import { directoryFromEnv } from "../tenant.js";
import type { RecipeIndex, IndexedRecipe } from "../recipes.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The shared index read, with the same `index_unavailable` remap `search_recipes` uses. */
async function loadIndex(env: Parameters<typeof loadRecipeIndex>[0]): Promise<RecipeIndex> {
  return loadRecipeIndex(env).catch((e) => {
    throw new ToolError(
      "index_unavailable",
      `the recipe index is unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
  });
}

function requireSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
}

/** Title-sorted compact hits over the whole index (the browse page's all-recipes list). */
function indexHits(index: RecipeIndex): CookbookHit[] {
  return Object.values(index)
    .map(toHit)
    .sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
}

export const cookbookArea = new Hono<ApiEnv>()
  // Browse: the full index as title-sorted compact hits.
  .get("/cookbook/index", requireSession, async (c) => {
    const index = await loadIndex(c.env);
    return jsonWithEtag(c, { recipes: indexHits(index) });
  })
  // Browse: "New for you" — the per-member discovery read with its watermark (D5).
  .get("/cookbook/new-for-me", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const floor = new Date(Date.now() - NEW_FOR_ME_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const recipes = await readNewForMe(c.env, tenant.id, floor);
    return jsonWithEtag(c, { recipes });
  })
  // Keyword search — the SAME pure ranker the public /cookbook/search serves (D6).
  .get("/cookbook/search", requireSession, async (c) => {
    const q = c.req.query("q") ?? "";
    const index = await loadIndex(c.env);
    return jsonWithEtag(c, { q, results: rankByKeyword(index, q) });
  })
  // Recipe detail: the extracted read_recipe assembly (overlay-merged + derived description).
  .get("/cookbook/recipes/:slug", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const detail = await readRecipeDetail(c.env, tenant.id, c.req.param("slug"));
    return jsonWithEtag(c, detail);
  })
  // Similar recipes: pure cosine over cron-captured vectors (same floor/cap as the cookbook).
  .get("/cookbook/recipes/:slug/similar", requireSession, async (c) => {
    const slug = c.req.param("slug");
    requireSlug(slug);
    const [embeddings, index] = await Promise.all([loadRecipeEmbeddings(c.env), loadIndex(c.env)]);
    const similar = nearestNeighbors(slug, embeddings)
      .map((s) => index[s])
      .filter((r): r is IndexedRecipe => r != null)
      .map(toHit);
    return jsonWithEtag(c, { slug, similar });
  })
  // Group notes + favorites for a recipe (the privacy rule lives in the op).
  .get("/cookbook/recipes/:slug/notes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    requireSlug(slug);
    const ids = await directoryFromEnv(c.env).list();
    const [notes, favorites] = await Promise.all([
      readRecipeNotes(c.env, slug, tenant.id),
      groupFavorites(c.env, slug, ids),
    ]);
    return jsonWithEtag(c, { slug, notes, favorites });
  })
  // Note add — class (b): identity is (author, slug, CLIENT-minted created_at), so a
  // replayed delivery finds its row and converges (deduped) instead of duplicating.
  .post("/cookbook/recipes/:slug/notes", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    if (!SLUG_RE.test(slug)) throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
    const body = await jsonBody<{ body?: unknown; tags?: unknown; private?: unknown; created_at?: unknown }>(c);
    const text = typeof body.body === "string" ? body.body : "";
    if (!text.trim()) throw new ToolError("validation_failed", "note body must not be empty", { slug });
    const createdAt = typeof body.created_at === "string" ? body.created_at : "";
    if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
      throw new ToolError("validation_failed", "created_at must be a client-minted ISO timestamp", { slug });
    }
    const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : [];
    const isPrivate = body.private === true;
    const existing = await readRecipeNotes(c.env, slug, tenant.id);
    if (existing.some((n) => n.author === tenant.id && n.created_at === createdAt)) {
      return c.json({ slug, author: tenant.id, created_at: createdAt, deduped: true });
    }
    await insertRecipeNote(c.env, slug, tenant.id, {
      created_at: createdAt,
      body: text,
      tags,
      private: isPrivate,
    });
    return c.json({ slug, author: tenant.id, created_at: createdAt });
  })
  // Note edit — author-scoped by construction (the op only ever touches the caller's own).
  .patch("/cookbook/recipes/:slug/notes/:created_at", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    const createdAt = c.req.param("created_at");
    if (!SLUG_RE.test(slug)) throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
    const body = await jsonBody<{ body?: unknown; tags?: unknown; private?: unknown }>(c);
    if (typeof body.body === "string" && !body.body.trim()) {
      throw new ToolError("validation_failed", "note body must not be empty", { slug });
    }
    const found = await updateRecipeNote(c.env, slug, tenant.id, createdAt, {
      body: typeof body.body === "string" ? body.body : undefined,
      tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : undefined,
      private: typeof body.private === "boolean" ? body.private : undefined,
    });
    if (!found) {
      throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at: createdAt });
    }
    return c.json({ slug, author: tenant.id, created_at: createdAt });
  })
  // Note delete — class (b): a second delivery finds nothing and reports converged.
  .delete("/cookbook/recipes/:slug/notes/:created_at", requireSession, async (c) => {
    const tenant = c.get("tenant");
    const slug = c.req.param("slug");
    const createdAt = c.req.param("created_at");
    if (!SLUG_RE.test(slug)) throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
    const removed = await removeRecipeNote(c.env, slug, tenant.id, createdAt);
    return c.json({ slug, created_at: createdAt, removed });
  });
