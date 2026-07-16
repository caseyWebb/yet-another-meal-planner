// Recipe-note + store-note tools (recipe-notes / in-store-fulfillment, §8/D6). Notes
// are attributed annotations on a recipe or a store, living in the D1 `recipe_notes` /
// `store_notes` tables (not per-tenant GitHub files): author is the caller (an
// `author` column, never a spoofable input). Recipe notes carry a visibility `tier`
// (public | friends | private, D30-final; the legacy `private` boolean stays accepted
// as a deprecated alias for stale plugin bundles); store notes keep the binary
// `private` flag. Reads are ONE query with the visibility rule applied in SQL —
// tier-filtered and members-joined for recipes, own-private + group-shared for stores.
// For recipes, the notes query is joined with the slice-4 overlay-ratings query so
// read_recipe_notes is fully D1 (notes + ratings).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import type { Tenant } from "./tenant.js";
import { db } from "./db.js";
import { ToolError, runTool } from "./errors.js";
import { isVisible, memberViewer, lensHouseholds } from "./visibility.js";
import {
  readRecipeNotes,
  insertRecipeNote,
  updateRecipeNote,
  removeRecipeNote,
  readStoreNotes,
  insertStoreNote,
  updateStoreNote,
  removeStoreNote,
  type NoteTier,
} from "./corpus-db.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The tier/alias resolution rule (D30-final): `tier` is the contract; the legacy
 * `private` boolean is a deprecated alias (`true` → 'private', `false` → 'friends')
 * kept so stale plugin bundles retain today's exact semantics. `tier` wins when both
 * are passed. Undefined when neither is given — the caller supplies its own default
 * ('friends' on add; unchanged on update).
 */
export function resolveNoteTier(tier: NoteTier | undefined, isPrivate: boolean | undefined): NoteTier | undefined {
  if (tier !== undefined) return tier;
  if (isPrivate === undefined) return undefined;
  return isPrivate ? "private" : "friends";
}

const TIER_ENUM = z.enum(["public", "friends", "private"]);

/** The group-favorites half of read_recipe_notes: the overlay table, scoped to the
 *  group. The favorite cutover replaced the per-rating list with the members who
 *  favorited the recipe — `favorites.length` IS the group signal (COUNT(favorite)).
 *  Exported: the member API's notes read (GET /api/cookbook/recipes/:slug/notes)
 *  aggregates the same shape. */
