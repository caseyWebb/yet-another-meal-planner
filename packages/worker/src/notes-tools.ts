// Recipe-note + store-note tools (recipe-notes / in-store-fulfillment, §8/D6). Notes
// are attributed annotations on a recipe or a store. After slice 6 they live in the D1
// `recipe_notes` / `store_notes` tables (not per-tenant GitHub files): author is the
// caller (an `author` column), `private` an owner-only flag. Reads are ONE query with
// the privacy rule applied (private=0 OR author=caller) — the caller's own private
// notes plus everyone's shared notes — replacing the per-tenant directory scan. For
// recipes, the notes query is joined with the slice-4 overlay-ratings query so
// read_recipe_notes is fully D1 (notes + ratings).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { ToolError, runTool } from "./errors.js";
import {
  readRecipeNotes,
  insertRecipeNote,
  updateRecipeNote,
  removeRecipeNote,
  readStoreNotes,
  insertStoreNote,
  updateStoreNote,
  removeStoreNote,
} from "./corpus-db.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nowIso(): string {
  return new Date().toISOString();
}

/** The group-favorites half of read_recipe_notes: the overlay table, scoped to the
 *  group. The favorite cutover replaced the per-rating list with the members who
 *  favorited the recipe — `favorites.length` IS the group signal (COUNT(favorite)). */
async function groupFavorites(env: Env, slug: string, ids: string[]): Promise<{ author: string }[]> {
  const inGroup = new Set(ids);
  const rows = await db(env).all<{ tenant: string; favorite: number | null }>(
    "SELECT tenant, favorite FROM overlay WHERE recipe = ?1",
    slug,
  );
  const favorites: { author: string }[] = [];
  for (const r of rows) {
    if (!inGroup.has(r.tenant) || !r.favorite) continue;
    favorites.push({ author: r.tenant });
  }
  favorites.sort((a, b) => (a.author < b.author ? -1 : a.author > b.author ? 1 : 0));
  return favorites;
}

/**
 * @param server    the MCP server to register on
 * @param tenantId  the caller — author of new notes + privacy boundary on reads
 * @param directory the tenant allowlist, scoping the group ratings aggregate
 * @param env       D1 — the `recipe_notes` + `overlay` tables back the read
 */
export function registerNoteTools(
  server: McpServer,
  tenantId: string,
  directory: { list(): Promise<string[]> },
  env: Env,
): void {
  server.registerTool(
    "add_recipe_note",
    {
      description:
        "Append an attributed note to a recipe (shared or personal) — the spin-capture mechanism (D6). Use this for tweaks/observations ('subbed gochujang for sriracha, better') instead of editing shared recipe content. Append-mostly: prior notes are retained. Author is you. Set private=true to keep a note to yourself; default is shared with the group. Optional tags (e.g. 'tweak', 'observation').",
      inputSchema: {
        slug: z.string(),
        body: z.string(),
        tags: z.array(z.string()).optional(),
        private: z.boolean().optional(),
      },
    },
    ({ slug, body, tags, private: isPrivate }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
        }
        if (!body.trim()) {
          throw new ToolError("validation_failed", "note body must not be empty", { slug });
        }
        const created_at = nowIso();
        await insertRecipeNote(env, slug, tenantId, {
          created_at,
          body,
          tags: tags ?? [],
          private: isPrivate ?? false,
        });
        return { slug, author: tenantId, created_at };
      }),
  );

  server.registerTool(
    "read_recipe_notes",
    {
      description:
        "Read the GROUP's notes and favorites for a recipe — the collaborative cookbook view. Returns { notes: [{ author, created_at, body, tags, private }], favorites: [{ author }] } aggregated across everyone in your group. You see your own private notes plus everyone's shared notes; other people's private notes are never shown. `favorites` is the group signal — surface it ('favorited by 2 others') before recommending a recipe someone hasn't tried.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        const ids = await directory.list();
        // Both halves are now D1 queries: notes (own-private + group-shared via the
        // privacy WHERE) and favorites (overlay scoped to the group). No GitHub read.
        const [notes, favorites] = await Promise.all([
          readRecipeNotes(env, slug, tenantId),
          groupFavorites(env, slug, ids),
        ]);
        return { slug, notes, favorites };
      }),
  );

  server.registerTool(
    "update_recipe_note",
    {
      description:
        "Edit one of YOUR OWN recipe notes, addressed by its created_at (from add_recipe_note / read_recipe_notes). Only the fields you pass change (body / tags / private); created_at is the immutable key. Self-scoped: it can only ever touch a note you authored — a created_at that matches only someone else's note returns not_found. Use it to fix a typo or refine an observation instead of stacking a correcting note.",
      inputSchema: {
        slug: z.string(),
        created_at: z.string(),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        private: z.boolean().optional(),
      },
    },
    ({ slug, created_at, body, tags, private: isPrivate }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
        }
        if (body !== undefined && !body.trim()) {
          throw new ToolError("validation_failed", "note body must not be empty", { slug });
        }
        const found = await updateRecipeNote(env, slug, tenantId, created_at, {
          body,
          tags,
          private: isPrivate,
        });
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, author: tenantId, created_at };
      }),
  );

  server.registerTool(
    "remove_recipe_note",
    {
      description:
        "Delete one of YOUR OWN recipe notes, addressed by its created_at. Self-scoped to your own notes, so you can only ever remove a note you authored; a created_at that matches only someone else's note returns not_found. Shared recipe content and other tenants' notes are untouched.",
      inputSchema: { slug: z.string(), created_at: z.string() },
    },
    ({ slug, created_at }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
        }
        const found = await removeRecipeNote(env, slug, tenantId, created_at);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, removed: true, created_at };
      }),
  );
}

