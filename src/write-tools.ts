// Repo-data write tools (data-write-tools capability). Each tool reads the
// current file(s), applies a pure transform, and persists via the atomic commit
// engine (commit.ts). The standalone tools commit one logical change; the
// batching tool `commit_changes` reuses the same builders to land a whole
// session as ONE commit. No tool here writes a Kroger cart or calls an external
// service — that is Change 06b.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitHubClient, TreeFile } from "./github.js";
import { readFile, readOptional, loadAliases } from "./gh-read.js";
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
import { applyPantryOperations, markVerified, type PantryItem, type AppliedOp, type ConflictOp } from "./pantry-write.js";
import { applyKitchenOperations, toInventory } from "./kitchen.js";
import {
  COOKING_LOG_PATH,
  entriesOf,
  appendEntries,
  deriveLastCooked,
  validateNewEntry,
  type CookingLogEntry,
} from "./cooking-log.js";
import { slugify } from "./discovery.js";
import { addStockup, STOCKUP_PATH } from "./stockup.js";
import { updateStaples, STAPLES_PATH } from "./staples.js";
import {
  getProfileBundle,
  updateProfileField,
  writePantryState,
  getPantryState,
  getMealPlanState,
  writeMealPlanState,
  type ProfileField,
} from "./user-kv.js";
import { applyMealPlanOps } from "./meal-plan.js";

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

/** The subjective recipe fields that route to the per-tenant overlay, not content. */
const SUBJECTIVE_KEYS = new Set(["rating", "status"]);

/**
 * Partition a recipe update into the per-tenant overlay edit (rating/status) and
 * the objective content edit (everything else). `last_cooked` is flagged: it is
 * derived from the cooking log and SHALL NOT be written to content or overlay.
 */
export function splitRecipeUpdate(updates: Record<string, unknown>): {
  overlayEdit: OverlayRow;
  content: Record<string, unknown>;
  hadLastCooked: boolean;
} {
  const overlayEdit: OverlayRow = {};
  const content: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k === "last_cooked") continue;
    if (SUBJECTIVE_KEYS.has(k)) overlayEdit[k as keyof OverlayRow] = v;
    else content[k] = v;
  }
  return { overlayEdit, content, hadLastCooked: "last_cooked" in updates };
}

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

/** Normalize a raw cooking-log entry input: default date to today, drop empties. */
function makeLogEntry(raw: Record<string, unknown>, todayDate: string): CookingLogEntry {
  const rawType = raw.type;
  const type: CookingLogEntry["type"] =
    rawType === "recipe" || rawType === "ready_to_eat" || rawType === "ad_hoc"
      ? rawType
      : "ad_hoc";
  const entry: CookingLogEntry = {
    date: typeof raw.date === "string" && raw.date ? raw.date : todayDate,
    type,
  };
  if (typeof raw.recipe === "string") entry.recipe = raw.recipe;
  if (typeof raw.name === "string") entry.name = raw.name;
  if (typeof raw.protein === "string") entry.protein = raw.protein;
  if (typeof raw.cuisine === "string") entry.cuisine = raw.cuisine;
  return entry;
}

/**
 * Append cooking-log entries. Returns the file to commit, the appended entries,
 * and the derived last_cooked per recipe slug (max date over existing + new),
 * which the caller co-writes onto recipe frontmatter in the SAME commit.
 */
