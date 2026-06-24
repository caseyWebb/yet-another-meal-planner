// Repo-data write tools (data-write-tools capability). Each tool reads the
// current file(s), applies a pure transform, and persists via the atomic commit
// engine (commit.ts) for shared GitHub content, or DATA_KV for per-tenant state.
// Objective recipe content is shared (GitHub); a recipe's subjective disposition
// (rating/status) is per-tenant and routes to the caller's KV overlay via
// `rate_recipe`. No tool here writes a Kroger cart or calls an external service.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import type { GitHubClient, TreeFile } from "./github.js";
import { readFile, loadAliases } from "./gh-read.js";
import { normalizePerishables } from "./matching.js";
import { parseMarkdown, parseToml } from "./parse.js";
import { serializeMarkdown, stringifyTomlWithHeader, stripEmptyVarietyDimensions } from "./serialize.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import {
  parseOverlay,
  applyOverlayEdit,
  serializeOverlay,
  type Overlay,
  type OverlayRow,
} from "./overlay.js";
import { applyPantryOperations, markVerified, type PantryItem } from "./pantry-write.js";
import { applyKitchenOperations, toInventory } from "./kitchen.js";
import { slugify } from "./discovery.js";
import { addStockup } from "./stockup.js";
import { updateStaples } from "./staples.js";
import {
  getProfileBundle,
  updateProfileField,
  writePantryState,
  getPantryState,
  type ProfileField,
} from "./user-kv.js";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];
/** The caller's per-tenant ready-to-eat catalog (under their users/<id>/ subtree). */
const READY_TO_EAT_PATH = "ready_to_eat.toml";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function itemsOf(parsed: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(parsed.items) ? (parsed.items as Record<string, unknown>[]) : [];
}

/**
 * The subjective recipe fields. They are the caller's per-tenant disposition and
 * route through `rate_recipe` to the KV overlay — `update_recipe` (objective-only)
 * rejects them rather than silently writing the overlay.
 */
const SUBJECTIVE_KEYS = ["rating", "status"] as const;

// --- file-level builders (return a TreeFile for the atomic commit) -----------

/** Build an objective-content update for a shared recipe (root `recipes/<slug>.md`). */
export async function buildRecipeUpdate(
  gh: GitHubClient,
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
    merged.perishable_ingredients = normalizePerishables(merged.perishable_ingredients, await loadAliases(gh));
  }
  // Treat a none/empty protein|cuisine as absent so a no-protein dish writes
  // cleanly instead of tripping the controlled-vocabulary check.
  stripEmptyVarietyDimensions(merged);
  return { path, content: serializeMarkdown(merged, body) };
}

/**
 * In-memory manager for the per-tenant ready-to-eat catalog. Takes the existing
 * raw TOML content (or null for a new catalog). Call `serialize()` to get the
 * updated TOML to write back to KV; it returns null when nothing was changed.
 */
export function readyToEatManager(existingContent: string | null) {
  const text = existingContent ?? "";
  const parsed = text ? parseToml(text, READY_TO_EAT_PATH) : {};
  const items: Record<string, unknown>[] = itemsOf(parsed);
  let touched = false;

  function uniqueSlug(name: string): string {
    const taken = new Set(items.map((it) => it.slug).filter((s): s is string => typeof s === "string"));
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
      items.push({
        name: item.name,
        slug,
        meal: item.meal,
        sku: null,
        category: item.category ?? null,
        status,
        rating: null,
        added_at: today(),
        discovered_at: status === "draft" ? today() : null,
        discovery_source: item.source ?? null,
        brand: item.brand ?? null,
        notes: item.notes ?? null,
      });
      touched = true;
      return slug;
    },
    /** Find an item by slug, apply updates. Throws not_found if absent. */
    update(slug: string, updates: Record<string, unknown>) {
      const idx = items.findIndex((it) => it.slug === slug);
      if (idx < 0) throw new ToolError("not_found", `No ready-to-eat item with slug: ${slug}`, { slug });
      items[idx] = { ...items[idx], ...updates };
      touched = true;
    },
    /** Returns the serialized TOML when touched, or null when nothing changed. */
    serialize(): string | null {
      if (!touched) return null;
      return stringifyTomlWithHeader(text, { ...parsed, items });
    },
  };
}

// Profile fields now stored in DATA_KV bundle (not GitHub).
const KV_PROFILE_FIELDS: Record<string, ProfileField> = {
  preferences: "preferences",
  taste: "taste",
  diet_principles: "diet_principles",
};
/** Curated files that remain GitHub-backed (shared reference data at root). */
const SHARED_CURATED_FILES: Record<string, string> = {
  aliases: "aliases.toml",
};

// --- registration ------------------------------------------------------------

/**
 * `gh` is the root data-repo client (shared recipe + notes writes — the only
 * GitHub-backed writes left here). `env` is D1 (the `recipes` index, queried by
 * `rate_recipe` to validate a slug). `dataKv` + `username` back the KV profile
 * bundle (preferences/taste/diet/kitchen/staples/overlay/ready_to_eat/stockup) and
 * session-state keys (pantry/meal_plan/grocery_list).
 */
