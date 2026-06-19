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
import { serializeMarkdown, stringifyTomlWithHeader } from "./serialize.js";
import { ToolError, runTool } from "./errors.js";
import { commitFiles } from "./commit.js";
import {
  parseOverlay,
  applyOverlayEdit,
  serializeOverlay,
  OVERLAY_PATH,
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
import { MEAL_PLAN_PATH, plannedOf, applyMealPlanOps, type MealPlanOp } from "./meal-plan.js";
import { slugify } from "./discovery.js";
import { addStockup, STOCKUP_PATH } from "./stockup.js";
import { updateStaples, STAPLES_PATH } from "./staples.js";
import { GROCERY_LIST_PATH, buildGroceryListUpdate } from "./grocery-tools.js";

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
  return { path, content: serializeMarkdown(merged, body) };
}

/**
 * Build the caller's overlay update from a set of per-slug subjective edits.
 * Reads + writes `overlayPath` (the caller's `users/<username>/overlay.toml`).
 * Returns null when there is nothing to write.
 */
export async function buildOverlayUpdate(
  gh: GitHubClient,
  overlayPath: string,
  edits: Map<string, OverlayRow>,
): Promise<TreeFile | null> {
  if (edits.size === 0) return null;
  const text = (await readOptional(gh, overlayPath)) ?? "";
  let overlay: Overlay = text ? parseOverlay(text) : {};
  for (const [slug, edit] of edits) overlay = applyOverlayEdit(overlay, slug, edit);
  return { path: overlayPath, content: serializeOverlay(overlay) };
}