export async function groupFavorites(env: Env, slug: string, ids: string[]): Promise<{ author: string }[]> {
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
 * @param tenant    the caller's identity pair — `tenant.member` authors new notes and is
 *                  the privacy boundary on reads (equals the tenant id for founding
 *                  members); `tenant.id` keys the visibility-lens gate on the read
 * @param directory the tenant allowlist, scoping the self-hosted group aggregate
 * @param env       D1 — the `recipe_notes` + `overlay` tables back the read
 */
export function registerNoteTools(
  server: McpServer,
  tenant: Tenant,
  directory: { list(): Promise<string[]> },
  env: Env,
): void {
  const memberId = tenant.member;
  server.registerTool(
    "add_recipe_note",
    {
      description:
        "Append an attributed note to a recipe (shared or personal) — the spin-capture mechanism (D6). Use this for tweaks/observations ('subbed gochujang for sriracha, better') instead of editing shared recipe content. Append-mostly: prior notes are retained. Author is you. Only recipes inside your visibility lens are writable — a slug outside it returns the same not_found an unknown slug does. `tier` sets the note's audience and is LIVE (re-tiering or a friendship change applies on the very next read): 'friends' (the default) = your household plus friend households (everyone on a self-hosted deployment); 'private' = only you, ever; 'public' = anyone who can see the recipe, including the anonymous public cookbook site where (and only where) the recipe itself is publicly visible. The legacy `private` boolean is a deprecated alias (true → tier 'private', false → 'friends'); `tier` wins if both are passed. Optional tags (e.g. 'tweak', 'observation').",
      inputSchema: {
        slug: z.string(),
        body: z.string(),
        tags: z.array(z.string()).optional(),
        tier: TIER_ENUM.optional(),
        private: z.boolean().optional(),
      },
    },
    ({ slug, body, tags, tier, private: isPrivate }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
        }
        if (!body.trim()) {
          throw new ToolError("validation_failed", "note body must not be empty", { slug });
        }
        // Write-side lens gate (lens-review carry-in): a member only annotates recipes
        // they can see. Out-of-lens and nonexistent slugs take the IDENTICAL not_found
        // the read path produces — no existence disclosure, no orphan rows.
        if (!(await isVisible(env, memberViewer(tenant.id, tenant.member), slug))) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        const created_at = nowIso();
        const resolved = resolveNoteTier(tier, isPrivate) ?? "friends";
        await insertRecipeNote(env, slug, memberId, {
          created_at,
          body,
          tags: tags ?? [],
          tier: resolved,
        });
        return { slug, author: memberId, created_at, tier: resolved };
      }),
  );

  server.registerTool(
    "read_recipe_notes",
    {
      description:
        "Read the notes and favorites for a recipe INSIDE YOUR VISIBILITY LENS — the collaborative cookbook view. Returns { notes: [{ author, handle, created_at, body, tags, tier, private }], favorites: [{ author }] }. Notes follow the visibility tiers, computed LIVE at read time (a new or severed friendship, or a re-tiered note, changes the very next read): you always see your OWN notes at every tier; 'friends' notes from your household and friend households (everyone on a self-hosted deployment); and 'public' notes from anyone — a public note on a recipe you can see is visible even when its author's household is outside your lens. Another member's 'private' note is never shown. `handle` is the author's display handle; `private` is a deprecated derived field (tier === 'private'). A recipe outside your lens returns the same not_found an unknown slug does. `favorites` aggregates over your lens households only — it is the group signal; surface it ('favorited by 2 others') before recommending a recipe someone hasn't tried.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        // Lens-bound (shared-corpus): the visibility check runs BEFORE any note read —
        // an out-of-lens slug is indistinguishable from a nonexistent one, and no note
        // content is disclosed.
        if (!(await isVisible(env, memberViewer(tenant.id, tenant.member), slug))) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        // Favorites aggregate over the caller's LENS households: null (self-hosted)
        // means every allowlisted household — today's read; under SaaS own + friends.
        // The notes read applies the TIER rules itself (one query over the same seam).
        const lens = await lensHouseholds(env, tenant.id);
        const ids = lens ?? (await directory.list());
        const [notes, favorites] = await Promise.all([
          readRecipeNotes(env, slug, { member: memberId, tenant: tenant.id }),
          groupFavorites(env, slug, ids),
        ]);
        return { slug, notes, favorites };
      }),
  );

  server.registerTool(
    "update_recipe_note",
    {
      description:
        "Edit one of YOUR OWN recipe notes, addressed by its created_at (from add_recipe_note / read_recipe_notes). Only the fields you pass change (body / tags / tier); created_at is the immutable key. Passing `tier` re-tiers the note — this IS the tier-change surface, and it applies on the very next read ('public' = anyone who can see the recipe incl. the public cookbook site where the recipe is publicly visible; 'friends' = your household + friend households; 'private' = only you). The legacy `private` boolean is a deprecated alias (true → 'private', false → 'friends'); `tier` wins if both are passed. Self-scoped: it can only ever touch a note you authored — a created_at that matches only someone else's note returns not_found. Use it to fix a typo or refine an observation instead of stacking a correcting note.",
      inputSchema: {
        slug: z.string(),
        created_at: z.string(),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        tier: TIER_ENUM.optional(),
        private: z.boolean().optional(),
      },
    },
    ({ slug, created_at, body, tags, tier, private: isPrivate }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
        }
        if (body !== undefined && !body.trim()) {
          throw new ToolError("validation_failed", "note body must not be empty", { slug });
        }
        const resultTier = await updateRecipeNote(env, slug, memberId, created_at, {
          body,
          tags,
          tier: resolveNoteTier(tier, isPrivate),
        });
        if (resultTier === null) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, author: memberId, created_at, tier: resultTier };
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
        const found = await removeRecipeNote(env, slug, memberId, created_at);
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
export function registerStoreNoteTools(server: McpServer, memberId: string, env: Env): void {
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
        await insertStoreNote(env, slug, memberId, {
          created_at,
          body,
          tags: tags ?? [],
          private: isPrivate ?? false,
        });
        return { slug, author: memberId, created_at };
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
        return { slug, notes: await readStoreNotes(env, slug, memberId) };
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
        const found = await updateStoreNote(env, slug, memberId, created_at, {
          body,
          tags,
          private: isPrivate,
        });
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, author: memberId, created_at };
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
        const found = await removeStoreNote(env, slug, memberId, created_at);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, { slug, created_at });
        }
        return { slug, removed: true, created_at };
      }),
  );
}
