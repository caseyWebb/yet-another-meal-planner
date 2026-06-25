// Repo-data write tools (data-write-tools capability). Each tool reads the
// current file(s)/rows, applies a pure transform, and persists via the atomic commit
// engine (commit.ts) for shared GitHub content, or D1 rows for per-tenant state.
// Objective recipe content is shared (GitHub); a recipe's subjective disposition
// (favorite/status) is per-tenant and routes to the caller's D1 overlay via
// `toggle_favorite` / `set_recipe_status`; the pantry is the D1 `pantry` table
// (src/session-db.ts). No tool here
// writes a Kroger cart or calls an external service.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import type { GitHubClient, TreeFile } from "./github.js";
import { readFile } from "./gh-read.js";
import { readAliases } from "./corpus-db.js";
import { normalizePerishables } from "./matching.js";
import { parseMarkdown } from "./parse.js";
import { serializeMarkdown, stripEmptyVarietyDimensions } from "./serialize.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import { applyOverlayEdit, type OverlayRow } from "./overlay.js";
import { applyKitchenOperations } from "./kitchen.js";
import { slugify } from "./discovery.js";
import { addStockup } from "./stockup.js";
import { updateStaples } from "./staples.js";
import {
  mergePatch,
  rejectUnknownPatchKeys,
  validatePreferences,
} from "./preferences.js";
import {
  readProfile,
  readPreferences,
  readOverlay,
  readStockupItems,
  readFreezerEstimate,
  setOverlay,
  setStaples,
  setStockup,
  setKitchen,
  setReadyToEat,
  setProfileFields,
  profileUpsertStmt,
  brandStmt,
} from "./profile-db.js";
import { applyPantryRowOps, markPantryVerifiedRows } from "./session-db.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The subjective recipe fields. They are the caller's per-tenant disposition and
 * route through `toggle_favorite` / `set_recipe_status` to the D1 overlay table —
 * `update_recipe` (objective-only) rejects them rather than silently writing the
 * overlay. (`rating` is retained so a stale caller's `update_recipe({ rating })` is
 * still steered to the disposition tools rather than written as objective content.)
 */
const SUBJECTIVE_KEYS = ["favorite", "rating", "status"] as const;

// --- file-level builders (return a TreeFile for the atomic commit) -----------

/** Build an objective-content update for a shared recipe (root `recipes/<slug>.md`). */
export async function buildRecipeUpdate(
  gh: GitHubClient,
  env: Env,
  slug: string,
  updates: Record<string, unknown>,
): Promise<TreeFile> {
  if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  const path = `recipes/${slug}.md`;
  const text = await readFile(gh, path, "not_found", `Unknown recipe slug: ${slug}`);
  const { frontmatter, body } = parseMarkdown(text, path);
  const merged = { ...frontmatter, ...updates };
  // perishable_ingredients is objective shared content; canonicalize the names the
  // same way the verify matcher does so cross-recipe overlap lines up (only when
  // the caller is writing the field — a non-array passes through for validation).
  if ("perishable_ingredients" in updates) {
    merged.perishable_ingredients = normalizePerishables(merged.perishable_ingredients, await readAliases(env));
  }
  // Treat a none/empty protein|cuisine as absent so a no-protein dish writes
  // cleanly instead of tripping the controlled-vocabulary check.
  stripEmptyVarietyDimensions(merged);
  return { path, content: serializeMarkdown(merged, body) };
}

/**
 * In-memory manager for the per-tenant ready-to-eat catalog. Takes the existing
 * items (from the D1 ready_to_eat table). Call `items()` to get the updated list to
 * persist; `touched()` reports whether anything changed.
 */