async function buildPantryUpdate(
  gh: GitHubClient,
  path: string,
  operations: Parameters<typeof applyPantryOperations>[1],
  verifyNames: string[],
): Promise<{ file: TreeFile | null; applied: AppliedOp[]; conflicts: ConflictOp[] }> {
  const text = await readFile(gh, path, "not_found", "no pantry is set up");
  const parsed = parseToml(text, path);
  let items = itemsOf(parsed) as PantryItem[];

  const opResult = applyPantryOperations(items, operations, today());
  items = opResult.items;
  let verified: string[] = [];
  let missing: string[] = [];
  if (verifyNames.length) {
    const v = markVerified(items, verifyNames, today());
    items = v.items;
    verified = v.verified;
    missing = v.missing;
  }

  const changed = opResult.applied.length > 0 || verified.length > 0;
  const conflicts = [
    ...opResult.conflicts,
    ...missing.map((name) => ({ op: "verify" as const, name, reason: "no pantry item with that name" })),
  ];
  if (!changed) return { file: null, applied: opResult.applied, conflicts };

  const content = stringifyTomlWithHeader(text, { ...parsed, items });
  return {
    file: { path, content },
    applied: [...opResult.applied, ...verified.map((name) => ({ op: "verify" as const, name }))],
    conflicts,
  };
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

/** Apply meal-plan add/remove ops. Returns the file (null when nothing changed) + report. */
export async function buildMealPlanUpdate(
  gh: GitHubClient,
  path: string,
  ops: MealPlanOp[],
): Promise<{ file: TreeFile | null; applied: unknown[]; conflicts: unknown[] }> {
  const text = (await readOptional(gh, path)) ?? "";
  const parsed = text ? parseToml(text, path) : {};
  const planned = plannedOf(parsed);
  const result = applyMealPlanOps(planned, ops);
  if (result.applied.length === 0) {
    return { file: null, applied: result.applied, conflicts: result.conflicts };
  }
  return {
    file: { path, content: stringifyTomlWithHeader(text, { ...parsed, planned: result.items }) },
    applied: result.applied,
    conflicts: result.conflicts,
  };
}

/**
 * In-memory manager for the caller's single per-tenant `ready_to_eat.toml`
 * catalog (loaded once). Items carry a `meal` field and a generated `slug` as
 * their stable key — `addDraft` mints a slug (unique within the file) from the
 * name and accepts a status so an onboarding-asserted item lands `active` rather
 * than as a draft; `update` addresses items by that slug.
 */
export function readyToEatManager(gh: GitHubClient, path: string) {
  let state: { text: string; parsed: Record<string, unknown>; items: Record<string, unknown>[] } | null = null;
  let touched = false;

  async function load() {
    if (!state) {
      const text = (await readOptional(gh, path)) ?? "";
      const parsed = text ? parseToml(text, path) : {};
      state = { text, parsed, items: itemsOf(parsed) };
    }
    return state;
  }

  /** A slug from `name`, de-duped within the file with a numeric suffix (recipe-style). */
  function uniqueSlug(name: string, items: Record<string, unknown>[]): string {
    const taken = new Set(items.map((it) => it.slug).filter((s): s is string => typeof s === "string"));
    const base = slugify(name) || "item";
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  return {
    /** Append a new item; returns its generated slug. Default status is "draft". */
    async addDraft(item: Record<string, unknown>, status: "draft" | "active" = "draft"): Promise<string> {
      const f = await load();
      const slug = uniqueSlug(String(item.name ?? ""), f.items);
      f.items.push({
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
    async update(slug: string, updates: Record<string, unknown>) {
      const f = await load();
      const idx = f.items.findIndex((it) => it.slug === slug);
      if (idx < 0) throw new ToolError("not_found", `No ready-to-eat item with slug: ${slug}`, { slug });
      f.items[idx] = { ...f.items[idx], ...updates };
      touched = true;
    },
    files(): TreeFile[] {
      if (!touched || !state) return [];
      return [{ path, content: stringifyTomlWithHeader(state.text, { ...state.parsed, items: state.items }) }];
    },
  };
}

const CURATED_FILES: Record<string, string> = {
  preferences: "preferences.toml",
  taste: "taste.md",
  diet_principles: "diet_principles.md",
  aliases: "aliases.toml",
};
/** Curated files that are SHARED reference data (root); the rest are per-tenant. */
const SHARED_CURATED = new Set(["aliases"]);

// --- registration ------------------------------------------------------------

/**
 * `gh` is the root data-repo client. `userPrefix` is the caller's subtree (e.g.
 * "users/alice", empty pre-migration). Writes are routed by category: objective
 * recipe content + shared reference data at the root; overlay/notes/personal state
 * under the caller's `users/<username>/`. All writes commit via `gh` with explicit
 * paths, so a batch lands as one atomic commit that may span both.
 */
export function registerWriteTools(server: McpServer, gh: GitHubClient, userPrefix: string): void {
  const userPath = (p: string): string => (userPrefix ? `${userPrefix}/${p}` : p);

  server.registerTool(
    "update_recipe",
    {
      description:
        "Edit a recipe. Objective frontmatter and body edits change the SHARED recipe content; rating and status are the caller's PERSONAL disposition and are written to their overlay, never the shared recipe. last_cooked cannot be set here — it is derived from the cooking log (append a cooking_log entry via commit_changes). For batching a whole session, use commit_changes.",
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
        const files: TreeFile[] = [];
        if (Object.keys(content).length > 0) files.push(await buildRecipeUpdate(gh, slug, content));
        if (Object.keys(overlayEdit).length > 0) {
          const f = await buildOverlayUpdate(gh, userPath(OVERLAY_PATH), new Map([[slug, overlayEdit]]));
          if (f) files.push(f);
        }
        if (files.length === 0) return { slug, updated_fields: [] };
        const { commit_sha } = await commitFiles(gh, files, `update recipe ${slug}`);
        return { slug, updated_fields: Object.keys(updates).filter((k) => k !== "last_cooked"), commit_sha };
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
        const { file, applied, conflicts } = await buildPantryUpdate(gh, userPath("pantry.toml"), operations, []);
        if (!file) return { applied, conflicts };
        const { commit_sha } = await commitFiles(gh, [file], "update pantry");
        return { applied, conflicts, commit_sha };
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
        const path = userPath(STOCKUP_PATH);
        const existing = await readOptional(gh, path);
        const { text, added, changed } = addStockup(existing, { items, freezer_capacity_estimate });
        if (!changed) return { added, commit_sha: null };
        const { commit_sha } = await commitFiles(gh, [{ path, content: text }], `update stockup (+${added})`);
        return { added, commit_sha };
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
        const path = userPath(STAPLES_PATH);
        const existing = await readOptional(gh, path);
        const { text, added, removed, changed } = updateStaples(existing, add ?? [], remove ?? []);
        if (!changed) return { added, removed, commit_sha: null };
        const { commit_sha } = await commitFiles(
          gh,
          [{ path, content: text }],
          `update staples (+${added} -${removed})`,
        );
        return { added, removed, commit_sha };
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
        const path = userPath("kitchen.toml");
        const text = (await readOptional(gh, path)) ?? "";
        const inventory = toInventory(text ? parseToml(text, path) : {});
        const { inventory: next, applied, conflicts } = applyKitchenOperations(inventory, operations);
        if (applied.length === 0) return { applied, conflicts };
        const data: Record<string, unknown> = { owned: next.owned };
        if (Object.keys(next.notes).length) data.notes = next.notes;
        const content = stringifyTomlWithHeader(text, data);
        const { commit_sha } = await commitFiles(gh, [{ path, content }], "update kitchen");
        return { applied, conflicts, commit_sha };
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
        const { file, applied, conflicts } = await buildPantryUpdate(gh, userPath("pantry.toml"), [], items);
        if (!file) return { verified: [], conflicts };
        const { commit_sha } = await commitFiles(gh, [file], "verify pantry items");
        return { verified: applied.filter((a) => a.op === "verify").map((a) => a.name), conflicts, commit_sha };
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
        const mgr = readyToEatManager(gh, userPath(READY_TO_EAT_PATH));
        const added: { meal: Meal; name: string; slug: string }[] = [];
        for (const it of items) {
          const slug = await mgr.addDraft(it, it.status ?? "draft");
          added.push({ meal: it.meal, name: it.name, slug });
        }
        const { commit_sha } = await commitFiles(gh, mgr.files(), "add ready-to-eat items");
        return { added, commit_sha };
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
        const mgr = readyToEatManager(gh, userPath(READY_TO_EAT_PATH));
        await mgr.update(slug, updates);
        const { commit_sha } = await commitFiles(gh, mgr.files(), `update ready-to-eat ${slug}`);
        return { slug, updated_fields: Object.keys(updates), commit_sha };
      }),
  );

  // User-curated config writers — content-faithful: write exactly what the caller
  // supplies. The discipline of WHEN to call these (only on explicit user
  // direction) lives in AGENT_INSTRUCTIONS.md.
  for (const [key, path] of Object.entries(CURATED_FILES)) {
    const target = SHARED_CURATED.has(key) ? path : userPath(path);
    server.registerTool(
      `update_${key}`,
      {
        description: `Write ${path} verbatim with the supplied full content. Call only when the user has directed an edit.`,
        inputSchema: { content: z.string() },
      },
      ({ content }) =>
        runTool(async () => {
          const { commit_sha } = await commitFiles(gh, [{ path: target, content }], `update ${path}`);
          return { file: path, commit_sha };
        }),
    );
  }

  server.registerTool(
    "commit_changes",
    {
      description:
        "Persist a batch of repo updates as ONE commit (no cart). This is the DEFAULT for any turn that makes more than one repo write — batch them here instead of calling the granular tools repeatedly, and never fire parallel writes at the same file (they full-file-clobber each other). recipe_updates split automatically: objective frontmatter/body → shared recipe content; rating/status → the caller's personal overlay. cooking_log_entries append cooked meals (date defaults to today); last_cooked is DERIVED from the log at read time — never set it by hand. meal_plan_ops add/remove committed cook intent (an `add` may carry free-text open-world `sides` that ride on the main's row; corpus sides get their own row). grocery_list_ops add/update/remove buy-list items in the same commit (same-name add merges; a missing-name update/remove is reported as a conflict, not an error). Ready-to-eat consumption is a cooking_log_entries {type:'ready_to_eat'} plus a pantry_operations remove when the user used the last of it.",
      inputSchema: {
        recipe_updates: z
          .array(z.object({ slug: z.string(), updates: z.record(z.string(), z.unknown()) }))
          .optional(),
        pantry_operations: z
          .array(
            z.object({
              op: z.enum(["add", "remove", "verify"]),
              item: z.record(z.string(), z.unknown()).optional(),
              name: z.string().optional(),
            }),
          )
          .optional(),
        pantry_verified: z.array(z.string()).optional(),
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
        meal_plan_ops: z
          .array(
            z.object({
              op: z.enum(["add", "remove"]),
              recipe: z.string(),
              planned_for: z.string().nullable().optional(),
              // Open-world sides (free text) to attach to the main's row on an `add`.
              sides: z.array(z.string()).optional(),
            }),
          )
          .optional(),
        grocery_list_ops: z
          .array(
            z.object({
              op: z.enum(["add", "update", "remove"]),
              // `add`: the full item (name + optional quantity/kind/domain/source/for_recipes/note).
              // `update`: the partial patch (with `name` as the key). `remove`: ignored.
              item: z.record(z.string(), z.unknown()).optional(),
              // The item key for `update` / `remove`.
              name: z.string().optional(),
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

        // Cooking log (per-tenant): append entries. last_cooked is DERIVED at read
        // time from the log, so it is no longer co-written onto recipe frontmatter.
        if ((payload.cooking_log_entries?.length ?? 0) > 0) {
          const { file, added } = await buildCookingLogUpdate(
            gh,
            userPath(COOKING_LOG_PATH),
            payload.cooking_log_entries!,
            today(),
          );
          files.push(file);
          summary.cooking_log = { added: added.length };
        }

        // Recipe updates: objective content → shared root recipe; the caller's
        // rating/status → their overlay. A subjective edit never touches shared content.
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
        const overlayFile = await buildOverlayUpdate(gh, userPath(OVERLAY_PATH), overlayEdits);
        if (overlayFile) files.push(overlayFile);
        if (contentSlugs.length > 0 || overlayEdits.size > 0) {
          summary.recipes = { content: contentSlugs, overlay: [...overlayEdits.keys()] };
        }

        if ((payload.meal_plan_ops?.length ?? 0) > 0) {
          const { file, applied, conflicts } = await buildMealPlanUpdate(
            gh,
            userPath(MEAL_PLAN_PATH),
            payload.meal_plan_ops!,
          );
          if (file) files.push(file);
          summary.meal_plan = { applied, conflicts };
        }

        if ((payload.grocery_list_ops?.length ?? 0) > 0) {
          const { file, applied, conflicts } = await buildGroceryListUpdate(
            gh,
            userPath(GROCERY_LIST_PATH),
            payload.grocery_list_ops!,
          );
          if (file) files.push(file);
          summary.grocery_list = { applied, conflicts };
        }

        if ((payload.pantry_operations?.length ?? 0) > 0 || (payload.pantry_verified?.length ?? 0) > 0) {
          const { file, applied, conflicts } = await buildPantryUpdate(
            gh,
            userPath("pantry.toml"),
            payload.pantry_operations ?? [],
            payload.pantry_verified ?? [],
          );
          if (file) files.push(file);
          summary.pantry = { applied, conflicts };
        }

        if ((payload.ready_to_eat_drafts?.length ?? 0) > 0 || (payload.ready_to_eat_updates?.length ?? 0) > 0) {
          const mgr = readyToEatManager(gh, userPath(READY_TO_EAT_PATH));
          const draftSlugs: string[] = [];
          for (const d of payload.ready_to_eat_drafts ?? []) draftSlugs.push(await mgr.addDraft(d, d.status ?? "draft"));
          for (const u of payload.ready_to_eat_updates ?? []) await mgr.update(u.slug, u.updates);
          files.push(...mgr.files());
          summary.ready_to_eat = {
            drafts: draftSlugs,
            updated: (payload.ready_to_eat_updates ?? []).map((u) => u.slug),
          };
        }

        for (const c of payload.config_updates ?? []) {
          const p = CURATED_FILES[c.file];
          files.push({ path: SHARED_CURATED.has(c.file) ? p : userPath(p), content: c.content });
        }
        if ((payload.config_updates?.length ?? 0) > 0) {
          summary.config = payload.config_updates!.map((c) => c.file);
        }

        const { commit_sha } = await commitFiles(gh, files, payload.commit_message);
        return { commit_sha, summary };
      }),
  );
}