/**
 * Store notes (in-store-fulfillment, D6) — the store analog of recipe notes: attributed,
 * append-mostly, shared-by-default with an optional private flag, authored by the caller
 * in the D1 `store_notes` table, read across the group with the same privacy WHERE. No
 * ratings (a store has no per-tenant disposition the way a recipe does — just notes).
 */
export function registerStoreNoteTools(server: McpServer, tenantId: string, env: Env): void {
  server.registerTool(
    "add_store_note",
    {
      description:
        "Append an attributed note to a store — the single home for everything we know about it. Freeform observations ('fish counter closes at 6 PM', 'parking is brutal after 5', 'they stock the Kerrygold I like') AND the store's layout, captured by tag convention: tags:['layout'] for an aisle and its sections — LEAD the body with the aisle number ('Aisle 7: baking, spices, oils'); the order of layout notes by aisle number IS the walk path. tags:['location'] for where a non-obvious item hides ('Harissa: aisle 9, international foods, not condiments'). tags:['stock'] for a not-carried item (\"Doesn't carry fresh dill\"). Append-mostly; author is you. Set private=true to keep a note to yourself; default is shared. Correct your own notes with update_store_note / remove_store_note (addressed by created_at); across tenants, a later note supersedes an earlier one at read by recency.",
      inputSchema: {
        slug: z.string(),
        body: z.string(),
        tags: z.array(z.string()).optional(),
        private: z.boolean().optional(),
      },
    },
    ({ slug, body, tags, private: isPrivate }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid store slug: ${slug}`, { slug });
        }
        if (!body.trim()) {
          throw new ToolError("validation_failed", "note body must not be empty", { slug });
        }
        const created_at = nowIso();
        await insertStoreNote(env, slug, tenantId, {
          created_at,
          body,
          tags: tags ?? [],
          private: isPrivate ?? false,
        });
        return { slug, author: tenantId, created_at };
      }),
  );

  server.registerTool(
    "read_store_notes",
    {
      description:
        "Read the GROUP's attributed notes for a store. Returns { notes: [{ author, created_at, body, tags, private }] } aggregated across everyone in your group. You see your own private notes plus everyone's shared notes; other people's private notes are never shown. Surface these alongside read_store during the walk (hours, parking, where-they-stock-X).",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
        }
        return { slug, notes: await readStoreNotes(env, slug, tenantId) };
      }),
  );

  server.registerTool(
    "update_store_note",
    {
      description:
        "Edit one of YOUR OWN store notes, addressed by its created_at (from add_store_note / read_store_notes). Only the fields you pass change (body / tags / private); created_at is the immutable key. Self-scoped: it can only ever touch a note you authored — a created_at that matches only someone else's note returns not_found. This is the clean-correction path for a stale layout note after a remodel (edit it instead of stacking a contradicting note).",
      inputSchema: {
        slug: z.string(),
        created_at: z.string(),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        private: z.boolean().optional(),
      },
    },
    ({ slug, created_at, body, tags, private: isPrivate }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid store slug: ${slug}`, { slug });
        }
        if (body !== undefined && !body.trim()) {
          throw new ToolError("validation_failed", "note body must not be empty", { slug });
        }
        const found = await updateStoreNote(env, slug, tenantId, created_at, {
          body,
          tags,
          private: isPrivate,
        });
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, author: tenantId, created_at };
      }),
  );

  server.registerTool(
    "remove_store_note",
    {
      description:
        "Delete one of YOUR OWN store notes, addressed by its created_at — e.g. drop a pre-remodel layout note. Self-scoped to your own notes, so you can only ever remove a note you authored; a created_at that matches only someone else's note returns not_found. Other tenants' notes are untouched.",
      inputSchema: { slug: z.string(), created_at: z.string() },
    },
    ({ slug, created_at }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid store slug: ${slug}`, { slug });
        }
        const found = await removeStoreNote(env, slug, tenantId, created_at);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, removed: true, created_at };
      }),
  );
}