export function registerWriteTools(
  server: McpServer,
  gh: GitHubClient,
  env: Env,
  dataKv: KVNamespace,
  username: string,
): void {
  server.registerTool(
    "update_recipe",
    {
      description:
        "Edit a recipe's OBJECTIVE shared content (frontmatter/body) — the same recipe everyone in the group sees. rating and status are NOT settable here: they are the caller's personal disposition — use rate_recipe. last_cooked is NOT settable here either — it is derived from the cooking log (record a cooked meal via log_cooked). Objective frontmatter validates against the controlled vocabularies: `protein`/`cuisine` must be coarse buckets (shrimp→shellfish, salmon→fish; omit `protein` when there's no protein focus — never 'none') and `requires_equipment` slugs must be in-vocab; an off-vocabulary value is rejected (validation_failed).",
      inputSchema: { slug: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ slug, updates }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        const subjective = SUBJECTIVE_KEYS.filter((k) => k in updates);
        if (subjective.length > 0) {
          throw new ToolError(
            "validation_failed",
            `${subjective.join("/")} ${subjective.length > 1 ? "are" : "is"} the caller's personal disposition, not shared recipe content — use rate_recipe to set rating/status`,
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

        const file = await buildRecipeUpdate(gh, slug, updates);
        const { commit_sha } = await commitFiles(gh, [file], `update recipe ${slug}`);
        return { slug, updated_fields, commit_sha };
      }),
  );

  server.registerTool(
    "rate_recipe",
    {
      description:
        "Set the caller's PERSONAL disposition for a recipe — `rating` (1–5) and/or effective `status` (active|draft|rejected). This writes only the caller's overlay; it never changes the shared recipe content, so one member's rating/status never affects another's. The slug must resolve against the recipe index (unknown slug → not_found). Pass at least one of rating/status. Returns { slug, overlay } with no commit_sha (overlay is KV-backed, not a git commit).",
      inputSchema: {
        slug: z.string(),
        rating: z.number().nullable().optional(),
        status: z.enum(["active", "draft", "rejected"]).nullable().optional(),
      },
    },
    ({ slug, rating, status }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        if (rating === undefined && status === undefined) {
          throw new ToolError(
            "validation_failed",
            "rate_recipe needs at least one of rating or status to set",
          );
        }
        const row = await db(env).first<{ ok: number }>(
          "SELECT 1 AS ok FROM recipes WHERE slug = ?1 LIMIT 1",
          slug,
        );
        if (!row) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });

        const edit: OverlayRow = {};
        if (rating !== undefined) edit.rating = rating;
        if (status !== undefined) edit.status = status;

        const bundle = await getProfileBundle(dataKv, username);
        const current: Overlay = bundle.overlay ? parseOverlay(bundle.overlay) : {};
        const next = applyOverlayEdit(current, slug, edit);
        await updateProfileField(dataKv, username, "overlay", serializeOverlay(next));
        return { slug, overlay: next[slug] ?? {} };
      }),
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
        const items = await getPantryState(dataKv, username);
        const result = applyPantryOperations(items as PantryItem[], operations, today());
        if (result.applied.length > 0) {
          await writePantryState(dataKv, username, result.items);
        }
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
        const bundle = await getProfileBundle(dataKv, username);
        const { text, added, changed } = addStockup(bundle.stockup ?? null, { items, freezer_capacity_estimate });
        if (!changed) return { added };
        await updateProfileField(dataKv, username, "stockup", text);
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
        const bundle = await getProfileBundle(dataKv, username);
        const { text, added, removed, changed } = updateStaples(bundle.staples ?? null, add ?? [], remove ?? []);
        if (!changed) return { added, removed };
        await updateProfileField(dataKv, username, "staples", text);
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
        const bundle = await getProfileBundle(dataKv, username);
        const text = bundle.kitchen ?? "";
        const inventory = toInventory(text ? parseToml(text, "kitchen.toml") : {});
        const { inventory: next, applied, conflicts } = applyKitchenOperations(inventory, operations);
        if (applied.length === 0) return { applied, conflicts };
        const data: Record<string, unknown> = { owned: next.owned };
        if (Object.keys(next.notes).length) data.notes = next.notes;
        const content = stringifyTomlWithHeader(text, data);
        await updateProfileField(dataKv, username, "kitchen", content);
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
        const current = await getPantryState(dataKv, username);
        const { items: nextItems, verified, missing } = markVerified(current as PantryItem[], items, today());
        const conflicts = missing.map((name) => ({ op: "verify" as const, name, reason: "no pantry item with that name" }));
        if (verified.length > 0) {
          await writePantryState(dataKv, username, nextItems);
        }
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
        const bundle = await getProfileBundle(dataKv, username);
        const mgr = readyToEatManager(bundle.ready_to_eat ?? null);
        const added: { meal: Meal; name: string; slug: string }[] = [];
        for (const it of items) {
          const slug = mgr.addDraft(it, it.status ?? "draft");
          added.push({ meal: it.meal, name: it.name, slug });
        }
        const serialized = mgr.serialize();
        if (serialized !== null) {
          await updateProfileField(dataKv, username, "ready_to_eat", serialized);
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
        const bundle = await getProfileBundle(dataKv, username);
        const mgr = readyToEatManager(bundle.ready_to_eat ?? null);
        mgr.update(slug, updates);
        const serialized = mgr.serialize();
        if (serialized !== null) {
          await updateProfileField(dataKv, username, "ready_to_eat", serialized);
        }
        return { slug, updated_fields: Object.keys(updates) };
      }),
  );

  // User-curated config writers — content-faithful: write exactly what the caller
  // supplies. The discipline of WHEN to call these (only on explicit user
  // direction) lives in AGENT_INSTRUCTIONS.md.

  // Profile fields (preferences/taste/diet_principles) write to the KV bundle.
  for (const [key, field] of Object.entries(KV_PROFILE_FIELDS)) {
    const label = key.replace(/_/g, " ");
    server.registerTool(
      `update_${key}`,
      {
        description: `Write ${key} verbatim with the supplied full content. Call only when the user has directed an edit.`,
        inputSchema: { content: z.string() },
      },
      ({ content }) =>
        runTool(async () => {
          await updateProfileField(dataKv, username, field, content);
          return { updated: key };
        }),
    );
    void label;
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
