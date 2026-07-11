// Repo-data write tools (data-write-tools capability). Each tool reads the
// current file/rows, applies a pure transform, and persists via a single-object R2 put
// through the corpus store (validated first) for shared recipe markdown, or D1 rows for
// per-tenant state. Objective recipe content is shared (R2 corpus); a recipe's subjective
// disposition (favorite/reject) is per-tenant and routes to the caller's D1 overlay via
// `toggle_favorite` / `toggle_reject`; the pantry is the D1 `pantry` table
// (src/session-db.ts). No tool here
// writes a Kroger cart or calls an external service.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { type CorpusStore, readCorpusFile } from "./corpus-store.js";
import { addAliases, enqueueNovelTerms, ingredientContext } from "./corpus-db.js";
import { brandKey } from "./matching.js";
import { parseMarkdown } from "./parse.js";
import { serializeMarkdown } from "./serialize.js";
import { validateFile } from "./validate.js";
import { ToolError, runTool } from "./errors.js";
import { applyOverlayEdit, type OverlayRow } from "./overlay.js";
import { applyKitchenOperations } from "./kitchen.js";
import { slugify } from "./discovery.js";
import { addStockup } from "./stockup.js";
import { updateStaples } from "./staples.js";
import {
  applyRetiredKeyShim,
  convertLegacyBrandRanks,
  mergePatch,
  rejectUnknownPatchKeys,
  validatePreferences,
  type DeprecationWarning,
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
 * route through `toggle_favorite` / `toggle_reject` to the D1 overlay table —
 * `update_recipe` (objective-only) rejects them rather than silently writing the
 * overlay. The retired `status`/`rating` keys stay listed so a stale caller's
 * `update_recipe({ status })` is steered (rejected) rather than written as objective
 * content; they are no longer overlay fields.
 */
const SUBJECTIVE_KEYS = ["favorite", "reject", "rating", "status"] as const;

/**
 * The mutable fields of a ready-to-eat item — `update_ready_to_eat`'s documented
 * contract: the two disposition marks plus the in-place content edits. Everything
 * else is identity/provenance (`slug`, `meal`, `discovery_source`/`source`, any
 * added/discovered timestamp) and is rejected (validation_failed, nothing
 * committed) rather than silently written — mirroring `update_recipe`'s
 * protected-key rejection.
 */
const READY_TO_EAT_MUTABLE_KEYS = ["name", "category", "brand", "notes", "favorite", "reject"] as const;

// --- file-level builders (return a TreeFile for the atomic commit) -----------

/** Build an objective-content update for a shared recipe (root `recipes/<slug>.md`). */
export async function buildRecipeUpdate(
  store: CorpusStore,
  env: Env,
  slug: string,
  updates: Record<string, unknown>,
): Promise<{ path: string; content: string }> {
  if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
  const path = `recipes/${slug}.md`;
  const text = await readCorpusFile(store, path, "not_found", `Unknown recipe slug: ${slug}`);
  const { frontmatter, body } = parseMarkdown(text, path);
  const merged = { ...frontmatter, ...updates };
  // perishable_ingredients and ingredients_key are objective shared content;
  // canonicalize the names at WRITE the same way the verify matcher does, so stored
  // names are canonical and cross-recipe overlap (waste detection + the pantry-overlap
  // re-rank) lines up. Only when the caller is writing the field — a non-array passes
  // through unchanged for the contract validator to reject.
  if ("perishable_ingredients" in updates || "ingredients_key" in updates) {
    // Route through the one ingredient funnel: resolveList canonicalizes exactly like
    // normalizeIngredientList AND best-effort-captures any novel surface form for the cron.
    const ctx = await ingredientContext(env);
    if ("perishable_ingredients" in updates)
      merged.perishable_ingredients = ctx.resolveList(merged.perishable_ingredients);
    if ("ingredients_key" in updates)
      merged.ingredients_key = ctx.resolveList(merged.ingredients_key);
  }
  // The full required-field contract is enforced on the serialized (merged) content by
  // the update_recipe handler's validateFile step BEFORE the R2 put (the commit engine
  // used to do this) — so a one-field patch on a compliant recipe passes while an edit
  // that strips or empties a required field, or sets an off-vocabulary value, is rejected
  // (validation_failed) and nothing is written.
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
    /** Append a new item (available by default — no draft/active state); returns its slug. */
    add(item: Record<string, unknown>): string {
      const slug = uniqueSlug(String(item.name ?? ""));
      list.push({
        name: item.name,
        slug,
        meal: item.meal,
        category: item.category ?? null,
        discovery_source: item.source ?? null,
        brand: item.brand ?? null,
        notes: item.notes ?? null,
      });
      changed = true;
      return slug;
    },
    /**
     * Find an item by slug (not_found if absent — checked FIRST, so an unknown slug
     * is reported as such regardless of what the patch carries), then apply updates.
     * Only the documented mutable fields (READY_TO_EAT_MUTABLE_KEYS) may change — any
     * other key throws validation_failed listing the offenders, and nothing is
     * committed. `favorite` and `reject` are mutually exclusive: setting one true
     * clears the other.
     */
    update(slug: string, updates: Record<string, unknown>) {
      const idx = list.findIndex((it) => it.slug === slug);
      if (idx < 0) throw new ToolError("not_found", `No ready-to-eat item with slug: ${slug}`, { slug });
      const rejected = Object.keys(updates).filter(
        (k) => !(READY_TO_EAT_MUTABLE_KEYS as readonly string[]).includes(k),
      );
      if (rejected.length > 0) {
        throw new ToolError(
          "validation_failed",
          `${rejected.join("/")} ${rejected.length > 1 ? "are" : "is"} not updatable on a ready-to-eat item — only ${READY_TO_EAT_MUTABLE_KEYS.join("/")} may change (slug, meal, discovery source, and timestamps are identity/provenance); nothing was written`,
          { fields: rejected },
        );
      }
      const next = { ...list[idx], ...updates };
      if (updates.favorite) next.reject = false;
      if (updates.reject) next.favorite = false;
      list[idx] = next;
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
export const PROFILE_MARKDOWN_FIELDS = {
  taste: "taste",
  diet_principles: "diet_principles",
} as const;

/**
 * The `update_preferences` apply as a shared operation (member-app-core D2):
 * reject-unknown-keys + RFC 7396 merge-patch + result validation + the atomic
 * profile-columns/brands batch. Called by the MCP tool and the member API's
 * `PATCH /api/profile/preferences`. Throws structured `validation_failed` /
 * `malformed_data`; stores nothing on failure. A success return may carry
 * `warnings` (the D21 deprecation convention): entries for patch values that were
 * accepted under a deprecated shape and converted.
 */
export async function applyPreferencesPatch(
  env: Env,
  tenant: string,
  patch: Record<string, unknown>,
): Promise<{ updated: "preferences"; warnings?: DeprecationWarning[] }> {
  // Stage 0 (D21, one deprecation window, BEFORE rejectUnknownPatchKeys): retired keys
  // (lunch_strategy / ready_to_eat_default_action) are accepted-and-dropped — never
  // validation_failed, never the nest-under-custom hint, nothing written — and
  // `default_cooking_nights: N` is aliased onto cadence.dinner (the frozen column is
  // never written). Each conversion lands in `warnings`.
  const shim = applyRetiredKeyShim(patch);
  patch = shim.patch;

  // Stage 1: reject unknown top-level patch keys (authorship-time signal).
  rejectUnknownPatchKeys(patch);

  // Stage 1b: normalize the brands patch BEFORE the merge, so patch keys land on the
  // stored keys and a legacy value converts ahead of validation.
  // - Key each family on the matcher's lookup form — brandKey(canonical id) — so a
  //   write lands on the SAME key the matcher reads (`deps.brands[brandKey(normalizeIngredient(x))]`)
  //   AND a partial family patch merges into the stored family instead of forking a
  //   sibling key. A raw multi-word term ("ground beef") otherwise stored as
  //   "ground beef" but was read as "ground_beef" — a silent miss.
  // - One-window deprecated-shape shim (D21): a legacy `string[]` value is
  //   accepted-and-converted by the migration mapping (never dropped, never bounced),
  //   with a `warnings` entry steering the stale caller to `{ tiers, any_brand }`.
  //   When the window closes, drop this conversion — validatePreferences then rejects
  //   an array value as `malformed_data` like any other type error.
  const warnings: DeprecationWarning[] = [...shim.warnings];
  let brandsPatch: Record<string, unknown> | undefined;
  let novelIds: string[] = [];
  if (patch.brands !== null && patch.brands !== undefined && typeof patch.brands === "object" && !Array.isArray(patch.brands)) {
    // Resolve-only (capture: false): this runs BEFORE validation, and a rejected
    // patch must store nothing — including novel-term queue rows. The write-path
    // capture happens after validation passes (below).
    const ctx = await ingredientContext(env, { capture: false });
    brandsPatch = {};
    const resolvedIds: string[] = [];
    for (const [term, value] of Object.entries(patch.brands as Record<string, unknown>)) {
      const id = ctx.resolve(term);
      resolvedIds.push(id);
      const key = brandKey(id);
      if (Array.isArray(value) && value.every((s) => typeof s === "string")) {
        brandsPatch[key] = convertLegacyBrandRanks(value as string[]);
        warnings.push({
          key: `brands.${term}`,
          reason: "deprecated_shape",
          superseded_by: "{ tiers, any_brand }",
        });
      } else {
        brandsPatch[key] = value;
      }
    }
    patch = { ...patch, brands: brandsPatch };
    novelIds = [...new Set(resolvedIds.filter((id) => id && !ctx.resolver.ids.has(id)))];
  }

  // Stage 2: deep-merge over the current preferences; validate the result's types.
  const current = (await readPreferences(env, tenant)) ?? {};
  const merged = mergePatch(current, patch) as Record<string, unknown>;
  validatePreferences(merged);

  // The patch survived validation — NOW capture its novel ingredient terms for the
  // graph (the write-path capture, deferred past validation so a rejected patch
  // enqueues nothing). enqueueNovelTerms is best-effort and never throws.
  if (novelIds.length > 0) await enqueueNovelTerms(env, novelIds);

  // Stage 3: apply atomically (one batch). Scalar/JSON columns come from the MERGED
  // result. Brands rows: the terms come from the PATCH (a `null` vanishes from the
  // merged object, so the patch is the only place the delete intent survives), but an
  // UPSERT writes the MERGED family value — a partial family patch (`{ any_brand: true }`)
  // must not clobber the stored sibling field.
  // The frozen columns (`default_cooking_nights`, `lunch_strategy`,
  // `ready_to_eat_default_action`) are DELIBERATELY absent: no writer post-0052 — the
  // scalar stays readable for the cadence fallback, the retired pair converges to NULL
  // via the pref-retirement cron, and all three drop at window close.
  const stmts: D1PreparedStatement[] = [];
  const profileFields: Record<string, unknown> = {
    cadence: "cadence" in merged ? JSON.stringify(merged.cadence) : null,
    planning_cadence_days:
      "planning_cadence_days" in merged ? merged.planning_cadence_days : null,
    weekly_budget: "weekly_budget" in merged ? merged.weekly_budget : null,
    stores: "stores" in merged ? JSON.stringify(merged.stores) : null,
    dietary: "dietary" in merged ? JSON.stringify(merged.dietary) : null,
    rotation: "rotation" in merged ? JSON.stringify(merged.rotation) : null,
    custom: "custom" in merged ? JSON.stringify(merged.custom) : null,
  };
  const profileStmt = profileUpsertStmt(env, tenant, profileFields);
  if (profileStmt) stmts.push(profileStmt);

  if (brandsPatch) {
    const mergedBrands = (merged.brands ?? {}) as Record<string, Record<string, unknown>>;
    for (const [key, value] of Object.entries(brandsPatch)) {
      stmts.push(brandStmt(env, tenant, key, value === null ? null : mergedBrands[key]));
    }
  }
  if (stmts.length > 0) await db(env).batch(stmts);
  return warnings.length > 0 ? { updated: "preferences", warnings } : { updated: "preferences" };
}
// --- registration ------------------------------------------------------------

/**
 * `store` is the R2 corpus store (shared recipe writes — `recipes/<slug>.md`, the one
 * authored corpus, now in R2 not git). `env` is D1: the `recipes` index (queried by
 * `toggle_favorite`/`toggle_reject` to validate a slug), the profile tables (preferences/taste/diet/
 * kitchen/staples/overlay/ready_to_eat/stockup — via src/profile-db.ts) AND the
 * session-state pantry table (via src/session-db.ts). meal_plan/grocery_list live in
 * their own tool groups.
 */
export function registerWriteTools(
  server: McpServer,
  store: CorpusStore,
  env: Env,
  username: string,
): void {
  server.registerTool(
    "update_recipe",
    {
      description:
        "Edit a recipe's OBJECTIVE shared content (frontmatter/body) — the same recipe everyone in the group sees. `updates` is a partial patch (merged over the existing frontmatter); send only the fields you're changing. favorite and reject are NOT settable here (the caller's personal disposition — use toggle_favorite / toggle_reject); last_cooked is derived from the cooking log (log_cooked). The DESCRIPTIVE facets (`protein`, `cuisine`, `course`, `season`, `tags`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`, `meal_preppable`) are DERIVED on the cron from the body — editing the body re-derives them. You MAY patch `protein`/`cuisine`/`course`/`season`/`tags` to pin an authored OVERRIDE (it wins over the classifier; an off-vocab `protein`/`cuisine`/`season` override is rejected). The MERGED result must keep the required AUTHORED fields valid (the gates + identity, same as create_recipe): `title`, `source`, `time_total`, `dietary`, `requires_equipment`, `pairs_with` — a patch that empties a required gate or sets an off-vocab `requires_equipment` slug is rejected (validation_failed). `description` is NOT settable here — it is AI-generated and refreshed automatically.",
      inputSchema: { slug: z.string(), updates: z.record(z.string(), z.unknown()) },
    },
    ({ slug, updates }) =>
      runTool(async () => {
        if (!SLUG_RE.test(slug)) throw new ToolError("not_found", `Unknown recipe slug: ${slug}`, { slug });
        const subjective = SUBJECTIVE_KEYS.filter((k) => k in updates);
        if (subjective.length > 0) {
          throw new ToolError(
            "validation_failed",
            `${subjective.join("/")} ${subjective.length > 1 ? "are" : "is"} the caller's personal disposition, not shared recipe content — use toggle_favorite to set favorite, toggle_reject to hide a recipe (status/rating are retired)`,
            { fields: subjective },
          );
        }
        if ("last_cooked" in updates) {
          throw new ToolError(
            "validation_failed",
            "last_cooked is derived from the cooking log; record a cooked meal via log_cooked instead of setting it directly",
          );
        }
        if ("description" in updates) {
          throw new ToolError(
            "validation_failed",
            "description is an AI-generated field now (derived from the recipe's facets and refreshed automatically when they change) — it is not authored content; omit it from updates",
          );
        }
        const updated_fields = Object.keys(updates);
        if (updated_fields.length === 0) return { slug, updated_fields: [] };

        const file = await buildRecipeUpdate(store, env, slug, updates);
        // Validate the merged content before persisting (the commit engine used to do
        // this): an edit that empties a required field or sets an off-vocab value is
        // rejected (validation_failed) and nothing is written.
        validateFile(file.path, file.content);
        await store.put(file.path, file.content);
        return { slug, updated_fields };
      }),
  );

  // Both disposition tools resolve the slug against the shared index, then apply a
  // single-field overlay edit. The overlay collapsed to two mutually-exclusive marks:
  // `toggle_favorite` (the positive taste signal) and `toggle_reject` (hide-from-me,
  // a hard gate) — the `status` lifecycle and `rating` were retired.
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
    "toggle_reject",
    {
      description:
        "Hide a recipe from the CALLER — `reject: true` removes it from the caller's search_recipes results (a hard gate, both membership and ranked modes), `false` un-hides it back to the available default. Per-tenant: one member's reject never affects another's view, and it does NOT remove the shared recipe. Mutually exclusive with favorite (rejecting clears a favorite). DISTINCT from reject_discovery, which suppresses a discovery URL group-wide before import; toggle_reject acts on an existing corpus slug for one member. Unknown slug → not_found. Returns { slug, overlay } (no commit_sha; the overlay is D1-backed).",
      inputSchema: { slug: z.string(), reject: z.boolean() },
    },
    ({ slug, reject }) => runTool(() => applyDisposition(slug, { reject })),
  );

  server.registerTool(
    "update_pantry",
    {
      description:
        "Apply pantry add/remove/verify/dispose operations. `add` is an upsert: re-adding an existing name merges into it (overlay incoming fields, preserve added_at, refresh last_verified_at) rather than duplicating; the result includes merged:true when this happens. " +
        "Items carry two orthogonal fields: `category`, the food taxonomy (produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages), and `location`, where it's kept (fridge | freezer | pantry | spice_rack | counter | cabinet). Omit category to let the background classifier derive it — NULL reads as uncategorized, never an error. An off-vocabulary location is a conflict, never a silent write; an off-vocabulary category is accepted with the field dropped and a warning (legacy values pantry|fridge|freezer|spices are transposed onto location for one deprecation window). " +
        "`remove` is a plain correction/cleanup delete and records nothing. When food actually leaves the kitchen, use `dispose`: { op:'dispose', name, disposition: 'used'|'waste', reason?, event_id?, occurred_at? } removes the row, and 'waste' also records a waste event for the waste analyzer — reason is required for waste, exactly one of spoiled | moldy | over_ripe | expired | freezer_burned | stale | forgot | bought_too_much | never_opened | other. Disposition NEVER asks or accepts a dollar value — the event's value is derived later from purchase history, so never prompt the member for what an item cost. The event's analytics department is stamped at capture from the item's identity (a prepared/leftover row stamps 'leftovers'). `event_id` is an optional client-minted idempotency key — a replayed dispose with the same id converges to one event; omit it and the server mints one. `occurred_at` (YYYY-MM-DD) backdates the toss; default today. 'used' records nothing today (pure removal). Returns applied + conflicts + warnings (e.g. a remove/dispose whose target isn't present is a conflict).",
      inputSchema: {
        operations: z.array(
          z.object({
            op: z.enum(["add", "remove", "verify", "dispose"]),
            item: z.record(z.string(), z.unknown()).optional(),
            name: z.string().optional(),
            disposition: z.enum(["used", "waste"]).optional(),
            reason: z.string().optional(),
            event_id: z.string().optional(),
            occurred_at: z.string().optional(),
          }),
        ),
      },
    },
    ({ operations }) =>
      runTool(async () => {
        const result = await applyPantryRowOps(env, username, operations, today());
        return {
          applied: result.applied,
          conflicts: result.conflicts,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        };
      }),
  );

  server.registerTool(
    "update_stockup",
    {
      description:
        "Add bulk-buy items to the caller's stockup watchlist. Add-only, deduped by normalized name — re-adding a name is a no-op. Each item needs a name; unit / typical_purchase / notes / baseline_price / buy_at_or_below are optional. Price thresholds are ADVISORY (nothing gates on them — the agent reasons over the live flyer price), so omit them when unknown. Optionally set freezer_capacity_estimate (tight|moderate|spacious). Returns { added }; makes no change when nothing changed.",
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
        "Add or remove items on the caller's staples list — the must-have items they never want to run out of. Adds are deduped by normalized name (re-adding is a no-op); removes match by normalized name (absent name is a silent no-op). Each add needs a `name`; `perishable: true` is optional (flag items like eggs or butter so the agent can prompt when stock looks stale). Returns { added, removed }; makes no change when nothing changed.",
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
        "Append ready-to-eat items to the caller's personal ready-to-eat catalog. Each item needs a meal (breakfast|lunch|dinner). Items are available (suggestible) immediately — there is no draft/active state. Returns the generated slug for each.",
      inputSchema: {
        items: z.array(
          z.object({
            meal: z.enum(MEALS),
            name: z.string(),
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
          const slug = mgr.add(it);
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
        "Disposition or update a ready-to-eat item in the caller's catalog, addressed by slug. Set `favorite` (loved) and/or `reject` (stop suggesting it) — mutually exclusive, mirroring recipes; there is no status or rating. Other fields (name, category, brand, notes) update in place. Those six are the ONLY updatable keys: any other key — `slug`, `meal`, the discovery source, timestamps — is identity/provenance and is rejected (validation_failed listing the offending keys, nothing written). Unknown slug → not_found.",
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
        "Edit the caller's grocery preferences with a deep merge-patch (RFC 7396): keys present in `patch` set/overwrite, a key set to null is DELETED, nested objects merge to any depth, and arrays replace wholesale. Only the keys you touch change — a partial patch never clobbers siblings (e.g. patching stores.preferred_location keeps stores.primary, and { cadence: { lunch: 2 } } sets lunch only), so you do NOT need to re-send the whole object. Defined top-level keys: cadence (the per-meal planning frequency map { breakfast?, lunch?, dinner? }, each an integer weekly count 0-7, merged PER KEY: { cadence: { dinner: null } } clears one meal, cadence: null clears the map; drives propose_meal_plan's per-meal slot counts), planning_cadence_days (positive number — how far out the caller plans/shops, in days; drives propose_meal_plan's weather horizon and vibe-recurrence caps; unset falls back to a 7-day window), weekly_budget (number ≥ 0 — the household's weekly grocery budget in dollars; unset or 0 means no budget line; null deletes it), stores ({primary, preferred_location, location_zip}), brands (map of ingredient-family term → tier object { tiers: string[][], any_brand: boolean } — `tiers` is an ordered ladder tried top tier first, brands in one tier are equally fine so the cheapest wins; `any_brand: true` means when the tiers (if any) are exhausted, take the cheapest acceptable instead of asking, so { any_brand: true } alone is the standing don't-care; an absent family = ask; null = clear back to ambiguous — the empty { tiers: [], any_brand: false } is rejected. A partial family patch merges into the stored family, e.g. { brands: { butter: { any_brand: true } } } keeps butter's tiers. For one deprecation window a legacy flat rank list still converts: [] → any-brand, a ranked list → one singleton tier per rank, flagged in the return's `warnings`), dietary ({avoid[], limit[]}), rotation ({resurface_after_days, novelty_boost} — tunes the semantic-search freshness re-rank: how many days until a cooked recipe rotates back in, and how hard never-cooked recipes are boosted; both positive numbers). Anything else nests under `custom`; an unknown top-level key is rejected (use custom). For one deprecation window: `default_cooking_nights: N` is accepted as an ALIAS merged onto cadence.dinner (breakfast/lunch preserved; the legacy column is never written), and the RETIRED keys `lunch_strategy` / `ready_to_eat_default_action` are accepted and DROPPED — nothing stored, never an error (meal vibes supersede them; capture that intent as lunch/dinner meal vibes instead). Both come back flagged in `warnings`. Returns { updated: 'preferences' }, plus `warnings` ([{ key, reason, superseded_by }]) when part of the patch was accepted under a deprecated form and converted or dropped.",
      inputSchema: { patch: z.record(z.string(), z.unknown()) },
    },
    ({ patch }) => runTool(() => applyPreferencesPatch(env, username, patch)),
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

  // Ingredient aliases are shared corpus in the D1 `aliases` table — the matcher reads
  // them via readAliases, so writes go to the same table (not GitHub, which the matcher
  // no longer consults). update_aliases upserts each mapping by variant (add/edit); it
  // does not remove, matching the other shared-corpus add tools (update_feeds, etc.).
  server.registerTool(
    "update_aliases",
    {
      description:
        'Add or update shared ingredient alias mappings (variant → canonical), e.g. { "EVOO": "olive oil" }. Upserts each by variant into the shared corpus (D1). Call only when the user directs an alias edit, or to record one you confirmed during matching. Does not remove aliases. Optionally pass `display_names` (a map of canonical id → human label, e.g. { "cabbage::color-red": "Red cabbage" }) to set the curated display name stored on the identity node — written as a HUMAN override (it wins over any auto-derived label and is never downgraded); the rendered label a member sees is this display name (falling back to the resolver name when absent).',
      inputSchema: {
        aliases: z.record(z.string(), z.string()),
        display_names: z.record(z.string(), z.string()).optional(),
      },
    },
    ({ aliases, display_names }) =>
      runTool(async () => {
        const mappings = Object.entries(aliases).map(([variant, canonical]) => ({
          variant,
          canonical,
          // The curated label is keyed by canonical id — addAliases writes it source='human'.
          display_name: display_names?.[canonical],
        }));
        const updated = await addAliases(env, mappings);
        return { updated };
      }),
  );
}