export function readyToEatManager(existing: Record<string, unknown>[]) {
  const list: Record<string, unknown>[] = existing.map((it) => ({ ...it }));
  let changed = false;

  function uniqueSlug(name: string): string {
    const taken = new Set(list.map((it) => it.slug).filter((s): s is string => typeof s === "string"));
    const base = slugify(name) || "item";
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  return {
    /** Append a new item; returns its generated slug. Default status is "draft". */
    addDraft(item: Record<string, unknown>, status: "draft" | "active" = "draft"): string {
      const slug = uniqueSlug(String(item.name ?? ""));
      list.push({
        name: item.name,
        slug,
        meal: item.meal,
        category: item.category ?? null,
        status,
        discovery_source: item.source ?? null,
        brand: item.brand ?? null,
        notes: item.notes ?? null,
      });
      changed = true;
      return slug;
    },
    /** Find an item by slug, apply updates. Throws not_found if absent. */
    update(slug: string, updates: Record<string, unknown>) {
      const idx = list.findIndex((it) => it.slug === slug);
      if (idx < 0) throw new ToolError("not_found", `No ready-to-eat item with slug: ${slug}`, { slug });
      list[idx] = { ...list[idx], ...updates };
      changed = true;
    },
    items(): Record<string, unknown>[] {
      return list;
    },
    touched(): boolean {
      return changed;
    },
  };
}

/** Profile markdown fields written to the D1 `profile` row (preferences uses merge-patch). */
const PROFILE_MARKDOWN_FIELDS = {
  taste: "taste",
  diet_principles: "diet_principles",
} as const;
/** Curated files that remain GitHub-backed (shared reference data at root). */
const SHARED_CURATED_FILES: Record<string, string> = {
  aliases: "aliases.toml",
};

// --- registration ------------------------------------------------------------

/**
 * `gh` is the root data-repo client (shared recipe + aliases writes — the only
 * GitHub-backed writes left here). `env` is D1: the `recipes` index (queried by
 * `toggle_favorite`/`set_recipe_status` to validate a slug), the profile tables (preferences/taste/diet/
 * kitchen/staples/overlay/ready_to_eat/stockup — via src/profile-db.ts) AND the
 * session-state pantry table (via src/session-db.ts). meal_plan/grocery_list live in
 * their own tool groups.
 */
export function registerWriteTools(
  server: McpServer,
  gh: GitHubClient,
  env: Env,
  username: string,
): void {
  server.registerTool(
    "update_recipe",
    {
      description:
        "Edit a recipe's OBJECTIVE shared content (frontmatter/body) — the same recipe everyone in the group sees. favorite and status are NOT settable here: they are the caller's personal disposition — use toggle_favorite (favorite) / set_recipe_status (status). last_cooked is NOT settable here either — it is derived from the cooking log (record a cooked meal via log_cooked). Objective frontmatter validates against the controlled vocabularies: `protein`/`cuisine` must be coarse buckets (shrimp→shellfish, salmon→fish; omit `protein` when there's no protein focus — never 'none') and `requires_equipment` slugs must be in-vocab; an off-vocabulary value is rejected (validation_failed).",
      inputSchema: { slug: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ slug, updates }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        const subjective = SUBJECTIVE_KEYS.filter((k) => k in updates);
        if (subjective.length > 0) {
          throw new ToolError(
            "validation_failed",
            `${subjective.join("/")} ${subjective.length > 1 ? "are" : "is"} the caller's personal disposition, not shared recipe content — use toggle_favorite to set favorite, set_recipe_status to set status`,
            { fields: subjective },
          );
        }
        if ("last_cooked" in updates) {
          throw new ToolError(
            "validation_failed",
            "last_cooked is derived from the cooking log; record a cooked meal via log_cooked instead of setting it directly",
          );
        }
        const updated_fields = Object.keys(updates);
        if (updated_fields.length === 0) return { slug, updated_fields: [] };

        const file = await buildRecipeUpdate(gh, env, slug, updates);
        const { commit_sha } = await commitFiles(gh, [file], `update recipe ${slug}`);
        return { slug, updated_fields, commit_sha };
      }),
  );

  // Both disposition tools resolve the slug against the shared index, then apply a
  // single-field overlay edit. `rate_recipe` was split here into `toggle_favorite`
  // (the positive taste signal) + `set_recipe_status` (the active/draft/rejected
  // lifecycle) in the favorite cutover.
  const applyDisposition = async (slug: string, edit: OverlayRow): Promise<Record<string, unknown>> => {
    if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    const row = await db(env).first<{ ok: number }>(
      "SELECT 1 AS ok FROM recipes WHERE slug = ?1 LIMIT 1",
      slug,
    );
    if (!row) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
    const current = await readOverlay(env, username);
    const next = applyOverlayEdit(current[slug], edit);
    await setOverlay(env, username, slug, next);
    return { slug, overlay: next ?? {} };
  };

  server.registerTool(
    "toggle_favorite",
    {
      description:
        "Set the caller's PERSONAL favorite flag for a recipe — `favorite: true` marks it a favorite, `false` clears it. Favorites are THE positive taste signal: they anchor the semantic-search nearest-liked re-rank and the group 'favorited by N others' signal (read_recipe_notes). Writes only the caller's overlay — never the shared recipe, so one member's favorites never affect another's. Unknown slug → not_found. Returns { slug, overlay } (no commit_sha; the overlay is D1-backed).",
      inputSchema: { slug: z.string(), favorite: z.boolean() },
    },
    ({ slug, favorite }) => runTool(() => applyDisposition(slug, { favorite })),
  );

  server.registerTool(
    "set_recipe_status",
    {
      description:
        "Set the caller's PERSONAL status for a recipe — `active | draft | rejected` (the disposition lifecycle: `rejected` drops it from the caller's active set but is kept for de-dup; `active` surfaces it; effective default with no overlay row is `draft`). Pass `status: null` to clear back to the default. Writes only the caller's overlay; one member's status never affects another's. Unknown slug → not_found. Returns { slug, overlay }.",
      inputSchema: { slug: z.string(), status: z.enum(["active", "draft", "rejected"]).nullable() },
    },
    ({ slug, status }) => runTool(() => applyDisposition(slug, { status })),
  );

  server.registerTool(
    "update_pantry",
    {
      description:
        "Apply pantry add/remove/verify operations. `add` is an upsert: re-adding an existing name merges into it (overlay incoming fields, preserve added_at, refresh last_verified_at) rather than duplicating; the result includes merged:true when this happens. Returns what was applied and any conflicts (e.g. a remove whose target isn't present).",
      inputSchema: {
        operations: z.array(
          z.object({
            op: z.enum(["add", "remove", "verify"]),
            item: z.record(z.string(), z.unknown()).optional(),
            name: z.string().optional(),
          }),
        ),
      },
    },
    ({ operations }) =>
      runTool(async () => {
        const result = await applyPantryRowOps(env, username, operations, today());
        return { applied: result.applied, conflicts: result.conflicts };
      }),
  );

  server.registerTool(
    "update_stockup",
    {
      description:
        "Add bulk-buy items to the caller's stockup watchlist (users/<id>/stockup.toml). Add-only, deduped by normalized name — re-adding a name is a no-op. Each item needs a name; unit / typical_purchase / notes / baseline_price / buy_at_or_below are optional. Price thresholds are ADVISORY (nothing gates on them — the agent reasons over the live flyer price), so omit them when unknown. Optionally set freezer_capacity_estimate (tight|moderate|spacious). Returns { added, commit_sha }; makes no commit when nothing changed.",
      inputSchema: {
        items: z
          .array(
            z.object({
              name: z.string(),
              unit: z.string().optional(),
              typical_purchase: z.string().optional(),
              notes: z.string().optional(),
              baseline_price: z.number().optional(),
              buy_at_or_below: z.number().optional(),
            }),
          )
          .optional(),
        freezer_capacity_estimate: z.enum(["tight", "moderate", "spacious"]).optional(),
      },
    },
    ({ items, freezer_capacity_estimate }) =>
      runTool(async () => {
        const [existing, currentFreezer] = await Promise.all([
          readStockupItems(env, username),
          readFreezerEstimate(env, username),
        ]);
        const {
          items: nextItems,
          freezer,
          added,
          changed,
        } = addStockup(existing, currentFreezer, { items, freezer_capacity_estimate });
        if (!changed) return { added };
        await setStockup(env, username, nextItems);
        if (freezer !== currentFreezer) {
          await setProfileFields(env, username, { freezer_capacity_estimate: freezer });
        }
        return { added };
      }),
  );

  server.registerTool(
    "update_staples",
    {
      description:
        "Add or remove items on the caller's staples list (users/<id>/staples.toml) — the must-have items they never want to run out of. Adds are deduped by normalized name (re-adding is a no-op); removes match by normalized name (absent name is a silent no-op). Each add needs a `name`; `perishable: true` is optional (flag items like eggs or butter so the agent can prompt when stock looks stale). Returns { added, removed, commit_sha }; makes no commit when nothing changed.",
      inputSchema: {
        add: z
          .array(z.object({ name: z.string(), perishable: z.boolean().optional() }))
          .optional(),
        remove: z.array(z.string()).optional(),
      },
    },
    ({ add, remove }) =>
      runTool(async () => {
        const existing = (await readProfile(env, username)).staples;
        const { items, added, removed, changed } = updateStaples(existing, add ?? [], remove ?? []);
        if (!changed) return { added, removed };
        await setStaples(env, username, items);
        return { added, removed };
      }),
  );

  server.registerTool(
    "update_kitchen",
    {
      description:
        "Update the caller's kitchen equipment inventory. Operations: { op:'add'|'remove', slug } adds/removes an owned equipment slug — it MUST be a known vocabulary slug (pressure-cooker | sous-vide-circulator | blender | ice-cream-maker); an off-vocab add returns a conflict, never a silent write. { op:'set_note', key, value } sets a freeform [notes] field (oven count, pan sizes — cook-reasoning only, NEVER gates a recipe). Returns applied + conflicts.",
      inputSchema: {
        operations: z.array(
          z.object({
            op: z.enum(["add", "remove", "set_note"]),
            slug: z.string().optional(),
            key: z.string().optional(),
            value: z.unknown().optional(),
          }),
        ),
      },
    },
    ({ operations }) =>
      runTool(async () => {
        const inventory = (await readProfile(env, username)).kitchen;
        const { inventory: next, applied, conflicts } = applyKitchenOperations(inventory, operations);
        if (applied.length === 0) return { applied, conflicts };
        await setKitchen(env, username, next);
        return { applied, conflicts };
      }),
  );

  server.registerTool(
    "mark_pantry_verified",
    {
      description: "Reset last_verified_at to today on the named pantry items.",
      inputSchema: { items: z.array(z.string()) },
    },
    ({ items }) =>
      runTool(async () => {
        const { verified, missing } = await markPantryVerifiedRows(env, username, items, today());
        const conflicts = missing.map((name) => ({ op: "verify" as const, name, reason: "no pantry item with that name" }));
        return { verified, conflicts };
      }),
  );

  server.registerTool(
    "add_draft_ready_to_eat",
    {
      description:
        "Append ready-to-eat items to the caller's personal ready-to-eat catalog. Each item needs a meal (breakfast|lunch|dinner). Defaults to draft; pass status:'active' for an item the user explicitly accepts (e.g. during onboarding). Returns the generated slug for each.",
      inputSchema: {
        items: z.array(
          z.object({
            meal: z.enum(MEALS),
            name: z.string(),
            status: z.enum(["draft", "active"]).optional(),
            category: z.string().optional(),
            source: z.string().optional(),
            brand: z.string().optional(),
            notes: z.string().optional(),
          }),
        ),
      },
    },
    ({ items }) =>
      runTool(async () => {
        const existing = (await readProfile(env, username)).ready_to_eat;
        const mgr = readyToEatManager(existing);
        const added: { meal: Meal; name: string; slug: string }[] = [];
        for (const it of items) {
          const slug = mgr.addDraft(it, it.status ?? "draft");
          added.push({ meal: it.meal, name: it.name, slug });
        }
        if (mgr.touched()) {
          await setReadyToEat(env, username, mgr.items());
        }
        return { added };
      }),
  );

  server.registerTool(
    "update_ready_to_eat",
    {
      description:
        "Disposition or update a ready-to-eat item in the caller's catalog, addressed by slug. Set status (active|draft|rejected) and/or rating.",
      inputSchema: { slug: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ slug, updates }) =>
      runTool(async () => {
        const existing = (await readProfile(env, username)).ready_to_eat;
        const mgr = readyToEatManager(existing);
        mgr.update(slug, updates);
        if (mgr.touched()) {
          await setReadyToEat(env, username, mgr.items());
        }
        return { slug, updated_fields: Object.keys(updates) };
      }),
  );

  // User-curated config writers — content-faithful: write exactly what the caller
  // supplies. The discipline of WHEN to call these (only on explicit user
  // direction) lives in AGENT_INSTRUCTIONS.md.

  server.registerTool(
    "update_preferences",
    {
      description:
        "Edit the caller's grocery preferences with a deep merge-patch (RFC 7396): keys present in `patch` set/overwrite, a key set to null is DELETED, nested objects merge to any depth, and arrays replace wholesale. Only the keys you touch change — a partial patch never clobbers siblings (e.g. patching stores.preferred_location keeps stores.primary), so you do NOT need to re-send the whole object. Defined top-level keys: default_cooking_nights (number), lunch_strategy (leftovers|buy|mixed), ready_to_eat_default_action (opt-in|auto-add), stores ({primary, preferred_location, location_zip}), brands (map of term → ranked brand list; [] = don't-care/cheapest, null = clear back to ambiguous), dietary ({avoid[], limit[]}), rotation ({resurface_after_days, novelty_boost} — tunes the semantic-search freshness re-rank: how many days until a cooked recipe rotates back in, and how hard never-cooked recipes are boosted; both positive numbers). Anything else nests under `custom`; an unknown top-level key is rejected (use custom). Returns { updated: 'preferences' }.",
      inputSchema: { patch: z.record(z.string(), z.unknown()) },
    },
    ({ patch }) =>
      runTool(async () => {
        // Stage 1: reject unknown top-level patch keys (authorship-time signal).
        rejectUnknownPatchKeys(patch);
        // Stage 2: deep-merge over the current preferences; validate the result's types.
        const current = (await readPreferences(env, username)) ?? {};
        const merged = mergePatch(current, patch) as Record<string, unknown>;
        validatePreferences(merged);

        // Stage 3: apply atomically (one batch). Scalar/JSON columns come from the
        // MERGED result; brands tri-state comes from the PATCH (value → UPSERT,
        // [] → UPSERT empty, null → DELETE — the merged object has already dropped a
        // null'd brand, so the patch is the only place the delete intent survives).
        const stmts: D1PreparedStatement[] = [];
        const profileFields: Record<string, unknown> = {
          default_cooking_nights:
            "default_cooking_nights" in merged ? merged.default_cooking_nights : null,
          lunch_strategy: "lunch_strategy" in merged ? merged.lunch_strategy : null,
          ready_to_eat_default_action:
            "ready_to_eat_default_action" in merged ? merged.ready_to_eat_default_action : null,
          stores: "stores" in merged ? JSON.stringify(merged.stores) : null,
          dietary: "dietary" in merged ? JSON.stringify(merged.dietary) : null,
          rotation: "rotation" in merged ? JSON.stringify(merged.rotation) : null,
          custom: "custom" in merged ? JSON.stringify(merged.custom) : null,
        };
        const profileStmt = profileUpsertStmt(env, username, profileFields);
        if (profileStmt) stmts.push(profileStmt);

        const brandsPatch = patch.brands;
        if (brandsPatch !== null && brandsPatch !== undefined && typeof brandsPatch === "object") {
          for (const [term, value] of Object.entries(brandsPatch as Record<string, unknown>)) {
            stmts.push(brandStmt(env, username, term, value === null ? null : (value as unknown[])));
          }
        }
        if (stmts.length > 0) await db(env).batch(stmts);
        return { updated: "preferences" };
      }),
  );

  // Profile markdown fields (taste / diet_principles) write the D1 `profile` row.
  for (const [key, column] of Object.entries(PROFILE_MARKDOWN_FIELDS)) {
    server.registerTool(
      `update_${key}`,
      {
        description: `Write ${key} verbatim with the supplied full content (markdown narrative). Call only when the user has directed an edit.`,
        inputSchema: { content: z.string() },
      },
      ({ content }) =>
        runTool(async () => {
          await setProfileFields(env, username, { [column]: content });
          return { updated: key };
        }),
    );
  }

  // Shared reference data (aliases) remains GitHub-backed.
  for (const [key, path] of Object.entries(SHARED_CURATED_FILES)) {
    server.registerTool(
      `update_${key}`,
      {
        description: `Write ${path} verbatim with the supplied full content. Call only when the user has directed an edit.`,
        inputSchema: { content: z.string() },
      },
      ({ content }) =>
        runTool(async () => {
          const { commit_sha } = await commitFiles(gh, [{ path, content }], `update ${path}`);
          return { file: path, commit_sha };
        }),
    );
  }

}
