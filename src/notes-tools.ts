// Recipe-note tools (recipe-notes capability, §8). Two tools:
//   - add_recipe_note — append an attributed note to THIS tenant's subtree
//     (users/<id>/notes/<slug>.toml). Never touches shared content or prior notes.
//   - read_recipe_notes — aggregate the group's notes + ratings for a recipe at
//     read time: enumerate the tenant directory, read each tenant's notes/overlay
//     from the shared repo (root client addresses any subtree), merge with the
//     caller's privacy rules applied (others' private notes excluded).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import type { GitHubClient, TreeFile } from "./github.js";
import type { TenantStore } from "./tenant.js";
import { readOptional } from "./gh-read.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import {
  parseNotes,
  appendNote,
  removeNote,
  updateNote,
  serializeNotes,
  serializeStoreNotes,
  notesPath,
  storeNotesPath,
  aggregateGroupSignal,
  aggregateNotes,
  type Note,
  type NotePatch,
  type TenantSignal,
} from "./notes.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * @param sharedGh  root data-repo client (addresses any `users/<id>/` subtree)
 * @param personalGh this tenant's prefixed client (writes land under users/<id>/)
 * @param tenantId  the caller — author of new notes + privacy boundary on reads
 * @param directory the tenant allowlist, scoping the group ratings aggregate
 * @param env       D1 — the `overlay` table backs the group ratings aggregate query
 */