export async function buildCookingLogUpdate(
  gh: GitHubClient,
  path: string,
  rawEntries: Record<string, unknown>[],
  todayDate: string,
): Promise<{ file: TreeFile; added: CookingLogEntry[]; lastCooked: Map<string, string> }> {
  const text = (await readOptional(gh, path)) ?? "";
  const parsed = text ? parseToml(text, path) : {};
  const existing = entriesOf(parsed);

  const additions = rawEntries.map((r) => makeLogEntry(r, todayDate));
  for (const e of additions) {
    const err = validateNewEntry(e);
    if (err) throw new ToolError("validation_failed", err);
  }

  const all = appendEntries(existing, additions);
  // Only co-write last_cooked for recipes touched by THIS call's additions.
  const touched = new Set(additions.filter((e) => e.type === "recipe" && e.recipe).map((e) => e.recipe!));
  const derived = deriveLastCooked(all);
  const lastCooked = new Map<string, string>();
  for (const slug of touched) {
    const max = derived.get(slug);
    if (max) lastCooked.set(slug, max);
  }

  return {
    file: { path, content: stringifyTomlWithHeader(text, { ...parsed, entries: all }) },
    added: additions,
    lastCooked,
  };
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
 * `gh` is the root data-repo client (shared recipe + notes writes). `userPrefix`
 * routes shared vs. per-tenant GitHub paths. `dataKv` + `username` back the KV
 * profile bundle (preferences/taste/diet/kitchen/staples/overlay/ready_to_eat/
 * stockup) and session-state keys (pantry/meal_plan/grocery_list).
 */
export function registerWriteTools(
  server: McpServer,
  gh: GitHubClient,
  userPrefix: string,
  dataKv: KVNamespace,
  username: string,
): void {
  const userPath = (p: string): string => (userPrefix ? `${userPrefix}/${p}` : p);

  server.registerTool(
    "update_recipe",
    {
      description:
        "Edit a recipe. Objective frontmatter and body edits change the SHARED recipe content; rating and status are the caller's PERSONAL disposition and are written to their overlay, never the shared recipe. Objective frontmatter validates against the controlled vocabularies: `protein`/`cuisine` must be coarse buckets (shrimp→shellfish, salmon→fish; omit `protein` when there's no protein focus — never 'none') and `requires_equipment` slugs must be in-vocab; an off-vocabulary value is rejected (validation_failed). last_cooked cannot be set here — it is derived from the cooking log (append a cooking_log entry via commit_changes). For batching a whole session, use commit_changes.",
      inputSchema: { slug: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ slug, updates }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        const { overlayEdit, content, hadLastCooked } = splitRecipeUpdate(updates);
        if (hadLastCooked) {
          throw new ToolError(
            "validation_failed",
            "last_cooked is derived from the cooking log; append a cooking_log entry instead of setting it directly",
          );
        }
        const updated_fields = Object.keys(updates).filter((k) => k !== "last_cooked");
        if (updated_fields.length === 0) return { slug, updated_fields: [] };

        let commit_sha: string | null = null;
        if (Object.keys(content).length > 0) {
          const file = await buildRecipeUpdate(gh, slug, content);
          ({ commit_sha } = await commitFiles(gh, [file], `update recipe ${slug}`));
        }
        if (Object.keys(overlayEdit).length > 0) {
          const bundle = await getProfileBundle(dataKv, username);
          const current: Overlay = bundle.overlay ? parseOverlay(bundle.overlay) : {};
          const next = applyOverlayEdit(current, slug, overlayEdit);
          await updateProfileField(dataKv, username, "overlay", serializeOverlay(next));
        }
        return { slug, updated_fields, commit_sha };
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
        const items = await getPantryState(dataKv, username, gh);
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
        const current = await getPantryState(dataKv, username, gh);
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

  server.registerTool(
    "commit_changes",
    {
      description:
        "Batch GitHub-backed writes as ONE commit, plus KV-backed writes in the same call. GitHub-backed: recipe_updates (objective frontmatter/body) and cooking_log_entries. KV-backed (no commit_sha per-field): recipe_updates rating/status → overlay bundle, ready_to_eat_drafts/updates → ready_to_eat bundle, config_updates (preferences/taste/diet_principles) → profile bundle, config_updates aliases → shared GitHub file. This is the DEFAULT for multi-write turns — batch rather than calling granular tools repeatedly. recipe_updates split automatically: objective frontmatter/body → shared GitHub recipe; rating/status → KV overlay. cooking_log_entries append cooked meals (date defaults to today); last_cooked is DERIVED from the log — never set it by hand. Ready-to-eat consumption is a cooking_log_entries {type:'ready_to_eat'} entry. Pantry, meal plan, and grocery list writes go through their own KV-backed tools (update_pantry, update_meal_plan, add_to_grocery_list/update_grocery_list/remove_from_grocery_list).",
      inputSchema: {
        recipe_updates: z
          .array(z.object({ slug: z.string(), updates: z.record(z.string(), z.unknown()) }))
          .optional(),
        ready_to_eat_drafts: z
          .array(
            z.object({
              meal: z.enum(MEALS),
              name: z.string(),
              status: z.enum(["draft", "active"]).optional(),
              category: z.string().optional(),
              source: z.string().optional(),
              brand: z.string().optional(),
              notes: z.string().optional(),
            }),
          )
          .optional(),
        ready_to_eat_updates: z
          .array(z.object({ slug: z.string(), updates: z.record(z.string(), z.unknown()) }))
          .optional(),
        config_updates: z
          .array(z.object({ file: z.enum(["preferences", "taste", "diet_principles", "aliases"]), content: z.string() }))
          .optional(),
        cooking_log_entries: z
          .array(
            z.object({
              date: z.string().optional(),
              type: z.enum(["recipe", "ready_to_eat", "ad_hoc"]),
              recipe: z.string().optional(),
              name: z.string().optional(),
              protein: z.string().optional(),
              cuisine: z.string().optional(),
            }),
          )
          .optional(),
        commit_message: z.string(),
      },
    },
    (payload) =>
      runTool(async () => {
        const files: TreeFile[] = [];
        const summary: Record<string, unknown> = {};

        // Cooking log (per-tenant, GitHub): append entries. last_cooked is DERIVED
        // at read time from the log — never co-written onto recipe frontmatter.
        // Recipe-type entries also trigger removal from the KV meal plan.
        if ((payload.cooking_log_entries?.length ?? 0) > 0) {
          const { file, added } = await buildCookingLogUpdate(
            gh,
            userPath(COOKING_LOG_PATH),
            payload.cooking_log_entries!,
            today(),
          );
          files.push(file);
          summary.cooking_log = { added: added.length };

          // Clear cooked recipes from the KV meal plan.
          const cooked = added
            .filter((e) => e.type === "recipe" && e.recipe)
            .map((e) => ({ op: "remove" as const, recipe: e.recipe! }));
          if (cooked.length > 0) {
            const current = await getMealPlanState(dataKv, username, gh);
            const { items: next, applied } = applyMealPlanOps(current, cooked);
            if (applied.length > 0) await writeMealPlanState(dataKv, username, next);
          }
        }

        // Recipe updates: objective content → shared GitHub recipe; rating/status →
        // KV overlay bundle. Subjective edits never touch shared GitHub content.
        const overlayEdits = new Map<string, OverlayRow>();
        const contentSlugs: string[] = [];
        for (const r of payload.recipe_updates ?? []) {
          const { overlayEdit, content, hadLastCooked } = splitRecipeUpdate(r.updates);
          if (hadLastCooked) {
            throw new ToolError(
              "validation_failed",
              "last_cooked is derived from the cooking log; use cooking_log_entries instead of setting it on a recipe",
            );
          }
          if (Object.keys(content).length > 0) {
            files.push(await buildRecipeUpdate(gh, r.slug, content));
            contentSlugs.push(r.slug);
          }
          if (Object.keys(overlayEdit).length > 0) {
            overlayEdits.set(r.slug, { ...(overlayEdits.get(r.slug) ?? {}), ...overlayEdit });
          }
        }
        if (overlayEdits.size > 0) {
          const bundle = await getProfileBundle(dataKv, username);
          let overlay: Overlay = bundle.overlay ? parseOverlay(bundle.overlay) : {};
          for (const [slug, edit] of overlayEdits) overlay = applyOverlayEdit(overlay, slug, edit);
          await updateProfileField(dataKv, username, "overlay", serializeOverlay(overlay));
        }
        if (contentSlugs.length > 0 || overlayEdits.size > 0) {
          summary.recipes = { content: contentSlugs, overlay: [...overlayEdits.keys()] };
        }

        // ready_to_eat drafts/updates → KV profile bundle.
        if ((payload.ready_to_eat_drafts?.length ?? 0) > 0 || (payload.ready_to_eat_updates?.length ?? 0) > 0) {
          const bundle = await getProfileBundle(dataKv, username);
          const mgr = readyToEatManager(bundle.ready_to_eat ?? null);
          const draftSlugs: string[] = [];
          for (const d of payload.ready_to_eat_drafts ?? []) draftSlugs.push(mgr.addDraft(d, d.status ?? "draft"));
          for (const u of payload.ready_to_eat_updates ?? []) mgr.update(u.slug, u.updates);
          const serialized = mgr.serialize();
          if (serialized !== null) {
            await updateProfileField(dataKv, username, "ready_to_eat", serialized);
          }
          summary.ready_to_eat = {
            drafts: draftSlugs,
            updated: (payload.ready_to_eat_updates ?? []).map((u) => u.slug),
          };
        }

        // config_updates: profile fields → KV bundle; aliases → shared GitHub file.
        for (const c of payload.config_updates ?? []) {
          const kvField = KV_PROFILE_FIELDS[c.file];
          if (kvField) {
            await updateProfileField(dataKv, username, kvField, c.content);
          } else {
            const path = SHARED_CURATED_FILES[c.file];
            if (path) files.push({ path, content: c.content });
          }
        }
        if ((payload.config_updates?.length ?? 0) > 0) {
          summary.config = payload.config_updates!.map((c) => c.file);
        }

        // Only commit to GitHub when there are actual file changes.
        let commit_sha: string | null = null;
        if (files.length > 0) {
          ({ commit_sha } = await commitFiles(gh, files, payload.commit_message));
        }
        return { commit_sha, summary };
      }),
  );
}