export function registerNoteTools(
  server: McpServer,
  sharedGh: GitHubClient,
  personalGh: GitHubClient,
  tenantId: string,
  directory: TenantStore,
  env: Env,
): void {
  server.registerTool(
    "add_recipe_note",
    {
      description:
        "Append an attributed note to a recipe (shared or personal) in YOUR notes — the spin-capture mechanism (D6). Use this for tweaks/observations ('subbed gochujang for sriracha, better') instead of editing shared recipe content. Append-mostly: prior notes are retained. Author is structural (your subtree), not a field. Set private=true to keep a note to yourself; default is shared with the group. Optional tags (e.g. 'tweak', 'observation').",
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
        const path = notesPath(slug);
        const existing = parseNotes(await readOptional(personalGh, path));
        const note: Note = {
          created_at: nowIso(),
          body,
          tags: tags ?? [],
          private: isPrivate ?? false,
        };
        const file: TreeFile = { path, content: serializeNotes(appendNote(existing, note)) };
        const { commit_sha } = await commitFiles(personalGh, [file], `note on ${slug}`);
        return { slug, author: tenantId, created_at: note.created_at, commit_sha };
      }),
  );

  server.registerTool(
    "read_recipe_notes",
    {
      description:
        "Read the GROUP's notes and ratings for a recipe — the collaborative cookbook view. Returns { notes: [{ author, created_at, body, tags, private }], ratings: [{ author, rating, status }] } aggregated across everyone in your group. You see your own private notes plus everyone's shared notes; other people's private notes are never shown. Use it to surface group signal ('rated 4+ by others') before recommending a recipe someone hasn't tried.",
      inputSchema: { slug: z.string() },
    },
    ({ slug }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        }
        const ids = await directory.list();
        // Notes half: still GitHub (per-tenant notes/<slug>.toml), until slice 6.
        // Ratings half: ONE indexed D1 query over the `overlay` table for this slug,
        // then scoped to the group's members (replacing the per-tenant bundle scan).
        const [notesByTenant, overlayRows] = await Promise.all([
          Promise.all(
            ids.map(async (id) => ({
              id,
              notes: parseNotes(await readOptional(sharedGh, `users/${id}/${notesPath(slug)}`)),
            })),
          ),
          db(env).all<{ tenant: string; rating: number | null; status: string | null }>(
            "SELECT tenant, rating, status FROM overlay WHERE recipe = ?1",
            slug,
          ),
        ]);
        const inGroup = new Set(ids);
        const ratingByTenant = new Map<string, { rating: unknown; status: unknown }>();
        for (const r of overlayRows) {
          if (inGroup.has(r.tenant)) {
            ratingByTenant.set(r.tenant, {
              rating: r.rating ?? undefined,
              status: r.status ?? undefined,
            });
          }
        }
        const perTenant: TenantSignal[] = [];
        for (const { id, notes } of notesByTenant) {
          const rating = ratingByTenant.get(id);
          if (notes.length === 0 && rating?.rating == null) continue;
          perTenant.push({ author: id, notes, rating: rating?.rating, status: rating?.status });
        }
        return { slug, ...aggregateGroupSignal(tenantId, perTenant) };
      }),
  );

  server.registerTool(
    "update_recipe_note",
    {
      description:
        "Edit one of YOUR OWN recipe notes, addressed by its created_at (from add_recipe_note / read_recipe_notes). Only the fields you pass change (body / tags / private); created_at is the immutable key. Self-scoped: it reads your own subtree, so it can only ever touch a note you authored — a created_at that matches only someone else's note returns not_found. Use it to fix a typo or refine an observation instead of stacking a correcting note.",
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
        const path = notesPath(slug);
        const patch: NotePatch = {};
        if (body !== undefined) patch.body = body;
        if (tags !== undefined) patch.tags = tags;
        if (isPrivate !== undefined) patch.private = isPrivate;
        const { notes, found } = updateNote(parseNotes(await readOptional(personalGh, path)), created_at, patch);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, {
            slug,
            created_at,
          });
        }
        const file: TreeFile = { path, content: serializeNotes(notes) };
        const { commit_sha } = await commitFiles(personalGh, [file], `edit note on ${slug}`);
        return { slug, author: tenantId, created_at, commit_sha };
      }),
  );

  server.registerTool(
    "remove_recipe_note",
    {
      description:
        "Delete one of YOUR OWN recipe notes, addressed by its created_at. Self-scoped to your subtree, so you can only ever remove a note you authored; a created_at that matches only someone else's note returns not_found. Shared recipe content and other tenants' notes are untouched.",
      inputSchema: { slug: z.string(), created_at: z.string() },
    },
    ({ slug, created_at }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid recipe slug: ${slug}`, { slug });
        }
        const path = notesPath(slug);
        const { notes, found } = removeNote(parseNotes(await readOptional(personalGh, path)), created_at);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, {
            slug,
            created_at,
          });
        }
        const file: TreeFile = { path, content: serializeNotes(notes) };
        const { commit_sha } = await commitFiles(personalGh, [file], `remove note on ${slug}`);
        return { slug, removed: true, created_at, commit_sha };
      }),
  );
}

/**
 * Store notes (in-store-fulfillment, D6) — the store analog of recipe notes,
 * verbatim: attributed, append-mostly, shared-by-default with an optional private
 * flag, authored structurally in the caller's `users/<id>/store_notes/<slug>.toml`
 * and aggregated across the group at read time. No overlay/ratings (a store has no
 * per-tenant disposition the way a recipe does — just notes).
 */
export function registerStoreNoteTools(
  server: McpServer,
  sharedGh: GitHubClient,
  personalGh: GitHubClient,
  tenantId: string,
  directory: TenantStore,
): void {
  server.registerTool(
    "add_store_note",
    {
      description:
        "Append an attributed note to a store — the single home for everything we know about it. Freeform observations ('fish counter closes at 6 PM', 'parking is brutal after 5', 'they stock the Kerrygold I like') AND the store's layout, captured by tag convention: tags:['layout'] for an aisle and its sections — LEAD the body with the aisle number ('Aisle 7: baking, spices, oils'); the order of layout notes by aisle number IS the walk path. tags:['location'] for where a non-obvious item hides ('Harissa: aisle 9, international foods, not condiments'). tags:['stock'] for a not-carried item (\"Doesn't carry fresh dill\"). Append-mostly; author is structural (your subtree), not a field. Set private=true to keep a note to yourself; default is shared. Correct your own notes with update_store_note / remove_store_note (addressed by created_at); across tenants, a later note supersedes an earlier one at read by recency.",
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
        const path = storeNotesPath(slug);
        const existing = parseNotes(await readOptional(personalGh, path));
        const note: Note = {
          created_at: nowIso(),
          body,
          tags: tags ?? [],
          private: isPrivate ?? false,
        };
        const file: TreeFile = { path, content: serializeStoreNotes(appendNote(existing, note)) };
        const { commit_sha } = await commitFiles(personalGh, [file], `store note on ${slug}`);
        return { slug, author: tenantId, created_at: note.created_at, commit_sha };
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
        const ids = await directory.list();
        const fetched = await Promise.all(
          ids.map(async (id) => {
            const notesText = await readOptional(sharedGh, `users/${id}/${storeNotesPath(slug)}`);
            return { id, notes: parseNotes(notesText) };
          }),
        );
        const perTenant = fetched.filter((r) => r.notes.length > 0).map(({ id, notes }) => ({ author: id, notes }));
        return { slug, notes: aggregateNotes(tenantId, perTenant) };
      }),
  );

  server.registerTool(
    "update_store_note",
    {
      description:
        "Edit one of YOUR OWN store notes, addressed by its created_at (from add_store_note / read_store_notes). Only the fields you pass change (body / tags / private); created_at is the immutable key. Self-scoped: it reads your own subtree, so it can only ever touch a note you authored — a created_at that matches only someone else's note returns not_found. This is the clean-correction path for a stale layout note after a remodel (edit it instead of stacking a contradicting note).",
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
        const path = storeNotesPath(slug);
        const patch: NotePatch = {};
        if (body !== undefined) patch.body = body;
        if (tags !== undefined) patch.tags = tags;
        if (isPrivate !== undefined) patch.private = isPrivate;
        const { notes, found } = updateNote(parseNotes(await readOptional(personalGh, path)), created_at, patch);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, {
            slug,
            created_at,
          });
        }
        const file: TreeFile = { path, content: serializeStoreNotes(notes) };
        const { commit_sha } = await commitFiles(personalGh, [file], `edit store note on ${slug}`);
        return { slug, author: tenantId, created_at, commit_sha };
      }),
  );

  server.registerTool(
    "remove_store_note",
    {
      description:
        "Delete one of YOUR OWN store notes, addressed by its created_at — e.g. drop a pre-remodel layout note. Self-scoped to your subtree, so you can only ever remove a note you authored; a created_at that matches only someone else's note returns not_found. Other tenants' notes are untouched.",
      inputSchema: { slug: z.string(), created_at: z.string() },
    },
    ({ slug, created_at }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) {
          throw new ToolError("validation_failed", `Invalid store slug: ${slug}`, { slug });
        }
        const path = storeNotesPath(slug);
        const { notes, found } = removeNote(parseNotes(await readOptional(personalGh, path)), created_at);
        if (!found) {
          throw new ToolError("not_found", `No note of yours on ${slug} with that created_at`, {
            slug,
            created_at,
          });
        }
        const file: TreeFile = { path, content: serializeStoreNotes(notes) };
        const { commit_sha } = await commitFiles(personalGh, [file], `remove store note on ${slug}`);
        return { slug, removed: true, created_at, commit_sha };
      }),
  );
}
